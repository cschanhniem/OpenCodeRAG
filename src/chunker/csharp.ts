/**
 * @fileoverview Tree-sitter based C# chunker splitting by method, interface, struct, record, and enum declarations.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for C# source files (.cs).
 * Uses tree-sitter to parse and split by method, interface, struct, record,
 * and enum declarations.
 */
export class CSharpChunker extends TreeSitterChunker {
  readonly language = "csharp";
  readonly fileExtensions = [".cs"];
  readonly grammarName = "c_sharp";
  readonly nodeTypes = new Set([
    "method_declaration",
    "interface_declaration",
    "struct_declaration",
    "record_declaration",
    "enum_declaration",
  ]);
}

/** Default singleton instance of {@link CSharpChunker}. */
export const csharpChunker = new CSharpChunker();
