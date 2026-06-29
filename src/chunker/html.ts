/**
 * @fileoverview Tree-sitter based HTML chunker splitting by script and style element boundaries.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for HTML files (.html, .htm).
 * Uses tree-sitter to parse and split by `<script>` and `<style>` element boundaries.
 */
export class HtmlChunker extends TreeSitterChunker {
  readonly language = "html";
  readonly fileExtensions = [".html", ".htm"];
  readonly grammarName = "html";
  readonly nodeTypes = new Set([
    "script_element",
    "style_element",
  ]);
}

/** Default singleton instance of {@link HtmlChunker}. */
export const htmlChunker = new HtmlChunker();
