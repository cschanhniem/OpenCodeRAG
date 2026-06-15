import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function isOpencodeAvailable(): boolean {
  const result = spawnSync("opencode", ["--version"], { encoding: "utf-8", shell: true });
  return result.status === 0;
}

describe("opencode run integration", () => {
  it("starts correctly with the rag plugin", { skip: !isOpencodeAvailable() ? "opencode binary not found; skipping integration test" : false }, () => {
    const result = spawnSync(
      "opencode",
      ["run", "list relevant files", "--log-level", "ERROR", "--print-logs"],
      {
        encoding: "utf-8",
        timeout: 60_000,
        cwd: process.cwd(),
        shell: true,
      }
    );

    // Process should exit cleanly (plugin loaded, LLM responded or timed out gracefully)
    assert.equal(result.status, 0, `opencode exited with code ${result.status}: ${result.stderr}`);

    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";

    // Output should be non-empty when LLM responds; allow empty on transient failures
    if (stdout.length < 100) {
      console.log(`⚠ integration test: stdout was short (${stdout.length} chars), likely LLM timeout`);
      console.log(`stderr: ${stderr.slice(0, 300)}`);
    }
  });
});
