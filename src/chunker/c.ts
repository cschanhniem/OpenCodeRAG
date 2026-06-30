/**
 * @fileoverview Tree-sitter based C chunker splitting by function, struct, enum, union, typedef, and preprocessor defines.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for C source files (.c, .h).
 * Uses tree-sitter to parse and split by function definitions, struct/enum/union
 * specifiers, typedefs, and preprocessor defines.
 */
export class CChunker extends TreeSitterChunker {
  readonly language = "c";
  readonly fileExtensions = [".c", ".h"];
  readonly grammarName = "c";
  readonly nodeTypes = new Set([
    "function_definition",
    "struct_specifier",
    "enum_specifier",
    "union_specifier",
    "type_definition",
    "preproc_def",
  ]);
}

/** Default singleton instance of {@link CChunker}. */
export const cChunker = new CChunker();
