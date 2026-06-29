/**
 * @fileoverview Persists a flag across plugin restarts indicating that RAG context
 * should be injected on the next chat message (chunks or file paths).
 */

import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

/** Type of RAG injection to perform on the next chat message. */
export type RagInjectionType = "chunks" | "files";

const FLAG_FILE = ".pending-injection";

/** Persist a flag indicating that RAG context should be injected on the next message. */
export function setPendingRagInjection(storePath: string, type: RagInjectionType): void {
  writeFileSync(join(storePath, FLAG_FILE), type, "utf-8");
}

/** Read and remove the pending injection flag. Returns the injection type or undefined if none pending. */
export function consumePendingRagInjection(storePath: string): RagInjectionType | undefined {
  const flagPath = join(storePath, FLAG_FILE);
  if (!existsSync(flagPath)) return undefined;
  try {
    const value = readFileSync(flagPath, "utf-8") as RagInjectionType;
    unlinkSync(flagPath);
    return value;
  } catch {
    return undefined;
  }
}
