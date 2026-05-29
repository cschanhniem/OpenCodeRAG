import { readFileSync } from "node:fs";
import path from "node:path";
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

export interface RagConfig {
  embedding: {
    provider: "ollama" | "openai";
    baseUrl: string;
    apiKey?: string;
    model: string;
    timeoutMs?: number;
    proxy?: ProxyConfig;
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
  };
  openCode: {
    enabled: boolean;
    maxContextChunks: number;
    autoIndex?: AutoIndexConfig;
  };
  chunkers?: ChunkerConfig[];
}

export const DEFAULT_CONFIG: RagConfig = {
  embedding: {
    provider: "ollama",
    baseUrl: "http://localhost:11434/api",
    model: "embeddinggemma",
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
    minFileSizeBytes: 1024,
  },
  vectorStore: {
    path: "./.opencode/rag_db",
  },
  retrieval: {
    topK: 10,
  },
  openCode: {
    enabled: true,
    maxContextChunks: 5,
    autoIndex: {
      enabled: true,
      debounceMs: 5000,
      intervalMs: 300000,
    },
  },
};

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
      };
      return merged;
    })(),
    chunkers: parsed.chunkers ?? DEFAULT_CONFIG.chunkers,
  };
}
