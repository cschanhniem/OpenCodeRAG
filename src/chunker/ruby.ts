/**
 * @fileoverview Tree-sitter based Ruby chunker splitting by method and singleton method definitions.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for Ruby source files (.rb).
 * Uses tree-sitter to parse and split by method and singleton method definitions.
 */
export class RubyChunker extends TreeSitterChunker {
  readonly language = "ruby";
  readonly fileExtensions = [".rb"];
  readonly grammarName = "ruby";
  readonly nodeTypes = new Set([
    "method",
    "singleton_method",
  ]);
}

/** Default singleton instance of {@link RubyChunker}. */
export const rubyChunker = new RubyChunker();
