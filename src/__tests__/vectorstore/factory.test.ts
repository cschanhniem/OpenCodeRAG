import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createVectorStore } from "../../vectorstore/factory.js";
import { LanceDbStore } from "../../vectorstore/lancedb.js";
import { InMemoryVectorStore } from "../../vectorstore/memory.js";
import { DEFAULT_CONFIG, type RagConfig } from "../../core/config.js";

function makeConfig(overrides?: Partial<RagConfig["vectorStore"]>): RagConfig {
  return {
    ...DEFAULT_CONFIG,
    vectorStore: {
      ...DEFAULT_CONFIG.vectorStore,
      ...overrides,
    },
  };
}

describe("createVectorStore", () => {
  it("returns LanceDbStore when provider is 'lancedb'", () => {
    const store = createVectorStore(makeConfig({ provider: "lancedb" }), "memory://", 384);
    assert.ok(store instanceof LanceDbStore);
  });

  it("returns LanceDbStore when provider is omitted (defaults to lancedb)", () => {
    const store = createVectorStore(makeConfig({}), "memory://", 384);
    assert.ok(store instanceof LanceDbStore);
  });

  it("returns InMemoryVectorStore when provider is 'memory'", () => {
    const store = createVectorStore(makeConfig({ provider: "memory" }), "unused", 384);
    assert.ok(store instanceof InMemoryVectorStore);
  });

  it("throws on unknown provider", () => {
    assert.throws(
      () => createVectorStore(makeConfig({ provider: "qdrant" as any }), "unused", 384),
      /Unknown vector store provider: qdrant/
    );
  });

  it("InMemoryVectorStore supports basic operations", async () => {
    const store = createVectorStore(makeConfig({ provider: "memory" }), "unused", 4);

    assert.equal(await store.count(), 0);

    await store.addChunks([
      {
        id: "1",
        content: "hello",
        embedding: [1, 0, 0, 0],
        metadata: { filePath: "a.ts", startLine: 1, endLine: 1, language: "ts" },
      },
      {
        id: "2",
        content: "world",
        embedding: [0, 1, 0, 0],
        metadata: { filePath: "b.ts", startLine: 1, endLine: 1, language: "ts" },
      },
    ]);

    assert.equal(await store.count(), 2);

    const results = await store.search([1, 0, 0, 0], 1);
    assert.equal(results.length, 1);
    const first = results[0]!;
    assert.equal(first.chunk.id, "1");
    assert.ok(first.score > 0.9);

    await store.deleteByFilePath("a.ts");
    assert.equal(await store.count(), 1);

    await store.clear();
    assert.equal(await store.count(), 0);
  });
});
