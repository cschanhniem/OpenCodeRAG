import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { DEFAULT_CONFIG, type RagConfig } from "../../core/config.js";
import { createWatchIgnore } from "../../indexer.js";

function testConfig(): RagConfig {
  return {
    ...DEFAULT_CONFIG,
    indexing: {
      ...DEFAULT_CONFIG.indexing,
      includeExtensions: [".ts"],
      excludeDirs: ["node_modules", ".git", ".opencode", "ignored-dir"],
      minFileSizeBytes: 0,
    },
  };
}

describe("createWatchIgnore", () => {
  // These paths don't need to exist — path.resolve and path.relative are
  // pure string operations that work with any absolute path.
  const workspaceDir = path.resolve("/test/workspace");
  const storeDir = path.resolve("/test/workspace/.opencode/vector-store");

  it("returns true for excluded paths and false for source files", () => {
    const config = testConfig();
    const ignore = createWatchIgnore(workspaceDir, config, storeDir);

    // Store dir itself and manifest.json should be ignored
    assert.equal(ignore(storeDir), true);
    assert.equal(ignore(path.join(storeDir, "chunks.lance")), true);
    assert.equal(ignore(path.join(storeDir, "manifest.json")), true);

    // Configured exclude dirs should be ignored
    assert.equal(ignore(path.join(workspaceDir, "node_modules", "some-dep")), true);
    assert.equal(ignore(path.join(workspaceDir, "ignored-dir", "file.ts")), true);

    // Regular source files should NOT be ignored
    assert.equal(ignore(path.join(workspaceDir, "src", "index.ts")), false);
    assert.equal(ignore(path.join(workspaceDir, "index.ts")), false);
  });
});
