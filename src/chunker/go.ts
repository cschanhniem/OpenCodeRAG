/**
 * @fileoverview Tree-sitter based Go chunker splitting by function and method declarations.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for Go source files (.go).
 * Uses tree-sitter to parse and split by function and method declarations.
 */
export class GoChunker extends TreeSitterChunker {
  readonly language = "go";
  readonly fileExtensions = [".go"];
  readonly grammarName = "go";
  readonly nodeTypes = new Set([
    "function_declaration",
    "method_declaration",
  ]);
}

/** Default singleton instance of {@link GoChunker}. */
export const goChunker = new GoChunker();
