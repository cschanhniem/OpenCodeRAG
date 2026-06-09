import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { retrieve } from "../../retriever/retriever.js";
import type {
  EmbeddingProvider,
  VectorStore,
  SearchResult,
  Chunk,
} from "../../core/interfaces.js";

function makeEmbedder(vectors: number[][]): EmbeddingProvider {
  return {
    name: "mock",
    async embed(_texts: string[]): Promise<number[][]> {
      return vectors;
    },
  };
}

function makeStore(results: SearchResult[]): VectorStore {
  return {
    async addChunks(_chunks: Chunk[]): Promise<void> {},
    async search(_embedding: number[], _topK: number): Promise<SearchResult[]> {
      return results;
    },
    async count(): Promise<number> {
      return results.length;
    },
    async clear(): Promise<void> {},
    async deleteByFilePath(_filePath: string): Promise<void> {},
  };
}

describe("retrieve", () => {
  it("returns search results from store", async () => {
    const embedder = makeEmbedder([[0.1, 0.2, 0.3]]);
    const store = makeStore([
      {
        score: 0.95,
        chunk: {
          id: "chunk-1",
          content: "test content",
          metadata: {
            filePath: "test.ts",
            startLine: 1,
            endLine: 10,
            language: "typescript",
          },
        },
      },
    ]);

    const results = await retrieve("test query", embedder, store);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.score, 0.95);
    assert.equal(results[0]!.chunk.id, "chunk-1");
  });

  it("returns empty array when embedding is empty", async () => {
    const embedder = makeEmbedder([[]]);
    const store = makeStore([]);

    const results = await retrieve("test query", embedder, store);
    assert.deepStrictEqual(results, []);
  });

  it("returns empty array when embeddings are empty array", async () => {
    const embedder = makeEmbedder([]);
    const store = makeStore([]);

    const results = await retrieve("test query", embedder, store);
    assert.deepStrictEqual(results, []);
  });

  it("passes custom topK to store", async () => {
    let receivedTopK = 0;
    const embedder = makeEmbedder([[0.1, 0.2]]);
    const store: VectorStore = {
      async addChunks(): Promise<void> {},
      async search(_embedding: number[], topK: number): Promise<SearchResult[]> {
        receivedTopK = topK;
        return [];
      },
      async count(): Promise<number> {
        return 0;
      },
      async clear(): Promise<void> {},
      async deleteByFilePath(_filePath: string): Promise<void> {},
    };

    await retrieve("query", embedder, store, { topK: 5 });
    assert.equal(receivedTopK, 5);
  });

  it("uses default topK of 10", async () => {
    let receivedTopK = 0;
    const embedder = makeEmbedder([[0.1, 0.2]]);
    const store: VectorStore = {
      async addChunks(): Promise<void> {},
      async search(_embedding: number[], topK: number): Promise<SearchResult[]> {
        receivedTopK = topK;
        return [];
      },
      async count(): Promise<number> {
        return 0;
      },
      async clear(): Promise<void> {},
      async deleteByFilePath(_filePath: string): Promise<void> {},
    };

    await retrieve("query", embedder, store);
    assert.equal(receivedTopK, 10);
  });

  it("filters results below minScore", async () => {
    const embedder = makeEmbedder([[0.1, 0.2, 0.3]]);
    const store = makeStore([
      { score: 0.9, chunk: { id: "a", content: "high", metadata: { filePath: "a.ts", startLine: 1, endLine: 2, language: "ts" } } },
      { score: 0.4, chunk: { id: "b", content: "low", metadata: { filePath: "b.ts", startLine: 1, endLine: 2, language: "ts" } } },
      { score: 0.7, chunk: { id: "c", content: "mid", metadata: { filePath: "c.ts", startLine: 1, endLine: 2, language: "ts" } } },
    ]);

    const results = await retrieve("query", embedder, store, { minScore: 0.6 });
    assert.equal(results.length, 2);
    assert.equal(results[0]!.score, 0.9);
    assert.equal(results[1]!.score, 0.7);
  });

  it("returns all results when minScore is 0", async () => {
    const embedder = makeEmbedder([[0.1, 0.2, 0.3]]);
    const store = makeStore([
      { score: 0.9, chunk: { id: "a", content: "high", metadata: { filePath: "a.ts", startLine: 1, endLine: 2, language: "ts" } } },
      { score: 0.4, chunk: { id: "b", content: "low", metadata: { filePath: "b.ts", startLine: 1, endLine: 2, language: "ts" } } },
    ]);

    const results = await retrieve("query", embedder, store, { minScore: 0 });
    assert.equal(results.length, 2);
  });
});
