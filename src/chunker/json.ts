/**
 * @fileoverview Tree-sitter based JSON chunker splitting by each top-level key-value pair.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for JSON files (.json).
 * Uses tree-sitter to parse and split by each top-level key-value pair.
 */
export class JsonChunker extends TreeSitterChunker {
  readonly language = "json";
  readonly fileExtensions = [".json"];
  readonly grammarName = "json";
  readonly nodeTypes = new Set([
    "pair",
  ]);
}

/** Default singleton instance of {@link JsonChunker}. */
export const jsonChunker = new JsonChunker();
