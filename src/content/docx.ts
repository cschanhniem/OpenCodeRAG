import type { ExtractResult } from "./types.js";

export const DOCX_EXTENSIONS = new Set([".docx"]);

export async function extract(filePath: string, buffer: Buffer): Promise<ExtractResult> {
  try {
    const { extractDocxText } = await import("../chunker/docx.js");
    const content = await extractDocxText(buffer);
    return { content, ok: true };
  } catch (err) {
    return { content: "", ok: false, error: (err as Error).message };
  }
}
