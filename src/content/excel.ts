import type { ExtractResult } from "./types.js";

export const EXCEL_EXTENSIONS = new Set([".xls", ".xlsx"]);

export async function extract(filePath: string, buffer: Buffer): Promise<ExtractResult> {
  try {
    const { extractExcelText } = await import("../chunker/excel.js");
    const content = await extractExcelText(buffer);
    return { content, ok: true };
  } catch (err) {
    return { content: "", ok: false, error: (err as Error).message };
  }
}
