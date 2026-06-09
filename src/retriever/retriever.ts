import type { EmbeddingProvider, VectorStore, SearchResult } from "../core/interfaces.js";

export interface RetrieveOptions {
  topK?: number;
  minScore?: number;
}

export async function retrieve(
  query: string,
  embedder: EmbeddingProvider,
  store: VectorStore,
  options: RetrieveOptions = {}
): Promise<SearchResult[]> {
  const topK = options.topK ?? 10;
  const minScore = options.minScore ?? 0;

  const embeddings = await embedder.embed([query]);
  const embedding = embeddings[0];
  if (!embedding || embedding.length === 0) {
    return [];
  }

  // Guard against malformed provider output before searching.
  if (typeof embedding[0] !== "number") {
    return [];
  }

  const results = await store.search(embedding as number[], topK);
  return results.filter((r) => r.score >= minScore);
}
