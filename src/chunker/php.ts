/**
 * @fileoverview Tree-sitter based PHP chunker splitting by function and method declarations.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for PHP source files (.php).
 * Uses tree-sitter to parse and split by function definitions and method declarations.
 */
export class PhpChunker extends TreeSitterChunker {
  readonly language = "php";
  readonly fileExtensions = [".php"];
  readonly grammarName = "php";
  readonly nodeTypes = new Set([
    "function_definition",
    "method_declaration",
  ]);
}

/** Default singleton instance of {@link PhpChunker}. */
export const phpChunker = new PhpChunker();
