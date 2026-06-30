/**
 * @fileoverview Tree-sitter based C++ chunker splitting by function definitions and struct/enum/union specifiers.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for C++ source files (.cpp, .cc, .cxx, .hpp, .hxx).
 * Uses tree-sitter to parse and split by function definitions and
 * struct/enum/union specifiers.
 */
export class CppChunker extends TreeSitterChunker {
  readonly language = "cpp";
  readonly fileExtensions = [".cpp", ".cc", ".cxx", ".hpp", ".hxx"];
  readonly grammarName = "cpp";
  readonly nodeTypes = new Set([
    "function_definition",
    "struct_specifier",
    "enum_specifier",
    "union_specifier",
  ]);
}

/** Default singleton instance of {@link CppChunker}. */
export const cppChunker = new CppChunker();
