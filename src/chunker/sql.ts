/**
 * @fileoverview Tree-sitter based SQL chunker splitting by each top-level statement.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for SQL files (.sql).
 * Uses tree-sitter to parse and split by each top-level SQL statement.
 */
export class SqlChunker extends TreeSitterChunker {
  readonly language = "sql";
  readonly fileExtensions = [".sql"];
  readonly grammarName = "sql";
  readonly nodeTypes = new Set([
    "statement",
  ]);
}

/** Default singleton instance of {@link SqlChunker}. */
export const sqlChunker = new SqlChunker();
