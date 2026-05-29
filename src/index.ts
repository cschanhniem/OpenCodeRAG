export { chunkFile, getChunker, registerChunker } from "./chunker/factory.js";
export { createEmbedder, embedBatch } from "./embedder/factory.js";
export { LanceDBStore } from "./vectorstore/lancedb.js";
export { retrieve } from "./retriever/retriever.js";
export { loadConfig, DEFAULT_CONFIG } from "./core/config.js";
export { createBackgroundIndexer } from "./watcher.js";
export { createWatchIgnore } from "./indexer.js";
export type { RagConfig } from "./core/config.js";
export type { Chunk, SearchResult, Chunker, EmbeddingProvider, VectorStore } from "./core/interfaces.js";

// Plugin is only importable inside OpenCode's runtime
export { ragPlugin as server } from "./plugin.js";
