import chokidar from "chokidar";
import path from "node:path";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { appendDebugLog } from "./core/fileLogger.js";
import type { RagConfig } from "./core/config.js";
import type { DescriptionProvider, EmbeddingProvider, KeywordIndex, VectorStore } from "./core/interfaces.js";
import { isCorruptionError } from "./vectorstore/lancedb.js";
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
  logLevel?: string;
  keywordIndex?: KeywordIndex;
  descriptionProvider?: DescriptionProvider;
}

export type WatcherStatus = {
  running: boolean;
  lastRunAt: number | undefined;
};

function writeWatcherStatus(storePath: string, status: WatcherStatus): void {
  try {
    writeFileSync(
      path.join(storePath, "watcher-status.json"),
      JSON.stringify(status, null, 2),
      "utf-8"
    );
  } catch {
    // silently ignore write errors
  }
}

export function createBackgroundIndexer(options: CreateBackgroundIndexerOptions): BackgroundIndexer {
  const { cwd, storePath, config, store, embedder, logFilePath, logLevel, keywordIndex, descriptionProvider } = options;

  writeWatcherStatus(storePath, { running: false, lastRunAt: undefined });

  const updateStatus = (partial: Partial<WatcherStatus>) => {
    writeWatcherStatus(storePath, { running: false, lastRunAt: undefined, ...partial });
  };

  const runPass = async (): Promise<void> => {
    updateStatus({ running: true, lastRunAt: Date.now() });
    try {
      await runIndexPass({
        cwd,
        storePath,
        config,
        store,
        embedder,
        keywordIndex,
        descriptionProvider,
        logger: {
          info: (message) => appendDebugLog(logFilePath, { scope: "autoIndex", message }, logLevel),
          warn: (message) => appendDebugLog(logFilePath, { scope: "autoIndex", message }, logLevel),
        },
      });
      updateStatus({ running: false, lastRunAt: Date.now() });
    } catch (err) {
      if (isCorruptionError(err)) {
        appendDebugLog(logFilePath, {
          scope: "autoIndex",
          message: "Corruption detected; clearing store and rebuilding",
          error: err,
        }, logLevel);
        try {
          await store.clear();
          keywordIndex?.clear();
          await runIndexPass({
            cwd,
            storePath,
            config,
            store,
            embedder,
            keywordIndex,
            descriptionProvider,
            logger: {
              info: (message) => appendDebugLog(logFilePath, { scope: "autoIndex", message }, logLevel),
              warn: (message) => appendDebugLog(logFilePath, { scope: "autoIndex", message }, logLevel),
            },
          });
        } catch (retryErr) {
          appendDebugLog(logFilePath, {
            scope: "autoIndex",
            message: "Rebuild after corruption also failed",
            error: retryErr,
          }, logLevel);
        }
      } else {
        appendDebugLog(logFilePath, {
          scope: "autoIndex",
          message: "Watch reindex pass failed",
          error: err,
        }, logLevel);
      }
      updateStatus({ running: false, lastRunAt: Date.now() });
    }
  };

  // Fire-and-forget initial index pass
  runPass().catch((err) => {
    appendDebugLog(logFilePath, {
      scope: "autoIndex",
      message: "Initial index pass failed",
      error: err,
    }, logLevel);
  });

  const autoIndexCfg = config.openCode.autoIndex ?? { enabled: true, debounceMs: 5000, intervalMs: 300000 };
  const scheduler = createWatchPassScheduler(
    runPass,
    (error) => {
      const message = (error as Error).message || String(error);
      appendDebugLog(logFilePath, {
        scope: "autoIndex",
        message: `Watch reindex failed: ${message}`,
        error,
      }, logLevel);
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
    }, logLevel);
  });

  const periodicTimer = setInterval(() => {
    scheduler.notifyChange();
  }, autoIndexCfg.intervalMs);

  return {
    async close(): Promise<void> {
      clearInterval(periodicTimer);
      scheduler.close();
      await scheduler.waitForIdle();
      await watcher.close();
      const statusPath = path.join(storePath, "watcher-status.json");
      if (existsSync(statusPath)) {
        try { unlinkSync(statusPath); } catch { /* ignore */ }
      }
      appendDebugLog(logFilePath, {
        scope: "autoIndex",
        message: "Background indexer shut down",
      });
    },
  };
}
