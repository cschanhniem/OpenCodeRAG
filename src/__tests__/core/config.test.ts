import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, DEFAULT_CONFIG, resolveLogConfig } from "../../core/config.js";
import { getRegisteredExtensions } from "../../chunker/factory.js";

describe("loadConfig", () => {
  let tmpFile: string;

  before(() => {
    tmpFile = join(tmpdir(), `opencode-rag-test-${Date.now()}.json`);
  });

  after(() => {
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  });

  it("returns default config for empty file", () => {
    writeFileSync(tmpFile, "{}", "utf-8");
    const config = loadConfig(tmpFile);
    assert.deepStrictEqual(config, { ...DEFAULT_CONFIG, chunkers: undefined });
  });

  it("allows partial override of embedding proxy setting", () => {
    writeFileSync(
      tmpFile,
      JSON.stringify({ embedding: { proxy: { url: "http://proxy:8080" } } }),
      "utf-8"
    );
    const config = loadConfig(tmpFile);
    assert.equal(config.embedding.proxy?.url, "http://proxy:8080");
  });

  it("allows partial override of embedding settings", () => {
    writeFileSync(
      tmpFile,
      JSON.stringify({ embedding: { provider: "openai", model: "custom-model" } }),
      "utf-8"
    );
    const config = loadConfig(tmpFile);
    assert.equal(config.embedding.provider, "openai");
    assert.equal(config.embedding.model, "custom-model");
    assert.equal(config.embedding.baseUrl, DEFAULT_CONFIG.embedding.baseUrl);
  });

  it("allows partial override of indexing settings", () => {
    writeFileSync(
      tmpFile,
      JSON.stringify({ indexing: { chunkOverlap: 5 } }),
      "utf-8"
    );
    const config = loadConfig(tmpFile);
    assert.equal(config.indexing.chunkOverlap, 5);
    assert.deepStrictEqual(
      config.indexing.includeExtensions,
      DEFAULT_CONFIG.indexing.includeExtensions
    );
  });

  it("allows partial override of retrieval settings", () => {
    writeFileSync(
      tmpFile,
      JSON.stringify({ retrieval: { topK: 20 } }),
      "utf-8"
    );
    const config = loadConfig(tmpFile);
    assert.equal(config.retrieval.topK, 20);
  });

  it("allows partial override of openCode settings", () => {
    writeFileSync(
      tmpFile,
      JSON.stringify({ openCode: { maxContextChunks: 10 } }),
      "utf-8"
    );
    const config = loadConfig(tmpFile);
    assert.equal(config.openCode.maxContextChunks, 10);
    assert.equal(config.openCode.enabled, DEFAULT_CONFIG.openCode.enabled);
  });

  it("allows partial override of vectorStore path", () => {
    writeFileSync(
      tmpFile,
      JSON.stringify({ vectorStore: { path: "/custom/path" } }),
      "utf-8"
    );
    const config = loadConfig(tmpFile);
    assert.equal(config.vectorStore.path, "/custom/path");
  });

  it("allows partial override of logging settings", () => {
    writeFileSync(
      tmpFile,
      JSON.stringify({ logging: { level: "debug" } }),
      "utf-8"
    );
    const config = loadConfig(tmpFile);
    assert.equal(config.logging.level, "debug");
    assert.equal(config.logging.logFilePath, DEFAULT_CONFIG.logging.logFilePath);
  });
});

describe("DEFAULT_CONFIG", () => {
  it("has ollama as default embedding provider", () => {
    assert.equal(DEFAULT_CONFIG.embedding.provider, "ollama");
  });

  it("includes TypeScript extensions", () => {
    assert.ok(DEFAULT_CONFIG.indexing.includeExtensions.includes(".ts"));
    assert.ok(DEFAULT_CONFIG.indexing.includeExtensions.includes(".tsx"));
  });

  it("includes every registered chunker extension", () => {
    const configured = new Set(DEFAULT_CONFIG.indexing.includeExtensions);
    for (const extension of getRegisteredExtensions()) {
      assert.ok(
        configured.has(extension),
        `expected default config to include ${extension}`
      );
    }
  });

  it("excludes node_modules, .git, and .opencode", () => {
    assert.ok(DEFAULT_CONFIG.indexing.excludeDirs.includes("node_modules"));
    assert.ok(DEFAULT_CONFIG.indexing.excludeDirs.includes(".git"));
    assert.ok(DEFAULT_CONFIG.indexing.excludeDirs.includes(".opencode"));
  });

  it("has openCode enabled by default", () => {
    assert.equal(DEFAULT_CONFIG.openCode.enabled, true);
  });

  it("has topK of 10", () => {
    assert.equal(DEFAULT_CONFIG.retrieval.topK, 10);
  });

  it("has minScore of 0", () => {
    assert.equal(DEFAULT_CONFIG.retrieval.minScore, 0);
  });

  it("has info as default logging level", () => {
    assert.equal(DEFAULT_CONFIG.logging.level, "info");
  });

  it("has default logFilePath", () => {
    assert.equal(DEFAULT_CONFIG.logging.logFilePath, "./.opencode/opencode-rag.log");
  });
});

describe("resolveLogConfig", () => {
  it("returns default values when config has no logging", () => {
    const { level, logFilePath } = resolveLogConfig({ ...DEFAULT_CONFIG, logging: DEFAULT_CONFIG.logging });
    assert.equal(level, "info");
    assert.equal(logFilePath, "./.opencode/opencode-rag.log");
  });

  it("uses config values when provided", () => {
    const config = { ...DEFAULT_CONFIG, logging: { level: "error" as const, logFilePath: "/custom/path.log" } };
    const { level, logFilePath } = resolveLogConfig(config);
    assert.equal(level, "error");
    assert.equal(logFilePath, "/custom/path.log");
  });

  it("config level overrides default", () => {
    const config = { ...DEFAULT_CONFIG, logging: { level: "debug" as const, logFilePath: DEFAULT_CONFIG.logging.logFilePath } };
    const result = resolveLogConfig(config);
    assert.equal(result.level, "debug");
  });

  it("config logFilePath overrides env var", () => {
    const config = { ...DEFAULT_CONFIG, logging: { level: "info" as const, logFilePath: "/config/path.log" } };
    const { logFilePath } = resolveLogConfig(config);
    assert.equal(logFilePath, "/config/path.log");
  });
});
