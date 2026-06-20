import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadRuntimeOverrides,
  saveRuntimeOverride,
  applyRuntimeOverrides,
} from "../../core/runtime-overrides.js";
import { DEFAULT_CONFIG } from "../../core/config.js";

describe("loadRuntimeOverrides", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = join(tmpdir(), `rag-override-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    try { unlinkSync(join(tmpDir, "runtime-overrides.json")); } catch { /* ignore */ }
    try { unlinkSync(join(tmpDir, "watcher-status.json")); } catch { /* ignore */ }
  });

  it("returns empty object when no override file exists", () => {
    const result = loadRuntimeOverrides(tmpDir);
    assert.deepStrictEqual(result, {});
  });

  it("returns parsed overrides from file", () => {
    writeFileSync(
      join(tmpDir, "runtime-overrides.json"),
      JSON.stringify({ retrieval: { topK: 25 } }),
      "utf-8"
    );
    const result = loadRuntimeOverrides(tmpDir);
    assert.deepStrictEqual(result, { retrieval: { topK: 25 } });
  });

  it("returns empty object for corrupt file", () => {
    writeFileSync(join(tmpDir, "runtime-overrides.json"), "not-json", "utf-8");
    const result = loadRuntimeOverrides(tmpDir);
    assert.deepStrictEqual(result, {});
  });
});

describe("saveRuntimeOverride", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = join(tmpdir(), `rag-save-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    try { unlinkSync(join(tmpDir, "runtime-overrides.json")); } catch { /* ignore */ }
  });

  it("writes a new runtime override file", () => {
    saveRuntimeOverride(tmpDir, ["retrieval", "topK"], 15);
    const content = readFileSync(join(tmpDir, "runtime-overrides.json"), "utf-8");
    assert.ok(content.includes('"topK"'));
    assert.ok(content.includes("15"));
  });

  it("merges with existing overrides", () => {
    writeFileSync(
      join(tmpDir, "runtime-overrides.json"),
      JSON.stringify({ retrieval: { topK: 10 } }),
      "utf-8"
    );
    saveRuntimeOverride(tmpDir, ["retrieval", "minScore"], 0.7);
    const result = loadRuntimeOverrides(tmpDir);
    assert.equal(result.retrieval?.topK, 10);
    assert.equal(result.retrieval?.minScore, 0.7);
  });

  it("overwrites existing key with new value", () => {
    writeFileSync(
      join(tmpDir, "runtime-overrides.json"),
      JSON.stringify({ retrieval: { topK: 10 } }),
      "utf-8"
    );
    saveRuntimeOverride(tmpDir, ["retrieval", "topK"], 20);
    const result = loadRuntimeOverrides(tmpDir);
    assert.equal(result.retrieval?.topK, 20);
  });

  it("handles deep nested paths", () => {
    saveRuntimeOverride(tmpDir, ["openCode", "autoIndex", "enabled"], false);
    saveRuntimeOverride(tmpDir, ["openCode", "autoInject", "minScore"], 0.8);
    const result = loadRuntimeOverrides(tmpDir);
    assert.equal(result.openCode?.autoIndex?.enabled, false);
    assert.equal(result.openCode?.autoInject?.minScore, 0.8);
  });

  it("handles boolean values", () => {
    saveRuntimeOverride(tmpDir, ["description", "enabled"], false);
    const result = loadRuntimeOverrides(tmpDir);
    assert.equal(result.description?.enabled, false);
  });

  it("handles string values", () => {
    saveRuntimeOverride(tmpDir, ["embedding", "model"], "nomic-embed-text");
    const result = loadRuntimeOverrides(tmpDir);
    assert.equal(result.embedding?.model, "nomic-embed-text");
  });

  it("handles string enum values", () => {
    saveRuntimeOverride(tmpDir, ["embedding", "provider"], "openai");
    const result = loadRuntimeOverrides(tmpDir);
    assert.equal(result.embedding?.provider, "openai");
  });

  it("overwrites string value with another string", () => {
    saveRuntimeOverride(tmpDir, ["embedding", "baseUrl"], "http://localhost:11434/api");
    saveRuntimeOverride(tmpDir, ["embedding", "baseUrl"], "http://custom:8080/api");
    const result = loadRuntimeOverrides(tmpDir);
    assert.equal(result.embedding?.baseUrl, "http://custom:8080/api");
  });

  it("mixes string and boolean overrides", () => {
    saveRuntimeOverride(tmpDir, ["embedding", "provider"], "openai");
    saveRuntimeOverride(tmpDir, ["embedding", "model"], "text-embedding-3-small");
    saveRuntimeOverride(tmpDir, ["description", "enabled"], false);
    const result = loadRuntimeOverrides(tmpDir);
    assert.equal(result.embedding?.provider, "openai");
    assert.equal(result.embedding?.model, "text-embedding-3-small");
    assert.equal(result.description?.enabled, false);
  });
});

describe("applyRuntimeOverrides", () => {
  it("returns cfg unchanged when overrides is empty", () => {
    const result = applyRuntimeOverrides(DEFAULT_CONFIG, {});
    assert.deepStrictEqual(result, DEFAULT_CONFIG);
  });

  it("returns cfg unchanged when overrides has no matching keys", () => {
    const result = applyRuntimeOverrides(DEFAULT_CONFIG, { retrieval: {} });
    assert.equal(result.retrieval.topK, DEFAULT_CONFIG.retrieval.topK);
    assert.equal(result.retrieval.minScore, DEFAULT_CONFIG.retrieval.minScore);
  });

  it("applies retrieval topK override", () => {
    const result = applyRuntimeOverrides(DEFAULT_CONFIG, {
      retrieval: { topK: 25 },
    });
    assert.equal(result.retrieval.topK, 25);
    assert.equal(result.retrieval.minScore, DEFAULT_CONFIG.retrieval.minScore);
  });

  it("applies retrieval minScore override", () => {
    const result = applyRuntimeOverrides(DEFAULT_CONFIG, {
      retrieval: { minScore: 0.8 },
    });
    assert.equal(result.retrieval.minScore, 0.8);
  });

  it("applies hybridSearch.enabled override", () => {
    const result = applyRuntimeOverrides(DEFAULT_CONFIG, {
      retrieval: { hybridSearch: { enabled: false } },
    });
    assert.equal(result.retrieval.hybridSearch?.enabled, false);
  });

  it("applies hybridSearch.keywordWeight override", () => {
    const result = applyRuntimeOverrides(DEFAULT_CONFIG, {
      retrieval: { hybridSearch: { keywordWeight: 0.6 } },
    });
    assert.equal(result.retrieval.hybridSearch?.keywordWeight, 0.6);
  });

  it("applies autoIndex.enabled override", () => {
    const result = applyRuntimeOverrides(DEFAULT_CONFIG, {
      openCode: { autoIndex: { enabled: false } },
    });
    assert.equal(result.openCode.autoIndex?.enabled, false);
  });

  it("applies autoIndex.debounceMs override", () => {
    const result = applyRuntimeOverrides(DEFAULT_CONFIG, {
      openCode: { autoIndex: { debounceMs: 5000 } },
    });
    assert.equal(result.openCode.autoIndex?.debounceMs, 5000);
  });

  it("applies autoInject.enabled override", () => {
    const result = applyRuntimeOverrides(DEFAULT_CONFIG, {
      openCode: { autoInject: { enabled: false } },
    });
    assert.equal(result.openCode.autoInject?.enabled, false);
  });

  it("applies autoInject.minScore override", () => {
    const result = applyRuntimeOverrides(DEFAULT_CONFIG, {
      openCode: { autoInject: { minScore: 0.9 } },
    });
    assert.equal(result.openCode.autoInject?.minScore, 0.9);
  });

  it("applies autoInject.maxChunks override", () => {
    const result = applyRuntimeOverrides(DEFAULT_CONFIG, {
      openCode: { autoInject: { maxChunks: 5 } },
    });
    assert.equal(result.openCode.autoInject?.maxChunks, 5);
  });

  it("applies autoInject.contentType override", () => {
    const result = applyRuntimeOverrides(DEFAULT_CONFIG, {
      openCode: { autoInject: { contentType: "chunks" } },
    });
    assert.equal(result.openCode.autoInject?.contentType, "chunks");
  });

  it("applies description.enabled override", () => {
    const result = applyRuntimeOverrides(DEFAULT_CONFIG, {
      description: { enabled: false },
    });
    assert.equal(result.description?.enabled, false);
  });

  it("applies multiple overrides simultaneously", () => {
    const result = applyRuntimeOverrides(DEFAULT_CONFIG, {
      retrieval: { topK: 15, minScore: 0.6 },
      openCode: { autoInject: { enabled: false } },
    });
    assert.equal(result.retrieval.topK, 15);
    assert.equal(result.retrieval.minScore, 0.6);
    assert.equal(result.openCode.autoInject?.enabled, false);
    assert.equal(result.openCode.autoInject?.maxChunks, 10);
  });

  it("does not mutate the original config", () => {
    const original = { ...DEFAULT_CONFIG, retrieval: { ...DEFAULT_CONFIG.retrieval } };
    const result = applyRuntimeOverrides(original, { retrieval: { topK: 99 } });
    assert.equal(result.retrieval.topK, 99);
    assert.equal(original.retrieval.topK, DEFAULT_CONFIG.retrieval.topK);
  });

  it("handles overrides when openCode.autoIndex is undefined in config", () => {
    const cfg = {
      ...DEFAULT_CONFIG,
      openCode: { ...DEFAULT_CONFIG.openCode, autoIndex: undefined },
    };
    const result = applyRuntimeOverrides(cfg, {
      openCode: { autoIndex: { debounceMs: 5000 } },
    });
    assert.equal(result.openCode.autoIndex?.debounceMs, 5000);
  });

  it("handles overrides when description is undefined in config", () => {
    const cfg = { ...DEFAULT_CONFIG, description: undefined as unknown as typeof DEFAULT_CONFIG.description };
    const result = applyRuntimeOverrides(cfg, {
      description: { enabled: false },
    });
    assert.equal(result.description?.enabled, false);
  });

  it("applies embedding.provider override", () => {
    const result = applyRuntimeOverrides(DEFAULT_CONFIG, {
      embedding: { provider: "openai" },
    });
    assert.equal(result.embedding.provider, "openai");
  });

  it("applies embedding.model override", () => {
    const result = applyRuntimeOverrides(DEFAULT_CONFIG, {
      embedding: { model: "text-embedding-3-small" },
    });
    assert.equal(result.embedding.model, "text-embedding-3-small");
  });

  it("applies embedding.baseUrl override", () => {
    const result = applyRuntimeOverrides(DEFAULT_CONFIG, {
      embedding: { baseUrl: "https://custom.api.com/v1" },
    });
    assert.equal(result.embedding.baseUrl, "https://custom.api.com/v1");
  });

  it("applies all embedding overrides simultaneously", () => {
    const result = applyRuntimeOverrides(DEFAULT_CONFIG, {
      embedding: { provider: "openai", model: "text-embedding-3-small", baseUrl: "https://api.openai.com/v1" },
    });
    assert.equal(result.embedding.provider, "openai");
    assert.equal(result.embedding.model, "text-embedding-3-small");
    assert.equal(result.embedding.baseUrl, "https://api.openai.com/v1");
  });

  it("applies description.provider override", () => {
    const result = applyRuntimeOverrides(DEFAULT_CONFIG, {
      description: { provider: "openai" },
    });
    assert.equal(result.description?.provider, "openai");
  });

  it("applies description.model override", () => {
    const result = applyRuntimeOverrides(DEFAULT_CONFIG, {
      description: { model: "gpt-4o-mini" },
    });
    assert.equal(result.description?.model, "gpt-4o-mini");
  });

  it("applies description.baseUrl override", () => {
    const result = applyRuntimeOverrides(DEFAULT_CONFIG, {
      description: { baseUrl: "https://custom.api.com/v1" },
    });
    assert.equal(result.description?.baseUrl, "https://custom.api.com/v1");
  });

  it("applies description.provider and model together with enabled", () => {
    const result = applyRuntimeOverrides(DEFAULT_CONFIG, {
      description: { provider: "openai", model: "gpt-4o-mini", enabled: true },
    });
    assert.equal(result.description?.provider, "openai");
    assert.equal(result.description?.model, "gpt-4o-mini");
    assert.equal(result.description?.enabled, true);
  });

});
