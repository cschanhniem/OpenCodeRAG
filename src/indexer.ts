export type { IndexRunStats, IndexStatusSummary } from "./indexer/stats.js";
export { createIndexStats } from "./indexer/stats.js";
export type { WorkspaceFile } from "./content/reader.js";
export { scanWorkspaceFiles, walkFiles } from "./content/reader.js";
export type { RunIndexPassOptions, WatchPassScheduler } from "./indexer/pipeline.js";
export {
  runIndexPass,
  getIndexStatusSummary,
  createWatchPassScheduler,
  createWatchIgnore,
} from "./indexer/pipeline.js";

import { scanWorkspaceFiles } from "./content/reader.js";
import type { RagConfig } from "./core/config.js";
import type { WorkspaceFile } from "./content/reader.js";

interface Logger {
  info(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
}

export async function scanWorkspace(
  cwd: string,
  config: RagConfig,
  logger?: Logger,
): Promise<WorkspaceFile[]> {
  return scanWorkspaceFiles(cwd, config, logger);
}
