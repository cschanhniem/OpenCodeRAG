/**
 * @fileoverview Abstract base class for tree-sitter based language chunkers.
 */
import { Parser } from "web-tree-sitter";
import { loadLanguage, loadLanguageFromPath, walkTree, type AstNode } from "./grammar.js";
import type { Chunker, Chunk } from "../core/interfaces.js";
import { uuid } from "./uuid.js";

/** Abstract base for tree-sitter based language chunkers. */
export abstract class TreeSitterChunker implements Chunker {
  abstract readonly language: string;
  abstract readonly fileExtensions: string[];
  abstract readonly grammarName: string;
  abstract readonly nodeTypes: Set<string>;

  readonly wasmFilePath?: string;

  /**
   * Maximum content length in bytes before chunking is skipped.
   * Tree-sitter can hang on very large files (especially SVGs).
   * Set to 0 or negative for no limit.
   * @default 0 (no limit)
   */
  maxContentBytes = 0;

  private parser: Parser | null = null;
  private parserPromise: Promise<Parser> | undefined;

  withNodeTypes(types: Set<string>): Chunker {
    const original = this;
    return {
      get language() { return original.language; },
      get fileExtensions() { return original.fileExtensions; },
      async chunk(filePath: string, content: string): Promise<Chunk[]> {
        if (content.trim().length === 0) return [];
        if (original.maxContentBytes > 0 && Buffer.byteLength(content, "utf-8") > original.maxContentBytes) {
          throw new Error(`File exceeds ${original.maxContentBytes} byte limit for ${original.language} chunker`);
        }
        const parser = await original.getParser();
        const tree = parser.parse(content);
        if (!tree) return [];
        const nodes = walkTree(tree.rootNode, types, content);
        return nodes.map((node: AstNode) => ({
          id: uuid(),
          content: node.text,
          description: node.leadingDoc,
          metadata: {
            filePath,
            startLine: node.startLine,
            endLine: node.endLine,
            language: original.language,
          },
        }));
      },
    };
  }

  private getParser(): Promise<Parser> {
    if (this.parser) return Promise.resolve(this.parser);
    if (!this.parserPromise) {
      this.parserPromise = (async () => {
        const lang = this.wasmFilePath
          ? await loadLanguageFromPath(this.grammarName, this.wasmFilePath)
          : await loadLanguage(this.grammarName);
        const parser = new Parser();
        parser.setLanguage(lang);
        this.parser = parser;
        this.parserPromise = undefined;
        return parser;
      })();
    }
    return this.parserPromise;
  }

  async chunk(filePath: string, content: string): Promise<Chunk[]> {
    if (content.trim().length === 0) return [];

    if (this.maxContentBytes > 0 && Buffer.byteLength(content, "utf-8") > this.maxContentBytes) {
      throw new Error(`File exceeds ${this.maxContentBytes} byte limit for ${this.language} chunker`);
    }

    const parser = await this.getParser();
    const tree = parser.parse(content);
    if (!tree) return [];

    const nodes = walkTree(tree.rootNode, this.nodeTypes, content);

    return nodes.map((node: AstNode) => ({
      id: uuid(),
      content: node.text,
      description: node.leadingDoc,
      metadata: {
        filePath,
        startLine: node.startLine,
        endLine: node.endLine,
        language: this.language,
      },
    }));
  }
}
