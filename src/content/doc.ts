/**
 * @fileoverview Extracts text content from legacy DOC files for indexing.
 */

import type { ExtractResult } from "./types.js";

/** Recognized legacy DOC file extension set. */
export const DOC_EXTENSIONS = new Set([".doc"]);

/**
 * Extract text content from a legacy DOC buffer using word-extractor.
 * @param _filePath - Unused, retained for API consistency.
 * @param buffer - Raw DOC file bytes.
 */
export async function extract(_filePath: string, buffer: Buffer): Promise<ExtractResult> {
  try {
    const { extractDocText } = await import("../chunker/doc.js");
    const content = await extractDocText(buffer);
    return { content, ok: true };
  } catch (err) {
    return { content: "", ok: false, error: (err as Error).message };
  }
}
