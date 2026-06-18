import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { iniChunker } from "../../chunker/ini.js";

describe("IniChunker", () => {
  it("language is 'ini'", () => {
    assert.equal(iniChunker.language, "ini");
  });

  it("fileExtensions includes .ini and .cfg", () => {
    assert.ok(iniChunker.fileExtensions.includes(".ini"));
    assert.ok(iniChunker.fileExtensions.includes(".cfg"));
    assert.equal(iniChunker.fileExtensions.length, 2);
  });

  it("grammarName is 'ini'", () => {
    assert.equal(iniChunker.grammarName, "ini");
  });

  it("nodeTypes contains section", () => {
    assert.ok(iniChunker.nodeTypes.has("section"));
  });

  it("chunk returns empty array for empty content", async () => {
    const chunks = await iniChunker.chunk("test.ini", "");
    assert.deepStrictEqual(chunks, []);
  });

  it("chunk extracts sections", async () => {
    const code = `[database]
host = localhost
port = 5432

[logging]
level = debug
file = app.log
`;
    const chunks = await iniChunker.chunk("test.ini", code);
    assert.equal(chunks.length, 2);
    assert.ok(chunks[0]!.content.includes("[database]"));
    assert.ok(chunks[1]!.content.includes("[logging]"));
  });

  it("chunk generates unique IDs", async () => {
    const code = "[a]\nx=1\n\n[b]\ny=2\n\n[c]\nz=3\n";
    const chunks = await iniChunker.chunk("test.ini", code);
    const ids = chunks.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
