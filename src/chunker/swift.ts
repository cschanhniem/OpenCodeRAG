/**
 * @fileoverview Tree-sitter based Swift chunker splitting by function, enum, protocol, and variable declarations.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for Swift source files (.swift).
 * Uses tree-sitter to parse and split by function, enum, protocol, and variable declarations.
 */
export class SwiftChunker extends TreeSitterChunker {
  readonly language = "swift";
  readonly fileExtensions = [".swift"];
  readonly grammarName = "swift";
  readonly nodeTypes = new Set([
    "function_declaration",
    "enum_declaration",
    "protocol_declaration",
    "variable_declaration",
  ]);
}

/** Default singleton instance of {@link SwiftChunker}. */
export const swiftChunker = new SwiftChunker();
