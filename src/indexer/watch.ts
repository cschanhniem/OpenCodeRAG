/**
 * @fileoverview Debounced file-watching scheduler and path-ignore predicate for incremental re-indexing.
 */
import path from "node:path";
import { manifestPathFor } from "../core/manifest.js";
import type { RagConfig } from "../core/config.js";

/** Scheduler that coordinates debounced re-index passes triggered by file-system changes. */
export interface WatchPassScheduler {
  /** Notify the scheduler that a change occurred; triggers a debounced re-index. */
  notifyChange(): void;
  /** Resolves once the current pass (if any) finishes and no further passes are pending. */
  waitForIdle(): Promise<void>;
  /** Shut down the scheduler, cancelling any pending pass. */
  close(): void;
}

/**
 * Create a scheduler that debounces calls to a re-index pass. While a pass is
 * running, subsequent notifications queue a single rerun. Useful for watching
 * file changes without overloading the system.
 *
 * @param runPass   - Async function that performs a single index pass.
 * @param onError   - Callback invoked when `runPass` throws.
 * @param debounceMs- Debounce interval in milliseconds (default 300).
 * @returns A {@link WatchPassScheduler} instance.
 */
export function createWatchPassScheduler(
  runPass: () => Promise<void>,
  onError: (error: unknown) => void,
  debounceMs: number = 300,
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

/**
 * Build a predicate that returns `true` for paths that should be ignored by
 * a file watcher (store directory, manifest file, and configured exclude
 * directories).
 *
 * @param cwd       - Workspace root directory.
 * @param config    - RAG configuration containing `indexing.excludeDirs`.
 * @param storePath - Path to the vector store data directory.
 * @returns A function that accepts a watched path and returns `true` if it
 *          should be ignored.
 */
export function createWatchIgnore(
  cwd: string,
  config: RagConfig,
  storePath: string,
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
