/**
 * @fileoverview Tree-sitter based Bash chunker splitting by function definitions.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for Bash shell scripts (.sh, .bash, .zsh).
 * Uses tree-sitter to parse and split by function definitions.
 */
export class BashChunker extends TreeSitterChunker {
  readonly language = "bash";
  readonly fileExtensions = [".sh", ".bash", ".zsh"];
  readonly grammarName = "bash";
  readonly nodeTypes = new Set([
    "function_definition",
  ]);
}

/** Default singleton instance of {@link BashChunker}. */
export const bashChunker = new BashChunker();
