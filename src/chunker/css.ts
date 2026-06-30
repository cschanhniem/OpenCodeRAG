/**
 * @fileoverview Tree-sitter based CSS chunker splitting by rule sets, at-rules, media, and keyframes.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for CSS stylesheets (.css).
 * Uses tree-sitter to parse and split by rule sets, at-rules, media
 * statements, and keyframes statements.
 */
export class CssChunker extends TreeSitterChunker {
  readonly language = "css";
  readonly fileExtensions = [".css"];
  readonly grammarName = "css";
  readonly nodeTypes = new Set([
    "rule_set",
    "at_rule",
    "media_statement",
    "keyframes_statement",
  ]);
}

/** Default singleton instance of {@link CssChunker}. */
export const cssChunker = new CssChunker();
