import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import {
  getCurrentVersion,
  loadLastCheckResult,
  saveCheckResult,
  shouldCheck,
  checkForUpdate,
  checkForUpdateWithCaching,
  type UpdateCheckResult,
} from "../updater.js";

async function makeTempDir(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
}

describe("updater", () => {
  describe("getCurrentVersion", () => {
    it("returns a semver-like string", () => {
      const version = getCurrentVersion();
      assert.match(version, /^\d+\.\d+\.\d+/);
    });
  });

  describe("shouldCheck", () => {
    it("returns true when never checked", () => {
      assert.ok(shouldCheck(0));
    });

    it("returns true when interval has elapsed", () => {
      const lastChecked = Date.now() - 4_000_000; // 66 min ago
      assert.ok(shouldCheck(lastChecked, 3_600_000)); // 1 hour interval
    });

    it("returns false when interval has not elapsed", () => {
      const lastChecked = Date.now();
      assert.ok(!shouldCheck(lastChecked, 86_400_000));
    });

    it("enforces minimum interval of 1 hour", () => {
      const lastChecked = Date.now() - 3_000_000; // 50 min ago
      assert.ok(!shouldCheck(lastChecked, 1_800_000)); // 30 min requested, but min is 1h
    });

    it("returns true when minimum interval has elapsed", () => {
      const lastChecked = Date.now() - 4_000_000; // 66 min ago
      assert.ok(shouldCheck(lastChecked, 1_800_000)); // 30 min requested, but min is 1h
    });
  });

  describe("loadLastCheckResult", () => {
    it("returns null for missing directory", () => {
      const result = loadLastCheckResult("/nonexistent/path");
      assert.equal(result, null);
    });

    it("returns null for corrupt JSON", async () => {
      const dir = await makeTempDir("updater-corrupt");
      const filePath = path.join(dir, ".update-check.json");
      writeFileSync(filePath, "{not-json", "utf-8");

      const result = loadLastCheckResult(dir);
      assert.equal(result, null);
    });

    it("returns null for invalid structure", async () => {
      const dir = await makeTempDir("updater-invalid");
      const filePath = path.join(dir, ".update-check.json");
      writeFileSync(filePath, JSON.stringify({ foo: "bar" }), "utf-8");

      const result = loadLastCheckResult(dir);
      assert.equal(result, null);
    });

    it("loads valid check result", async () => {
      const dir = await makeTempDir("updater-valid");
      const expected: UpdateCheckResult = {
        info: {
          currentVersion: "1.0.0",
          latestVersion: "1.1.0",
          updateAvailable: true,
          releaseUrl: "https://github.com/test/releases/tag/v1.1.0",
          publishedAt: "2025-01-01T00:00:00Z",
        },
        checkedAt: 1234567890,
      };
      writeFileSync(path.join(dir, ".update-check.json"), JSON.stringify(expected), "utf-8");

      const result = loadLastCheckResult(dir);
      assert.deepEqual(result, expected);
    });
  });

  describe("saveCheckResult", () => {
    it("creates directory and file", async () => {
      const dir = await makeTempDir("updater-save");
      const nestedDir = path.join(dir, "sub", "dir");
      const result: UpdateCheckResult = {
        info: {
          currentVersion: "1.0.0",
          latestVersion: "1.0.0",
          updateAvailable: false,
          releaseUrl: "",
          publishedAt: "",
        },
        checkedAt: 9999,
      };

      saveCheckResult(nestedDir, result);

      const filePath = path.join(nestedDir, ".update-check.json");
      assert.ok(existsSync(filePath));
      const loaded = JSON.parse(readFileSync(filePath, "utf-8"));
      assert.equal(loaded.checkedAt, 9999);
    });

    it("overwrites existing file", async () => {
      const dir = await makeTempDir("updater-overwrite");
      const result1: UpdateCheckResult = {
        info: {
          currentVersion: "1.0.0",
          latestVersion: "1.0.0",
          updateAvailable: false,
          releaseUrl: "",
          publishedAt: "",
        },
        checkedAt: 1111,
      };
      const result2: UpdateCheckResult = {
        info: {
          currentVersion: "1.0.0",
          latestVersion: "2.0.0",
          updateAvailable: true,
          releaseUrl: "https://example.com",
          publishedAt: "2025-01-01",
        },
        checkedAt: 2222,
      };

      saveCheckResult(dir, result1);
      saveCheckResult(dir, result2);

      const loaded = loadLastCheckResult(dir);
      assert.equal(loaded?.checkedAt, 2222);
      assert.equal(loaded?.info.latestVersion, "2.0.0");
    });
  });

  describe("checkForUpdate", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("returns update available when latest is newer", async () => {
      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
          tag_name: "v2.0.0",
          html_url: "https://github.com/test/releases/tag/v2.0.0",
          published_at: "2025-06-01T00:00:00Z",
        }),
      }) as Response;

      const info = await checkForUpdate("1.0.0");
      assert.ok(info.updateAvailable);
      assert.equal(info.latestVersion, "2.0.0");
      assert.equal(info.currentVersion, "1.0.0");
      assert.equal(info.releaseUrl, "https://github.com/test/releases/tag/v2.0.0");
    });

    it("returns no update when versions match", async () => {
      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
          tag_name: "v1.0.0",
          html_url: "https://github.com/test/releases/tag/v1.0.0",
          published_at: "2025-01-01T00:00:00Z",
        }),
      }) as Response;

      const info = await checkForUpdate("1.0.0");
      assert.equal(info.updateAvailable, false);
    });

    it("returns no update when API fails", async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 404,
      }) as Response;

      const info = await checkForUpdate("1.0.0");
      assert.equal(info.updateAvailable, false);
    });

    it("returns no update on network error", async () => {
      globalThis.fetch = async () => {
        throw new Error("network error");
      };

      const info = await checkForUpdate("1.0.0");
      assert.equal(info.updateAvailable, false);
    });

    it("handles missing tag_name", async () => {
      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({}),
      }) as Response;

      const info = await checkForUpdate("1.0.0");
      assert.equal(info.updateAvailable, false);
    });

    it("strips v prefix from tag", async () => {
      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
          tag_name: "v3.2.1",
          html_url: "",
          published_at: "",
        }),
      }) as Response;

      const info = await checkForUpdate("1.0.0");
      assert.equal(info.latestVersion, "3.2.1");
    });
  });

  describe("checkForUpdateWithCaching", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("returns cached result when within interval", async () => {
      const dir = await makeTempDir("updater-cache-hit");
      const cached: UpdateCheckResult = {
        info: {
          currentVersion: "1.0.0",
          latestVersion: "1.5.0",
          updateAvailable: true,
          releaseUrl: "",
          publishedAt: "",
        },
        checkedAt: Date.now() - 1000, // 1 second ago
      };
      writeFileSync(path.join(dir, ".update-check.json"), JSON.stringify(cached), "utf-8");

      let fetchCalled = false;
      globalThis.fetch = async () => {
        fetchCalled = true;
        throw new Error("should not be called");
      };

      const info = await checkForUpdateWithCaching(dir, "1.0.0", 86_400_000);
      assert.equal(info.latestVersion, "1.5.0");
      assert.equal(info.updateAvailable, true);
      assert.equal(fetchCalled, false);
    });

    it("fetches fresh when interval has elapsed", async () => {
      const dir = await makeTempDir("updater-cache-miss");
      const cached: UpdateCheckResult = {
        info: {
          currentVersion: "1.0.0",
          latestVersion: "1.0.0",
          updateAvailable: false,
          releaseUrl: "",
          publishedAt: "",
        },
        checkedAt: Date.now() - 200_000_000, // long ago
      };
      writeFileSync(path.join(dir, ".update-check.json"), JSON.stringify(cached), "utf-8");

      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({
          tag_name: "v2.0.0",
          html_url: "",
          published_at: "",
        }),
      }) as Response;

      const info = await checkForUpdateWithCaching(dir, "1.0.0", 50_000);
      assert.equal(info.updateAvailable, true);
      assert.equal(info.latestVersion, "2.0.0");
    });
  });
});
