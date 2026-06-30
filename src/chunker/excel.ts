/**
 * @fileoverview CSV-per-sheet extraction and chunker for Excel spreadsheets using @e965/xlsx.
 */
import type { Chunker, Chunk } from "../core/interfaces.js";
import { uuid } from "./uuid.js";

const MAX_CHUNK_CHARS = 4000;

/**
 * Extract text content from an Excel workbook buffer (.xls / .xlsx).
 * Reads all sheets, converting each to CSV, prefixed with a sheet header.
 * Uses the `@e965/xlsx` library under the hood.
 * @param buffer - Raw buffer of the Excel file.
 * @returns A string with each sheet's CSV content separated by blank lines.
 */
export async function extractExcelText(buffer: Buffer): Promise<string> {
  const XLSX = await import("@e965/xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const lines: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    lines.push(`[Sheet: ${sheetName}]`);
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    if (csv.trim().length > 0) {
      lines.push(csv);
    }
  }

  return lines.join("\n\n");
}

/**
 * Chunker for Excel spreadsheets (.xls, .xlsx).
 * Splits the extracted CSV-per-sheet content into chunks, one per sheet,
 * with large sheets further split into row-based batches of up to 4000 characters.
 */
export class ExcelChunker implements Chunker {
  readonly language = "excel";
  readonly fileExtensions = [".xls", ".xlsx"];

  /**
   * Split the spreadsheet text into chunks by sheet, breaking large sheets by row batches.
   * @param filePath - Original file path (for metadata).
   * @param content - Extracted CSV-per-sheet text of the Excel file.
   * @returns A list of text chunks with file-path and line-range metadata.
   */
  async chunk(filePath: string, content: string): Promise<Chunk[]> {
    if (content.trim().length === 0) return [];

    // Split by sheet sections (separated by double newlines)
    const sections = content.split(/\n\n(?=\[Sheet:)/).filter((s) => s.trim().length > 0);
    if (sections.length === 0) return [];

    const chunks: Chunk[] = [];
    let lineCounter = 0;

    for (const section of sections) {
      const sectionLines = section.split("\n");
      const startLine = lineCounter + 1;
      lineCounter += sectionLines.length;
      const endLine = lineCounter;

      if (section.length <= MAX_CHUNK_CHARS) {
        chunks.push({
          id: uuid(),
          content: section.trim(),
          metadata: { filePath, startLine, endLine, language: "excel" },
        });
        continue;
      }

      // Split oversized sheet content into row batches
      const rows = section.split("\n");
      let batch: string[] = [];
      let batchSize = 0;
      let batchStart = startLine;
      let rowLine = startLine;

      for (const row of rows) {
        rowLine++;
        const rowLen = row.length + 1;
        if (batch.length > 0 && batchSize + rowLen > MAX_CHUNK_CHARS) {
          chunks.push({
            id: uuid(),
            content: batch.join("\n").trim(),
            metadata: { filePath, startLine: batchStart, endLine: rowLine - 1, language: "excel" },
          });
          batch = [];
          batchSize = 0;
          batchStart = rowLine;
        }
        batch.push(row);
        batchSize += rowLen;
      }

      if (batch.length > 0) {
        chunks.push({
          id: uuid(),
          content: batch.join("\n").trim(),
          metadata: { filePath, startLine: batchStart, endLine: rowLine, language: "excel" },
        });
      }
    }

    return chunks;
  }
}

/** Default singleton instance of {@link ExcelChunker}. */
export const excelChunker = new ExcelChunker();
