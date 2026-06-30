/**
 * @fileoverview Tree-sitter based Python chunker splitting by function and decorated definitions.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for Python source files (.py).
 * Uses tree-sitter to parse and split by function definitions and decorated definitions.
 */
export class PythonChunker extends TreeSitterChunker {
  readonly language = "python";
  readonly fileExtensions = [".py"];
  readonly grammarName = "python";
  readonly nodeTypes = new Set([
    "function_definition",
    "decorated_definition",
  ]);
}

/** Default singleton instance of {@link PythonChunker}. */
export const pythonChunker = new PythonChunker();
