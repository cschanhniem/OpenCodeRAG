import pLimit from "p-limit";
import { scanWorkspaceFiles } from "../content/reader.js";
import type { RagConfig } from "../core/config.js";
import { loadManifest, saveManifest } from "../core/manifest.js";
import type {
  DescriptionProvider,
  EmbeddingProvider,
  KeywordIndex,
  VectorStore,
} from "../core/interfaces.js";
import { createIndexStats, type IndexRunStats, type IndexStatusSummary } from "./stats.js";
import { processFile, type WorkerResult } from "./worker.js";

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
}

function createLogger(logger?: Partial<Logger>): Logger {
  return {
    info: logger?.info ?? (() => {}),
    warn: logger?.warn ?? (() => {}),
  };
}

export async function runIndexPass(options: RunIndexPassOptions): Promise<IndexRunStats> {
  const logger = createLogger(options.logger);
  const workspaceFiles = await scanWorkspaceFiles(options.cwd, options.config, logger);
  const loadResult = await loadManifest(options.storePath);
  const manifest = loadResult.manifest;
  let manifestStatus = loadResult.status;
  let rebuildPerformed = false;

  const existingCount = await options.store.count();
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
  for (const indexedPath of Object.keys(manifest.files)) {
    if (!currentPaths.has(indexedPath)) {
      await options.store.deleteByFilePath(indexedPath);
      options.keywordIndex?.removeByFilePath(indexedPath);
      delete manifest.files[indexedPath];
      stats.deletedFiles++;
    }
  }

  const limit = pLimit(options.config.indexing.concurrency);

  const workerResults = await Promise.all(
    workspaceFiles.map((file) =>
      limit(() =>
        processFile(
          file,
          options.cwd,
          manifest.files[file.normalizedPath],
          options.config,
          options.store,
          options.keywordIndex,
          options.embedder,
          options.descriptionProvider,
          logger,
        ),
      ),
    ),
  );

  aggregateStats(stats, workerResults, manifest);

  manifest.lastIndexedAt = Date.now();
  await saveManifest(options.storePath, manifest);
  await options.keywordIndex?.save(options.storePath);
  stats.finalCount = await options.store.count();
  return stats;
}

function aggregateStats(
  stats: IndexRunStats,
  results: WorkerResult[],
  manifest: { files: Record<string, { hash: string; chunkCount: number; indexedAt?: number }> },
): void {
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
      manifest.files[result.normalizedPath] = {
        hash: result.hash,
        chunkCount: result.chunkCount,
        indexedAt: Date.now(),
      };
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
  const workspaceFiles = await scanWorkspaceFiles(cwd, config);
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
