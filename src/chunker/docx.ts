/**
 * @fileoverview Text extraction and paragraph-based chunker for Word (.docx) documents using mammoth.
 */
import type { Chunker, Chunk } from "../core/interfaces.js";
import { uuid } from "./uuid.js";

const MAX_CHUNK_CHARS = 4000;
const MIN_GROUP_CHARS = 300;

const PARAGRAPH_SPLIT = /\n\s*\n/;

/**
 * Extract the raw text from a Word (.docx) file buffer.
 * Uses the `mammoth` library under the hood.
 * @param buffer - Raw buffer of the .docx file.
 * @returns The extracted raw text as a string.
 */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

/**
 * Chunker for Word (.docx) documents.
 * Splits the extracted plain text by paragraph boundaries, grouping small
 * paragraphs into chunks of up to 4000 characters.
 */
export class DocxChunker implements Chunker {
  readonly language = "docx";
  readonly fileExtensions = [".docx"];

  /**
   * Split the document text into chunks by paragraph grouping.
   * @param filePath - Original file path (for metadata).
   * @param content - Extracted plain-text content of the .docx file.
   * @returns A list of text chunks with file-path and line-range metadata.
   */
  async chunk(filePath: string, content: string): Promise<Chunk[]> {
    if (content.trim().length === 0) return [];

    const paragraphs = content.split(PARAGRAPH_SPLIT).filter((p) => p.trim().length > 0);
    if (paragraphs.length === 0) return [];

    const chunks: Chunk[] = [];
    let currentGroup: string[] = [];
    let currentSize = 0;
    let paragraphIndex = 0;

    function flush() {
      const text = currentGroup.join("\n\n").trim();
      if (text.length === 0) return;
      chunks.push({
        id: uuid(),
        content: text,
        metadata: {
          filePath,
          startLine: paragraphIndex - currentGroup.length + 1,
          endLine: paragraphIndex,
          language: "docx",
        },
      });
      currentGroup = [];
      currentSize = 0;
    }

    for (const para of paragraphs) {
      paragraphIndex++;
      const paraLen = para.length;

      if (paraLen > MAX_CHUNK_CHARS) {
        if (currentGroup.length > 0) flush();
        chunks.push({
          id: uuid(),
          content: para,
          metadata: {
            filePath,
            startLine: paragraphIndex,
            endLine: paragraphIndex,
            language: "docx",
          },
        });
        continue;
      }

      if (currentGroup.length > 0 && currentSize + paraLen > MAX_CHUNK_CHARS) {
        flush();
      }

      currentGroup.push(para);
      currentSize += paraLen;

      if (currentSize >= MIN_GROUP_CHARS && currentGroup.length >= 1) {
        const nextParaStillSmall =
          paragraphIndex < paragraphs.length &&
          paragraphs[paragraphIndex]!.length < MIN_GROUP_CHARS;
        if (!nextParaStillSmall) {
          flush();
        }
      }
    }

    if (currentGroup.length > 0) {
      flush();
    }

    return chunks;
  }
}

/** Default singleton instance of {@link DocxChunker}. */
export const docxChunker = new DocxChunker();
