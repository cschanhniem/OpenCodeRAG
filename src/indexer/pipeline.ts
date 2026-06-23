import fs from "node:fs/promises";
import { unlinkSync } from "node:fs";
import path from "node:path";
import pLimit from "p-limit";
import { scanWorkspaceFiles } from "../content/reader.js";
import type { RagConfig } from "../core/config.js";
import { loadManifest, saveManifest, normalizeFilePath } from "../core/manifest.js";
import type {
  Chunk,
  DescriptionProvider,
  EmbeddingProvider,
  KeywordIndex,
  VectorStore,
} from "../core/interfaces.js";
import { embedBatch } from "../embedder/factory.js";
import { createIndexStats, type IndexRunStats, type IndexStatusSummary } from "./stats.js";
import { prepareFile, buildTextsToEmbed, type WorkerResult, type PreparedFile } from "./worker.js";
import { getCurrentCommit, getChangedFilesSince, getUntrackedFiles, getRepoRoot } from "./git-diff.js";

export type { WatchPassScheduler } from "./watch.js";
export { createWatchPassScheduler, createWatchIgnore } from "./watch.js";

export interface RunIndexPassOptions {
  cwd: string;
  storePath: string;
  config: RagConfig;
  store: VectorStore;
  embedder: EmbeddingProvider;
  force?: boolean;
  logger?: Partial<Logger>;
  keywordIndex?: KeywordIndex;
  descriptionProvider?: DescriptionProvider;
}

interface Logger {
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

  const cleanupLock = () => {
    try { unlinkSync(lockPath); } catch {}
  };

  process.once("SIGINT", cleanupLock);
  process.once("SIGTERM", cleanupLock);

  try {
    return await runIndexPassInner(options, logger);
  } finally {
    process.off("SIGINT", cleanupLock);
    process.off("SIGTERM", cleanupLock);
    try { await fs.unlink(lockPath); } catch {}
  }
}

async function runIndexPassInner(options: RunIndexPassOptions, logger: Logger): Promise<IndexRunStats> {
  const loadResult = await loadManifest(options.storePath);
  const manifest = loadResult.manifest;
  let manifestStatus = loadResult.status;
  let rebuildPerformed = false;

  logger.debug(`Manifest loaded: ${manifestStatus}, ${Object.keys(manifest.files).length} entries`);

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

  const workspaceFiles = await scanWorkspaceFiles(
    options.cwd,
    options.config,
    logger,
    options.force ? undefined : manifest,
    filterPaths,
  );

  logger.debug(`Workspace scan complete: ${workspaceFiles.length} files`);

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

  if (options.force || (manifestStatus !== "ok" && existingCount > 0)) {
    await options.store.clear();
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
    stalePaths = gitDeletedPaths.map((p) => normalizeFilePath(path.resolve(options.cwd, p)));
  } else {
    stalePaths = Object.keys(manifest.files).filter((p) => !currentPaths.has(p));
  }
  if (stalePaths.length > 0) {
    logger.debug(`Removing ${stalePaths.length} stale files from index...`);
    const deleteLimit = pLimit(options.config.indexing.concurrency);
    await Promise.all(
      stalePaths.map((p) =>
        deleteLimit(async () => {
          await options.store.deleteByFilePath(p);
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
    logger.info(`Removed ${stats.deletedFiles} deleted files from index.`);
  }
  logger.info(`Processing ${workspaceFiles.length} files (${newCount} new, ${modifiedCount} modified, ${unchangedCount} unchanged)...`);

  // ── Phase 1: prepare all files (chunk + keyword, defer descriptions if provider present) ──
  const limit = pLimit(options.config.indexing.concurrency);
  let completed = 0;
  let started = 0;
  const total = workspaceFiles.length;
  const deferDescriptions = !!options.descriptionProvider;

  const prepared = await Promise.all(
    workspaceFiles.map((file) =>
      limit(async () => {
        const fileLabel = file.normalizedPath;
        started++;
        logger.info(`  Preparing file: ${started} - ${fileLabel}`);
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
        completed++;
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

      if (allChunks.length > 0) {
        logger.info(`  Generating descriptions for ${allChunks.length} chunks...`);
        try {
          const batchResult = await options.descriptionProvider!.generateBatchDescriptions(allChunks, (msg: string) => logger.debug(msg));
          for (const chunk of allChunks) {
            const desc = batchResult.get(chunk.id);
            if (desc && desc.trim().length > 0) {
              chunk.description = desc;
            }
          }
          logger.info(`  Descriptions generated for ${batchResult.size} chunks`);
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

  // ── Handle deletions from store for files being re-processed ──
  const deletionLimit = pLimit(options.config.indexing.concurrency);
  await Promise.all(
    prepared.map((prep) =>
      deletionLimit(async () => {
        if (prep.earlyResult?.isRemoved) {
          await options.store.deleteByFilePath(prep.normalizedPath);
          options.keywordIndex?.removeByFilePath(prep.normalizedPath);
          return;
        }
        if (prep.isModified && prep.chunks && prep.chunks.length > 0) {
          await options.store.deleteByFilePath(prep.normalizedPath);
          options.keywordIndex?.removeByFilePath(prep.normalizedPath);
        }
      }),
    ),
  );

  // ── Phase 2: global embedding batch ──
  const allTextToEmbed: string[] = [];
  const textPrepIndex: number[] = [];

  for (let i = 0; i < prepared.length; i++) {
    const prep = prepared[i]!;
    if (prep.chunks && prep.textToEmbed && prep.textToEmbed.length > 0) {
      for (const text of prep.textToEmbed) {
        allTextToEmbed.push(text);
        textPrepIndex.push(i);
      }
    }
  }

  let allEmbeddings: number[][] = [];
  if (allTextToEmbed.length > 0) {
    const embedConcurrency = options.config.indexing.embedConcurrency ?? 1;
    logger.info(`  Embedding ${allTextToEmbed.length} chunks in global batch (concurrency: ${embedConcurrency})...`);
    allEmbeddings = await embedBatch(
      options.embedder,
      allTextToEmbed,
      options.config.indexing.embedBatchSize,
      "document",
      embedConcurrency,
    );
    logger.debug(`  Embedding batch complete: ${allEmbeddings.length} vectors`);
  }

  // ── Distribute embeddings back to prepared files ──
  const embedByPrep = new Map<number, number[][]>();
  for (let i = 0; i < textPrepIndex.length; i++) {
    const prepIdx = textPrepIndex[i]!;
    const emb = allEmbeddings[i];
    if (!embedByPrep.has(prepIdx)) {
      embedByPrep.set(prepIdx, []);
    }
    if (emb) {
      embedByPrep.get(prepIdx)!.push(emb);
    }
  }

  // ── Phase 3: store all files with their embeddings (batched) ──
  logger.debug(`Phase 3: storing chunks for ${prepared.length} files...`);

  const allValidChunks: Chunk[] = [];
  const workerResults: WorkerResult[] = prepared.map((prep, idx) => {
    if (prep.earlyResult) {
      return prep.earlyResult;
    }
    if (!prep.chunks || !prep.textToEmbed) {
      return {
        normalizedPath: prep.normalizedPath, hash: prep.hash, chunkCount: 0, fileLabel: prep.fileLabel,
        isNew: false, isModified: false, isUnchanged: false, isEmpty: false, isTooSmall: false, isRemoved: true, hadChunks: false,
        descriptionFailed: prep.descriptionFailed,
      };
    }

    const embeddings = embedByPrep.get(idx) ?? [];
    for (let i = 0; i < prep.chunks.length; i++) {
      const emb = embeddings[i];
      if (Array.isArray(emb) && emb.length > 0 && typeof emb[0] === "number") {
        prep.chunks[i]!.embedding = emb as number[];
      } else {
        prep.chunks[i]!.embedding = undefined;
      }
    }

    const validChunks = prep.chunks.filter((c) => c.embedding && c.embedding.length > 0);
    allValidChunks.push(...validChunks);

    logger.info(`  ${prep.fileLabel} (${prep.chunks.length} chunks${prep.isModified ? ", modified" : ", new"})`);

    return {
      normalizedPath: prep.normalizedPath,
      hash: prep.hash,
      chunkCount: prep.chunks.length,
      fileLabel: prep.fileLabel,
      isNew: !prep.isModified,
      isModified: prep.isModified,
      isUnchanged: false,
      isEmpty: false,
      isTooSmall: false,
      isRemoved: false,
      hadChunks: prep.chunks.length > 0,
      descriptionFailed: prep.descriptionFailed,
    };
  });

  if (allValidChunks.length > 0) {
    const STORE_BATCH = 1000;
    for (let i = 0; i < allValidChunks.length; i += STORE_BATCH) {
      const batch = allValidChunks.slice(i, i + STORE_BATCH);
      await options.store.addChunks(batch);
    }
    logger.debug(`  Stored ${allValidChunks.length} chunks in batched writes`);
  }

  // ── Aggregate stats and update manifest ──
  aggregateStats(stats, workerResults, manifest, workspaceFiles);

  manifest.lastIndexedAt = Date.now();
  tryUpdateLastGitCommit(options.cwd, manifest);

  await saveManifest(options.storePath, manifest);
  await options.keywordIndex?.save(options.storePath);
  stats.finalCount = await options.store.count();
  return stats;
}

function aggregateStats(
  stats: IndexRunStats,
  results: WorkerResult[],
  manifest: { files: Record<string, { hash: string; chunkCount: number; indexedAt?: number; mtime?: number; size?: number; descriptionFailed?: boolean }> },
  workspaceFiles: { normalizedPath: string; mtime?: number; size?: number }[],
): void {
  const fileMeta = new Map(workspaceFiles.map((f) => [f.normalizedPath, { mtime: f.mtime, size: f.size }]));

  for (const result of results) {
    if (result.isEmpty) {
      stats.skippedEmptyFiles++;
      if (result.isRemoved) {
        delete manifest.files[result.normalizedPath];
        stats.removedFiles++;
      }
      continue;
    }
    if (result.isTooSmall) {
      stats.skippedSmallFiles++;
      if (result.isRemoved) {
        delete manifest.files[result.normalizedPath];
        stats.removedFiles++;
      }
      continue;
    }
    if (result.isUnchanged) {
      stats.unchangedFiles++;
      continue;
    }
    if (result.isRemoved) {
      delete manifest.files[result.normalizedPath];
      stats.removedFiles++;
      continue;
    }
    if (result.isModified) {
      stats.modifiedFiles++;
    } else if (result.isNew) {
      stats.newFiles++;
    }
    if (result.chunkCount > 0) {
      const meta = fileMeta.get(result.normalizedPath);
      manifest.files[result.normalizedPath] = {
        hash: result.hash,
        chunkCount: result.chunkCount,
        indexedAt: Date.now(),
        mtime: meta?.mtime,
        size: meta?.size,
        descriptionFailed: result.descriptionFailed,
      };
      if (result.descriptionFailed) {
        stats.descriptionFailedFiles++;
      }
      stats.totalChunks += result.chunkCount;
      stats.batchesFlushed++;
    }
  }

  for (const { normalizedPath, mtime, size } of workspaceFiles) {
    const entry = manifest.files[normalizedPath];
    if (entry && (mtime !== undefined || size !== undefined)) {
      entry.mtime = mtime;
      entry.size = size;
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
