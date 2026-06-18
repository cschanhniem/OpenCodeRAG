import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { yamlChunker } from "../../chunker/yaml.js";

describe("YamlChunker", () => {
  it("language is 'yaml'", () => {
    assert.equal(yamlChunker.language, "yaml");
  });

  it("fileExtensions includes .yaml and .yml", () => {
    assert.ok(yamlChunker.fileExtensions.includes(".yaml"));
    assert.ok(yamlChunker.fileExtensions.includes(".yml"));
    assert.equal(yamlChunker.fileExtensions.length, 2);
  });

  it("grammarName is 'yaml'", () => {
    assert.equal(yamlChunker.grammarName, "yaml");
  });

  it("nodeTypes contains block_mapping_pair and block_sequence_item", () => {
    assert.ok(yamlChunker.nodeTypes.has("block_mapping_pair"));
    assert.ok(yamlChunker.nodeTypes.has("block_sequence_item"));
  });

  it("chunk returns empty array for empty content", async () => {
    const chunks = await yamlChunker.chunk("test.yaml", "");
    assert.deepStrictEqual(chunks, []);
  });

  it("chunk extracts top-level mapping pairs", async () => {
    const code = `name: test
version: "1.0"
debug: true
`;
    const chunks = await yamlChunker.chunk("test.yaml", code);
    assert.equal(chunks.length, 3);
    assert.ok(chunks[0]!.content.includes("name:"));
    assert.ok(chunks[1]!.content.includes("version:"));
    assert.ok(chunks[2]!.content.includes("debug:"));
  });

  it("chunk extracts block sequence items", async () => {
    const code = `services:
  - name: web
    port: 80
  - name: db
    port: 5432
`;
    const chunks = await yamlChunker.chunk("test.yaml", code);
    assert.equal(chunks.length, 1);
    assert.ok(chunks[0]!.content.includes("services:"));
  });

  it("chunk generates unique IDs", async () => {
    const code = "a: 1\nb: 2\nc: 3\n";
    const chunks = await yamlChunker.chunk("test.yaml", code);
    const ids = chunks.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
