/**
 * @fileoverview Tree-sitter based JavaScript/JSX chunker splitting by function and method declarations.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for JavaScript/JSX files (.js, .jsx, .mjs, .cjs).
 * Uses tree-sitter to parse and split by function declarations, method
 * definitions, and arrow functions.
 */
export class JavaScriptChunker extends TreeSitterChunker {
  readonly language = "javascript";
  readonly fileExtensions = [".js", ".jsx", ".mjs", ".cjs"];
  readonly grammarName = "javascript";
  readonly nodeTypes = new Set([
    "function_declaration",
    "method_definition",
    "arrow_function",
  ]);
}

/** Default singleton instance of {@link JavaScriptChunker}. */
export const javascriptChunker = new JavaScriptChunker();
