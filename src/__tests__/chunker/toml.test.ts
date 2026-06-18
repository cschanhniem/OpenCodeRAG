import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tomlChunker } from "../../chunker/toml.js";

describe("TomlChunker", () => {
  it("language is 'toml'", () => {
    assert.equal(tomlChunker.language, "toml");
  });

  it("fileExtensions includes .toml", () => {
    assert.ok(tomlChunker.fileExtensions.includes(".toml"));
    assert.equal(tomlChunker.fileExtensions.length, 1);
  });

  it("grammarName is 'toml'", () => {
    assert.equal(tomlChunker.grammarName, "toml");
  });

  it("nodeTypes contains table, table_array_element, and pair", () => {
    assert.ok(tomlChunker.nodeTypes.has("table"));
    assert.ok(tomlChunker.nodeTypes.has("table_array_element"));
    assert.ok(tomlChunker.nodeTypes.has("pair"));
  });

  it("chunk returns empty array for empty content", async () => {
    const chunks = await tomlChunker.chunk("test.toml", "");
    assert.deepStrictEqual(chunks, []);
  });

  it("chunk extracts tables and top-level pairs", async () => {
    const code = `name = "test"
version = "1.0"

[build]
optimize = true

[dependencies]
ts = "^5.0"
`;
    const chunks = await tomlChunker.chunk("test.toml", code);
    assert.equal(chunks.length, 4);
    assert.ok(chunks[0]!.content.includes('name = "test"'));
    assert.ok(chunks[1]!.content.includes("version"));
    assert.ok(chunks[2]!.content.includes("[build]"));
    assert.ok(chunks[3]!.content.includes("[dependencies]"));
  });

  it("chunk generates unique IDs", async () => {
    const code = 'a = 1\nb = 2\n[foo]\nc = 3\n';
    const chunks = await tomlChunker.chunk("test.toml", code);
    const ids = chunks.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
