import { TreeSitterChunker } from "./base.js";

export class XmlChunker extends TreeSitterChunker {
  readonly language = "xml";
  readonly fileExtensions = [".xml", ".csproj", ".svg"];
  readonly grammarName = "xml";
  readonly nodeTypes = new Set([
    "element",
  ]);
}

export const xmlChunker = new XmlChunker();
