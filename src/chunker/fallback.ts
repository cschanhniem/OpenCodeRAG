/**
 * @fileoverview Fallback line-based text chunker for unsupported file types.
 */
import type { Chunker, Chunk } from "../core/interfaces.js";
import { uuid } from "./uuid.js";

const DEFAULT_MAX_LINES = 100;

/** Line-based text chunker for unsupported file types. */
export class FallbackChunker implements Chunker {
  readonly language = "text";

  private maxLines: number;

  constructor(maxLines: number = DEFAULT_MAX_LINES) {
    this.maxLines = maxLines;
  }

  async chunk(filePath: string, content: string): Promise<Chunk[]> {
    const lines = content.split("\n");
    if (lines.length === 0) return [];

    const chunks: Chunk[] = [];

    for (let start = 0; start < lines.length; start += this.maxLines) {
      const end = Math.min(start + this.maxLines, lines.length);
      const chunkContent = lines.slice(start, end).join("\n").trim();
      if (chunkContent.length === 0) continue;

      chunks.push({
        id: uuid(),
        content: chunkContent,
        metadata: {
          filePath,
          startLine: start + 1,
          endLine: end,
          language: this.language,
        },
      });
    }

    return chunks;
  }
}

export const fallbackChunker = new FallbackChunker();
