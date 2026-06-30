/**
 * @fileoverview Section-command based chunker for LaTeX files splitting by chapter/section/subsection boundaries.
 */
import type { Chunker, Chunk } from "../core/interfaces.js";
import { uuid } from "./uuid.js";

const SECTION_REGEX = /^\\(chapter|section|subsection|subsubsection)\*?\s*\{/gm;

/**
 * Chunker for LaTeX files (.tex).
 * Splits content by sectioning commands (\chapter, \section, \subsection, \subsubsection),
 * skipping content inside comment environments.
 */
export class TexChunker implements Chunker {
  readonly language = "latex";
  readonly fileExtensions = [".tex"];

  /**
   * Split LaTeX content into chunks by sectioning command boundaries.
   * @param filePath - Original file path (for metadata).
   * @param content - Full content of the .tex file.
   * @returns A list of text chunks with file-path and line-range metadata.
   */
  async chunk(filePath: string, content: string): Promise<Chunk[]> {
    if (content.trim().length === 0) return [];

    const chunks: Chunk[] = [];
    const lines = content.split("\n");
    const sections: { command: string; name: string; startLine: number }[] = [];

    let inCommentBlock = false;
    let currentSectionStart = 1;
    let currentCommand = "";
    let currentName = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";

      const commentMatch = line.match(/\\begin\{comment\}/);
      if (commentMatch) {
        inCommentBlock = true;
        continue;
      }
      if (inCommentBlock) {
        if (line.match(/\\end\{comment\}/)) {
          inCommentBlock = false;
        }
        continue;
      }

      SECTION_REGEX.lastIndex = 0;
      const match = SECTION_REGEX.exec(line);
      if (match) {
        if (currentName) {
          sections.push({
            command: currentCommand,
            name: currentName,
            startLine: currentSectionStart,
          });
        }
        currentCommand = match[1] ?? "";
        const braceContent = line.slice(match.index + match[0].length);
        const closing = braceContent.indexOf("}");
        currentName = closing >= 0 ? braceContent.slice(0, closing) : "";
        currentSectionStart = i + 1;
      }
    }

    if (currentName) {
      sections.push({
        command: currentCommand,
        name: currentName,
        startLine: currentSectionStart,
      });
    }

    if (sections.length === 0) {
      return [
        {
          id: uuid(),
          content,
          metadata: {
            filePath,
            startLine: 1,
            endLine: lines.length,
            language: this.language,
          },
        },
      ];
    }

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]!;
      const startLine = section.startLine;
      const endLine =
        i + 1 < sections.length
          ? sections[i + 1]!.startLine - 1
          : lines.length;

      if (startLine > endLine) continue;

      const chunkContent = lines.slice(startLine - 1, endLine).join("\n").trim();
      if (chunkContent.length === 0) continue;

      chunks.push({
        id: uuid(),
        content: chunkContent,
        metadata: {
          filePath,
          startLine,
          endLine,
          language: this.language,
        },
      });
    }

    return chunks;
  }
}

/** Default singleton instance of {@link TexChunker}. */
export const texChunker = new TexChunker();
