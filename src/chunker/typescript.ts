/**
 * @fileoverview Tree-sitter based TypeScript/TSX chunker splitting by function, method, interface, and type declarations.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for TypeScript/TSX files (.ts, .tsx).
 * Uses tree-sitter to parse and split by function declarations, method definitions,
 * arrow functions, interface declarations, and type alias declarations.
 */
export class TypeScriptChunker extends TreeSitterChunker {
  readonly language = "typescript";
  readonly fileExtensions = [".ts", ".tsx"];
  readonly grammarName = "typescript";
  readonly nodeTypes = new Set([
    "function_declaration",
    "method_definition",
    "arrow_function",
    "interface_declaration",
    "type_alias_declaration",
  ]);
}

/** Default singleton instance of {@link TypeScriptChunker}. */
export const typescriptChunker = new TypeScriptChunker();
