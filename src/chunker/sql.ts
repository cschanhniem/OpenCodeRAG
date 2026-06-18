import { TreeSitterChunker } from "./base.js";

export class SqlChunker extends TreeSitterChunker {
  readonly language = "sql";
  readonly fileExtensions = [".sql"];
  readonly grammarName = "sql";
  readonly nodeTypes = new Set([
    "statement",
  ]);
}

export const sqlChunker = new SqlChunker();
