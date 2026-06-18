import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sqlChunker } from "../../chunker/sql.js";

describe("SqlChunker", () => {
  it("language is 'sql'", () => {
    assert.equal(sqlChunker.language, "sql");
  });

  it("fileExtensions includes .sql", () => {
    assert.ok(sqlChunker.fileExtensions.includes(".sql"));
    assert.equal(sqlChunker.fileExtensions.length, 1);
  });

  it("grammarName is 'sql'", () => {
    assert.equal(sqlChunker.grammarName, "sql");
  });

  it("nodeTypes contains statement", () => {
    assert.ok(sqlChunker.nodeTypes.has("statement"));
  });

  it("chunk returns empty array for empty content", async () => {
    const chunks = await sqlChunker.chunk("test.sql", "");
    assert.deepStrictEqual(chunks, []);
  });

  it("chunk extracts statements", async () => {
    const code = `CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE INDEX idx_name ON users(name);

SELECT * FROM users;
`;
    const chunks = await sqlChunker.chunk("test.sql", code);
    assert.equal(chunks.length, 3);
    assert.ok(chunks[0]!.content.includes("CREATE TABLE"));
    assert.ok(chunks[1]!.content.includes("CREATE INDEX"));
    assert.ok(chunks[2]!.content.includes("SELECT"));
  });
});
