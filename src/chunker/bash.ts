import { TreeSitterChunker } from "./base.js";

export class BashChunker extends TreeSitterChunker {
  readonly language = "bash";
  readonly fileExtensions = [".sh", ".bash", ".zsh"];
  readonly grammarName = "bash";
  readonly nodeTypes = new Set([
    "function_definition",
  ]);
}

export const bashChunker = new BashChunker();
