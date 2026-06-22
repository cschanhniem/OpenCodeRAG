import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export type LogSeverity = "debug" | "info" | "warn";

const SEVERITY_RANK: Record<LogSeverity, number> = {
  debug: 0,
  info: 1,
  warn: 2,
};

const LEVEL_RANK: Record<string, number | undefined> = {
  debug: 0,
  info: 1,
  error: 2,
  none: -1,
};

export interface DebugLogEntry {
  scope: string;
  message: string;
  error?: unknown;
  severity?: LogSeverity;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function appendDebugLog(
  logFilePath: string,
  entry: DebugLogEntry,
  configuredLevel?: string,
): void {
  if (configuredLevel === "none") return;
  const levelRank = LEVEL_RANK[configuredLevel ?? "info"] ?? 1;
  const severityRank = SEVERITY_RANK[entry.severity ?? "info"] ?? 1;
  if (severityRank < levelRank) return;
  try {
    mkdirSync(path.dirname(logFilePath), { recursive: true });

    const lines = [
      `[${new Date().toISOString()}] [${entry.scope}] ${entry.message}`,
    ];

    if (typeof entry.error !== "undefined") {
      lines.push(formatError(entry.error));
    }

    appendFileSync(logFilePath, `${lines.join("\n")}\n\n`, "utf8");
  } catch {
    // Logging must never break the plugin.
  }
}