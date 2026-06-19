import path from "node:path";
import { existsSync } from "node:fs";
import { loadConfig, DEFAULT_CONFIG, type RagConfig, type ConfigValidationResult } from "./core/config.js";
import { resolveApiKey } from "./core/resolve-api-key.js";
import { loadChunkersFromConfig } from "./chunker/loader.js";
import { createEmbedder } from "./embedder/factory.js";
import { createDescriptionProvider } from "./describer/factory.js";
import { LanceDBStore } from "./vectorstore/lancedb.js";
import { retrieve } from "./retriever/retriever.js";
import type { RetrieveOptions } from "./retriever/retriever.js";
import { KeywordIndex } from "./retriever/keyword-index.js";
import { runIndexPass, getIndexStatusSummary, scanWorkspace, type IndexRunStats, type WorkspaceFile } from "./indexer.js";
import type { SearchResult, EmbeddingProvider, KeywordIndex as IKeywordIndex } from "./core/interfaces.js";

export interface SearchOptions {
  cwd?: string;
  configPath?: string;
  topK?: number;
  minScore?: number;
  keywordWeight?: number;
  pathHints?: string[];
  languageHints?: string[];
  explain?: boolean;
}

export interface IndexOptions {
  configPath?: string;
  force?: boolean;
  onProgress?: (message: string) => void;
}

export interface ContextResult {
  chunks: SearchResult[];
  text: string;
}

async function resolveConfig(cwd?: string, configPath?: string): Promise<RagConfig> {
  const workDir = cwd ?? process.cwd();

  if (configPath) {
    const resolved = path.resolve(configPath);
    const cfg = loadConfig(resolved);
    resolveApiKey(cfg, workDir);
    await loadChunkersFromConfig(cfg, path.dirname(resolved));
    return cfg;
  }

  const locations = [
    path.join(workDir, "opencode-rag.json"),
    path.join(workDir, ".opencode", "opencode-rag.json"),
    path.join(workDir, ".opencode", "rag.json"),
  ];
  for (const loc of locations) {
    if (existsSync(loc)) {
      const cfg = loadConfig(loc);
      resolveApiKey(cfg, workDir);
      await loadChunkersFromConfig(cfg, path.dirname(loc));
      return cfg;
    }
  }

  return { ...DEFAULT_CONFIG };
}

async function probeDimension(embedder: EmbeddingProvider): Promise<number> {
  try {
    const probe = await embedder.embed(["dimension-probe"], "query");
    if (probe && probe[0] && probe[0].length > 0 && typeof probe[0][0] === "number") {
      return (probe[0] as number[]).length;
    }
  } catch {
    // fallback to 384
  }
  return 384;
}

async function loadKeywordIndex(storePath: string): Promise<IKeywordIndex> {
  try {
    const idx = await KeywordIndex.load(storePath);
    return idx;
  } catch {
    return new KeywordIndex(storePath);
  }
}

function formatContextResults(results: SearchResult[]): string {
  if (results.length === 0) return "No matching chunks found.";

  const lines: string[] = [];
  for (const r of results) {
    const { filePath, startLine, endLine, language } = r.chunk.metadata;
    lines.push(`#### ${filePath}:${startLine}-${endLine} (score: ${r.score.toFixed(3)})`);
    lines.push("```" + language);
    lines.push(r.chunk.content);
    lines.push("```");
    if (r.chunk.description) {
      lines.push(`> ${r.chunk.description}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export async function search(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  const cfg = await resolveConfig(options.cwd, options.configPath);
  const storePath = path.resolve(options.cwd ?? process.cwd(), cfg.vectorStore.path);

  const embedder = createEmbedder(cfg);
  const dimension = await probeDimension(embedder);
  const store = new LanceDBStore(storePath, dimension);

  const keywordIndex = await loadKeywordIndex(storePath);

  return retrieve(query, embedder, store, {
    topK: options.topK ?? cfg.retrieval.topK,
    minScore: options.minScore ?? cfg.retrieval.minScore,
    keywordIndex,
    keywordWeight: options.keywordWeight ?? cfg.retrieval.hybridSearch?.keywordWeight ?? 0.4,
    queryPrefix: cfg.embedding.queryPrefix,
    explain: options.explain,
  } satisfies RetrieveOptions);
}

export async function indexWorkspace(
  cwd?: string,
  options: IndexOptions = {}
): Promise<IndexRunStats> {
  const workDir = cwd ?? process.cwd();
  const cfg = await resolveConfig(workDir, options.configPath);
  const storePath = path.resolve(workDir, cfg.vectorStore.path);

  const embedder = createEmbedder(cfg);
  const dimension = await probeDimension(embedder);
  const store = new LanceDBStore(storePath, dimension);

  const keywordIndex = await loadKeywordIndex(storePath);

  const descriptionConfig = cfg.description;
  const descriptionProvider = descriptionConfig?.enabled
    ? createDescriptionProvider(descriptionConfig)
    : undefined;

  if (options.onProgress) {
    options.onProgress(`Indexing ${workDir}...`);
  }

  const stats = await runIndexPass({
    cwd: workDir,
    storePath,
    config: cfg,
    store,
    embedder,
    force: options.force ?? false,
    keywordIndex,
    descriptionProvider,
  });

  return stats;
}

export async function getContext(
  query: string,
  options: SearchOptions = {}
): Promise<ContextResult> {
  const results = await search(query, options);
  return {
    chunks: results,
    text: formatContextResults(results),
  };
}

export { validateConfig } from "./core/config.js";
export type { ConfigValidationResult } from "./core/config.js";
export { scanWorkspace, getIndexStatusSummary } from "./indexer.js";
export type { WorkspaceFile, IndexRunStats } from "./indexer.js";
