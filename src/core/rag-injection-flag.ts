import { writeFileSync, readFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

export type RagInjectionType = "chunks" | "files";

const FLAG_FILE = ".pending-injection";

export function setPendingRagInjection(storePath: string, type: RagInjectionType): void {
  writeFileSync(join(storePath, FLAG_FILE), type, "utf-8");
}

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
