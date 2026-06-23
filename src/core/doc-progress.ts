import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export interface DocProgress {
  documented: string[];
  lastUpdated: number;
}

const PROGRESS_FILE = "doc-mode-progress.json";

function progressPath(storePath: string): string {
  return join(storePath, PROGRESS_FILE);
}

export function loadDocProgress(storePath: string): DocProgress {
  const filePath = progressPath(storePath);
  try {
    if (!existsSync(filePath)) return { documented: [], lastUpdated: 0 };
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as DocProgress;
  } catch {
    return { documented: [], lastUpdated: 0 };
  }
}

export function saveDocProgress(storePath: string, progress: DocProgress): void {
  const filePath = progressPath(storePath);
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, JSON.stringify(progress, null, 2), "utf-8");
  } catch {
    // silently ignore write errors
  }
}

export function markFileDocumented(storePath: string, filePath: string): void {
  const progress = loadDocProgress(storePath);
  if (!progress.documented.includes(filePath)) {
    progress.documented.push(filePath);
    progress.lastUpdated = Date.now();
    saveDocProgress(storePath, progress);
  }
}
