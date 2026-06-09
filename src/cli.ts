#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import chokidar from "chokidar";
import { loadConfig, DEFAULT_CONFIG, resolveLogConfig, type RagConfig } from "./core/config.js";
import { appendDebugLog } from "./core/fileLogger.js";
import { loadChunkersFromConfig } from "./chunker/loader.js";
import { createEmbedder } from "./embedder/factory.js";
import { LanceDBStore } from "./vectorstore/lancedb.js";
import { retrieve } from "./retriever/retriever.js";
import {
  createWatchPassScheduler,
  createWatchIgnore,
  getIndexStatusSummary,
  runIndexPass,
  type IndexRunStats,
} from "./indexer.js";

interface CliOptions {
  config?: string;
  force?: boolean;
  watch?: boolean;
  topK?: string;
}

interface InitOptions {
  force?: boolean;
  skipInstall?: boolean;
}

interface PackageMetadata {
  name: string;
  version: string;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function logCliError(logFilePath: string, scope: string, message: string, error: unknown): void {
  console.error(message);
  //appendDebugLog(logFilePath, { scope, message, error });
}

function logCliInfo(logFilePath: string, scope: string, message: string): void {
  console.log(message);
  //appendDebugLog(logFilePath, { scope, message });
}

async function resolveConfig(opt: CliOptions, logFilePath: string): Promise<RagConfig> {
  if (opt.config) {
    try {
      const configPath = path.resolve(opt.config);
      const cfg = loadConfig(configPath);
      await loadChunkersFromConfig(cfg, path.dirname(configPath));
      logCliInfo(logFilePath, "config", `Config: ${configPath}`);
      return logConfigDetails(logFilePath,cfg);
    } catch (err) {
      logCliError(logFilePath, "config", `Could not load config from ${opt.config}, using defaults`, err);
      console.error(`Could not load config from ${opt.config}, using defaults`);
    }
  }
  for (const loc of ["opencode-rag.json", ".opencode/opencode-rag.json", ".opencode/rag.json"]) {
    const configPath = path.resolve(loc);
    try {
      const cfg = loadConfig(configPath);
      await loadChunkersFromConfig(cfg, path.dirname(configPath));
      logCliInfo(logFilePath, "config", `Config: ${configPath}`);
      return logConfigDetails(logFilePath, cfg);
    } catch (err) {
      logCliError(logFilePath, "config", `Failed to load config from ${configPath}`, err);
    }
  }
  logCliInfo(logFilePath, "config", `Config: using defaults (no opencode-rag.json found)`);
  return logConfigDetails(logFilePath, DEFAULT_CONFIG);
}

function logConfigDetails(logFilePath: string, config: RagConfig): RagConfig {
  logCliInfo(logFilePath, "config", `  Embedding provider: ${config.embedding.provider}`);
  logCliInfo(logFilePath, "config", `  Embedding model:    ${config.embedding.model}`);
  logCliInfo(logFilePath, "config", `  Vector store:       ${config.vectorStore.path}`);
  return config;
}

function formatTimestamp(timestamp?: number): string {
  if (!timestamp) return "never";
  return new Date(timestamp).toLocaleString();
}

function logIndexSummary(logFilePath: string, stats: IndexRunStats): void {
  logCliInfo(logFilePath, "index", `  New:              ${stats.newFiles}`);
  logCliInfo(logFilePath, "index", `  Modified:         ${stats.modifiedFiles}`);
  logCliInfo(logFilePath, "index", `  Unchanged:        ${stats.unchangedFiles}`);
  logCliInfo(logFilePath, "index", `  Deleted:          ${stats.deletedFiles}`);
  logCliInfo(logFilePath, "index", `  Removed:          ${stats.removedFiles}`);
  logCliInfo(logFilePath, "index", `  Empty skipped:    ${stats.skippedEmptyFiles}`);
  logCliInfo(logFilePath, "index", `  Small skipped:    ${stats.skippedSmallFiles}`);
  logCliInfo(logFilePath, "index", `  Chunks written:   ${stats.totalChunks}`);
}

function formatDuration(ms: number): string {
  const seconds = (ms / 1000).toFixed(1);
  if (ms < 60000) return `${seconds}s`;
  const minutes = Math.floor(ms / 60000);
  const secs = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${secs}s`;
}

function getPackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

function getPackageMetadata(): PackageMetadata {
  const packageJsonPath = path.join(getPackageRoot(), "package.json");
  return JSON.parse(readFileSync(packageJsonPath, "utf-8")) as PackageMetadata;
}

function getStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function readJsonObject(filePath: string): Record<string, unknown> | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }

  return JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
}

function writeJsonFile(filePath: string, value: Record<string, unknown>): void {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function toPosixPath(input: string): string {
  return input.split(path.sep).join("/");
}

function resolveWorkspacePackageSpecifier(opencodeDir: string, packageRoot: string, version: string): string {
  const workspaceRoot = path.parse(opencodeDir).root.toLowerCase();
  const sourceRoot = path.parse(packageRoot).root.toLowerCase();

  if (workspaceRoot === sourceRoot) {
    return `file:${toPosixPath(path.relative(opencodeDir, packageRoot))}`;
  }

  return version;
}

function buildWorkspacePackageJson(
  existing: Record<string, unknown> | undefined,
  packageMetadata: PackageMetadata,
  opencodeDir: string
): Record<string, unknown> {
  const existingDependencies = getStringRecord(existing?.dependencies);
  const pluginVersion =
    existingDependencies["@opencode-ai/plugin"] ??
    packageMetadata.devDependencies?.["@opencode-ai/plugin"] ??
    packageMetadata.peerDependencies?.["@opencode-ai/plugin"] ??
    ">=1.0.0";

  return {
    ...existing,
    name: typeof existing?.name === "string" ? existing.name : ".opencode",
    private: true,
    type: "module",
    dependencies: {
      ...existingDependencies,
      "@opencode-ai/plugin": pluginVersion,
      [packageMetadata.name]: resolveWorkspacePackageSpecifier(opencodeDir, getPackageRoot(), packageMetadata.version),
    },
  };
}

function buildOpencodeConfig(existing: Record<string, unknown> | undefined): Record<string, unknown> {
  const next = { ...(existing ?? {}) };
  if (typeof next.$schema !== "string") {
    next.$schema = "https://opencode.ai/config.json";
  }
  return next;
}

function generateWorkspacePluginFile(packageName: string): string {
  return [
    `export { id, server, default } from "../node_modules/${packageName}/dist/plugin-entry.js";`,
    "",
  ].join("\n");
}

function mergeGitignoreContent(existingContent?: string): string {
  const lines = existingContent ? existingContent.split(/\r?\n/) : [];
  const trimmed = new Set(lines.map((line) => line.trim()));
  const requiredEntries = ["node_modules/", "package-lock.json", "rag_db/", "opencode-rag.log"];
  const missing = requiredEntries.filter((entry) => !trimmed.has(entry));

  if (!existingContent) {
    return [
      "# Ignore workspace-local plugin dependencies",
      "node_modules/",
      "package-lock.json",
      "",
      "# Ignore the LanceDB vector store (binary data)",
      "rag_db/",
      "",
      "# Ignore logs",
      "opencode-rag.log",
      "",
    ].join("\n");
  }

  if (missing.length === 0) {
    return existingContent.endsWith("\n") ? existingContent : `${existingContent}\n`;
  }

  const merged = [...lines];
  const lastLine = merged.length > 0 ? (merged[merged.length - 1] ?? "") : "";
  if (lastLine.trim().length > 0) {
    merged.push("");
  }
  merged.push("# OpenCodeRAG workspace state", ...missing, "");
  return merged.join("\n");
}

function installWorkspaceDependencies(opencodeDir: string): void {
  const quoteForCmd = (value: string): string =>
    /[\s"]/u.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

  const attempts = [
    {
      args: ["install", "--silent", "--no-package-lock"],
      retry: false,
    },
    {
      args: [
        "install",
        "--silent",
        "--no-package-lock",
        "--ignore-scripts",
        "--no-optional",
      ],
      retry: true,
    },
  ];

  let lastError: Error | undefined;

  for (const attempt of attempts) {
    if (attempt.retry) {
      console.log("  Retrying dependency install without native module compilation...");
    }

    const result =
      process.platform === "win32"
        ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `npm ${attempt.args.map(quoteForCmd).join(" ")}`], {
            cwd: opencodeDir,
            stdio: "inherit",
            env: process.env,
          })
        : spawnSync("npm", attempt.args, {
            cwd: opencodeDir,
            stdio: "inherit",
            env: process.env,
          });

    if (result.status === 0) {
      return;
    }

    lastError = result.error ?? new Error(`npm install exited with code ${result.status ?? 1}`);
  }

  throw lastError ?? new Error("npm install failed for workspace dependencies");
}

const program = new Command();

program
  .name("opencode-rag")
  .description("Local-first RAG semantic code search")
  .version(getPackageMetadata().version);

program
  .command("index")
  .description("Index workspace files")
  .option("-c, --config <path>", "path to config file")
  .option("-f, --force", "force full re-index")
  .option("-w, --watch", "watch workspace and incrementally re-index on changes")
  .action(async (options: CliOptions) => {
    const started = Date.now();

    try {
      const cwd = process.cwd();
      let logFilePath = path.resolve(cwd, ".opencode", "opencode-rag.log");
      const config = await resolveConfig(options, logFilePath);
      logFilePath = path.resolve(cwd, resolveLogConfig(config).logFilePath);

      logCliInfo(logFilePath, "index", "\nIndexing workspace...");

      const embedder = createEmbedder(config);

      // Detect actual vector dimension from the model
      const probe = await embedder.embed(["dimension-probe"]);
      let vectorDimension = 384;
      if (probe && probe[0] && probe[0].length > 0 && typeof probe[0][0] === "number") {
        vectorDimension = (probe[0] as number[]).length;
      }
      logCliInfo(logFilePath, "index", `  Vector dimension:   ${vectorDimension}`);

      const store = new LanceDBStore(
        path.resolve(cwd, config.vectorStore.path),
        vectorDimension
      );

      logCliInfo(logFilePath, "index", `Scanning: ${cwd}`);
      const runPass = async (watchTriggered: boolean = false): Promise<void> => {
        const passStarted = Date.now();
        const stats = await runIndexPass({
          cwd,
          storePath: path.resolve(cwd, config.vectorStore.path),
          config,
          store,
          embedder,
          force: Boolean(options.force && !watchTriggered),
          logger: {
            info: (message) => logCliInfo(logFilePath, "index", message),
            warn: (message) => console.warn(message),
          },
        });

        logIndexSummary(logFilePath, stats);
        logCliInfo(
          logFilePath,
          "index",
          `\nIndexing complete. ${stats.finalCount} chunks stored (${formatDuration(Date.now() - passStarted)}).`
        );
      };

      await runPass(false);

      if (!options.watch) {
        return;
      }

      logCliInfo(logFilePath, "index", "\nWatching for changes...");
      const scheduler = createWatchPassScheduler(
        () => runPass(true),
        (error) => {
          const message = (error as Error).message || String(error);
          logCliError(logFilePath, "watch", `Watch reindex failed: ${message}`, error);
          console.error(`\nWatch reindex failed: ${message}`);
        },
        300
      );

      const watcher = chokidar.watch(cwd, {
        ignored: createWatchIgnore(cwd, config, path.resolve(cwd, config.vectorStore.path)),
        ignoreInitial: true,
        persistent: true,
      });

      const handleChange = () => scheduler.notifyChange();
      watcher.on("add", handleChange);
      watcher.on("change", handleChange);
      watcher.on("unlink", handleChange);
      watcher.on("unlinkDir", handleChange);
      watcher.on("addDir", handleChange);
      watcher.on("error", (error) => {
        logCliError(logFilePath, "watch", `Watcher error: ${(error as Error).message}`, error);
        console.error(`\nWatcher error: ${(error as Error).message}`);
      });

      const shutdown = async () => {
        scheduler.close();
        await watcher.close();
        process.exit(0);
      };

      process.once("SIGINT", () => void shutdown());
      process.once("SIGTERM", () => void shutdown());

      const duration = formatDuration(Date.now() - started);
      logCliInfo(logFilePath, "index", `Watcher ready (${duration} startup). Press Ctrl+C to stop.`);
    } catch (err) {
      const message = (err as Error).message || String(err);
      const logFilePath = path.resolve(process.cwd(), ".opencode", "opencode-rag.log");
      logCliError(logFilePath, "index", `Indexing failed: ${message}`, err);
      console.error(`\nIndexing failed: ${message}`);
      if (message.toLowerCase().includes("fetch") || message.toLowerCase().includes("econnrefused")) {
        console.error("Hint: Is your embedding provider running?");
      }
      process.exit(1);
    }
  });

program
  .command("query")
  .description("Search the indexed codebase")
  .argument("<query>", "natural language query")
  .option("-c, --config <path>", "path to config file")
  .option("-n, --top-k <number>", "number of results", "10")
  .action(async (query: string, options: CliOptions) => {
    const started = Date.now();

    try {
      const cwd = process.cwd();
      let logFilePath = path.resolve(cwd, ".opencode", "opencode-rag.log");
      const config = await resolveConfig(options, logFilePath);
      logFilePath = path.resolve(cwd, resolveLogConfig(config).logFilePath);

      logCliInfo(logFilePath, "query", `\nQuerying: "${query}"`);
      logCliInfo(logFilePath, "query", `Top-K: ${parseInt(options.topK ?? "10", 10)}`);

      const embedder = createEmbedder(config);
      const store = new LanceDBStore(path.resolve(cwd, config.vectorStore.path));

      const indexedCount = await store.count();
      if (indexedCount === 0) {
        logCliInfo(logFilePath, "query", "No indexed chunks found. Run 'opencode-rag index' first.");
        return;
      }
      logCliInfo(logFilePath, "query", `Searching ${indexedCount} indexed chunks...`);

      const topK = parseInt(options.topK ?? "10", 10);
      const results = await retrieve(query, embedder, store, { topK });

      if (results.length === 0) {
        logCliInfo(logFilePath, "query", "No results found.");
        return;
      }

      const duration = formatDuration(Date.now() - started);
      logCliInfo(logFilePath, "query", `\n${results.length} result(s) in ${duration}:\n`);

      for (const r of results) {
        logCliInfo(logFilePath, "query", `  ${r.chunk.metadata.filePath}:${r.chunk.metadata.startLine}-${r.chunk.metadata.endLine}`);
        logCliInfo(logFilePath, "query", `  Score: ${r.score.toFixed(4)}`);
        logCliInfo(logFilePath, "query", `  ${r.chunk.content.slice(0, 200).replace(/\n/g, "\n  ")}`);
      }
    } catch (err) {
      const message = (err as Error).message || String(err);
      const logFilePath = path.resolve(process.cwd(), ".opencode", "opencode-rag.log");
      logCliError(logFilePath, "query", `Query failed: ${message}`, err);
      console.error(`\nQuery failed: ${message}`);
      if (message.toLowerCase().includes("fetch") || message.toLowerCase().includes("econnrefused")) {
        console.error("Hint: Is your embedding provider running?");
      }
      process.exit(1);
    }
  });

program
  .command("clear")
  .description("Clear all indexed data")
  .option("-c, --config <path>", "path to config file")
  .action(async (options: CliOptions) => {
    try {
      const cwd = process.cwd();
      let logFilePath = path.resolve(cwd, ".opencode", "opencode-rag.log");
      const config = await resolveConfig(options, logFilePath);
      logFilePath = path.resolve(cwd, resolveLogConfig(config).logFilePath);

      const store = new LanceDBStore(path.resolve(cwd, config.vectorStore.path));
      const prevCount = await store.count();

      if (prevCount === 0) {
        logCliInfo(logFilePath, "clear", "No indexed data to clear.");
        return;
      }

      logCliInfo(logFilePath, "clear", `Clearing ${prevCount} indexed chunks...`);
      await store.clear();
      logCliInfo(logFilePath, "clear", `Done. ${prevCount} chunks removed.`);
    } catch (err) {
      const message = (err as Error).message || String(err);
      const logFilePath = path.resolve(process.cwd(), ".opencode", "opencode-rag.log");
      logCliError(logFilePath, "clear", `Clear failed: ${message}`, err);
      console.error(`\nClear failed: ${message}`);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show indexing status")
  .option("-c, --config <path>", "path to config file")
  .action(async (options: CliOptions) => {
    try {
      const cwd = process.cwd();
      let logFilePath = path.resolve(cwd, ".opencode", "opencode-rag.log");
      const config = await resolveConfig(options, logFilePath);
      logFilePath = path.resolve(cwd, resolveLogConfig(config).logFilePath);

      const store = new LanceDBStore(path.resolve(cwd, config.vectorStore.path));
      const count = await store.count();
      const summary = await getIndexStatusSummary(
        cwd,
        path.resolve(cwd, config.vectorStore.path),
        config,
        store
      );

      logCliInfo(logFilePath, "status", `\nIndexed chunks:    ${count}`);
      logCliInfo(logFilePath, "status", `Store path:        ${path.resolve(cwd, config.vectorStore.path)}`);
      logCliInfo(logFilePath, "status", `Embedding provider: ${config.embedding.provider}`);
      logCliInfo(logFilePath, "status", `Embedding model:   ${config.embedding.model}`);
      logCliInfo(logFilePath, "status", `File extensions:   ${config.indexing.includeExtensions.join(", ")}`);
      logCliInfo(logFilePath, "status", `Excluded dirs:     ${config.indexing.excludeDirs.join(", ")}`);
      logCliInfo(logFilePath, "status", `Default top-K:     ${config.retrieval.topK}`);
      logCliInfo(logFilePath, "status", `Plugin enabled:    ${config.openCode.enabled}`);
      logCliInfo(logFilePath, "status", `Manifest status:   ${summary.manifestStatus}`);
      logCliInfo(logFilePath, "status", `Manifest entries:  ${summary.manifestEntries}`);
      logCliInfo(logFilePath, "status", `Last indexed:      ${formatTimestamp(summary.lastIndexedAt)}`);
      logCliInfo(logFilePath, "status", `Up-to-date files:  ${summary.upToDateFiles}`);
      logCliInfo(logFilePath, "status", `Pending files:     ${summary.pendingFiles}`);
      logCliInfo(logFilePath, "status", `Watch mode:        off`);
      if (summary.rebuildRequired) {
        logCliInfo(logFilePath, "status", `Rebuild required:  yes (manifest missing/corrupt)`);
      }
    } catch (err) {
      const message = (err as Error).message || String(err);
      const logFilePath = path.resolve(process.cwd(), ".opencode", "opencode-rag.log");
      logCliError(logFilePath, "status", `Status check failed: ${message}`, err);
      console.error(`\nStatus check failed: ${message}`);
      process.exit(1);
    }
  });

function generateDefaultConfigJson(): string {
  return JSON.stringify(
    {
      $schema: "https://raw.githubusercontent.com/MrDoe/OpenCodeRAG/main/opencode-rag.schema.json",
      embedding: {
        provider: DEFAULT_CONFIG.embedding.provider,
        baseUrl: DEFAULT_CONFIG.embedding.baseUrl,
        model: DEFAULT_CONFIG.embedding.model,
        timeoutMs: DEFAULT_CONFIG.embedding.timeoutMs,
      },
      indexing: {
        includeExtensions: DEFAULT_CONFIG.indexing.includeExtensions,
        excludeDirs: DEFAULT_CONFIG.indexing.excludeDirs,
        chunkOverlap: DEFAULT_CONFIG.indexing.chunkOverlap,
        minFileSizeBytes: DEFAULT_CONFIG.indexing.minFileSizeBytes,
      },
      vectorStore: {
        path: DEFAULT_CONFIG.vectorStore.path,
      },
      retrieval: {
        topK: DEFAULT_CONFIG.retrieval.topK,
      },
      openCode: {
        enabled: DEFAULT_CONFIG.openCode.enabled,
        maxContextChunks: DEFAULT_CONFIG.openCode.maxContextChunks,
        overrideRead: DEFAULT_CONFIG.openCode.overrideRead,
        autoIndex: {
          enabled: DEFAULT_CONFIG.openCode.autoIndex!.enabled,
          debounceMs: DEFAULT_CONFIG.openCode.autoIndex!.debounceMs,
          intervalMs: DEFAULT_CONFIG.openCode.autoIndex!.intervalMs,
        },
      },
      logging: {
        level: DEFAULT_CONFIG.logging.level,
        logFilePath: DEFAULT_CONFIG.logging.logFilePath,
      },
    },
    null,
    2
  ) + "\n";
}

program
  .command("init")
  .description("Configure the current workspace for OpenCodeRAG")
  .option("-f, --force", "overwrite existing files")
  .option("--skip-install", "skip installing workspace-local plugin dependencies")
  .action(async (options: InitOptions) => {
    const cwd = process.cwd();
    const packageMetadata = getPackageMetadata();
    const configPath = path.join(cwd, "opencode-rag.json");
    const opencodeDir = path.join(cwd, ".opencode");
    const gitignorePath = path.join(opencodeDir, ".gitignore");
    const opencodeConfigPath = path.join(opencodeDir, "opencode.json");
    const pluginsDir = path.join(opencodeDir, "plugins");
    const pluginEntryPath = path.join(pluginsDir, "rag-plugin.js");
    const opencodePackagePath = path.join(opencodeDir, "package.json");

    console.log("Initializing OpenCodeRAG in workspace...\n");

    if (!existsSync(opencodeDir)) {
      mkdirSync(opencodeDir, { recursive: true });
      console.log("  Created:  .opencode/");
    } else {
      console.log("  Exists:   .opencode/");
    }

    if (!existsSync(pluginsDir)) {
      mkdirSync(pluginsDir, { recursive: true });
      console.log("  Created:  .opencode/plugins/");
    } else {
      console.log("  Exists:   .opencode/plugins/");
    }

    const gitignoreExists = existsSync(gitignorePath);
    const nextGitignoreContent = mergeGitignoreContent(
      gitignoreExists ? readFileSync(gitignorePath, "utf-8") : undefined
    );
    if (!gitignoreExists || options.force || readFileSync(gitignorePath, "utf-8") !== nextGitignoreContent) {
      writeFileSync(gitignorePath, nextGitignoreContent, "utf-8");
      console.log(`  ${gitignoreExists ? "Updated" : "Created"}: .opencode/.gitignore`);
    } else {
      console.log("  Exists:   .opencode/.gitignore");
    }

    const opencodeConfigExists = existsSync(opencodeConfigPath);
    const nextOpencodeConfig = buildOpencodeConfig(readJsonObject(opencodeConfigPath));
    if (!opencodeConfigExists || options.force) {
      writeJsonFile(opencodeConfigPath, nextOpencodeConfig);
      console.log(`  ${opencodeConfigExists ? "Updated" : "Created"}: .opencode/opencode.json`);
    } else if (JSON.stringify(readJsonObject(opencodeConfigPath)) !== JSON.stringify(nextOpencodeConfig)) {
      writeJsonFile(opencodeConfigPath, nextOpencodeConfig);
      console.log("  Updated:  .opencode/opencode.json");
    } else {
      console.log("  Exists:   .opencode/opencode.json");
    }

    const pluginEntryExists = existsSync(pluginEntryPath);
    const pluginEntryContent = generateWorkspacePluginFile(packageMetadata.name);
    if (!pluginEntryExists || options.force) {
      writeFileSync(pluginEntryPath, pluginEntryContent, "utf-8");
      console.log(`  ${pluginEntryExists ? "Updated" : "Created"}: .opencode/plugins/rag-plugin.js`);
    } else if (readFileSync(pluginEntryPath, "utf-8") !== pluginEntryContent) {
      writeFileSync(pluginEntryPath, pluginEntryContent, "utf-8");
      console.log("  Updated:  .opencode/plugins/rag-plugin.js");
    } else {
      console.log("  Exists:   .opencode/plugins/rag-plugin.js");
    }

    const workspacePackageExists = existsSync(opencodePackagePath);
    const nextWorkspacePackage = buildWorkspacePackageJson(readJsonObject(opencodePackagePath), packageMetadata, opencodeDir);
    if (!workspacePackageExists || options.force) {
      writeJsonFile(opencodePackagePath, nextWorkspacePackage);
      console.log(`  ${workspacePackageExists ? "Updated" : "Created"}: .opencode/package.json`);
    } else if (JSON.stringify(readJsonObject(opencodePackagePath)) !== JSON.stringify(nextWorkspacePackage)) {
      writeJsonFile(opencodePackagePath, nextWorkspacePackage);
      console.log("  Updated:  .opencode/package.json");
    } else {
      console.log("  Exists:   .opencode/package.json");
    }

    const configExists = existsSync(configPath);
    if (!configExists || options.force) {
      writeFileSync(configPath, generateDefaultConfigJson(), "utf-8");
      console.log(`  ${configExists ? "Updated" : "Created"}: opencode-rag.json`);
    } else {
      console.log("  Exists:   opencode-rag.json");
    }

    if (!options.skipInstall) {
      console.log("\nInstalling workspace-local plugin dependencies...\n");
      installWorkspaceDependencies(opencodeDir);
      console.log("\n  Installed: .opencode/node_modules/");
    } else {
      console.log("\n  Skipped:   dependency installation (--skip-install)");
    }

    console.log("\nDone. Restart OpenCode if it is running, then run `opencode-rag index` in this workspace.");
  });

export function shouldAutoRunCli(moduleUrl: string, argv1?: string): boolean {
  if (!argv1) {
    return false;
  }

  try {
    return moduleUrl === `file://${realpathSync(argv1).replace(/\\/g, "/")}`;
  } catch {
    return false;
  }
}

if (shouldAutoRunCli(import.meta.url, process.argv[1])) {
  void program.parseAsync(process.argv);
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  await program.parseAsync(argv);
}
