/**
 * @fileoverview Extracts text content from PDF files for indexing.
 */

import type { ExtractResult } from "./types.js";

/** Recognized PDF file extension set. */
export const PDF_EXTENSIONS = new Set([".pdf"]);

/**
 * Extract text content from a PDF buffer using the pdfjs-dist library.
 * @param _filePath - Unused, retained for API consistency.
 * @param buffer - Raw PDF file bytes.
 */
export async function extract(_filePath: string, buffer: Buffer): Promise<ExtractResult> {
  try {
    const { extractPdfText } = await import("../chunker/pdf.js");
    const content = await extractPdfText(buffer);
    return { content, ok: true };
  } catch (err) {
    return { content: "", ok: false, error: (err as Error).message };
  }
}
