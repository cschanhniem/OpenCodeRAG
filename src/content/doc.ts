import type { ExtractResult } from "./types.js";

export const DOC_EXTENSIONS = new Set([".doc"]);

export async function extract(filePath: string, buffer: Buffer): Promise<ExtractResult> {
  try {
    const { extractDocText } = await import("../chunker/doc.js");
    const content = await extractDocText(buffer);
    return { content, ok: true };
  } catch (err) {
    return { content: "", ok: false, error: (err as Error).message };
  }
}
