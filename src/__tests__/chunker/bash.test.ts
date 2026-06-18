import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bashChunker } from "../../chunker/bash.js";

describe("BashChunker", () => {
  it("language is 'bash'", () => {
    assert.equal(bashChunker.language, "bash");
  });

  it("fileExtensions includes .sh, .bash, .zsh", () => {
    assert.ok(bashChunker.fileExtensions.includes(".sh"));
    assert.ok(bashChunker.fileExtensions.includes(".bash"));
    assert.ok(bashChunker.fileExtensions.includes(".zsh"));
    assert.equal(bashChunker.fileExtensions.length, 3);
  });

  it("grammarName is 'bash'", () => {
    assert.equal(bashChunker.grammarName, "bash");
  });

  it("nodeTypes contains function_definition", () => {
    assert.ok(bashChunker.nodeTypes.has("function_definition"));
  });

  it("chunk returns empty array for empty content", async () => {
    const chunks = await bashChunker.chunk("test.sh", "");
    assert.deepStrictEqual(chunks, []);
  });

  it("chunk extracts function definitions", async () => {
    const code = `#!/bin/bash

hello() {
  echo "Hello, world!"
}

function greet {
  echo "Hi there!"
}
`;
    const chunks = await bashChunker.chunk("test.sh", code);
    assert.equal(chunks.length, 2);
    assert.ok(chunks[0]!.content.includes("hello()"));
    assert.ok(chunks[1]!.content.includes("greet"));
  });

  it("chunk generates unique IDs", async () => {
    const code = `a() { echo 1; }\nb() { echo 2; }\nc() { echo 3; }`;
    const chunks = await bashChunker.chunk("test.sh", code);
    const ids = chunks.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});
