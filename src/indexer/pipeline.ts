import fs from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { scanWorkspaceFiles } from "../content/reader.js";
import type { RagConfig } from "../core/config.js";
import { loadManifest, saveManifest, normalizeFilePath } from "../core/manifest.js";
import type {
  Chunk,
  DescriptionProvider,
  EmbeddingProvider,
  IndexProgress,
  KeywordIndex,
  VectorStore,
} from "../core/interfaces.js";
import { embedBatch } from "../embedder/factory.js";
import { createVectorStore } from "../vectorstore/factory.js";
import { swapStoreDirectories } from "../vectorstore/lancedb.js";
import { createIndexStats, type IndexRunStats, type IndexStatusSummary } from "./stats.js";
import { prepareFile, buildTextsToEmbed, storeFileChunks, type WorkerResult, type PreparedFile } from "./worker.js";
import { getCurrentCommit, getChangedFilesSince, getUntrackedFiles, getRepoRoot } from "./git-diff.js";

export type { WatchPassScheduler } from "./watch.js";
export { createWatchPassScheduler, createWatchIgnore } from "./watch.js";

/** Options for configuring a single index pass. */
export interface RunIndexPassOptions {
  /** Workspace root directory. */
  cwd: string;
  /** Path to the vector store data directory. */
  storePath: string;
  /** Full RAG configuration for the workspace. */
  config: RagConfig;
  /** Vector store instance for persisting chunks. */
  store: VectorStore;
  /** Embedding provider for generating vector representations. */
  embedder: EmbeddingProvider;
  /** When true, ignore the existing manifest and re-index everything. */
  force?: boolean;
  /** Optional partial logger (missing methods default to no-ops). */
  logger?: Partial<Logger>;
  /** Optional keyword index to populate during the pass. */
  keywordIndex?: KeywordIndex;
  /** Optional provider for AI-generated chunk descriptions. */
  descriptionProvider?: DescriptionProvider;
  /** Optional progress tracker for reporting file-level progress. */
  progress?: IndexProgress;
  /** Optional abort signal – when fired, the pass finishes the current file then stops. */
  abortSignal?: AbortSignal;
  /** Embedding vector dimension — needed when creating a temporary store for atomic rebuilds. */
  dimension?: number;
}

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
}

function createLogger(logger?: Partial<Logger>): Logger {
  return {
    info: logger?.info ?? (() => {}),
    warn: logger?.warn ?? (() => {}),
    debug: logger?.debug ?? (() => {}),
  };
}

function tryUpdateLastGitCommit(cwd: string, manifest: { lastGitCommit?: string }): boolean {
  try {
    const repoRoot = getRepoRoot(cwd);
    if (!repoRoot) return false;
    const commit = getCurrentCommit(repoRoot);
    if (!commit) return false;
    manifest.lastGitCommit = commit;
    return true;
  } catch {
    return false;
  }
}

const LOCK_FILE = "index.lock";
const LOCK_MAX_AGE_MS = 5 * 60 * 1000;

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute a full index pass: scan workspace, prepare files, generate embeddings
 * (and optionally AI descriptions), and store results into the vector store.
 * Uses a lock file to prevent concurrent passes.
 *
 * @param options - Configuration for the index pass.
 * @returns Aggregate statistics for the pass.
 */
export async function runIndexPass(options: RunIndexPassOptions): Promise<IndexRunStats> {
  const logger = createLogger(options.logger);
  const lockPath = path.join(options.storePath, LOCK_FILE);

  try {
    const raw = await fs.readFile(lockPath, "utf-8");
    const lock = JSON.parse(raw) as { pid?: number; startedAt?: number };
    const age = lock.startedAt ? Date.now() - lock.startedAt : Infinity;
    if (lock.pid && !isPidAlive(lock.pid)) {
      logger.debug(`Stale lock from dead process ${lock.pid} — continuing`);
    } else if (lock.startedAt && age < LOCK_MAX_AGE_MS) {
      logger.warn(`Another index pass is running (PID ${lock.pid ?? "unknown"}). Skipping.`);
      return createIndexStats(0, "missing");
    }
  } catch {
    // No lock file — proceed
  }

  try {
    await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), "utf-8");
  } catch {
    // Best-effort lock
  }

  try {
    return await runIndexPassInner(options, logger);
  } finally {
    try { await fs.unlink(lockPath); } catch {}
  }
}

async function runIndexPassInner(options: RunIndexPassOptions, logger: Logger): Promise<IndexRunStats> {
  const loadResult = await loadManifest(options.storePath);
  const manifest = loadResult.manifest;
  let manifestStatus = loadResult.status;
  let rebuildPerformed = false;

  logger.info(`Manifest loaded: ${manifestStatus}, ${Object.keys(manifest.files).length} entries`);

  if (options.force) {
    manifestStatus = "missing";
    logger.debug("Force mode: ignoring manifest");
  }

  // Clear files that had description failures so they are fully re-indexed
  const descFailedPaths = Object.keys(manifest.files).filter(
    (p) => manifest.files[p]?.descriptionFailed,
  );
  if (descFailedPaths.length > 0) {
    logger.info(`  ${descFailedPaths.length} file(s) marked as description-failed — re-indexing`);
    for (const p of descFailedPaths) {
      delete manifest.files[p];
    }
  }

  let filterPaths: string[] | undefined;
  let gitDeletedPaths: string[] = [];

  if (!options.force && manifestStatus === "ok" && manifest.lastGitCommit) {
    const repoRoot = getRepoRoot(options.cwd);
    if (repoRoot) {
      const diffResult = getChangedFilesSince(options.cwd, manifest.lastGitCommit);
      if (diffResult) {
        const untracked = getUntrackedFiles(options.cwd);
        const changedSet = new Set<string>();
        for (const f of diffResult.changedFiles) changedSet.add(f);
        for (const f of untracked) changedSet.add(f);
        filterPaths = Array.from(changedSet);
        gitDeletedPaths = diffResult.deletedFiles;
        logger.debug(`Git incremental: ${filterPaths.length} changed/untracked, ${gitDeletedPaths.length} deleted since ${manifest.lastGitCommit.slice(0, 8)}`);
      }
    }
  }

  const scanStart = Date.now();
  const workspaceFiles = await scanWorkspaceFiles(
    options.cwd,
    options.config,
    logger,
    options.force ? undefined : manifest,
    filterPaths,
  );

  const scanSec = ((Date.now() - scanStart) / 1000).toFixed(1);
  logger.info(`Workspace scan complete: ${workspaceFiles.length} files in ${scanSec}s`);

  const existingCount = await options.store.count();

  // Detect data loss: if the store has far fewer chunks than the manifest expects,
  // treat it as a corrupt store (e.g. schema migration dropped the old table).
  if (!options.force && manifestStatus === "ok" && existingCount > 0) {
    const manifestTotalChunks = Object.values(manifest.files).reduce(
      (sum, entry) => sum + entry.chunkCount, 0
    );
    if (manifestTotalChunks > 0 && existingCount < manifestTotalChunks * 0.5) {
      logger.warn(
        `Store has ${existingCount} chunks but manifest expects ~${manifestTotalChunks}. ` +
        `Data appears to have been lost — re-indexing all files.`
      );
      for (const key of Object.keys(manifest.files)) {
        delete manifest.files[key];
      }
      manifest.lastIndexedAt = undefined;
      manifestStatus = "missing";
    }
  }

  // Effective store used throughout the pass — may be a temp store for atomic rebuild.
  let effectiveStore: VectorStore = options.store;
  let tempStorePath: string | undefined;

  if (options.force || (manifestStatus !== "ok" && existingCount > 0)) {
    options.keywordIndex?.clear();
    for (const key of Object.keys(manifest.files)) {
      delete manifest.files[key];
    }
    manifest.lastIndexedAt = undefined;
    rebuildPerformed = existingCount > 0 || Boolean(options.force);
    if (manifestStatus !== "ok" && existingCount > 0) {
      logger.warn("Manifest missing or corrupt; rebuilding full index.");
    }
    manifestStatus = options.force ? "missing" : manifestStatus;

    // Build the new index into a temporary store first, then atomically
    // swap on completion.  Original data stays untouched if the process
    // is aborted (Ctrl+C, crash) before the swap completes.
    if (options.dimension) {
      tempStorePath = options.storePath + "_tmp";
      try { await fs.rm(tempStorePath, { recursive: true, force: true }); } catch { /* may not exist */ }
      effectiveStore = createVectorStore(options.config, tempStorePath, options.dimension);
      logger.debug(`Rebuilding index in temporary store at ${tempStorePath}`);
    } else {
      // Fallback — in-memory store or no dimension: clear in place.
      logger.warn("No embedding dimension available; falling back to in-place clear.");
      await options.store.clear();
    }
  }

  const stats = createIndexStats(workspaceFiles.length, manifestStatus);
  stats.rebuildPerformed = rebuildPerformed;

  for (const file of workspaceFiles) {
    if (file.extractionStatus === "failed" && file.extractionError) {
      stats.extractionFailures++;
      stats.extractionErrors.push({
        filePath: file.filePath,
        error: file.extractionError,
      });
    }
  }

  const currentPaths = new Set(workspaceFiles.map((file) => file.normalizedPath));
  let stalePaths: string[];
  if (filterPaths) {
    const repoRoot = getRepoRoot(options.cwd) ?? options.cwd;
    stalePaths = gitDeletedPaths.map((p) => normalizeFilePath(path.resolve(repoRoot, p)));
  } else {
    stalePaths = Object.keys(manifest.files).filter((p) => !currentPaths.has(p));
  }
  if (stalePaths.length > 0) {
    logger.debug(`Removing ${stalePaths.length} stale files from index...`);
    const deleteLimit = pLimit(options.config.indexing.concurrency);
    await Promise.all(
      stalePaths.map((p) =>
        deleteLimit(async () => {
          await effectiveStore.deleteByFilePath(p);
          options.keywordIndex?.removeByFilePath(p);
          delete manifest.files[p];
          stats.deletedFiles++;
        }),
      ),
    );
  }

  let newCount = 0;
  let modifiedCount = 0;
  let unchangedCount = 0;
  for (const file of workspaceFiles) {
    const previous = manifest.files[file.normalizedPath];
    if (file.isEmpty || file.isTooSmall) continue;
    if (previous && previous.hash === file.hash) {
      unchangedCount++;
    } else if (previous) {
      modifiedCount++;
    } else {
      newCount++;
    }
  }
  if (stats.deletedFiles > 0) {
    logger.debug(`Removed ${stats.deletedFiles} deleted files from index.`);
  }
  logger.debug(`Processing ${workspaceFiles.length} files (${newCount} new, ${modifiedCount} modified, ${unchangedCount} unchanged)...`);

  // ── Phase 1: prepare all files (chunk + keyword, defer descriptions if provider present) ──
  const limit = pLimit(options.config.indexing.concurrency);
  const deferDescriptions = !!options.descriptionProvider;

  const prepared = await Promise.all(
    workspaceFiles.map((file) =>
      limit(async () => {
        const fileLabel = path.relative(options.cwd, file.normalizedPath).replace(/\\/g, "/");

        const isActive = !file.isEmpty && !file.isTooSmall &&
          (!manifest.files[file.normalizedPath] || manifest.files[file.normalizedPath]!.hash !== file.hash);
        if (isActive) {
          options.progress?.startFile(fileLabel);
        }

        const prep = await prepareFile(
          file,
          options.cwd,
          manifest.files[file.normalizedPath],
          options.config,
          options.keywordIndex,
          options.descriptionProvider,
          logger,
          deferDescriptions,
        );

        if (prep.earlyResult && isActive) {
          options.progress?.finishFile(fileLabel);
        }

        return prep;
      }),
    ),
  );

  // ── Phase 1.5: global description generation (single pool, no nested concurrency) ──
  if (deferDescriptions) {
    const deferredPreps = prepared.filter((p) => p.chunks && p.chunks.length > 0 && p.relPath !== undefined);
    if (deferredPreps.length > 0) {
      const allChunks: Chunk[] = [];
      for (const prep of deferredPreps) {
        for (const chunk of prep.chunks!) {
          if (chunk.metadata.contentType !== "image") {
            allChunks.push(chunk);
          }
        }
      }

      // Advance progress to Description stage before descriptions start
      for (const prep of deferredPreps) {
        options.progress?.finishStage(prep.fileLabel);
      }

      if (allChunks.length > 0) {
        try {
          const batchResult = await options.descriptionProvider!.generateBatchDescriptions(allChunks, (msg: string) => logger.debug(msg));
          for (const chunk of allChunks) {
            const desc = batchResult.get(chunk.id);
            if (desc && desc.trim().length > 0) {
              chunk.description = desc;
            }
          }
        } catch (err) {
          logger.warn(`  Global description generation failed: ${(err as Error).message}`);
          for (const prep of deferredPreps) {
            if (prep.chunks!.some((c) => c.metadata.contentType !== "image")) {
              prep.descriptionFailed = true;
            }
          }
        }
      }

      // Phase 1.6: build textToEmbed with descriptions injected
      for (const prep of deferredPreps) {
        prep.textToEmbed = buildTextsToEmbed(
          prep.chunks!,
          prep.relPath!,
          prep.metaHeader ?? "",
          prep.docPrefix ?? "",
          prep.isImageFile ?? false,
        );
      }
    }
  }

  // ── Phase 2+3: per-file delete, embed + store (in parallel) ──
  // Deletions for modified/re-removed files happen per-worker, right before
  // embedding, so that an abort mid-embed doesn't orphan old entries.
  const isOllama = options.embedder.name === "ollama";
  const ollamaMaxBatch = options.config.indexing.ollamaMaxBatchSize ?? 4000;
  const defaultBatchSize = options.config.indexing.embedBatchSize;
  const defaultConcurrency = options.config.indexing.embedConcurrency ?? 1;

  // File metadata look-up for manifest entries
  const fileMeta = new Map(workspaceFiles.map((f) => [f.normalizedPath, { mtime: f.mtime, size: f.size }]));

  // Serialised manifest-save queue — prevents concurrent write races and acts
  // as a checkpoint for Ctrl+C resilience.  Each worker appends to this chain
  // after a successful store, so previously completed files are never lost.
  let manifestSaveChain = Promise.resolve<void>(undefined);
  function enqueueManifestSave(): void {
    manifestSaveChain = manifestSaveChain.then(() =>
      saveManifest(options.storePath, manifest),
    );
  }

  const aborted = (): boolean => options.abortSignal?.aborted ?? false;

  const embedStoreLimit = pLimit(options.config.indexing.concurrency);
  const workerResults = await Promise.all(
    prepared.map((prep) =>
      embedStoreLimit(async () => {
        // ── Check abort signal before any work ──
        if (aborted()) {
          return { normalizedPath: prep.normalizedPath, skipped: true as const } as const;
        }

        // ── Early results (empty / too-small / unchanged / chunking failure) ──
        if (prep.earlyResult) {
          // Remove stale manifest/store entries for files that no longer produce chunks
          if (prep.earlyResult.isRemoved) {
            await effectiveStore.deleteByFilePath(prep.normalizedPath);
            options.keywordIndex?.removeByFilePath(prep.normalizedPath);
            delete manifest.files[prep.normalizedPath];
            enqueueManifestSave();
          }
          return prep.earlyResult;
        }

        if (!prep.chunks || !prep.textToEmbed || prep.textToEmbed.length === 0) {
          options.progress?.finishFile(prep.fileLabel);
          return {
            normalizedPath: prep.normalizedPath, hash: prep.hash, chunkCount: 0,
            fileLabel: prep.fileLabel,
            isNew: false, isModified: false, isUnchanged: false, isEmpty: false,
            isTooSmall: false, isRemoved: true, hadChunks: false,
            descriptionFailed: prep.descriptionFailed,
          };
        }

        // ── Embed ──
        const batchSize = isOllama
          ? Math.min(prep.textToEmbed.length, ollamaMaxBatch)
          : defaultBatchSize;
        const concurrency = isOllama ? 1 : defaultConcurrency;

        options.progress?.finishStage(prep.fileLabel);

        let embeddings: number[][];
        try {
          embeddings = await embedBatch(
            options.embedder,
            prep.textToEmbed,
            batchSize,
            "document",
            concurrency,
          );
        } catch (err) {
          logger.warn(`  ${prep.fileLabel} (embedding failed: ${(err as Error).message})`);
          options.progress?.failFile(prep.fileLabel);
          return {
            normalizedPath: prep.normalizedPath, hash: prep.hash, chunkCount: 0,
            fileLabel: prep.fileLabel,
            isNew: false, isModified: false, isUnchanged: false, isEmpty: false,
            isTooSmall: false, isRemoved: true, hadChunks: false,
            descriptionFailed: prep.descriptionFailed,
          };
        }

        // ── Store (new data first; orphan cleanup is handled inside the store) ──
        const result = await storeFileChunks(prep, embeddings, effectiveStore, logger);

        // ── Update manifest in-memory and enqueue an atomic save ──
        if (result.chunkCount > 0 && !result.isRemoved) {
          const meta = fileMeta.get(result.normalizedPath);
          manifest.files[result.normalizedPath] = {
            hash: result.hash,
            chunkCount: result.chunkCount,
            indexedAt: Date.now(),
            mtime: meta?.mtime,
            size: meta?.size,
            descriptionFailed: result.descriptionFailed,
          };
          enqueueManifestSave();
        } else if (result.isRemoved) {
          delete manifest.files[result.normalizedPath];
          enqueueManifestSave();
        }

        options.progress?.finishFile(prep.fileLabel);
        return result;
      }),
    ),
  );

  // Strip skipped sentinels
  const finalResults: WorkerResult[] = [];
  for (const r of workerResults) {
    if ((r as { skipped?: boolean }).skipped) break;
    finalResults.push(r as WorkerResult);
  }

  // Drain any in-flight manifest saves so all file entries are durable
  await manifestSaveChain;

  // Update mtime/size for unchanged files (speeds up the next scan)
  for (const { normalizedPath, mtime, size } of workspaceFiles) {
    const entry = manifest.files[normalizedPath];
    if (entry && (mtime !== undefined || size !== undefined)) {
      entry.mtime = mtime;
      entry.size = size;
    }
  }

  // ── Aggregate stats ──
  aggregateStats(stats, finalResults);

  // Update timestamps; advance lastGitCommit ONLY on a complete pass
  manifest.lastIndexedAt = Date.now();
  if (!aborted()) {
    tryUpdateLastGitCommit(options.cwd, manifest);
  }

  // ── Atomically promote temp store if a full rebuild was performed ──
  if (tempStorePath) {
    if (!aborted()) {
      try {
        await effectiveStore.close();
        await options.store.close();
        // Swap the newly-built temp directory into the real path
        await swapStoreDirectories(tempStorePath, options.storePath);
        // Re-open the original store handle so callers can search the new data
        if (typeof (options.store as any).reopen === "function") {
          await (options.store as any).reopen(options.storePath);
        }
        logger.debug(`Promoted temporary store ${tempStorePath} → ${options.storePath}`);
      } catch (err) {
        logger.warn(
          `Could not promote temporary store: ${(err as Error).message}. ` +
          `Original data preserved at ${options.storePath}`,
        );
        try { await fs.rm(tempStorePath, { recursive: true, force: true }); } catch {}
      }
    } else {
      // Aborted — discard temp, keep original data intact
      effectiveStore.close().catch(() => {});
      try { await fs.rm(tempStorePath, { recursive: true, force: true }); } catch {}
      logger.debug("Index pass cancelled; discarded temporary store.");
    }
  }

  // Save manifest and keyword index (always to the real store path — after
  // a successful swap this points to the new data; after an abort it's the old).
  await saveManifest(options.storePath, manifest);
  await options.keywordIndex?.save(options.storePath);

  // Count from the store — after a successful swap, the original handle has
  // been reopened pointing to the new directory.
  try {
    stats.finalCount = await options.store.count();
  } catch {
    stats.finalCount = (tempStorePath ? 0 : stats.totalChunks);
  }
  return stats;
}

function aggregateStats(
  stats: IndexRunStats,
  results: WorkerResult[],
): void {
  for (const result of results) {
    if (result.isEmpty) {
      stats.skippedEmptyFiles++;
      if (result.isRemoved) stats.removedFiles++;
      continue;
    }
    if (result.isTooSmall) {
      stats.skippedSmallFiles++;
      if (result.isRemoved) stats.removedFiles++;
      continue;
    }
    if (result.isUnchanged) {
      stats.unchangedFiles++;
      continue;
    }
    if (result.isRemoved) {
      stats.removedFiles++;
      continue;
    }
    if (result.isModified) {
      stats.modifiedFiles++;
    } else if (result.isNew) {
      stats.newFiles++;
    }
    if (result.chunkCount > 0) {
      if (result.descriptionFailed) {
        stats.descriptionFailedFiles++;
      }
      stats.totalChunks += result.chunkCount;
      stats.batchesFlushed++;
    }
  }
}

export async function getIndexStatusSummary(
  cwd: string,
  storePath: string,
  config: RagConfig,
  store: VectorStore,
): Promise<IndexStatusSummary> {
  const loadResult = await loadManifest(storePath);
  const manifest = loadResult.manifest;
  const workspaceFiles = await scanWorkspaceFiles(cwd, config, undefined, manifest);
  const storeCount = await store.count();

  if (loadResult.status !== "ok") {
    return {
      manifestStatus: loadResult.status,
      manifestEntries: 0,
      upToDateFiles: 0,
      pendingFiles: workspaceFiles.length,
      rebuildRequired: storeCount > 0,
      storeChunkCount: storeCount,
      manifestExpectedChunks: 0,
    };
  }

  const currentPaths = new Set(workspaceFiles.map((file) => file.normalizedPath));
  let upToDateFiles = 0;
  let pendingFiles = 0;

  for (const file of workspaceFiles) {
    const previous = manifest.files[file.normalizedPath];
    if (file.isEmpty || file.isTooSmall) {
      if (previous) pendingFiles++;
      continue;
    }

    if (previous && previous.hash === file.hash) {
      upToDateFiles++;
    } else {
      pendingFiles++;
    }
  }

  for (const indexedPath of Object.keys(manifest.files)) {
    if (!currentPaths.has(indexedPath)) {
      pendingFiles++;
    }
  }

  const manifestExpectedChunks = Object.values(manifest.files).reduce(
    (sum, entry) => sum + entry.chunkCount, 0
  );

  return {
    manifestStatus: loadResult.status,
    manifestEntries: Object.keys(manifest.files).length,
    upToDateFiles,
    pendingFiles,
    lastIndexedAt: manifest.lastIndexedAt,
    rebuildRequired: false,
    storeChunkCount: storeCount,
    manifestExpectedChunks,
  };
}
