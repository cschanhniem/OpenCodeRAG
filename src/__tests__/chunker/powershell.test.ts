import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { powershellChunker } from "../../chunker/powershell.js";

describe("PowerShellChunker", () => {
  it("language is 'powershell'", () => {
    assert.equal(powershellChunker.language, "powershell");
  });

  it("fileExtensions includes .ps1, .psm1, .psd1", () => {
    assert.ok(powershellChunker.fileExtensions.includes(".ps1"));
    assert.ok(powershellChunker.fileExtensions.includes(".psm1"));
    assert.ok(powershellChunker.fileExtensions.includes(".psd1"));
    assert.equal(powershellChunker.fileExtensions.length, 3);
  });

  it("grammarName is 'powershell'", () => {
    assert.equal(powershellChunker.grammarName, "powershell");
  });

  it("nodeTypes contains function_statement", () => {
    assert.ok(powershellChunker.nodeTypes.has("function_statement"));
  });

  it("chunk returns empty array for empty content", async () => {
    const chunks = await powershellChunker.chunk("test.ps1", "");
    assert.deepStrictEqual(chunks, []);
  });

  it("chunk extracts function definitions", async () => {
    const code = `function Get-Hello {
  Write-Output "Hello!"
}

function Set-Greeting {
  param([string]$name)
  Write-Output "Hi, $name!"
}
`;
    const chunks = await powershellChunker.chunk("test.ps1", code);
    assert.equal(chunks.length, 2);
    assert.ok(chunks[0]!.content.includes("Get-Hello"));
    assert.ok(chunks[1]!.content.includes("Set-Greeting"));
  });
});
