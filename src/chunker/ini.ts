/**
 * @fileoverview Tree-sitter based INI chunker splitting by section headers.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for INI configuration files (.ini, .cfg).
 * Uses tree-sitter to parse and split by section headers.
 */
export class IniChunker extends TreeSitterChunker {
  readonly language = "ini";
  readonly fileExtensions = [".ini", ".cfg"];
  readonly grammarName = "ini";
  readonly nodeTypes = new Set([
    "section",
  ]);
}

/** Default singleton instance of {@link IniChunker}. */
export const iniChunker = new IniChunker();
