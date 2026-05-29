import fs from "node:fs/promises";
import path from "node:path";
import { chunkFile } from "./chunker/factory.js";
import type { RagConfig } from "./core/config.js";
import {
  computeFileHash,
  loadManifest,
  manifestPathFor,
  normalizeFilePath,
  saveManifest,
  type FileManifest,
} from "./core/manifest.js";
import type { Chunk, EmbeddingProvider, VectorStore } from "./core/interfaces.js";
import { embedBatch } from "./embedder/factory.js";

export interface IndexRunStats {
  totalFiles: number;
  newFiles: number;
  modifiedFiles: number;
  unchangedFiles: number;
  deletedFiles: number;
  removedFiles: number;
  skippedEmptyFiles: number;
  skippedSmallFiles: number;
  totalChunks: number;
  finalCount: number;
  manifestStatus: "ok" | "missing" | "corrupt";
  rebuildPerformed: boolean;
  batchesFlushed: number;
}

export interface IndexStatusSummary {
  manifestStatus: "ok" | "missing" | "corrupt";
  manifestEntries: number;
  upToDateFiles: number;
  pendingFiles: number;
  lastIndexedAt?: number;
  rebuildRequired: boolean;
}

interface WorkspaceFile {
  filePath: string;
  normalizedPath: string;
  content: string;
  hash: string;
  isEmpty: boolean;
  isTooSmall: boolean;
}

interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

export interface RunIndexPassOptions {
  cwd: string;
  storePath: string;
  config: RagConfig;
  store: VectorStore;
  embedder: EmbeddingProvider;
  force?: boolean;
  logger?: Partial<Logger>;
}

export interface WatchPassScheduler {
  notifyChange(): void;
  waitForIdle(): Promise<void>;
  close(): void;
}

const BATCH_SIZE = 50;

function createLogger(logger?: Partial<Logger>): Logger {
  return {
    info: logger?.info ?? (() => {}),
    warn: logger?.warn ?? (() => {}),
  };
}

export async function walkFiles(
  dir: string,
  extensions: Set<string>,
  excludeDirs: Set<string>
): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (excludeDirs.has(entry.name)) continue;
      if (entry.name.startsWith(".") && !extensions.size) continue;
      results.push(...(await walkFiles(fullPath, extensions, excludeDirs)));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.has(ext)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

async function scanWorkspace(cwd: string, config: RagConfig): Promise<WorkspaceFile[]> {
  const files = await walkFiles(
    cwd,
    new Set(config.indexing.includeExtensions),
    new Set(config.indexing.excludeDirs)
  );

  const minSize = config.indexing.minFileSizeBytes ?? 0;
  const workspaceFiles: WorkspaceFile[] = [];
  for (const filePath of files) {
    const content = await fs.readFile(filePath, "utf-8");
    const byteLength = Buffer.byteLength(content, "utf-8");
    workspaceFiles.push({
      filePath,
      normalizedPath: normalizeFilePath(filePath),
      content,
      hash: computeFileHash(content),
      isEmpty: content.trim().length === 0,
      isTooSmall: !content.trim().length === false && byteLength < minSize,
    });
  }

  return workspaceFiles;
}

function createIndexStats(totalFiles: number, manifestStatus: IndexRunStats["manifestStatus"]): IndexRunStats {
  return {
    totalFiles,
    newFiles: 0,
    modifiedFiles: 0,
    unchangedFiles: 0,
    deletedFiles: 0,
    removedFiles: 0,
    skippedEmptyFiles: 0,
    skippedSmallFiles: 0,
    totalChunks: 0,
    finalCount: 0,
    manifestStatus,
    rebuildPerformed: false,
    batchesFlushed: 0,
  };
}

function updateManifestEntry(manifest: FileManifest, file: WorkspaceFile, chunkCount: number): void {
  manifest.files[file.normalizedPath] = {
    hash: file.hash,
    chunkCount,
    indexedAt: Date.now(),
  };
}

async function flushChunkBatch(store: VectorStore, chunkBatch: Chunk[]): Promise<boolean> {
  if (chunkBatch.length === 0) return false;
  await store.addChunks(chunkBatch.splice(0, chunkBatch.length));
  return true;
}

export async function runIndexPass(options: RunIndexPassOptions): Promise<IndexRunStats> {
  const logger = createLogger(options.logger);
  const workspaceFiles = await scanWorkspace(options.cwd, options.config);
  const loadResult = await loadManifest(options.storePath);
  const manifest = loadResult.manifest;
  let manifestStatus = loadResult.status;
  let rebuildPerformed = false;

  const existingCount = await options.store.count();
  if (options.force || (manifestStatus !== "ok" && existingCount > 0)) {
    await options.store.clear();
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

  const currentPaths = new Set(workspaceFiles.map((file) => file.normalizedPath));
  for (const indexedPath of Object.keys(manifest.files)) {
    if (!currentPaths.has(indexedPath)) {
      await options.store.deleteByFilePath(indexedPath);
      delete manifest.files[indexedPath];
      stats.deletedFiles++;
    }
  }

  const chunkBatch: Chunk[] = [];

  for (const file of workspaceFiles) {
    const previous = manifest.files[file.normalizedPath];

    if (file.isEmpty) {
      stats.skippedEmptyFiles++;
      if (previous) {
        await options.store.deleteByFilePath(file.normalizedPath);
        delete manifest.files[file.normalizedPath];
        stats.removedFiles++;
        logger.info(`  ${path.relative(options.cwd, file.filePath)} (empty, removed from index)`);
      } else {
        logger.info(`  ${path.relative(options.cwd, file.filePath)} (empty, skipped)`);
      }
      continue;
    }

    if (file.isTooSmall) {
      stats.skippedSmallFiles++;
      if (previous) {
        await options.store.deleteByFilePath(file.normalizedPath);
        delete manifest.files[file.normalizedPath];
        stats.removedFiles++;
        logger.info(`  ${path.relative(options.cwd, file.filePath)} (too small, removed from index)`);
      } else {
        logger.info(`  ${path.relative(options.cwd, file.filePath)} (too small, skipped)`);
      }
      continue;
    }

    if (previous && previous.hash === file.hash) {
      stats.unchangedFiles++;
      logger.info(`  ${path.relative(options.cwd, file.filePath)} (unchanged)`);
      continue;
    }

    if (previous) {
      await options.store.deleteByFilePath(file.normalizedPath);
      stats.modifiedFiles++;
    } else {
      stats.newFiles++;
    }

    const chunks = await chunkFile(file.filePath, file.content);
    if (chunks.length === 0) {
      delete manifest.files[file.normalizedPath];
      stats.removedFiles++;
      logger.info(`  ${path.relative(options.cwd, file.filePath)} (0 chunks, removed from index)`);
      continue;
    }

    const embeddings = await embedBatch(
      options.embedder,
      chunks.map((chunk) => chunk.content)
    );

    for (let i = 0; i < chunks.length; i++) {
      const emb = embeddings[i];
      if (Array.isArray(emb) && emb.length > 0 && typeof emb[0] === "number") {
        chunks[i]!.embedding = emb as number[];
      } else {
        // Guard against malformed provider output so the chunk is skipped
        // instead of corrupting the vector store.
        chunks[i]!.embedding = undefined;
      }
    }

    chunkBatch.push(...chunks);
    stats.totalChunks += chunks.length;
    updateManifestEntry(manifest, file, chunks.length);

    if (chunkBatch.length >= BATCH_SIZE) {
      if (await flushChunkBatch(options.store, chunkBatch)) {
        stats.batchesFlushed++;
      }
    }

    logger.info(
      `  ${path.relative(options.cwd, file.filePath)} (${chunks.length} chunks${previous ? ", modified" : ", new"})`
    );
  }

  if (await flushChunkBatch(options.store, chunkBatch)) {
    stats.batchesFlushed++;
  }

  manifest.lastIndexedAt = Date.now();
  await saveManifest(options.storePath, manifest);
  stats.finalCount = await options.store.count();
  return stats;
}

export async function getIndexStatusSummary(
  cwd: string,
  storePath: string,
  config: RagConfig,
  store: VectorStore
): Promise<IndexStatusSummary> {
  const workspaceFiles = await scanWorkspace(cwd, config);
  const loadResult = await loadManifest(storePath);
  const storeCount = await store.count();

  if (loadResult.status !== "ok") {
    return {
      manifestStatus: loadResult.status,
      manifestEntries: 0,
      upToDateFiles: 0,
      pendingFiles: workspaceFiles.length,
      rebuildRequired: storeCount > 0,
    };
  }

  const manifest = loadResult.manifest;
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

  return {
    manifestStatus: loadResult.status,
    manifestEntries: Object.keys(manifest.files).length,
    upToDateFiles,
    pendingFiles,
    lastIndexedAt: manifest.lastIndexedAt,
    rebuildRequired: false,
  };
}

export function createWatchPassScheduler(
  runPass: () => Promise<void>,
  onError: (error: unknown) => void,
  debounceMs: number = 300
): WatchPassScheduler {
  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let rerunRequested = false;
  let closed = false;
  const waiters: Array<() => void> = [];

  function resolveWaiters(): void {
    if (running || timer || rerunRequested) return;
    while (waiters.length > 0) {
      waiters.shift()?.();
    }
  }

  function schedule(): void {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void execute();
    }, debounceMs);
  }

  async function execute(): Promise<void> {
    if (closed) return;
    if (running) {
      rerunRequested = true;
      return;
    }

    running = true;
    try {
      await runPass();
    } catch (error) {
      onError(error);
    } finally {
      running = false;
      if (rerunRequested) {
        rerunRequested = false;
        schedule();
      } else {
        resolveWaiters();
      }
    }
  }

  return {
    notifyChange() {
      if (closed) return;
      if (running) {
        rerunRequested = true;
        return;
      }
      schedule();
    },
    waitForIdle() {
      if (!running && !timer && !rerunRequested) {
        return Promise.resolve();
      }
      return new Promise((resolve) => {
        waiters.push(resolve);
      });
    },
    close() {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      resolveWaiters();
    },
  };
}

export function createWatchIgnore(
  cwd: string,
  config: RagConfig,
  storePath: string
): (watchedPath: string) => boolean {
  const manifestPath = manifestPathFor(storePath);
  const excludeDirs = new Set(config.indexing.excludeDirs);

  return (watchedPath: string): boolean => {
    const resolved = path.resolve(watchedPath);
    if (resolved.startsWith(storePath)) return true;
    if (resolved === manifestPath) return true;

    const relative = path.relative(cwd, resolved);
    if (!relative || relative.startsWith("..")) return false;
    const segments = relative.split(path.sep);
    return segments.some((segment) => excludeDirs.has(segment));
  };
}
