/**
 * @fileoverview Static HTML file reader and cache for the Web UI entry page.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cachedHtml: string | null = null;

/**
 * Read and cache the Web UI `index.html` from disk.
 *
 * The HTML is read once from the `ui/` directory adjacent to this module
 * and cached in memory for subsequent calls.
 *
 * @returns The full HTML string of the Web UI entry page.
 */
export function getStaticHtml(): string {
  if (cachedHtml) return cachedHtml;

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const htmlPath = join(__dirname, "ui", "index.html");
  cachedHtml = readFileSync(htmlPath, "utf-8");
  return cachedHtml;
}
