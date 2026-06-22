import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const GITHUB_REPO = "MrDoe/OpenCodeRAG";
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const CHECK_RESULT_FILENAME = ".update-check.json";
const DEFAULT_CHECK_INTERVAL_MS = 86_400_000; // 24 hours
const MIN_CHECK_INTERVAL_MS = 3_600_000; // 1 hour

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  publishedAt: string;
}

export interface UpdateCheckResult {
  info: UpdateInfo;
  checkedAt: number;
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

function checkResultPath(storePath: string): string {
  return path.join(storePath, CHECK_RESULT_FILENAME);
}

export function loadLastCheckResult(storePath: string): UpdateCheckResult | null {
  const filePath = checkResultPath(storePath);
  try {
    if (!existsSync(filePath)) return null;
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<UpdateCheckResult>;
    if (!parsed || typeof parsed !== "object" || !parsed.info || typeof parsed.checkedAt !== "number") {
      return null;
    }
    return parsed as UpdateCheckResult;
  } catch {
    return null;
  }
}

export function saveCheckResult(storePath: string, result: UpdateCheckResult): void {
  const filePath = checkResultPath(storePath);
  try {
    if (!existsSync(storePath)) {
      mkdirSync(storePath, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(result, null, 2), "utf-8");
  } catch {
    // Best-effort — ignore write errors
  }
}

export function shouldCheck(lastCheckedAt: number, intervalMs: number = DEFAULT_CHECK_INTERVAL_MS): boolean {
  const effectiveInterval = Math.max(intervalMs, MIN_CHECK_INTERVAL_MS);
  return Date.now() - lastCheckedAt >= effectiveInterval;
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
    // Network error, timeout, etc. — silently return no update
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

export async function checkForUpdateWithCaching(
  storePath: string,
  currentVersion: string,
  intervalMs: number = DEFAULT_CHECK_INTERVAL_MS,
): Promise<UpdateInfo> {
  const lastResult = loadLastCheckResult(storePath);
  if (lastResult && !shouldCheck(lastResult.checkedAt, intervalMs)) {
    return lastResult.info;
  }

  const info = await checkForUpdate(currentVersion);
  saveCheckResult(storePath, { info, checkedAt: Date.now() });
  return info;
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

  const globalConfig = path.join(
    process.env.USERPROFILE ?? process.env.HOME ?? "",
    ".config", "opencode",
  );
  const runtimeDir = path.join(
    process.env.USERPROFILE ?? process.env.HOME ?? "",
    ".opencode",
  );

  try {
    const packOutput = execSync(
      `npm pack --pack-destination "${globalConfig}"`,
      { cwd: repoRoot, stdio: "pipe", encoding: "utf-8", timeout: 30_000 },
    );
    const lines = packOutput.trim().split("\n");
    const tgzName = lines[lines.length - 1]?.trim();
    if (!tgzName) {
      return { success: false, message: "npm pack did not produce a .tgz file" };
    }
    const tgzPath = path.join(globalConfig, tgzName);

    for (const targetDir of [runtimeDir, globalConfig]) {
      try {
        execSync(
          `npm install --prefix "${targetDir}" "${tgzPath}"`,
          { stdio, timeout: 120_000 },
        );
      } catch {
        // Retry without native modules
        execSync(
          `npm install --prefix "${targetDir}" --ignore-scripts --no-optional "${tgzPath}"`,
          { stdio, timeout: 120_000 },
        );
      }
    }

    rmSync(tgzPath, { force: true });

    return { success: true, message: "Update installed successfully. Restart OpenCode to use the new version." };
  } catch (err) {
    return { success: false, message: `install failed: ${(err as Error).message}` };
  }
}
