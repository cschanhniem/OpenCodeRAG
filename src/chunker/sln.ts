/**
 * @fileoverview Project and global section based chunker for Visual Studio solution files.
 */
import type { Chunker, Chunk } from "../core/interfaces.js";
import { uuid } from "./uuid.js";

const PROJECT_LINE = /^Project\("/;
const GLOBAL_LINE = /^Global\s*$/;
const END_GLOBAL_LINE = /^EndGlobal\s*$/;
const END_PROJECT_LINE = /^EndProject\s*$/;

/**
 * Chunker for Visual Studio solution files (.sln).
 * Splits content into chunks by project and global section boundaries.
 */
export class SlnChunker implements Chunker {
  readonly language = "sln";
  readonly fileExtensions = [".sln"];
  readonly name = "sln";

  /**
   * Split the .sln content into project and global section chunks.
   * @param filePath - Original file path (for metadata).
   * @param content - Full content of the .sln file.
   * @returns A list of text chunks with file-path and line-range metadata.
   */
  async chunk(filePath: string, content: string): Promise<Chunk[]> {
    if (content.trim().length === 0) return [];

    const chunks: Chunk[] = [];
    const lines = content.split("\n");

    let sectionStart = 0;
    let sectionEnd = 0;
    let collecting = false;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();

      if (PROJECT_LINE.test(trimmed)) {
        if (collecting) {
          chunks.push(this.makeChunk(lines, sectionStart, i - 1, filePath));
        }
        sectionStart = i;
        collecting = true;
      } else if (END_PROJECT_LINE.test(trimmed) || END_GLOBAL_LINE.test(trimmed)) {
        if (collecting) {
          chunks.push(this.makeChunk(lines, sectionStart, i, filePath));
          collecting = false;
        }
      } else if (GLOBAL_LINE.test(trimmed)) {
        if (collecting) {
          chunks.push(this.makeChunk(lines, sectionStart, i - 1, filePath));
        }
        sectionStart = i;
        collecting = true;
      }

      sectionEnd = i;
    }

    if (collecting && sectionStart <= sectionEnd) {
      chunks.push(this.makeChunk(lines, sectionStart, sectionEnd, filePath));
    } else if (chunks.length === 0) {
      chunks.push(this.makeChunk(lines, 0, lines.length - 1, filePath));
    }

    return chunks;
  }

  private makeChunk(
    lines: string[],
    start: number,
    end: number,
    filePath: string
  ): Chunk {
    const content = lines.slice(start, end + 1).join("\n");
    return {
      id: uuid(),
      content,
      metadata: {
        filePath,
        startLine: start + 1,
        endLine: end + 1,
        language: "sln",
      },
    };
  }
}

/** Default singleton instance of {@link SlnChunker}. */
export const slnChunker = new SlnChunker();
