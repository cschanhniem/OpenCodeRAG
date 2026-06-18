import { TreeSitterChunker } from "./base.js";

export class PowerShellChunker extends TreeSitterChunker {
  readonly language = "powershell";
  readonly fileExtensions = [".ps1", ".psm1", ".psd1"];
  readonly grammarName = "powershell";
  readonly nodeTypes = new Set([
    "function_statement",
  ]);
}

export const powershellChunker = new PowerShellChunker();
