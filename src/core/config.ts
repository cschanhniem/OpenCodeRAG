import { readFileSync } from "node:fs";
import path from "node:path";
import { env } from "node:process";
import type { EmbeddingProvider, Chunker, VectorStore } from "./interfaces.js";

export interface ChunkerConfig {
  module: string;
  extensions: string[];
}

export interface ProxyConfig {
  url?: string;
  username?: string;
  password?: string;
  noProxy?: string;
}

export interface AutoIndexConfig {
  enabled: boolean;
  debounceMs: number;
  intervalMs: number;
}

export type ReadNoResultsBehavior = "hint" | "empty" | "error";

export interface AutoInjectConfig {
  enabled: boolean;
  minScore: number;
  maxChunks: number;
  maxTokens: number;
}

export interface DescriptionConfig {
  enabled: boolean;
  provider: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  proxy?: ProxyConfig;
  systemPrompt: string;
  batchMaxChunks?: number;
  batchTimeoutMs?: number;
  retryMax?: number;
  retryBaseDelayMs?: number;
}

export interface RagConfig {
  embedding: {
    provider: string;
    baseUrl: string;
    apiKey?: string;
    model: string;
    timeoutMs?: number;
    proxy?: ProxyConfig;
    documentPrefix?: string;
    queryPrefix?: string;
  };
  indexing: {
    includeExtensions: string[];
    excludeDirs: string[];
    chunkOverlap: number;
    minFileSizeBytes?: number;
  };
  vectorStore: {
    path: string;
  };
  retrieval: {
    topK: number;
    minScore: number;
    hybridSearch?: {
      enabled: boolean;
      keywordWeight: number;
    };
  };
  openCode: {
    enabled: boolean;
    maxContextChunks: number;
    autoIndex?: AutoIndexConfig;
    autoInject?: AutoInjectConfig;
    readOverride?: boolean;
    maxReadOutputChars?: number;
    readNoResultsBehavior?: ReadNoResultsBehavior;
    readRelatedFilesMax?: number;
  };
  chunkers?: ChunkerConfig[];
  description?: DescriptionConfig;
  logging: LoggingConfig;
}

export interface LoggingConfig {
  level: "debug" | "info" | "error";
  logFilePath: string;
}

export const DEFAULT_CONFIG: RagConfig = {
  embedding: {
    provider: "ollama",
    baseUrl: "http://127.0.0.1:11434/api",
    model: "embeddinggemma:latest",
    timeoutMs: 30000,
  },
  indexing: {
    includeExtensions: [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".cjs",
      ".py",
      ".java",
      ".go",
      ".md",
      ".mdx",
      ".c",
      ".h",
      ".cpp",
      ".cc",
      ".cxx",
      ".hpp",
      ".hxx",
      ".cs",
      ".aspx",
      ".razor",
      ".cshtml",
      ".json",
      ".html",
      ".htm",
      ".css",
      ".xml",
      ".csproj",
      ".sln",
      ".rs",
      ".rb",
      ".kt",
      ".kts",
      ".swift",
      ".tex",
      ".pdf",
      ".docx",
      ".doc",
      ".xls",
      ".xlsx",
    ],
    excludeDirs: [
      "node_modules",
      ".git",
      ".opencode",
      "dist",
      "build",
      "__pycache__",
      ".venv",
    ],
    chunkOverlap: 0,
    minFileSizeBytes: 0,
  },
  vectorStore: {
    path: "./.opencode/rag_db",
  },
  retrieval: {
    topK: 10,
    minScore: 0.5,
    hybridSearch: {
      enabled: true,
      keywordWeight: 0.4,
    },
  },
  openCode: {
    enabled: true,
    maxContextChunks: 10,
    readOverride: true,
    autoIndex: {
      enabled: true,
      debounceMs: 2000,
      intervalMs: 300000,
    },
    autoInject: {
      enabled: true,
      minScore: 0.75,
      maxChunks: 3,
      maxTokens: 2000,
    },
  },
  description: {
    enabled: true,
    provider: "ollama",
    baseUrl: "http://127.0.0.1:11434/api",
    model: "qwen2.5:3b",
    timeoutMs: 60000,
    systemPrompt:
      "You are a code analysis assistant. Describe code for embedding search in caveman style: short simple words, rough grammar. Include what code do, main names, data in, data out, side effects, errors, and search words. No markdown, no code, no line-by-line talk. If user message contains multiple chunks labeled === CHUNK N ===, describe each one separately, starting each with CHUNK N: followed by the description. For a single chunk, give the description directly.",
    batchMaxChunks: 25,
    batchTimeoutMs: 120000,
    retryMax: 3,
    retryBaseDelayMs: 1000,
  },
  logging: {
    level: "info",
    logFilePath: "./.opencode/opencode-rag.log",
  },
};

export function resolveLogConfig(config: RagConfig): LoggingConfig {
  return {
    level: config.logging?.level ?? DEFAULT_CONFIG.logging.level,
    logFilePath: config.logging?.logFilePath ?? env.LOG_FILE_PATH ?? DEFAULT_CONFIG.logging.logFilePath,
  };
}

export interface RagContext {
  config: RagConfig;
  embedder: EmbeddingProvider;
  chunker: Chunker;
  vectorStore: VectorStore;
}

export function loadConfig(filePath: string): RagConfig {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as Partial<RagConfig>;

  return {
    embedding: {
      ...DEFAULT_CONFIG.embedding,
      ...parsed.embedding,
    },
    indexing: {
      ...DEFAULT_CONFIG.indexing,
      ...parsed.indexing,
    },
    vectorStore: {
      ...DEFAULT_CONFIG.vectorStore,
      ...parsed.vectorStore,
    },
    retrieval: {
      ...DEFAULT_CONFIG.retrieval,
      ...parsed.retrieval,
      hybridSearch: {
        ...DEFAULT_CONFIG.retrieval.hybridSearch,
        ...((parsed.retrieval as Record<string, unknown> | undefined)?.hybridSearch as Partial<typeof DEFAULT_CONFIG.retrieval.hybridSearch> | undefined ?? {}),
      } as { enabled: boolean; keywordWeight: number },
    },
    openCode: (() => {
      const base = DEFAULT_CONFIG.openCode;
      const user: Partial<typeof base> = (parsed as { openCode?: Partial<typeof base> }).openCode ?? {};
      const merged: typeof base = {
        ...base,
        ...user,
        autoIndex: {
          ...base.autoIndex,
          ...(user.autoIndex ?? {}),
        } as AutoIndexConfig,
        autoInject: {
          ...base.autoInject,
          ...(user.autoInject ?? {}),
        } as AutoInjectConfig,
      };
      return merged;
    })(),
    chunkers: parsed.chunkers ?? DEFAULT_CONFIG.chunkers,
    description: {
      ...DEFAULT_CONFIG.description,
      ...((parsed as { description?: Partial<DescriptionConfig> }).description ?? {}),
    } as DescriptionConfig,
    logging: {
      ...DEFAULT_CONFIG.logging,
      ...(parsed.logging ?? {}),
    } as LoggingConfig,
  };
}
