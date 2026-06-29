/**
 * @fileoverview Extracts text content from Excel (XLS/XLSX) files for indexing.
 */

import type { ExtractResult } from "./types.js";

/** Recognized Excel file extension set. */
export const EXCEL_EXTENSIONS = new Set([".xls", ".xlsx"]);

/**
 * Extract text content from an Excel buffer using @e965/xlsx.
 * @param _filePath - Unused, retained for API consistency.
 * @param buffer - Raw Excel file bytes.
 */
export async function extract(_filePath: string, buffer: Buffer): Promise<ExtractResult> {
  try {
    const { extractExcelText } = await import("../chunker/excel.js");
    const content = await extractExcelText(buffer);
    return { content, ok: true };
  } catch (err) {
    return { content: "", ok: false, error: (err as Error).message };
  }
}
