import { TreeSitterChunker } from "./base.js";

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

export const tomlChunker = new TomlChunker();
