/**
 * @fileoverview Tree-sitter based Rust chunker splitting by functions, structs, enums, traits, impls, and types.
 */
import { TreeSitterChunker } from "./base.js";

/**
 * Chunker for Rust source files (.rs).
 * Uses tree-sitter to parse and split by functions, structs, enums, traits,
 * impl blocks, and type aliases.
 */
export class RustChunker extends TreeSitterChunker {
  readonly language = "rust";
  readonly fileExtensions = [".rs"];
  readonly grammarName = "rust";
  readonly nodeTypes = new Set([
    "function_item",
    "struct_item",
    "enum_item",
    "trait_item",
    "impl_item",
    "type_item",
  ]);
}

/** Default singleton instance of {@link RustChunker}. */
export const rustChunker = new RustChunker();
