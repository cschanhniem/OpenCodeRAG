import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalCwd = process.cwd;

describe("opencode-rag init", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = join(tmpdir(), `opencode-rag-init-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    process.cwd = originalCwd;
  });

  it("creates opencode-rag.json and .opencode/.gitignore and .opencode/ dir", async () => {
    process.cwd = () => tmpDir;

    // Dynamic import so commander registers the 'init' command
    const { runCli } = await import("../cli.js");
    await runCli(["node", "cli.ts", "init"]);

    const configPath = join(tmpDir, "opencode-rag.json");
    const opencodeDir = join(tmpDir, ".opencode");
    const gitignorePath = join(opencodeDir, ".gitignore");

    assert.ok(existsSync(opencodeDir), ".opencode/ should exist");
    assert.ok(existsSync(gitignorePath), ".opencode/.gitignore should exist");
    assert.ok(existsSync(configPath), "opencode-rag.json should exist");

    // Check opencode-rag.json is valid JSON
    const configContent = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(configContent);
    assert.equal(parsed.embedding.provider, "ollama");
    assert.equal(parsed.embedding.baseUrl, "http://localhost:11434/api");
    assert.equal(parsed.vectorStore.path, "./.opencode/rag_db");

    // Check .gitignore content
    const gitignoreContent = readFileSync(gitignorePath, "utf-8");
    assert.ok(gitignoreContent.includes("rag_db/"));
    assert.ok(gitignoreContent.includes("opencode-rag.log"));
  });

  it("does not overwrite existing files without --force", async () => {
    process.cwd = () => tmpDir;

    // Replace opencode-rag.json with custom content
    const configPath = join(tmpDir, "opencode-rag.json");
    const customContent = JSON.stringify({ embedding: { provider: "openai" } });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(configPath, customContent, "utf-8");

    // Re-run init without force
    const { runCli } = await import("../cli.js");
    await runCli(["node", "cli.ts", "init"]);

    // Content should be unchanged (still our custom content)
    const afterContent = readFileSync(configPath, "utf-8");
    assert.equal(afterContent, customContent, "should not overwrite without --force");
  });

  it("overwrites files with --force", async () => {
    process.cwd = () => tmpDir;

    const configPath = join(tmpDir, "opencode-rag.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(configPath, "garbage", "utf-8");

    const { runCli } = await import("../cli.js");
    await runCli(["node", "cli.ts", "init", "--force"]);

    const afterContent = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(afterContent);
    assert.equal(parsed.embedding.provider, "ollama", "should contain defaults after force");
  });
});
