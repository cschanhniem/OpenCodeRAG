/**
 * @fileoverview Tree-sitter based Kotlin chunker splitting by function, object, and property declarations.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for Kotlin source files (.kt, .kts).
 * Uses tree-sitter to parse and split by function declarations, object
 * declarations, and property declarations.
 */
export class KotlinChunker extends TreeSitterChunker {
  readonly language = "kotlin";
  readonly fileExtensions = [".kt", ".kts"];
  readonly grammarName = "kotlin";
  readonly nodeTypes = new Set([
    "function_declaration",
    "object_declaration",
    "property_declaration",
  ]);
}

/** Default singleton instance of {@link KotlinChunker}. */
export const kotlinChunker = new KotlinChunker();
