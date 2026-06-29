/**
 * @fileoverview Tree-sitter based Markdown chunker splitting by section headings.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for Markdown files (.md, .mdx).
 * Uses tree-sitter to parse and split by section headings.
 */
export class MarkdownChunker extends TreeSitterChunker {
  readonly language = "markdown";
  readonly fileExtensions = [".md", ".mdx"];
  readonly grammarName = "markdown";
  readonly nodeTypes = new Set(["section"]);
}

/** Default singleton instance of {@link MarkdownChunker}. */
export const markdownChunker = new MarkdownChunker();
