import path from "node:path";
import os from "node:os";
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { execSync } from "node:child_process";

const PLUGIN_NAME = "opencode-rag-plugin";

export interface SetupResult {
  success: boolean;
  errors: string[];
}

export function getRuntimeDir(): string {
  return path.join(os.homedir(), ".opencode");
}

export function getNpmGlobalRoot(): string {
  return execSync("npm root -g", {
    encoding: "utf-8",
    timeout: 10_000,
  }).trim();
}

function createJunction(targetPath: string, linkPath: string): void {
  const type = process.platform === "win32" ? "junction" : "dir";
  symlinkSync(targetPath, linkPath, type);
}

function removeIfExists(targetPath: string): void {
  if (existsSync(targetPath)) {
    rmSync(targetPath, { recursive: true, force: true });
  }
}

export function getVersionFile(runtimeDir: string): string {
  return path.join(runtimeDir, ".bundle-version");
}

export function readVersionFile(versionFile: string): string | null {
  try {
    return readFileSync(versionFile, "utf-8").trim();
  } catch {
    return null;
  }
}

export async function setupRuntime(options?: {
  force?: boolean;
  silent?: boolean;
  version?: string;
}): Promise<SetupResult> {
  const errors: string[] = [];

  const pluginVersion = options?.version || process.env.OPCODE_RAG_VERSION || "0.0.0";
  const runtimeDir = getRuntimeDir();
  const versionFile = getVersionFile(runtimeDir);
  const runtimePluginDir = path.join(runtimeDir, "node_modules", PLUGIN_NAME);
  const runtimeSdkDir = path.join(runtimeDir, "node_modules", "@opencode-ai");
  const runtimeSdkPluginDir = path.join(runtimeSdkDir, "plugin");

  const installedVersion = readVersionFile(versionFile);
  const runtimeDist = path.join(runtimePluginDir, "dist");
  const alreadyInstalled = existsSync(runtimeDist);

  if (alreadyInstalled && installedVersion === pluginVersion && !options?.force) {
    return { success: true, errors: [] };
  }

  let npmGlobalRoot: string;
  try {
    npmGlobalRoot = getNpmGlobalRoot();
  } catch {
    errors.push("npm is not available on PATH. Cannot determine global package location.");
    return { success: false, errors };
  }

  const globalPluginDir = path.join(npmGlobalRoot, PLUGIN_NAME);
  const globalSdkPluginDir = path.join(npmGlobalRoot, "@opencode-ai", "plugin");

  if (!existsSync(globalPluginDir)) {
    errors.push(`Plugin not found at: ${globalPluginDir}`);
    return { success: false, errors };
  }

  if (!existsSync(path.join(globalPluginDir, "dist", "cli.js"))) {
    errors.push(`Global install seems incomplete: dist/ not found in ${globalPluginDir}`);
    return { success: false, errors };
  }

  mkdirSync(runtimeDir, { recursive: true });
  const runtimePkg = path.join(runtimeDir, "package.json");
  if (!existsSync(runtimePkg)) {
    writeFileSync(runtimePkg, JSON.stringify({ private: true, type: "module" }, null, 2) + "\n", "utf-8");
  }

  removeIfExists(runtimePluginDir);
  mkdirSync(path.dirname(runtimePluginDir), { recursive: true });

  try {
    createJunction(globalPluginDir, runtimePluginDir);
  } catch {
    const { cpSync } = await import("node:fs") as typeof import("node:fs");
    cpSync(globalPluginDir, runtimePluginDir, { recursive: true });
  }

  if (existsSync(globalSdkPluginDir)) {
    removeIfExists(runtimeSdkPluginDir);
    mkdirSync(runtimeSdkDir, { recursive: true });
    try {
      createJunction(globalSdkPluginDir, runtimeSdkPluginDir);
    } catch {
      const { cpSync } = await import("node:fs") as typeof import("node:fs");
      cpSync(globalSdkPluginDir, runtimeSdkPluginDir, { recursive: true });
    }
  } else {
    mkdirSync(runtimeSdkDir, { recursive: true });
    execSync(`npm install @opencode-ai/plugin --prefix "${runtimeDir}" --no-save`, {
      cwd: runtimeDir,
      stdio: "pipe",
      timeout: 60_000,
    });
  }

  writeFileSync(versionFile, pluginVersion, "utf-8");

  const cliEntry = path.join(runtimePluginDir, "dist", "cli.js");
  const pluginEntry = path.join(runtimePluginDir, "dist", "plugin-entry.js");
  const sdkPkg = path.join(runtimeSdkPluginDir, "package.json");

  const success = existsSync(cliEntry) && existsSync(pluginEntry) && existsSync(sdkPkg);
  if (!success) {
    if (!existsSync(cliEntry)) errors.push(`CLI entry missing: ${cliEntry}`);
    if (!existsSync(pluginEntry)) errors.push(`Plugin entry missing: ${pluginEntry}`);
    if (!existsSync(sdkPkg)) errors.push(`Plugin SDK missing: ${sdkPkg}`);
  }

  return { success, errors };
}
