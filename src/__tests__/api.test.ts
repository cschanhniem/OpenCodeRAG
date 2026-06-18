import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("Programmatic API", () => {
  it("exports search as a function", async () => {
    const { search } = await import("../api.js");
    assert.equal(typeof search, "function");
  });

  it("exports indexWorkspace as a function", async () => {
    const { indexWorkspace } = await import("../api.js");
    assert.equal(typeof indexWorkspace, "function");
  });

  it("exports getContext as a function", async () => {
    const { getContext } = await import("../api.js");
    assert.equal(typeof getContext, "function");
  });

  it("exports validateConfig as a function", async () => {
    const { validateConfig } = await import("../api.js");
    assert.equal(typeof validateConfig, "function");
  });

  it("exports scanWorkspace as a function", async () => {
    const { scanWorkspace } = await import("../api.js");
    assert.equal(typeof scanWorkspace, "function");
  });

  it("exports getIndexStatusSummary as a function", async () => {
    const { getIndexStatusSummary } = await import("../api.js");
    assert.equal(typeof getIndexStatusSummary, "function");
  });

  it("getContext formats empty results correctly", async () => {
    const { getContext } = await import("../api.js");
    const result = await getContext("test query", { cwd: process.cwd() });
    assert.ok(Array.isArray(result.chunks));
    assert.equal(typeof result.text, "string");
    if (result.chunks.length === 0) {
      assert.equal(result.text, "No matching chunks found.");
    }
  });
});

describe("Library re-exports", () => {
  it("re-exports API functions from index.ts", async () => {
    const mod = await import("../index.js");
    assert.equal(typeof mod.search, "function");
    assert.equal(typeof mod.indexWorkspace, "function");
    assert.equal(typeof mod.getContext, "function");
    assert.equal(typeof mod.validateConfig, "function");
  });

  it("re-exports existing functions from index.ts", async () => {
    const mod = await import("../index.js");
    assert.equal(typeof mod.retrieve, "function");
    assert.equal(typeof mod.loadConfig, "function");
    assert.equal(typeof mod.LanceDBStore, "function");
  });
});
