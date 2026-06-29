/**
 * @fileoverview Tree-sitter based YAML chunker splitting by block mapping pairs and block sequence items.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for YAML files (.yaml, .yml).
 * Uses tree-sitter to parse and split by block mapping pairs and block sequence items.
 */
export class YamlChunker extends TreeSitterChunker {
  readonly language = "yaml";
  readonly fileExtensions = [".yaml", ".yml"];
  readonly grammarName = "yaml";
  readonly nodeTypes = new Set([
    "block_mapping_pair",
    "block_sequence_item",
  ]);
}

/** Default singleton instance of {@link YamlChunker}. */
export const yamlChunker = new YamlChunker();
