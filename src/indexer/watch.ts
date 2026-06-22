import path from "node:path";
import { manifestPathFor } from "../core/manifest.js";
import type { RagConfig } from "../core/config.js";

export interface WatchPassScheduler {
  notifyChange(): void;
  waitForIdle(): Promise<void>;
  close(): void;
}

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
