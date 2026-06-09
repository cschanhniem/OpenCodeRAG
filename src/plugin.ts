import type { Plugin, PluginInput, Hooks, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";
import type { EmbeddingProvider, VectorStore, SearchResult } from "./core/interfaces.js";
import { loadConfig, DEFAULT_CONFIG, resolveLogConfig, type RagConfig } from "./core/config.js";
import { createEmbedder } from "./embedder/factory.js";
import { LanceDBStore } from "./vectorstore/lancedb.js";
import { retrieve } from "./retriever/retriever.js";
import { loadChunkersFromConfig } from "./chunker/loader.js";
import { appendDebugLog } from "./core/fileLogger.js";
import { createBackgroundIndexer } from "./watcher.js";
import { existsSync } from "node:fs";
import path from "node:path";

const configCache = new Map<string, RagConfig>();
const backgroundIndexers = new Map<string, { close: () => Promise<void> }>();

const CONTEXT_TOOL_NAME = "opencode-rag-context";
const CONTEXT_MARKER = "opencode-rag retrieved context";

type RetrievalQueryHints = {
  query: string;
  pathHints?: string[];
  languageHints?: string[];
  topK?: number;
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
      ? `${message}\n${formatLogPayload(payload)}`
      : message,
  });
}

function formatLogPayload(value: unknown, indent = 0): string {
  const prefix = "  ".repeat(indent);

  if (value === null) {
    return `${prefix}null`;
  }

  if (typeof value === "string") {
    return indentMultiline(value, indent);
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return `${prefix}${String(value)}`;
  }

  if (typeof value === "undefined") {
    return `${prefix}undefined`;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${prefix}[]`;
    }

    return value
      .map((item) => {
        if (item === null || typeof item === "number" || typeof item === "boolean" || typeof item === "bigint") {
          return `${prefix}- ${String(item)}`;
        }

        if (typeof item === "undefined") {
          return `${prefix}- undefined`;
        }

        if (typeof item === "string") {
          return `${prefix}- ${item.includes("\n") ? `\n${indentMultiline(item, indent + 1)}` : item}`;
        }

        return `${prefix}-\n${formatLogPayload(item, indent + 1)}`;
      })
      .join("\n");
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return `${prefix}{}`;
    }

    return entries
      .map(([key, nested]) => {
        if (nested === null || typeof nested === "number" || typeof nested === "boolean" || typeof nested === "bigint") {
          return `${prefix}${key}: ${String(nested)}`;
        }

        if (typeof nested === "undefined") {
          return `${prefix}${key}: undefined`;
        }

        if (typeof nested === "string") {
          return `${prefix}${key}:\n${indentMultiline(nested, indent + 1)}`;
        }

        return `${prefix}${key}:\n${formatLogPayload(nested, indent + 1)}`;
      })
      .join("\n");
  }

  return `${prefix}${String(value)}`;
}

function indentMultiline(text: string, indent: number): string {
  const prefix = "  ".repeat(indent);
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
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
  retrieveFn: typeof retrieve = retrieve,
  minScore = 0
): Promise<SearchResult[]> {
  if (query.trim().length === 0) return [];
  return retrieveFn(query, embedder, store, { topK, minScore });
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
  const minScore = cfg.retrieval.minScore;
  const primaryResults = await retrieveContext(query, embedder, store, topK, retrieveFn, minScore);
  const extraResults = extraQuery
    ? await retrieveContext(extraQuery, embedder, store, topK, retrieveFn, minScore)
    : [];

  return dedupeResults([...primaryResults, ...extraResults])
    .sort((a, b) => b.score - a.score)
    .slice(0, cfg.openCode.maxContextChunks);
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
  worktree: string;
  dependencies?: Partial<RagPluginDependencies>;
  store?: VectorStore;
  embedder?: EmbeddingProvider;
};

function formatFileList(results: SearchResult[], worktree: string): string {
  const fileMap = new Map<string, { lines: number[]; scores: number[] }>();

  for (const r of results) {
    const m = r.chunk.metadata;
    const existing = fileMap.get(m.filePath);
    if (existing) {
      existing.lines.push(m.startLine, m.endLine);
      existing.scores.push(r.score);
    } else {
      fileMap.set(m.filePath, {
        lines: [m.startLine, m.endLine],
        scores: [r.score],
      });
    }
  }

  const sorted = [...fileMap.entries()]
    .sort((a, b) => Math.max(...b[1].scores) - Math.max(...a[1].scores))
    .slice(0, 10);

  if (sorted.length === 0) return "";

  const lines: string[] = [];
  for (const [filePath, info] of sorted) {
    const relPath = path.relative(worktree, filePath).replace(/\\/g, "/");
    const minLine = Math.min(...info.lines);
    const maxLine = Math.max(...info.lines);
    const relevance = Math.max(...info.scores).toFixed(2);
    const lang = results.find((r) => r.chunk.metadata.filePath === filePath)?.chunk.metadata.language ?? "";
    lines.push(`${relPath} (${lang}, lines ${minLine}-${maxLine}, relevance ${relevance})`);
  }
  lines.push(`\n(Showing top ${sorted.length} relevant files. Run "${CONTEXT_TOOL_NAME}" tool with path hints for more targeted context.)`);
  let linesReturn = lines.join("\n");
  return linesReturn;
}

/**
 * Extract the user message text from chat.message hook input/output.
 *
 * Attempts to find the user's message content from output.message first
 * (via parts/text), then falls back to input fields.
 */
function extractUserMessageText(
  input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string }; messageID?: string; variant?: string },
  output?: { message?: unknown; parts?: unknown[] }
): string {
  // Try to extract from output.parts first (most common path)
  if (output?.message) {
    const msg = output.message as Record<string, unknown>;
    // Check for parts array in message
    const parts = (Array.isArray(msg.parts) ? msg.parts : undefined) ?? output.parts;
    if (parts) {
      const textParts = parts
        .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
        .map((p) => (typeof p.text === "string" ? p.text : ""))
        .filter((t) => t.length > 0);
      if (textParts.length > 0) {
        return textParts.join(" ");
      }
    }
    // Check for content string in message
    if (typeof msg.content === "string" && msg.content.length > 0) {
      return msg.content;
    }
  }
  return "";
}

export function createRagHooks(options: CreateRagHooksOptions): Hooks {
  const dependencies: RagPluginDependencies = {
    ...defaultDependencies,
    ...options.dependencies,
  };
  const embedder = options.embedder ?? dependencies.createEmbedder(options.cfg);
  const store = options.store ?? dependencies.createStore(options.storePath);

  // Session-level caches for lazy retrieval
  const sessionLastMessage = new Map<string, string>();
  const sessionRetrievalCache = new Map<string, { messageText: string; rawResults: SearchResult[] }>();

  appendDebugLog(options.logFilePath, {
    scope: "plugin",
    message: "OpenCode plugin initialized",
  });

  const overrideRead = options.cfg.openCode.overrideRead !== false;

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

  const tools: Record<string, ToolDefinition> = {
    [CONTEXT_TOOL_NAME]: retrievalTool,
  };

  return {
    async event({ event }) {
      //appendVerboseLog(options.logFilePath, "event", "opencode event received", event);
    },
    tool: tools,
    async "experimental.chat.system.transform"(_input, output) {
      appendDebugLog(options.logFilePath, {
        scope: "experimental.chat.system.transform",
        message: "system guidance injected",
      });

      const guidance = [
        "OpenCodeRAG is available through the `opencode-rag-context` tool.",
        "Use it before planning, editing, or answering when you need code provenance, surrounding implementation, or file-level evidence.",
        "Prefer narrow queries and add path or language hints when they are known.",
      ];

      output.system.unshift(guidance.join(" "));
    },
    async "chat.message"(input, output) {
      try {
        const text = extractUserMessageText(input, output);
        if (text.length === 0) return;

        sessionLastMessage.set(input.sessionID, text);

        const count = await store.count();
        if (count === 0) return;

        const results = await dependencies.retrieve(text, embedder, store, {
          topK: options.cfg.retrieval.topK,
          minScore: options.cfg.retrieval.minScore,
        });

        if (results.length === 0) return;

        const suggestionList = formatFileList(results, options.worktree);

        if (!suggestionList) return;

        const parts = output?.parts ?? (output?.message as Record<string, unknown>)?.parts;
        if (Array.isArray(parts) && parts.length > 0) {
          const first = parts[0] as Record<string, unknown>;
          if (typeof first.text === "string") {
            first.text = `${first.text}\n\n${suggestionList}`;
          }
        }
      } catch (err) {
        appendDebugLog(options.logFilePath, {
          scope: "chat.message",
          message: "failed to suggest related files",
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
  const cfg = await getConfig(input.directory);
  const logFilePath = path.resolve(input.directory, resolveLogConfig(cfg).logFilePath);

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
    worktree: input.directory,
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
