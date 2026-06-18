// Low-level building blocks
export { chunkFile, getChunker, registerChunker } from "./chunker/factory.js";
export { createEmbedder, embedBatch } from "./embedder/factory.js";
export { createDescriptionProvider } from "./describer/factory.js";
export { LanceDBStore } from "./vectorstore/lancedb.js";
export { retrieve } from "./retriever/retriever.js";
export { loadConfig, DEFAULT_CONFIG } from "./core/config.js";
export { createBackgroundIndexer } from "./watcher.js";
export { createWatchIgnore } from "./indexer.js";
export type { RagConfig, DescriptionConfig } from "./core/config.js";
export type { Chunk, SearchResult, Chunker, DescriptionProvider, EmbeddingProvider, VectorStore } from "./core/interfaces.js";

// High-level convenience API
export { search, indexWorkspace, getContext, validateConfig, scanWorkspace, getIndexStatusSummary } from "./api.js";
export type { SearchOptions, IndexOptions, ContextResult, ConfigValidationResult, WorkspaceFile, IndexRunStats } from "./api.js";

// Plugin is only importable inside OpenCode's runtime
import { ragPlugin } from "./plugin.js";
export const server = ragPlugin;
export const id = "opencode-rag-plugin";
export default { id, server: ragPlugin };
