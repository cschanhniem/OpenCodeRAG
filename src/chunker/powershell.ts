/**
 * @fileoverview Tree-sitter based PowerShell chunker splitting by function statement boundaries.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for PowerShell script files (.ps1, .psm1, .psd1).
 * Uses tree-sitter to parse and split by function statement boundaries.
 */
export class PowerShellChunker extends TreeSitterChunker {
  readonly language = "powershell";
  readonly fileExtensions = [".ps1", ".psm1", ".psd1"];
  readonly grammarName = "powershell";
  readonly nodeTypes = new Set([
    "function_statement",
  ]);
}

/** Default singleton instance of {@link PowerShellChunker}. */
export const powershellChunker = new PowerShellChunker();
