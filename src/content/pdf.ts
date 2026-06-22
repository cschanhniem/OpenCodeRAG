import type { ExtractResult } from "./types.js";

export const PDF_EXTENSIONS = new Set([".pdf"]);

export async function extract(filePath: string, buffer: Buffer): Promise<ExtractResult> {
  try {
    const { extractPdfText } = await import("../chunker/pdf.js");
    const content = await extractPdfText(buffer);
    return { content, ok: true };
  } catch (err) {
    return { content: "", ok: false, error: (err as Error).message };
  }
}
