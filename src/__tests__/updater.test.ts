import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { checkForUpdate } from "../core/version-check.js";

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
