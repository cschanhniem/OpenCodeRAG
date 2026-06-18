import type { Chunker, Chunk } from "../core/interfaces.js";
import { TreeSitterChunker } from "./base.js";
import { typescriptChunker } from "./typescript.js";
import { pythonChunker } from "./python.js";
import { javaChunker } from "./java.js";
import { goChunker } from "./go.js";
import { markdownChunker } from "./markdown.js";
import { cChunker } from "./c.js";
import { cppChunker } from "./cpp.js";
import { csharpChunker } from "./csharp.js";
import { javascriptChunker } from "./javascript.js";
import { razorChunker } from "./razor.js";
import { jsonChunker } from "./json.js";
import { htmlChunker } from "./html.js";
import { cssChunker } from "./css.js";
import { xmlChunker } from "./xml.js";
import { slnChunker } from "./sln.js";
import { rustChunker } from "./rust.js";
import { rubyChunker } from "./ruby.js";
import { kotlinChunker } from "./kotlin.js";
import { swiftChunker } from "./swift.js";
import { bashChunker } from "./bash.js";
import { phpChunker } from "./php.js";
import { powershellChunker } from "./powershell.js";
import { iniChunker } from "./ini.js";
import { yamlChunker } from "./yaml.js";
import { tomlChunker } from "./toml.js";
import { dockerfileChunker } from "./dockerfile.js";
import { sqlChunker } from "./sql.js";
import { texChunker } from "./tex.js";
import { fallbackChunker } from "./fallback.js";
import { pdfChunker } from "./pdf.js";
import { docxChunker } from "./docx.js";
import { docChunker } from "./doc.js";
import { excelChunker } from "./excel.js";
import { uuid } from "./uuid.js";

const chunkers: Chunker[] = [
  typescriptChunker,
  pythonChunker,
  javaChunker,
  goChunker,
  markdownChunker,
  cChunker,
  cppChunker,
  csharpChunker,
  javascriptChunker,
  razorChunker,
  jsonChunker,
  htmlChunker,
  cssChunker,
  xmlChunker,
  slnChunker,
  rustChunker,
  rubyChunker,
  kotlinChunker,
  swiftChunker,
  bashChunker,
  phpChunker,
  powershellChunker,
  iniChunker,
  yamlChunker,
  tomlChunker,
  dockerfileChunker,
  sqlChunker,
  texChunker,
  pdfChunker,
  docxChunker,
  docChunker,
  excelChunker,
];

const extensionMap = new Map<string, Chunker>();

for (const chunker of chunkers) {
  if ("fileExtensions" in chunker) {
    const ce = chunker as typeof chunker & { fileExtensions: string[] };
    for (const ext of ce.fileExtensions) {
      extensionMap.set(ext, chunker);
    }
  }
}

export function registerChunker(
  chunker: Chunker,
  extensions?: string[]
): void {
  const exts = extensions ?? ("fileExtensions" in chunker
    ? (chunker as typeof chunker & { fileExtensions: string[] }).fileExtensions
    : []);

  for (const ext of exts) {
    const lower = ext.toLowerCase();
    if (extensionMap.has(lower)) {
      console.warn(
        `[opencode-rag] Chunker for "${lower}" already registered — skipping pluggable chunker "${chunker.language}"`
      );
      continue;
    }
    extensionMap.set(lower, chunker);
  }
}

export function getChunker(filePath: string): Chunker {
  const dotIdx = filePath.lastIndexOf(".");
  const ext = dotIdx >= 0 ? filePath.slice(dotIdx).toLowerCase() : "";
  if (ext && extensionMap.has(ext)) {
    return extensionMap.get(ext)!;
  }
  const basename = filePath.toLowerCase();
  return extensionMap.get(basename) ?? fallbackChunker;
}

export function getRegisteredExtensions(): string[] {
  return [...extensionMap.keys()].sort();
}

const MAX_CHUNK_LINES = 100;
const MAX_CHUNK_CHARS = 8000;

function splitOversized(chunks: Chunk[], filePath: string): Chunk[] {
  const result: Chunk[] = [];

  for (const chunk of chunks) {
    const lines = chunk.content.split("\n");
    if (lines.length <= MAX_CHUNK_LINES && chunk.content.length <= MAX_CHUNK_CHARS) {
      result.push(chunk);
      continue;
    }

    const subChunks: Chunk[] = [];
    let currentLines: string[] = [];
    let currentCharCount = 0;
    let lineOffset = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineLen = line.length + 1;

      if (
        currentLines.length > 0 &&
        (currentLines.length >= MAX_CHUNK_LINES || currentCharCount + lineLen > MAX_CHUNK_CHARS)
      ) {
        subChunks.push({
          id: uuid(),
          content: currentLines.join("\n"),
          metadata: {
            filePath,
            startLine: chunk.metadata.startLine + lineOffset,
            endLine: chunk.metadata.startLine + i - 1,
            language: chunk.metadata.language,
          },
        });
        currentLines = [];
        currentCharCount = 0;
        lineOffset = i;
      }

      currentLines.push(line);
      currentCharCount += lineLen;
    }

    if (currentLines.length > 0) {
      subChunks.push({
        id: uuid(),
        content: currentLines.join("\n"),
        metadata: {
          filePath,
          startLine: chunk.metadata.startLine + lineOffset,
          endLine: chunk.metadata.startLine + lines.length - 1,
          language: chunk.metadata.language,
        },
      });
    }

    for (const sub of subChunks) {
      if (sub.content.trim().length > 0) {
        result.push(sub);
      }
    }
  }

  return result;
}

export async function chunkFile(
  filePath: string,
  content: string,
  nodeTypesOverrides?: Record<string, string[]>
): Promise<Chunk[]> {
  let chunker = getChunker(filePath);

  if (nodeTypesOverrides && chunker instanceof TreeSitterChunker) {
    const overrideTypes = nodeTypesOverrides[chunker.language];
    if (overrideTypes && overrideTypes.length > 0) {
      chunker = chunker.withNodeTypes(new Set(overrideTypes));
    }
  }

  const chunks = await chunker.chunk(filePath, content);

  if (chunks.length === 0) {
    return fallbackChunker.chunk(filePath, content);
  }

  return splitOversized(chunks, filePath);
}

export { typescriptChunker, pythonChunker, javaChunker, goChunker, markdownChunker, cChunker, cppChunker, csharpChunker, javascriptChunker, razorChunker, jsonChunker, htmlChunker, cssChunker, xmlChunker, slnChunker, rustChunker, rubyChunker, kotlinChunker, swiftChunker, bashChunker, phpChunker, powershellChunker, iniChunker, yamlChunker, tomlChunker, dockerfileChunker, sqlChunker, texChunker, pdfChunker, fallbackChunker };
