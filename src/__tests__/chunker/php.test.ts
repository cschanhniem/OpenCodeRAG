import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { phpChunker } from "../../chunker/php.js";

describe("PhpChunker", () => {
  it("language is 'php'", () => {
    assert.equal(phpChunker.language, "php");
  });

  it("fileExtensions includes .php", () => {
    assert.ok(phpChunker.fileExtensions.includes(".php"));
    assert.equal(phpChunker.fileExtensions.length, 1);
  });

  it("grammarName is 'php'", () => {
    assert.equal(phpChunker.grammarName, "php");
  });

  it("nodeTypes contains function_definition and method_declaration", () => {
    assert.ok(phpChunker.nodeTypes.has("function_definition"));
    assert.ok(phpChunker.nodeTypes.has("method_declaration"));
  });

  it("chunk returns empty array for empty content", async () => {
    const chunks = await phpChunker.chunk("test.php", "");
    assert.deepStrictEqual(chunks, []);
  });

  it("chunk extracts function definitions", async () => {
    const code = `<?php

function hello() {
  echo "Hello!";
}

function greet(string $name): void {
  echo "Hi, $name!";
}
`;
    const chunks = await phpChunker.chunk("test.php", code);
    assert.equal(chunks.length, 2);
    assert.ok(chunks[0]!.content.includes("function hello"));
    assert.ok(chunks[1]!.content.includes("function greet"));
  });
});
