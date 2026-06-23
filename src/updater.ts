import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const GITHUB_REPO = "MrDoe/OpenCodeRAG";
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  publishedAt: string;
}

function getPackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

export function getCurrentVersion(): string {
  const packageJsonPath = path.join(getPackageRoot(), "package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string };
  return pkg.version;
}

function normalizeVersion(tag: string): string {
  return tag.replace(/^v/i, "");
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

export async function checkForUpdate(
  currentVersion: string,
  proxy?: { url?: string; noProxy?: string[] },
): Promise<UpdateInfo> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "opencode-rag-updater",
    };

    const response = await fetch(GITHUB_API_URL, {
      headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        currentVersion,
        latestVersion: currentVersion,
        updateAvailable: false,
        releaseUrl: "",
        publishedAt: "",
      };
    }

    const data = await response.json() as {
      tag_name?: string;
      html_url?: string;
      published_at?: string;
    };

    const tagName = data.tag_name;
    if (!tagName) {
      return {
        currentVersion,
        latestVersion: currentVersion,
        updateAvailable: false,
        releaseUrl: "",
        publishedAt: "",
      };
    }

    const latestVersion = normalizeVersion(tagName);
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;

    return {
      currentVersion,
      latestVersion,
      updateAvailable,
      releaseUrl: data.html_url ?? "",
      publishedAt: data.published_at ?? "",
    };
  } catch {
    return {
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
      releaseUrl: "",
      publishedAt: "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function applyUpdate(options: {
  repoRoot: string;
  verbose: boolean;
}): { success: boolean; message: string } {
  const { repoRoot, verbose } = options;
  const stdio = verbose ? "inherit" as const : "pipe" as const;

  try {
    execSync("git stash", { cwd: repoRoot, stdio, timeout: 30_000 });
  } catch {
    // Non-fatal: may be a clean tree
  }

  try {
    execSync("git pull --rebase origin main", { cwd: repoRoot, stdio, timeout: 60_000 });
  } catch (err) {
    return { success: false, message: `git pull failed: ${(err as Error).message}` };
  }

  try {
    execSync("npm run build", { cwd: repoRoot, stdio, timeout: 120_000 });
  } catch (err) {
    return { success: false, message: `build failed: ${(err as Error).message}` };
  }

  const runtimeDir = path.join(
    process.env.USERPROFILE ?? process.env.HOME ?? "",
    ".opencode",
  );
  const pluginDir = path.join(runtimeDir, "node_modules", "opencode-rag-plugin");
  const junctionScript = path.join(repoRoot, "scripts", "make-junction.cjs");

  try {
    execSync(
      `node "${junctionScript}" "${pluginDir}" "${repoRoot}"`,
      { stdio, timeout: 10_000 },
    );

    // Also recreate workspace junction if we're inside a workspace root
    const workspaceLink = path.join(repoRoot, ".opencode", "node_modules", "opencode-rag-plugin");
    if (existsSync(path.dirname(workspaceLink))) {
      execSync(
        `node "${junctionScript}" "${workspaceLink}" "${pluginDir}"`,
        { stdio, timeout: 10_000 },
      );
    }

    return { success: true, message: "Update installed successfully. Restart OpenCode to use the new version." };
  } catch (err) {
    return { success: false, message: `install failed: ${(err as Error).message}` };
  }
}
