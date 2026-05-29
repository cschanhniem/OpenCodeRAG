import chokidar from "chokidar";
import path from "node:path";
import { appendDebugLog } from "./core/fileLogger.js";
import type { RagConfig } from "./core/config.js";
import type { EmbeddingProvider, VectorStore } from "./core/interfaces.js";
import {
  createWatchPassScheduler,
  createWatchIgnore,
  runIndexPass,
} from "./indexer.js";

export interface BackgroundIndexer {
  close(): Promise<void>;
}

export interface CreateBackgroundIndexerOptions {
  cwd: string;
  storePath: string;
  config: RagConfig;
  store: VectorStore;
  embedder: EmbeddingProvider;
  logFilePath: string;
}

export function createBackgroundIndexer(options: CreateBackgroundIndexerOptions): BackgroundIndexer {
  const { cwd, storePath, config, store, embedder, logFilePath } = options;

  // Fire-and-forget initial index pass
  runIndexPass({
    cwd,
    storePath,
    config,
    store,
    embedder,
    logger: {
      info: (message) => appendDebugLog(logFilePath, { scope: "autoIndex", message }),
      warn: (message) => appendDebugLog(logFilePath, { scope: "autoIndex", message }),
    },
  }).catch((err) => {
    appendDebugLog(logFilePath, {
      scope: "autoIndex",
      message: "Initial index pass failed",
      error: err,
    });
  });

  const runPass = async (): Promise<void> => {
    try {
      await runIndexPass({
        cwd,
        storePath,
        config,
        store,
        embedder,
        logger: {
          info: (message) => appendDebugLog(logFilePath, { scope: "autoIndex", message }),
          warn: (message) => appendDebugLog(logFilePath, { scope: "autoIndex", message }),
        },
      });
    } catch (err) {
      appendDebugLog(logFilePath, {
        scope: "autoIndex",
        message: "Watch reindex pass failed",
        error: err,
      });
    }
  };

  const autoIndexCfg = config.openCode.autoIndex ?? { enabled: true, debounceMs: 5000, intervalMs: 300000 };
  const scheduler = createWatchPassScheduler(
    runPass,
    (error) => {
      const message = (error as Error).message || String(error);
      appendDebugLog(logFilePath, {
        scope: "autoIndex",
        message: `Watch reindex failed: ${message}`,
        error,
      });
    },
    autoIndexCfg.debounceMs
  );

  const watcher = chokidar.watch(cwd, {
    ignored: createWatchIgnore(cwd, config, storePath),
    ignoreInitial: true,
    persistent: true,
  });

  const handleChange = () => scheduler.notifyChange();
  watcher.on("add", handleChange);
  watcher.on("change", handleChange);
  watcher.on("unlink", handleChange);
  watcher.on("unlinkDir", handleChange);
  watcher.on("addDir", handleChange);
  watcher.on("error", (error) => {
    appendDebugLog(logFilePath, {
      scope: "autoIndex",
      message: `Watcher error: ${(error as Error).message}`,
      error,
    });
  });

  const periodicTimer = setInterval(() => {
    scheduler.notifyChange();
  }, autoIndexCfg.intervalMs);

  return {
    async close(): Promise<void> {
      clearInterval(periodicTimer);
      scheduler.close();
      await watcher.close();
      appendDebugLog(logFilePath, {
        scope: "autoIndex",
        message: "Background indexer shut down",
      });
    },
  };
}
