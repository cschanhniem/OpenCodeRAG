/**
 * @fileoverview Tree-sitter based Java chunker splitting by method, interface, and enum declarations.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for Java source files (.java).
 * Uses tree-sitter to parse and split by method, interface, and enum declarations.
 */
export class JavaChunker extends TreeSitterChunker {
  readonly language = "java";
  readonly fileExtensions = [".java"];
  readonly grammarName = "java";
  readonly nodeTypes = new Set([
    "method_declaration",
    "interface_declaration",
    "enum_declaration",
  ]);
}

/** Default singleton instance of {@link JavaChunker}. */
export const javaChunker = new JavaChunker();
