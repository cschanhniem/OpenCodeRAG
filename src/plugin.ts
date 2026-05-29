import type { Plugin, PluginInput, Hooks } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";
import type { EmbeddingProvider, VectorStore, SearchResult } from "./core/interfaces.js";
import { loadConfig, DEFAULT_CONFIG, type RagConfig } from "./core/config.js";
import { createEmbedder } from "./embedder/factory.js";
import { LanceDBStore } from "./vectorstore/lancedb.js";
import { retrieve } from "./retriever/retriever.js";
import { loadChunkersFromConfig } from "./chunker/loader.js";
import { appendDebugLog } from "./core/fileLogger.js";
import { createBackgroundIndexer } from "./watcher.js";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

const configCache = new Map<string, RagConfig>();
const backgroundIndexers = new Map<string, { close: () => Promise<void> }>();

const SEARCH_TOOLS = new Set(["glob", "grep", "read", "list"]);
const CONTEXT_TOOL_NAME = "opencode-rag-context";
const CONTEXT_MARKER = "opencode-rag retrieved context";

type RetrievalQueryHints = {
  query: string;
  pathHints?: string[];
  languageHints?: string[];
  topK?: number;
};

type TextPart = {
  type: "text";
  text: string;
  id: string;
  sessionID: string;
  messageID: string;
};

type MessagePart = {
  type?: string;
  text?: string;
  id?: string;
  sessionID?: string;
  messageID?: string;
};

type MessagePartsOutput = {
  message: {
    id?: string;
    sessionID?: string;
  };
  parts: MessagePart[];
};

type ToolExecuteAfterOutput = {
  title: string;
  output: string;
  metadata: unknown;
};

function appendVerboseLog(
  logFilePath: string,
  scope: string,
  message: string,
  payload?: unknown
): void {
  appendDebugLog(logFilePath, {
    scope,
    message: payload
      ? `${message} ${safeStringify(payload)}`
      : message,
  });
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function getConfig(directory: string): Promise<RagConfig> {
  const cached = configCache.get(directory);
  if (cached) return cached;

  for (const loc of ["opencode-rag.json", ".opencode/opencode-rag.json", ".opencode/rag.json"]) {
    const configPath = path.join(directory, loc);
    if (!existsSync(configPath)) {
      continue;
    }

    try {
      const cfg = loadConfig(configPath);
      await loadChunkersFromConfig(cfg, path.dirname(configPath));
      configCache.set(directory, cfg);
      return cfg;
    } catch (err) {
      appendDebugLog(path.resolve(directory, ".opencode", "opencode-rag.log"), {
        scope: "config",
        message: `Failed to load config from ${configPath}`,
        error: err,
      });
    }
  }

  configCache.set(directory, DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}

function formatContext(
  results: Awaited<ReturnType<typeof retrieve>>
): string {
  if (results.length === 0) return "";

  const avgScore = results.reduce((sum, r) => sum + r.score, 0) / results.length;

  const parts: string[] = [];
  parts.push(`\n**${CONTEXT_MARKER}** _(context: ${results.length} chunks, avg relevance: ${avgScore.toFixed(2)})_\n`);
  parts.push("---\n");

  for (const r of results) {
    const m = r.chunk.metadata;
    parts.push(
      `[${m.filePath}:${m.startLine}-${m.endLine}] (${m.language}, score: ${r.score.toFixed(2)})`
    );
    parts.push("```" + m.language);
    parts.push(r.chunk.content);
    parts.push("```\n");
  }

  parts.push("---\n");
  return parts.join("\n");
}

function buildRetrievalQuery(hints: RetrievalQueryHints): string {
  const parts: string[] = [hints.query.trim()];

  const pathHints = hints.pathHints?.map((hint) => hint.trim()).filter((hint) => hint.length > 0) ?? [];
  if (pathHints.length > 0) {
    parts.push(`Path hints: ${pathHints.join(", ")}`);
  }

  const languageHints = hints.languageHints?.map((hint) => hint.trim()).filter((hint) => hint.length > 0) ?? [];
  if (languageHints.length > 0) {
    parts.push(`Language hints: ${languageHints.join(", ")}`);
  }

  return parts.join("\n").trim();
}

function getQueryFromParts(output: MessagePartsOutput): string {
  const queryTexts: string[] = [];

  for (const part of output.parts) {
    if (part.type === "text" && typeof part.text === "string") {
      queryTexts.push(part.text);
    }
  }

  return queryTexts.join("\n").trim();
}

function hasInjectedContext(parts: Array<{ type?: string; text?: string }>): boolean {
  return parts.some(
    (part) => part.type === "text" && typeof part.text === "string" && part.text.includes("opencode-rag retrieved context")
  );
}

function buildInjectedTextPart(output: MessagePartsOutput, text: string): TextPart | null {
  const template = output.parts.find(
    (part) => typeof part.sessionID === "string" && typeof part.messageID === "string"
  );

  const sessionID = output.message.sessionID ?? template?.sessionID;
  const messageID = output.message.id ?? template?.messageID;

  if (!sessionID || !messageID) {
    return null;
  }

  return {
    type: "text",
    text,
    id: `prt_${randomUUID().replace(/-/g, "")}`,
    sessionID,
    messageID,
  };
}

function normalizeToolOutput(output: string): string {
  return output.replace(/\r\n/g, "\n").trim();
}

function buildToolQuery(tool: string, output: string): string {
  const normalized = normalizeToolOutput(output);
  if (!normalized) return "";

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 40);

  if (lines.length === 0) return "";

  return [
    `OpenCode used the ${tool} tool while searching for relevant files and code.`,
    "Use these discovered paths and matches as retrieval hints:",
    ...lines,
  ].join("\n");
}

function dedupeResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];

  for (const result of results) {
    const chunk = result.chunk;
    const key = [
      chunk.metadata.filePath,
      chunk.metadata.startLine,
      chunk.metadata.endLine,
      chunk.content,
    ].join(":");

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }

  return deduped;
}

async function retrieveContext(
  query: string,
  embedder: EmbeddingProvider,
  store: VectorStore,
  topK: number,
  retrieveFn: typeof retrieve = retrieve
): Promise<SearchResult[]> {
  if (query.trim().length === 0) return [];
  return retrieveFn(query, embedder, store, { topK });
}

async function loadRetrievedResults(
  query: string,
  embedder: EmbeddingProvider,
  store: VectorStore,
  cfg: RagConfig,
  retrieveFn: typeof retrieve = retrieve,
  topK = cfg.retrieval.topK,
  extraQuery?: string
): Promise<SearchResult[]> {
  const primaryResults = await retrieveContext(query, embedder, store, topK, retrieveFn);
  const extraResults = extraQuery
    ? await retrieveContext(extraQuery, embedder, store, topK, retrieveFn)
    : [];

  return dedupeResults([...primaryResults, ...extraResults])
    .sort((a, b) => b.score - a.score)
    .slice(0, cfg.openCode.maxContextChunks);
}

async function appendRetrievedContext(
  logFilePath: string,
  query: string,
  output: MessagePartsOutput,
  store: VectorStore,
  embedder: EmbeddingProvider,
  cfg: RagConfig,
  retrieveFn: typeof retrieve = retrieve,
  extraQuery?: string
): Promise<void> {
  if (hasInjectedContext(output.parts)) return;

  const merged = await loadRetrievedResults(query, embedder, store, cfg, retrieveFn, cfg.retrieval.topK, extraQuery);

  if (merged.length === 0) {
    appendVerboseLog(logFilePath, "chat.message", "retrieval produced no context", {
      query,
      extraQuery: extraQuery ?? null,
    });
    return;
  }

  const context = formatContext(merged);
  const part = buildInjectedTextPart(output, context);

  if (!part) {
    appendVerboseLog(logFilePath, "chat.message", "skipped context append because message metadata was missing", {
      query,
      extraQuery: extraQuery ?? null,
      message: output.message,
      parts: output.parts,
    });
    return;
  }

  output.parts.push(part);

  appendVerboseLog(logFilePath, "chat.message", "appended retrieved context", {
    query,
    extraQuery: extraQuery ?? null,
    results: merged.map((result) => ({
      filePath: result.chunk.metadata.filePath,
      startLine: result.chunk.metadata.startLine,
      endLine: result.chunk.metadata.endLine,
      language: result.chunk.metadata.language,
      score: result.score,
    })),
    context,
  });
}

type RagPluginDependencies = {
  createEmbedder: typeof createEmbedder;
  createStore: (storePath: string) => VectorStore;
  retrieve: typeof retrieve;
};

const defaultDependencies: RagPluginDependencies = {
  createEmbedder,
  createStore: (storePath) => new LanceDBStore(storePath),
  retrieve,
};

type CreateRagHooksOptions = {
  cfg: RagConfig;
  storePath: string;
  logFilePath: string;
  dependencies?: Partial<RagPluginDependencies>;
  store?: VectorStore;
  embedder?: EmbeddingProvider;
};

export function createRagHooks(options: CreateRagHooksOptions): Hooks {
  const dependencies: RagPluginDependencies = {
    ...defaultDependencies,
    ...options.dependencies,
  };
  const embedder = options.embedder ?? dependencies.createEmbedder(options.cfg);
  const store = options.store ?? dependencies.createStore(options.storePath);

  appendDebugLog(options.logFilePath, {
    scope: "plugin",
    message: "OpenCode plugin initialized",
  });

  const retrievalTool = tool({
    description:
      "Retrieve the most relevant indexed code chunks before planning, answering, or editing. Use it to get file-level evidence, line ranges, and surrounding implementation details.",
    args: {
      query: tool.schema.string().min(1, "A retrieval query is required."),
      pathHints: tool.schema.array(tool.schema.string().min(1)).max(10).optional(),
      languageHints: tool.schema.array(tool.schema.string().min(1)).max(10).optional(),
      topK: tool.schema.number().int().min(1).max(25).optional(),
    },
    async execute(args) {
      try {
        const count = await store.count();
        if (count === 0) {
          appendVerboseLog(options.logFilePath, CONTEXT_TOOL_NAME, "retrieval requested but no chunks are indexed", {
            query: args.query,
            pathHints: args.pathHints ?? [],
            languageHints: args.languageHints ?? [],
            topK: args.topK ?? options.cfg.retrieval.topK,
          });

          return {
            title: "OpenCodeRAG context",
            output:
              "No indexed chunks are available yet. Run indexing first, then ask again for code context.",
            metadata: {
              query: args.query,
              chunks: 0,
              indexed: false,
            },
          };
        }

        const query = buildRetrievalQuery({
          query: args.query,
          pathHints: args.pathHints,
          languageHints: args.languageHints,
        });
        const topK = args.topK ?? options.cfg.retrieval.topK;
        const results = await loadRetrievedResults(query, embedder, store, options.cfg, dependencies.retrieve, topK);

        if (results.length === 0) {
          appendVerboseLog(options.logFilePath, CONTEXT_TOOL_NAME, "retrieval completed with no matching chunks", {
            query,
            pathHints: args.pathHints ?? [],
            languageHints: args.languageHints ?? [],
            topK,
          });

          return {
            title: "OpenCodeRAG context",
            output: `${CONTEXT_MARKER}\n\nNo indexed chunks matched the query.`,
            metadata: {
              query: args.query,
              chunks: 0,
              indexed: true,
            },
          };
        }

        const output = formatContext(results);

        appendVerboseLog(options.logFilePath, CONTEXT_TOOL_NAME, "retrieval completed successfully", {
          query,
          pathHints: args.pathHints ?? [],
          languageHints: args.languageHints ?? [],
          topK,
          results: results.map((result) => ({
            filePath: result.chunk.metadata.filePath,
            startLine: result.chunk.metadata.startLine,
            endLine: result.chunk.metadata.endLine,
            language: result.chunk.metadata.language,
            score: result.score,
          })),
          output,
        });

        return {
          title: `OpenCodeRAG context (${results.length} chunk${results.length === 1 ? "" : "s"})`,
          output,
          metadata: {
            query: args.query,
            topK,
            chunks: results.length,
            indexed: true,
            pathHints: args.pathHints ?? [],
            languageHints: args.languageHints ?? [],
          },
        };
      } catch (err) {
        appendDebugLog(options.logFilePath, {
          scope: CONTEXT_TOOL_NAME,
          message: "chunk retrieval tool error",
          error: err,
        });

        return {
          title: "OpenCodeRAG context",
          output:
            "OpenCodeRAG could not retrieve context right now. Try again after indexing or reduce the query scope.",
          metadata: {
            query: args.query,
            chunks: 0,
            indexed: false,
          },
        };
      }
    },
  });

  return {
    async event({ event }) {
      //appendVerboseLog(options.logFilePath, "event", "opencode event received", event);
    },
    tool: {
      [CONTEXT_TOOL_NAME]: retrievalTool,
    },
    async "experimental.chat.system.transform"(_input, output) {
      appendDebugLog(options.logFilePath, {
        scope: "experimental.chat.system.transform",
        message: "system guidance injected",
      });

      output.system.unshift(
        [
          "OpenCodeRAG is available through the `opencode-rag-context` tool.",
          "Use it before planning, editing, or answering when you need code provenance, surrounding implementation, or file-level evidence.",
          "Prefer narrow queries and add path or language hints when they are known.",
        ].join(" ")
      );
    },
    async "chat.message"(_input, output) {
      try {
        appendVerboseLog(options.logFilePath, "chat.message", "chat.message hook invoked", {
          input: _input,
          output,
        });

        const count = await store.count();

        if (count === 0) {
          appendVerboseLog(options.logFilePath, "chat.message", "skipped retrieval because no chunks are indexed", {
            parts: output.parts,
          });

          return;
        }

        const query = getQueryFromParts(output);
        if (query.length === 0) {
          appendVerboseLog(options.logFilePath, "chat.message", "skipped retrieval because the query was empty", {
            parts: output.parts,
          });

          return;
        }

        await appendRetrievedContext(options.logFilePath, query, output, store, embedder, options.cfg, dependencies.retrieve);
      } catch (err) {
        appendDebugLog(options.logFilePath, {
          scope: "chat.message",
          message: "chat.message hook error",
          error: err,
        });
      }
    },
    async "tool.execute.after"(hookInput, output) {
      try {
        if (!SEARCH_TOOLS.has(hookInput.tool)) return;

        appendVerboseLog(options.logFilePath, "tool.execute.after", `tool.execute.after hook invoked for ${hookInput.tool}`, {
          input: hookInput,
          output,
        });

        const toolOutput = typeof output.output === "string" ? output.output : "";
        const extraQuery = buildToolQuery(hookInput.tool, toolOutput);
        if (extraQuery.length === 0) {
          appendVerboseLog(options.logFilePath, "tool.execute.after", "skipped retrieval because the tool output did not contain usable hints", {
            tool: hookInput.tool,
            toolOutput,
          });

          return;
        }

        const count = await store.count();
        if (count === 0) {
          appendVerboseLog(options.logFilePath, "tool.execute.after", "skipped retrieval because no chunks are indexed", {
            tool: hookInput.tool,
            toolOutput,
            extraQuery,
          });

          return;
        }

        const context = formatContext(
          await loadRetrievedResults(
            extraQuery,
            embedder,
            store,
            options.cfg,
            dependencies.retrieve,
            options.cfg.openCode.maxContextChunks
          )
        );

        if (!context) {
          appendVerboseLog(options.logFilePath, "tool.execute.after", "retrieval produced no context", {
            tool: hookInput.tool,
            toolOutput,
            extraQuery,
          });

          return;
        }

        output.output = `${toolOutput}\n${context}`.trim();

        appendVerboseLog(options.logFilePath, "tool.execute.after", "appended retrieval context to tool output", {
          tool: hookInput.tool,
          toolOutput,
          extraQuery,
          context,
        });
      } catch (err) {
        appendDebugLog(options.logFilePath, {
          scope: "tool.execute.after",
          message: "tool.execute.after hook error",
          error: err,
        });
      }
    },
  };
}

export const ragPlugin: Plugin = async (
  input: PluginInput,
  _options?: Record<string, unknown>
): Promise<Hooks> => {
  const logFilePath = path.resolve(input.directory, ".opencode", "opencode-rag.log");
  const cfg = await getConfig(input.directory);

  if (!cfg.openCode.enabled) {
    return {};
  }

  const storePath = path.resolve(input.directory, cfg.vectorStore.path);

  // Close existing indexer for this directory if one exists (e.g. on plugin reload)
  const existingIndexer = backgroundIndexers.get(input.directory);
  if (existingIndexer) {
    try {
      await existingIndexer.close();
    } catch (err) {
      appendDebugLog(logFilePath, {
        scope: "plugin",
        message: "Failed to close existing background indexer",
        error: err,
      });
    }
    backgroundIndexers.delete(input.directory);
  }

  appendDebugLog(logFilePath, {
    scope: "plugin",
    message: `OpenCode plugin enabled for ${input.directory}`,
  });

  // Probe vector dimension and create store with correct dimension
  const embedder = createEmbedder(cfg);
  let vectorDimension = 384;
  try {
    const probe = await embedder.embed(["dimension-probe"]);
    if (probe && probe[0] && probe[0].length > 0 && typeof probe[0][0] === "number") {
      vectorDimension = (probe[0] as number[]).length;
    }
    appendDebugLog(logFilePath, {
      scope: "plugin",
      message: `Vector dimension: ${vectorDimension}`,
    });
  } catch (err) {
    appendDebugLog(logFilePath, {
      scope: "plugin",
      message: `Dimension probe failed, falling back to ${vectorDimension}`,
      error: err,
    });
  }

  const store = new LanceDBStore(storePath, vectorDimension);

  const hooks = createRagHooks({
    cfg,
    storePath,
    logFilePath,
    embedder,
    store,
  });

  // Start background auto-indexer if enabled
  const autoIndexCfg = cfg.openCode.autoIndex ?? { enabled: true, debounceMs: 5000, intervalMs: 300000 };
  if (autoIndexCfg.enabled) {
    const indexer = createBackgroundIndexer({
      cwd: input.directory,
      storePath,
      config: cfg,
      store,
      embedder,
      logFilePath,
    });

    backgroundIndexers.set(input.directory, indexer);
  }

  return hooks;
};

export default ragPlugin;
