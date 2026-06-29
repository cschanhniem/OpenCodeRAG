/**
 * @fileoverview Tree-sitter based XML chunker splitting by top-level XML elements.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for XML files (.xml, .csproj, .svg).
 * Uses tree-sitter to parse and split by top-level XML elements.
 */
export class XmlChunker extends TreeSitterChunker {
  readonly language = "xml";
  readonly fileExtensions = [".xml", ".csproj", ".svg"];
  readonly grammarName = "xml";
  readonly nodeTypes = new Set([
    "element",
  ]);
}

/** Default singleton instance of {@link XmlChunker}. */
export const xmlChunker = new XmlChunker();
