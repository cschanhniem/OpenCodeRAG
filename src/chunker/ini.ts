import { TreeSitterChunker } from "./base.js";

export class IniChunker extends TreeSitterChunker {
  readonly language = "ini";
  readonly fileExtensions = [".ini", ".cfg"];
  readonly grammarName = "ini";
  readonly nodeTypes = new Set([
    "section",
  ]);
}

export const iniChunker = new IniChunker();
