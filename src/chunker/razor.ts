/**
 * @fileoverview Code-block based chunker for Razor view files splitting by @code and @functions blocks.
 */
import type { Chunker, Chunk } from "../core/interfaces.js";
import { uuid } from "./uuid.js";

/**
 * Count the number of newline characters up to a given position in the content.
 * @param content - The full file content string.
 * @param end - The character index at which to stop counting (exclusive).
 * @returns The count of newline characters before `end`.
 */
function countNewlines(content: string, end: number): number {
  let count = 0;
  for (let i = 0; i < end; i++) {
    if (content[i] === "\n") count++;
  }
  return count;
}

/**
 * Find all `@code { ... }` or `@functions { ... }` blocks in a Razor file.
 * Correctly handles nested braces to determine block boundaries.
 * @param content - The full file content string.
 * @param keyword - The directive keyword to search for (e.g. "code" or "functions").
 * @returns An array of { start, end } positions for each matched block.
 */
function findCodeBlocks(
  content: string,
  keyword: string
): { start: number; end: number }[] {
  const blocks: { start: number; end: number }[] = [];
  const regex = new RegExp(`@${keyword}\\s*\\{`, "g");
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    let depth = 1;
    let pos = match.index + match[0].length;

    while (pos < content.length && depth > 0) {
      if (content[pos] === "{") depth++;
      else if (content[pos] === "}") depth--;
      pos++;
    }

    blocks.push({ start: match.index, end: pos });
  }

  return blocks;
}

/**
 * Chunker for Razor view files (.razor, .cshtml).
 * Splits content into alternating markup and code-block regions (`@code { }`
 * and `@functions { }`), creating one chunk per region.
 */
export class RazorChunker implements Chunker {
  readonly language = "razor";
  readonly fileExtensions = [".razor", ".cshtml"];

  /**
   * Split the Razor content into markup and code-block chunks.
   * @param filePath - Original file path (for metadata).
   * @param content - Full content of the Razor file.
   * @returns A list of text chunks with file-path and line-range metadata.
   */
  async chunk(filePath: string, content: string): Promise<Chunk[]> {
    if (content.trim().length === 0) return [];

    const codeBlocks = [
      ...findCodeBlocks(content, "code"),
      ...findCodeBlocks(content, "functions"),
    ].sort((a, b) => a.start - b.start);

    const regions: { start: number; end: number }[] = [];
    let lastEnd = 0;

    for (const block of codeBlocks) {
      if (block.start > lastEnd) {
        regions.push({ start: lastEnd, end: block.start });
      }
      regions.push({ start: block.start, end: block.end });
      lastEnd = block.end;
    }

    if (lastEnd < content.length) {
      regions.push({ start: lastEnd, end: content.length });
    }

    if (regions.length === 0) {
      return [
        {
          id: uuid(),
          content,
          metadata: {
            filePath,
            startLine: 1,
            endLine: countNewlines(content, content.length) + 1,
            language: this.language,
          },
        },
      ];
    }

    return regions
      .map(({ start, end }) => {
        const chunkContent = content.slice(start, end).trim();
        if (chunkContent.length === 0) return null;

        return {
          id: uuid(),
          content: chunkContent,
          metadata: {
            filePath,
            startLine: countNewlines(content, start) + 1,
            endLine: countNewlines(content, end) + 1,
            language: this.language,
          },
        };
      })
      .filter((c): c is Chunk => c !== null);
  }
}

/** Default singleton instance of {@link RazorChunker}. */
export const razorChunker = new RazorChunker();
