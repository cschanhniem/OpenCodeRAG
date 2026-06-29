/**
 * @fileoverview Keyword-based chunker for STARLIMS SSL script files using block nesting analysis.
 */
import type { Chunker, Chunk } from "../core/interfaces.js";
import { uuid } from "./uuid.js";

const BLOCK_START: Record<string, string> = {
  PROCEDURE: "proc",
  CLASS: "class",
  IF: "if",
  FOR: "for",
  WHILE: "while",
  TRY: "try",
  BEGINCASE: "case",
};

const BLOCK_END: Record<string, string> = {
  ENDPROC: "proc",
  ENDCLASS: "class",
  ENDIF: "if",
  NEXT: "for",
  ENDWHILE: "while",
  ENDTRY: "try",
  ENDCASE: "case",
};

const KEYWORD_RE = /^:(\w+)\b/i;

/**
 * Chunker for STARLIMS SSL script files (.ssl).
 * Splits content by procedure, class, and top-level block boundaries using
 * keyword-based nesting analysis (PROCEDURE, CLASS, IF, FOR, WHILE, TRY, BEGINCASE).
 */
export class SslChunker implements Chunker {
  readonly language = "ssl";
  readonly fileExtensions = [".ssl"];

  /**
   * Split SSL content into procedure, class, and top-level chunks by block nesting.
   * @param filePath - Original file path (for metadata).
   * @param content - Full content of the SSL file.
   * @returns A list of text chunks with file-path and line-range metadata.
   */
  async chunk(filePath: string, content: string): Promise<Chunk[]> {
    if (content.trim().length === 0) return [];

    const lines = content.split("\n");
    const chunks: Chunk[] = [];

    const blockStack: string[] = [];

    let topLevelStart = 1;

    function flushTopLevel(endLine: number): void {
      if (endLine <= topLevelStart) return;
      const slice = lines.slice(topLevelStart - 1, endLine - 1).join("\n").trim();
      if (!slice) return;
      chunks.push({
        id: uuid(),
        content: slice,
        metadata: { filePath, startLine: topLevelStart, endLine: endLine - 1, language: "ssl" },
      });
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (!line) continue;

      if (line.startsWith("/*") || line.startsWith("*")) continue;

      const kwMatch = line.match(KEYWORD_RE);
      if (!kwMatch) continue;

      const keyword = kwMatch[1]!.toUpperCase();

      const blockType = BLOCK_START[keyword];
      if (blockType) {
        // Before starting a procedure, flush any preceding top-level content
        if (keyword === "PROCEDURE") {
          flushTopLevel(i + 1);
        }
        // Before starting a class at top level, flush preceding content
        if (keyword === "CLASS" && blockStack.length === 0) {
          flushTopLevel(i + 1);
        }
        blockStack.push(blockType);

        // If we just started a class, record class-start line for class-header chunk
        continue;
      }

      const endType = BLOCK_END[keyword];
      if (endType) {
        const expected = blockStack.pop();
        if (expected === "proc" && endType === "proc") {
          const procLine = findProcedureStartLine(lines, i, filePath);
          const startLine = procLine ?? (i + 1);
          const endLine = i + 1;
          const slice = lines.slice(startLine - 1, endLine).join("\n").trim();
          if (slice) {
            chunks.push({
              id: uuid(),
              content: slice,
              metadata: { filePath, startLine, endLine, language: "ssl" },
            });
          }
          topLevelStart = endLine + 1;
        } else if (expected === "class" && endType === "class") {
          // Class ended — flush any remaining class-level content as a chunk
          const slice = lines.slice(topLevelStart - 1, i).join("\n").trim();
          if (slice) {
            chunks.push({
              id: uuid(),
              content: slice,
              metadata: { filePath, startLine: topLevelStart, endLine: i, language: "ssl" },
            });
          }
          topLevelStart = i + 2;
        }
      }
    }

    flushTopLevel(lines.length + 1);

    if (chunks.length === 0) {
      chunks.push({
        id: uuid(),
        content,
        metadata: { filePath, startLine: 1, endLine: lines.length, language: "ssl" },
      });
    }

    return chunks;
  }
}

/**
 * Walk backward from a given line index to find the start line of the enclosing
 * PROCEDURE block, accounting for nested block keywords.
 * @param lines - All lines of the file.
 * @param fromIndex - The line index to start searching backward from.
 * @param filePath - Original file path (unused, for metadata consistency).
 * @returns The 1-based start line of the PROCEDURE, or null if not found.
 */
function findProcedureStartLine(lines: string[], fromIndex: number, _filePath: string): number | null {
  let depth = 0;
  for (let i = fromIndex - 1; i >= 0; i--) {
    const line = lines[i]!.trim().toUpperCase();

    // Walk backward — closing keywords reduce depth, opening keywords increase
    const startMatch = line.match(/^:(\w+)\b/);
    if (startMatch) {
      const kw = startMatch[1]!;
      if (BLOCK_START[kw]) {
        if (kw === "PROCEDURE" && depth === 0) {
          return i + 1;
        }
        depth--;
      } else if (BLOCK_END[kw]) {
        depth++;
      }
    }
  }
  return null;
}

/** Default singleton instance of {@link SslChunker}. */
export const sslChunker = new SslChunker();
