/**
 * @fileoverview Version check and self-update functionality. Checks GitHub releases
 * API for new versions and applies updates via git pull + npm build.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const GITHUB_REPO = "MrDoe/OpenCodeRAG";
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

/** Information about an available update. */
export interface UpdateInfo {
  /** The currently installed version string. */
  currentVersion: string;
  /** The latest available version on GitHub. */
  latestVersion: string;
  /** Whether a newer version than the current one exists. */
  updateAvailable: boolean;
  /** URL to the GitHub release page. */
  releaseUrl: string;
  /** ISO date string of when the release was published. */
  publishedAt: string;
}

/** Resolve the absolute path to the package root directory. */
function getPackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

/** Read the current version from package.json. */
export function getCurrentVersion(): string {
  const packageJsonPath = path.join(getPackageRoot(), "package.json");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { version: string };
  return pkg.version;
}

/** Strip a leading 'v' or 'V' prefix from a version tag. */
function normalizeVersion(tag: string): string {
  return tag.replace(/^v/i, "");
}

/**
 * Compare two semver strings.
 * @returns 1 if a > b, -1 if a < b, 0 if equal.
 */
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

/**
 * Check the GitHub releases API for a newer version of OpenCodeRAG.
 * Uses a 10-second timeout; failures are silently caught.
 *
 * @param currentVersion - The version string to compare against.
 * @param proxy - Optional proxy configuration for the HTTP request.
 * @returns UpdateInfo indicating whether an update is available.
 */
export async function checkForUpdate(
  currentVersion: string,
  _proxy?: { url?: string; noProxy?: string[] },
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

/**
 * Apply a software update by pulling the latest source from git,
 * rebuilding, and re-creating the runtime junction link.
 *
 * @param options - Update options including the repo root and verbosity flag.
 * @returns Object with success status and a human-readable message.
 */
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
  const pluginName = "opencode-rag-plugin";

  try {
    // Pack the updated package
    const packOutput = execSync(`npm pack --pack-destination "${runtimeDir}"`, {
      cwd: repoRoot,
      stdio: "pipe",
      timeout: 30_000,
    }).toString().trim();

    // Find the .tgz file
    const tgzName = packOutput.split("\n").pop()?.trim() ?? `${pluginName}-*.tgz`;
    const tgzPath = path.join(runtimeDir, tgzName);

    // Ensure runtime dir has a package.json for npm context
    const runtimePkg = path.join(runtimeDir, "package.json");
    if (!existsSync(runtimePkg)) {
      execSync(`node -e "require('fs').writeFileSync('${runtimePkg.replace(/\\/g, '\\\\')}','{\\"private\\":true,\\"type\\":\\"module\\"}\\n')"`, { stdio, timeout: 5_000 });
    }

    // Install the plugin from .tgz via npm (resolves all JS deps with prebuilt binaries)
    execSync(`npm install "${tgzPath}" --no-save --no-package-lock --silent`, {
      cwd: runtimeDir,
      stdio,
      timeout: 120_000,
    });

    // Also update the workspace copy if present (via npm install from same .tgz)
    const workspaceNodeModules = path.join(repoRoot, ".opencode", "node_modules");
    if (existsSync(workspaceNodeModules)) {
      const workspacePkg = path.join(repoRoot, ".opencode", "package.json");
      if (!existsSync(workspacePkg)) {
        execSync(`node -e "require('fs').writeFileSync('${workspacePkg.replace(/\\/g, '\\\\')}','{\\"private\\":true,\\"type\\":\\"module\\"}\\n')"`, { stdio, timeout: 5_000 });
      }
      execSync(`npm install "${tgzPath}" --no-save --no-package-lock --silent`, {
        cwd: path.dirname(workspacePkg),
        stdio,
        timeout: 120_000,
      });
    }

    return { success: true, message: "Update installed successfully. Restart OpenCode to use the new version." };
  } catch (err) {
    return { success: false, message: `install failed: ${(err as Error).message}` };
  }
}
