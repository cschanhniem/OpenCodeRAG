/**
 * @fileoverview Tree-sitter based TOML chunker splitting by tables, table arrays, and top-level pairs.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for TOML configuration files (.toml).
 * Uses tree-sitter to parse and split by tables, table array elements, and top-level pairs.
 */
export class TomlChunker extends TreeSitterChunker {
  readonly language = "toml";
  readonly fileExtensions = [".toml"];
  readonly grammarName = "toml";
  readonly nodeTypes = new Set([
    "table",
    "table_array_element",
    "pair",
  ]);
}

/** Default singleton instance of {@link TomlChunker}. */
export const tomlChunker = new TomlChunker();
