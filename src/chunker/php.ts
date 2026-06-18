import { TreeSitterChunker } from "./base.js";

export class PhpChunker extends TreeSitterChunker {
  readonly language = "php";
  readonly fileExtensions = [".php"];
  readonly grammarName = "php";
  readonly nodeTypes = new Set([
    "function_definition",
    "method_declaration",
  ]);
}

export const phpChunker = new PhpChunker();
