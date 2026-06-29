/**
 * @fileoverview Factory function to create the configured VectorStore instance (LanceDB or in-memory).
 */
import type { VectorStore } from "../core/interfaces.js";
import type { RagConfig } from "../core/config.js";
import { LanceDbStore } from "./lancedb.js";
import { InMemoryVectorStore } from "./memory.js";

/**
 * Create a VectorStore instance based on the configured provider.
 *
 * Supported providers:
 * - `"lancedb"`: Persistent LanceDB-backed store (default).
 * - `"memory"`: Ephemeral in-memory store.
 *
 * @param config - The RAG configuration containing the vector store provider setting.
 * @param storePath - The filesystem path for persistent stores (LanceDB).
 * @param dimension - The embedding vector dimension.
 * @returns A VectorStore instance matching the configured provider.
 * @throws If the provider name is unknown.
 */
export function createVectorStore(
  config: RagConfig,
  storePath: string,
  dimension: number,
): VectorStore {
  const provider = config.vectorStore.provider ?? "lancedb";

  if (provider === "lancedb") {
    return new LanceDbStore(storePath, dimension);
  }

  if (provider === "memory") {
    return new InMemoryVectorStore();
  }

  throw new Error(`Unknown vector store provider: ${provider}`);
}
