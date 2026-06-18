import { TreeSitterChunker } from "./base.js";

export class YamlChunker extends TreeSitterChunker {
  readonly language = "yaml";
  readonly fileExtensions = [".yaml", ".yml"];
  readonly grammarName = "yaml";
  readonly nodeTypes = new Set([
    "block_mapping_pair",
    "block_sequence_item",
  ]);
}

export const yamlChunker = new YamlChunker();
