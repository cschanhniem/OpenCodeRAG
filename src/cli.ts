#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import chokidar from "chokidar";
import pc from "picocolors";
import { loadConfig, DEFAULT_CONFIG, resolveLogConfig, type RagConfig } from "./core/config.js";
import { resolveApiKey } from "./core/resolve-api-key.js";

import { appendDebugLog } from "./core/fileLogger.js";
import { loadChunkersFromConfig } from "./chunker/loader.js";
import { createEmbedder } from "./embedder/factory.js";
import { createDescriptionProvider } from "./describer/factory.js";
import { retrieve } from "./retriever/retriever.js";
import type { KeywordIndex, SearchResult } from "./core/interfaces.js";
import {
  createWatchPassScheduler,
  createWatchIgnore,
  getIndexStatusSummary,
  runIndexPass,
  type IndexRunStats,
} from "./indexer.js";

const c = {
  heading: (s: string) => pc.bold(pc.cyan(s)),
  label: (s: string) => pc.dim(s),
  dim: (s: string) => pc.dim(s),
  value: (s: string) => pc.green(s),
  num: (s: string | number) => pc.green(String(s)),
  file: (s: string) => pc.yellow(s),
  lang: (s: string) => pc.cyan(s),
  score: (s: string) => pc.magenta(s),
  desc: (s: string) => pc.dim(s),
  success: (s: string) => pc.green(s),
  warn: (s: string) => pc.yellow(s),
  error: (s: string) => pc.red(s),
  enabled: (s: string) => pc.green(s),
  disabled: (s: string) => pc.yellow(s),
  created: (s: string) => pc.green(s),
  updated: (s: string) => pc.yellow(s),
  exists: (s: string) => pc.dim(s),
};

interface CliOptions {
  config?: string;
  force?: boolean;
  watch?: boolean;
  topK?: string;
  offset?: string;
  limit?: string;
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
  console.error(c.error(message));
  //appendDebugLog(logFilePath, { scope, message, error });
}

function logCliInfo(logFilePath: string, scope: string, message: string): void {
  console.log(message);
  //appendDebugLog(logFilePath, { scope, message });
}

async function resolveConfig(opt: CliOptions, logFilePath: string): Promise<RagConfig> {
  const worktree = process.cwd();
  if (opt.config) {
    try {
      const configPath = path.resolve(opt.config);
      const cfg = loadConfig(configPath);
      resolveApiKey(cfg, worktree);
      await loadChunkersFromConfig(cfg, path.dirname(configPath));
      logCliInfo(logFilePath, "config", `${c.label("Config:")} ${c.file(configPath)}`);
      return logConfigDetails(logFilePath,cfg);
    } catch (err) {
      logCliError(logFilePath, "config", `Could not load config from ${opt.config}, using defaults`, err);
      console.error(c.warn(`Could not load config from ${opt.config}, using defaults`));
    }
  }
  for (const loc of ["opencode-rag.json", ".opencode/opencode-rag.json", ".opencode/rag.json"]) {
    const configPath = path.resolve(loc);
    try {
      const cfg = loadConfig(configPath);
      resolveApiKey(cfg, worktree);
      await loadChunkersFromConfig(cfg, path.dirname(configPath));
      logCliInfo(logFilePath, "config", `${c.label("Config:")} ${c.file(configPath)}`);
      return logConfigDetails(logFilePath, cfg);
    } catch (err) {
      logCliError(logFilePath, "config", `Failed to load config from ${configPath}`, err);
    }
  }
  logCliInfo(logFilePath, "config", `${c.label("Config:")} ${c.dim("using defaults (no opencode-rag.json found)")}`);
  return logConfigDetails(logFilePath, DEFAULT_CONFIG);
}

async function loadCliKeywordIndex(storePath: string, logFilePath: string): Promise<KeywordIndex | undefined> {
  const { KeywordIndex } = await import("./retriever/keyword-index.js");
  try {
    const index = await KeywordIndex.load(storePath);
    logCliInfo(logFilePath, "keyword-index", `${c.label("Keyword index loaded")} (${c.num(index.count())} chunks)`);
    return index;
  } catch {
    logCliInfo(logFilePath, "keyword-index", c.warn("Creating keyword index"));
    return new KeywordIndex(storePath);
  }
}

function logConfigDetails(logFilePath: string, config: RagConfig): RagConfig {
  logCliInfo(logFilePath, "config", `  ${c.label("Embedding provider:")} ${c.value(config.embedding.provider)}`);
  logCliInfo(logFilePath, "config", `  ${c.label("Embedding model:")}    ${c.value(config.embedding.model)}`);
  logCliInfo(logFilePath, "config", `  ${c.label("Vector store:")}       ${c.file(config.vectorStore.path)}`);
  return config;
}

function formatTimestamp(timestamp?: number): string {
  if (!timestamp) return "never";
  return new Date(timestamp).toLocaleString();
}

function logIndexSummary(logFilePath: string, stats: IndexRunStats): void {
  logCliInfo(logFilePath, "index", `  ${c.label("New:")}              ${c.num(stats.newFiles)}`);
  logCliInfo(logFilePath, "index", `  ${c.label("Modified:")}         ${c.num(stats.modifiedFiles)}`);
  logCliInfo(logFilePath, "index", `  ${c.label("Unchanged:")}        ${c.num(stats.unchangedFiles)}`);
  logCliInfo(logFilePath, "index", `  ${c.label("Deleted:")}          ${c.num(stats.deletedFiles)}`);
  logCliInfo(logFilePath, "index", `  ${c.label("Removed:")}          ${c.num(stats.removedFiles)}`);
  logCliInfo(logFilePath, "index", `  ${c.label("Empty skipped:")}    ${c.num(stats.skippedEmptyFiles)}`);
  logCliInfo(logFilePath, "index", `  ${c.label("Small skipped:")}    ${c.num(stats.skippedSmallFiles)}`);
  logCliInfo(logFilePath, "index", `  ${c.label("Chunks written:")}   ${c.num(stats.totalChunks)}`);
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
  // Plugin is loaded via .opencode/plugins/rag-plugin.js auto-discovery,
  // not via npm package resolution. Stale "plugin" entries from older
  // init versions would trigger npm install (which fails due to native
  // dependencies like canvas) and produce "Plugin export is not a function".
  delete next.plugin;
  return next;
}

export function removeStaleGlobalPluginRegistrations(homeDir: string, pluginName: string): string[] {
  const globalConfigDir = path.join(homeDir, ".config", "opencode");
  const updatedPaths: string[] = [];

  for (const cfgFile of ["opencode.jsonc", "opencode.json"]) {
    const configPath = path.join(globalConfigDir, cfgFile);
    if (!existsSync(configPath)) {
      continue;
    }

    try {
      const cfg = readJsonObject(configPath);
      if (!cfg || !Array.isArray(cfg.plugin)) {
        continue;
      }

      const nextPlugins = cfg.plugin.filter((entry): entry is string => typeof entry === "string" && entry !== pluginName);
      if (nextPlugins.length === cfg.plugin.length) {
        continue;
      }

      if (nextPlugins.length > 0) {
        cfg.plugin = nextPlugins;
      } else {
        delete cfg.plugin;
      }

      writeJsonFile(configPath, cfg);
      updatedPaths.push(configPath);
    } catch {
      // Ignore malformed OpenCode config files and leave them unchanged.
    }
  }

  return updatedPaths;
}

function generateWorkspacePluginFile(packageName: string): string {
  return [
    `import plugin from "../node_modules/${packageName}/dist/plugin-entry.js";`,
    `export const id = plugin.id;`,
    `export const server = plugin.server;`,
    `export default plugin;`,
    "",
  ].join("\n");
}

function generateWorkspaceTuiPluginFile(packageName: string): string {
  return [
    `import plugin from "../node_modules/${packageName}/dist/tui.js";`,
    `export default plugin;`,
    "",
  ].join("\n");
}

function generateSkillFile(): string {
  return [
    "---",
    "name: opencode-rag",
    "description: Semantic code retrieval via OpenCodeRAG — vector search, file skeletons, and symbol usage lookup for this workspace",
    "---",
    "",
    "## OpenCodeRAG Tools",
    "",
    "This workspace has OpenCodeRAG indexed for semantic code search. Use these tools BEFORE planning, editing, or answering code questions.",
    "",
    "### When to use each tool",
    "",
    "| Tool | Use when | Example |",
    "|------|----------|---------|",
    "| `opencode-rag-context` | Any code search — you need to find relevant code before acting | `\"authentication middleware\"` |",
    "| `search_semantic` | Conceptual question — \"how does X work?\" or \"where is Y?\" | `\"How does the chunking pipeline work?\"` |",
    "| `get_file_skeleton` | You have a file path but need to orient before reading | `\"src/plugin.ts\"` |",
    "| `find_usages` | Before editing any function, class, or variable — check all call sites | `\"createRagHooks\"` |",
    "",
    "### Workflow",
    "",
    "1. **Skeleton first** — call `get_file_skeleton(filePath)` to see structure",
    "2. **Find usages** — call `find_usages(symbolName)` before modifying any symbol",
    "3. **Search** — call `opencode-rag-context(query)` or `search_semantic(query)` to find relevant code",
    "4. **Read** — use the `read` tool on specific line ranges identified above",
    "5. **Edit** — now you have full context to make safe changes",
    "",
    "### Parameters",
    "",
    "- `opencode-rag-context`: `query` (req), `pathHints?`, `languageHints?`, `topK?`",
    "- `search_semantic`: `query` (req), `pathHints?`, `languageHints?`, `topK?`",
    "- `get_file_skeleton`: `filePath` (req)",
    "- `find_usages`: `symbolName` (req), `pathHint?`, `topK?`",
    "",
    "### Tips",
    "",
    "- Use `pathHints` to narrow searches to specific directories",
    "- Use `languageHints` to filter by file type",
    "- `find_usages` is essential before refactoring — it shows every reference",
    "- If no results appear, the workspace may not be indexed yet — run `opencode-rag index`",
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
      console.log(c.warn("  Retrying dependency install without native module compilation..."));
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

      logCliInfo(logFilePath, "index", `\n${c.heading("Indexing workspace...")}`);

      const embedder = createEmbedder(config);

      // Detect actual vector dimension from the model
      const probe = await embedder.embed(["dimension-probe"], "query");
      let vectorDimension = 384;
      if (probe && probe[0] && probe[0].length > 0 && typeof probe[0][0] === "number") {
        vectorDimension = (probe[0] as number[]).length;
      }
      logCliInfo(logFilePath, "index", `  ${c.label("Vector dimension:")}   ${c.num(vectorDimension)}`);

      const { LanceDBStore } = await import("./vectorstore/lancedb.js");
      const store = new LanceDBStore(
        path.resolve(cwd, config.vectorStore.path),
        vectorDimension
      );

      const keywordIndex = await loadCliKeywordIndex(path.resolve(cwd, config.vectorStore.path), logFilePath);

      // Create description provider (enabled by default)
      const descriptionConfig = config.description ?? { enabled: true, provider: "ollama" as const, baseUrl: "http://127.0.0.1:11434/api", model: "qwen2.5:3b", systemPrompt: "" };
      const descriptionProvider = descriptionConfig.enabled
        ? createDescriptionProvider(descriptionConfig)
        : undefined;
      if (descriptionProvider) {
        logCliInfo(logFilePath, "index", `  ${c.label("Description LLM:")}  ${c.value(descriptionConfig.model)} (${descriptionConfig.provider})`);
      }

      logCliInfo(logFilePath, "index", `${c.label("Scanning:")} ${c.file(cwd)}`);
      const runPass = async (watchTriggered: boolean = false): Promise<void> => {
        const passStarted = Date.now();
        const stats = await runIndexPass({
          cwd,
          storePath: path.resolve(cwd, config.vectorStore.path),
          config,
          store,
          embedder,
          keywordIndex,
          descriptionProvider,
          force: Boolean(options.force && !watchTriggered),
          logger: {
            info: (message) => appendDebugLog(logFilePath, { scope: "index", message }),
            warn: (message) => console.warn(message),
          },
        });

        logIndexSummary(logFilePath, stats);
        logCliInfo(
          logFilePath,
          "index",
          `\n${c.success("Indexing complete.")} ${c.num(stats.finalCount)} chunks stored (${formatDuration(Date.now() - passStarted)}).`
        );
      };

      await runPass(false);

      if (!options.watch) {
        return;
      }

      logCliInfo(logFilePath, "index", `\n${c.heading("Watching for changes...")}`);
      const scheduler = createWatchPassScheduler(
        () => runPass(true),
        (error) => {
          const message = (error as Error).message || String(error);
          logCliError(logFilePath, "watch", `\nWatch reindex failed: ${message}`, error);
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
        console.error(c.error(`\nWatcher error: ${(error as Error).message}`));
      });

      const shutdown = async () => {
        scheduler.close();
        await watcher.close();
        process.exit(0);
      };

      process.once("SIGINT", () => void shutdown());
      process.once("SIGTERM", () => void shutdown());

      const duration = formatDuration(Date.now() - started);
      logCliInfo(logFilePath, "index", `${c.success("Watcher ready")} (${duration} startup). Press Ctrl+C to stop.`);
    } catch (err) {
      const message = (err as Error).message || String(err);
      const logFilePath = path.resolve(process.cwd(), ".opencode", "opencode-rag.log");
      logCliError(logFilePath, "index", `\nIndexing failed: ${message}`, err);
      if (message.toLowerCase().includes("fetch") || message.toLowerCase().includes("econnrefused")) {
        console.error(c.warn("Hint: Is your embedding provider running?"));
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

      logCliInfo(logFilePath, "query", `\n${c.heading("Querying:")} "${query}"`);
      logCliInfo(logFilePath, "query", `${c.label("Top-K:")} ${c.num(parseInt(options.topK ?? "10", 10))}`);

      const embedder = createEmbedder(config);
      const { LanceDBStore } = await import("./vectorstore/lancedb.js");
      const store = new LanceDBStore(path.resolve(cwd, config.vectorStore.path));

      const indexedCount = await store.count();
      if (indexedCount === 0) {
        logCliInfo(logFilePath, "query", `${c.warn("No indexed chunks found.")} Run 'opencode-rag index' first.`);
        return;
      }
      logCliInfo(logFilePath, "query", `${c.label("Searching")} ${c.num(indexedCount)} indexed chunks...`);

      const topK = parseInt(options.topK ?? "10", 10);
      const minScore = config.retrieval.minScore;
      const keywordIndex = await loadCliKeywordIndex(path.resolve(cwd, config.vectorStore.path), logFilePath);
      const hybridCfg = config.retrieval.hybridSearch;
      const rawResults = await retrieve(query, embedder, store, { topK, minScore, keywordIndex, keywordWeight: hybridCfg?.keywordWeight, queryPrefix: config.embedding.queryPrefix });
      const results = dedupeResults(rawResults);

      if (results.length === 0) {
        logCliInfo(logFilePath, "query", c.warn("No results found."));
        return;
      }

      const duration = formatDuration(Date.now() - started);
      logCliInfo(logFilePath, "query", `\n${c.num(results.length)} result(s) in ${duration}:\n`);

      for (const r of results) {
        logCliInfo(logFilePath, "query", `  ${c.file(r.chunk.metadata.filePath)}:${c.value(String(r.chunk.metadata.startLine))}-${c.value(String(r.chunk.metadata.endLine))}`);
        logCliInfo(logFilePath, "query", `  ${c.label("Score:")} ${c.score(r.score.toFixed(4))}`);
        logCliInfo(logFilePath, "query", `  ${pc.dim(r.chunk.content.slice(0, 200).replace(/\n/g, "\n  "))}`);
      }
    } catch (err) {
      const message = (err as Error).message || String(err);
      const logFilePath = path.resolve(process.cwd(), ".opencode", "opencode-rag.log");
      logCliError(logFilePath, "query", `\nQuery failed: ${message}`, err);
      if (message.toLowerCase().includes("fetch") || message.toLowerCase().includes("econnrefused")) {
        console.error(c.warn("Hint: Is your embedding provider running?"));
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

      const { LanceDBStore } = await import("./vectorstore/lancedb.js");
      const store = new LanceDBStore(path.resolve(cwd, config.vectorStore.path));
      const prevCount = await store.count();

      if (prevCount === 0) {
        logCliInfo(logFilePath, "clear", c.warn("No indexed data to clear."));
      } else {
        logCliInfo(logFilePath, "clear", `${c.label("Clearing")} ${c.num(prevCount)} indexed chunks...`);
      }

      await store.dropDatabase();
      logCliInfo(logFilePath, "clear", `${c.success("Done.")} vector database directory removed.`);
    } catch (err) {
      const message = (err as Error).message || String(err);
      const logFilePath = path.resolve(process.cwd(), ".opencode", "opencode-rag.log");
      logCliError(logFilePath, "clear", `\nClear failed: ${message}`, err);
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

      const { LanceDBStore } = await import("./vectorstore/lancedb.js");
      const store = new LanceDBStore(path.resolve(cwd, config.vectorStore.path));
      const count = await store.count();
      const summary = await getIndexStatusSummary(
        cwd,
        path.resolve(cwd, config.vectorStore.path),
        config,
        store
      );

      logCliInfo(logFilePath, "status", `\n${c.heading("Indexed chunks:")}    ${c.num(count)}`);
      logCliInfo(logFilePath, "status", `${c.label("Store path:")}        ${c.file(path.resolve(cwd, config.vectorStore.path))}`);
      logCliInfo(logFilePath, "status", `${c.label("Embedding provider:")} ${c.value(config.embedding.provider)}`);
      logCliInfo(logFilePath, "status", `${c.label("Embedding model:")}   ${c.value(config.embedding.model)}`);
      logCliInfo(logFilePath, "status", `${c.label("File extensions:")}   ${config.indexing.includeExtensions.join(", ")}`);
      logCliInfo(logFilePath, "status", `${c.label("Excluded dirs:")}     ${config.indexing.excludeDirs.join(", ")}`);
      logCliInfo(logFilePath, "status", `${c.label("Default top-K:")}     ${c.num(config.retrieval.topK)}`);
      logCliInfo(logFilePath, "status", `${c.label("Plugin enabled:")}    ${config.openCode.enabled ? c.enabled("yes") : c.disabled("no")}`);
      logCliInfo(logFilePath, "status", `${c.label("Manifest status:")}   ${summary.manifestStatus}`);
      logCliInfo(logFilePath, "status", `${c.label("Manifest entries:")}  ${c.num(summary.manifestEntries)}`);
      logCliInfo(logFilePath, "status", `${c.label("Last indexed:")}      ${c.value(formatTimestamp(summary.lastIndexedAt))}`);
      logCliInfo(logFilePath, "status", `${c.label("Up-to-date files:")}  ${c.num(summary.upToDateFiles)}`);
      logCliInfo(logFilePath, "status", `${c.label("Pending files:")}     ${c.num(summary.pendingFiles)}`);
      logCliInfo(logFilePath, "status", `${c.label("Watch mode:")}        ${c.dim("off")}`);
      const kiCount = config.retrieval.hybridSearch?.enabled
        ? (await loadCliKeywordIndex(path.resolve(cwd, config.vectorStore.path), logFilePath))?.count() ?? 0
        : 0;
      logCliInfo(logFilePath, "status", `${c.label("Keyword index:")}     ${config.retrieval.hybridSearch?.enabled ? c.enabled("enabled") : c.disabled("disabled")} (${c.num(kiCount)} chunks)`);
      if (summary.rebuildRequired) {
        logCliInfo(logFilePath, "status", `${c.label("Rebuild required:")}  ${c.warn("yes")} (manifest missing/corrupt)`);
      }
    } catch (err) {
      const message = (err as Error).message || String(err);
      const logFilePath = path.resolve(process.cwd(), ".opencode", "opencode-rag.log");
      logCliError(logFilePath, "status", `\nStatus check failed: ${message}`, err);
      process.exit(1);
    }
  });

program
  .command("list")
  .description("List all indexed files with chunk counts")
  .option("-c, --config <path>", "path to config file")
  .action(async (options: CliOptions) => {
    try {
      const cwd = process.cwd();
      let logFilePath = path.resolve(cwd, ".opencode", "opencode-rag.log");
      const config = await resolveConfig(options, logFilePath);
      logFilePath = path.resolve(cwd, resolveLogConfig(config).logFilePath);

      const { LanceDBStore } = await import("./vectorstore/lancedb.js");
      const store = new LanceDBStore(path.resolve(cwd, config.vectorStore.path));
      const files = await store.listFiles();

      if (files.length === 0) {
        logCliInfo(logFilePath, "list", `${c.warn("No indexed files found.")} Run 'opencode-rag index' first.`);
        return;
      }

      logCliInfo(logFilePath, "list", `\n${c.num(files.length)} file(s) indexed:\n`);
      for (const f of files) {
        logCliInfo(logFilePath, "list", `  ${c.file(f.filePath)}  ${c.label("(")}${c.lang(f.language)}${c.label(", ")}${c.num(f.chunkCount)} chunk${f.chunkCount === 1 ? "" : "s"}${c.label(")")}`);
      }
    } catch (err) {
      const message = (err as Error).message || String(err);
      const logFilePath = path.resolve(process.cwd(), ".opencode", "opencode-rag.log");
      logCliError(logFilePath, "list", `\nList failed: ${message}`, err);
      process.exit(1);
    }
  });

program
  .command("show <file>")
  .description("Show chunks for a specific file")
  .option("-c, --config <path>", "path to config file")
  .action(async (file: string, options: CliOptions) => {
    try {
      const cwd = process.cwd();
      let logFilePath = path.resolve(cwd, ".opencode", "opencode-rag.log");
      const config = await resolveConfig(options, logFilePath);
      logFilePath = path.resolve(cwd, resolveLogConfig(config).logFilePath);

      const { LanceDBStore } = await import("./vectorstore/lancedb.js");
      const store = new LanceDBStore(path.resolve(cwd, config.vectorStore.path));
      const chunks = await store.getChunksByFilePath(file);

      if (chunks.length === 0) {
        logCliInfo(logFilePath, "show", `${c.warn(`No chunks found for '${file}'.`)}`);
        return;
      }

      logCliInfo(logFilePath, "show", `\n${c.num(chunks.length)} chunk(s) for ${c.file(file)}:\n`);
      for (const chunk of chunks) {
        logCliInfo(logFilePath, "show", `  ${c.label("[")}${c.value(String(chunk.metadata.startLine))}${c.label("-")}${c.value(String(chunk.metadata.endLine))}${c.label("]")} ${c.label("(")}${c.lang(chunk.metadata.language)}${c.label(")")} ${pc.dim(chunk.id)}`);
        if (chunk.description) {
          logCliInfo(logFilePath, "show", `  ${c.desc(">")} ${c.desc(chunk.description)}`);
        }
        logCliInfo(logFilePath, "show", `  ${chunk.content}\n`);
      }
    } catch (err) {
      const message = (err as Error).message || String(err);
      const logFilePath = path.resolve(process.cwd(), ".opencode", "opencode-rag.log");
      logCliError(logFilePath, "show", `\nShow failed: ${message}`, err);
      process.exit(1);
    }
  });

program
  .command("dump")
  .description("Dump all indexed chunks")
  .option("-c, --config <path>", "path to config file")
  .option("--offset <number>", "start at chunk offset", "0")
  .option("--limit <number>", "max number of chunks to dump", "25")
  .action(async (options: CliOptions) => {
    try {
      const cwd = process.cwd();
      let logFilePath = path.resolve(cwd, ".opencode", "opencode-rag.log");
      const config = await resolveConfig(options, logFilePath);
      logFilePath = path.resolve(cwd, resolveLogConfig(config).logFilePath);

      const { LanceDBStore } = await import("./vectorstore/lancedb.js");
      const store = new LanceDBStore(path.resolve(cwd, config.vectorStore.path));
      const total = await store.count();

      if (total === 0) {
        logCliInfo(logFilePath, "dump", `${c.warn("No indexed chunks found.")} Run 'opencode-rag index' first.`);
        return;
      }

      const offset = parseInt(options.offset ?? "0", 10);
      const limit = parseInt(options.limit ?? "25", 10);
      const chunks = await store.getChunks(offset, limit);

      logCliInfo(logFilePath, "dump", `\n${c.heading("Chunks")} ${c.value(String(offset + 1))}${c.label("-")}${c.value(String(offset + chunks.length))} of ${c.num(total)}:\n`);
      for (const chunk of chunks) {
        logCliInfo(logFilePath, "dump", `  ${c.file(chunk.filePath)}:${c.value(String(chunk.startLine))}${c.label("-")}${c.value(String(chunk.endLine))} ${c.label("(")}${c.lang(chunk.language)}${c.label(")")}`);
        logCliInfo(logFilePath, "dump", `  ${chunk.content}\n`);
      }

      if (offset + limit < total) {
        logCliInfo(logFilePath, "dump", `  ${c.dim(`... ${total - offset - limit} more (use --offset ${offset + limit} to continue)`)}`);
      }
    } catch (err) {
      const message = (err as Error).message || String(err);
      const logFilePath = path.resolve(process.cwd(), ".opencode", "opencode-rag.log");
      logCliError(logFilePath, "dump", `\nDump failed: ${message}`, err);
      process.exit(1);
    }
  });

function generateDefaultConfigJson(): string {
  return JSON.stringify(
    {
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
        minScore: DEFAULT_CONFIG.retrieval.minScore,
        hybridSearch: {
          enabled: DEFAULT_CONFIG.retrieval.hybridSearch!.enabled,
          keywordWeight: DEFAULT_CONFIG.retrieval.hybridSearch!.keywordWeight,
        },
      },
      openCode: {
        enabled: DEFAULT_CONFIG.openCode.enabled,
        maxContextChunks: DEFAULT_CONFIG.openCode.maxContextChunks,
        readOverride: DEFAULT_CONFIG.openCode.readOverride,
        autoIndex: {
          enabled: DEFAULT_CONFIG.openCode.autoIndex!.enabled,
          debounceMs: DEFAULT_CONFIG.openCode.autoIndex!.debounceMs,
          intervalMs: DEFAULT_CONFIG.openCode.autoIndex!.intervalMs,
        },
        autoInject: {
          enabled: DEFAULT_CONFIG.openCode.autoInject!.enabled,
          minScore: DEFAULT_CONFIG.openCode.autoInject!.minScore,
          maxChunks: DEFAULT_CONFIG.openCode.autoInject!.maxChunks,
          maxTokens: DEFAULT_CONFIG.openCode.autoInject!.maxTokens,
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
    const tuiPluginEntryPath = path.join(pluginsDir, "rag-tui.js");
    const tuiConfigPath = path.join(opencodeDir, "tui.json");
    const opencodePackagePath = path.join(opencodeDir, "package.json");

    console.log(`\n${c.heading("Initializing OpenCodeRAG in workspace...")}\n`);

    if (!existsSync(opencodeDir)) {
      mkdirSync(opencodeDir, { recursive: true });
      console.log(`  ${c.created("Created:")}  .opencode/`);
    } else {
      console.log(`  ${c.exists("Exists:")}   .opencode/`);
    }

    if (!existsSync(pluginsDir)) {
      mkdirSync(pluginsDir, { recursive: true });
      console.log(`  ${c.created("Created:")}  .opencode/plugins/`);
    } else {
      console.log(`  ${c.exists("Exists:")}   .opencode/plugins/`);
    }

    const gitignoreExists = existsSync(gitignorePath);
    const nextGitignoreContent = mergeGitignoreContent(
      gitignoreExists ? readFileSync(gitignorePath, "utf-8") : undefined
    );
    if (!gitignoreExists || options.force || readFileSync(gitignorePath, "utf-8") !== nextGitignoreContent) {
      writeFileSync(gitignorePath, nextGitignoreContent, "utf-8");
      console.log(`  ${gitignoreExists ? c.updated("Updated:") : c.created("Created:")} .opencode/.gitignore`);
    } else {
      console.log(`  ${c.exists("Exists:")}   .opencode/.gitignore`);
    }

    const opencodeConfigExists = existsSync(opencodeConfigPath);
    const nextOpencodeConfig = buildOpencodeConfig(readJsonObject(opencodeConfigPath));
    if (!opencodeConfigExists || options.force) {
      writeJsonFile(opencodeConfigPath, nextOpencodeConfig);
      console.log(`  ${opencodeConfigExists ? c.updated("Updated:") : c.created("Created:")} .opencode/opencode.json`);
    } else if (JSON.stringify(readJsonObject(opencodeConfigPath)) !== JSON.stringify(nextOpencodeConfig)) {
      writeJsonFile(opencodeConfigPath, nextOpencodeConfig);
      console.log(`  ${c.updated("Updated:")}  .opencode/opencode.json`);
    } else {
      console.log(`  ${c.exists("Exists:")}   .opencode/opencode.json`);
    }

    const pluginEntryExists = existsSync(pluginEntryPath);
    const pluginEntryContent = generateWorkspacePluginFile(packageMetadata.name);
    if (!pluginEntryExists || options.force) {
      writeFileSync(pluginEntryPath, pluginEntryContent, "utf-8");
      console.log(`  ${pluginEntryExists ? c.updated("Updated:") : c.created("Created:")} .opencode/plugins/rag-plugin.js`);
    } else if (readFileSync(pluginEntryPath, "utf-8") !== pluginEntryContent) {
      writeFileSync(pluginEntryPath, pluginEntryContent, "utf-8");
      console.log(`  ${c.updated("Updated:")}  .opencode/plugins/rag-plugin.js`);
    } else {
      console.log(`  ${c.exists("Exists:")}   .opencode/plugins/rag-plugin.js`);
    }

    const tuiPluginEntryExists = existsSync(tuiPluginEntryPath);
    const tuiPluginEntryContent = generateWorkspaceTuiPluginFile(packageMetadata.name);
    if (!tuiPluginEntryExists || options.force) {
      writeFileSync(tuiPluginEntryPath, tuiPluginEntryContent, "utf-8");
      console.log(`  ${tuiPluginEntryExists ? c.updated("Updated:") : c.created("Created:")} .opencode/plugins/rag-tui.js`);
    } else if (readFileSync(tuiPluginEntryPath, "utf-8") !== tuiPluginEntryContent) {
      writeFileSync(tuiPluginEntryPath, tuiPluginEntryContent, "utf-8");
      console.log(`  ${c.updated("Updated:")}  .opencode/plugins/rag-tui.js`);
    } else {
      console.log(`  ${c.exists("Exists:")}   .opencode/plugins/rag-tui.js`);
    }

    const tuiConfigExists = existsSync(tuiConfigPath);
    const nextTuiConfig = { plugin: ["./plugins/rag-tui.js"] };
    if (!tuiConfigExists || options.force) {
      writeJsonFile(tuiConfigPath, nextTuiConfig);
      console.log(`  ${tuiConfigExists ? c.updated("Updated:") : c.created("Created:")} .opencode/tui.json`);
    } else if (JSON.stringify(readJsonObject(tuiConfigPath)) !== JSON.stringify(nextTuiConfig)) {
      writeJsonFile(tuiConfigPath, nextTuiConfig);
      console.log(`  ${c.updated("Updated:")}  .opencode/tui.json`);
    } else {
      console.log(`  ${c.exists("Exists:")}   .opencode/tui.json`);
    }

    const skillsDir = path.join(opencodeDir, "skills");
    const skillDir = path.join(skillsDir, "opencode-rag");
    const skillPath = path.join(skillDir, "SKILL.md");
    if (!existsSync(skillDir)) {
      mkdirSync(skillDir, { recursive: true });
      console.log(`  ${c.created("Created:")}  .opencode/skills/opencode-rag/`);
    }
    const skillContent = generateSkillFile();
    const skillExists = existsSync(skillPath);
    if (!skillExists || options.force) {
      writeFileSync(skillPath, skillContent, "utf-8");
      console.log(`  ${skillExists ? c.updated("Updated:") : c.created("Created:")} .opencode/skills/opencode-rag/SKILL.md`);
    } else if (readFileSync(skillPath, "utf-8") !== skillContent) {
      writeFileSync(skillPath, skillContent, "utf-8");
      console.log(`  ${c.updated("Updated:")}  .opencode/skills/opencode-rag/SKILL.md`);
    } else {
      console.log(`  ${c.exists("Exists:")}   .opencode/skills/opencode-rag/SKILL.md`);
    }

    const workspacePackageExists = existsSync(opencodePackagePath);
    const nextWorkspacePackage = buildWorkspacePackageJson(readJsonObject(opencodePackagePath), packageMetadata, opencodeDir);
    if (!workspacePackageExists || options.force) {
      writeJsonFile(opencodePackagePath, nextWorkspacePackage);
      console.log(`  ${workspacePackageExists ? c.updated("Updated:") : c.created("Created:")} .opencode/package.json`);
    } else if (JSON.stringify(readJsonObject(opencodePackagePath)) !== JSON.stringify(nextWorkspacePackage)) {
      writeJsonFile(opencodePackagePath, nextWorkspacePackage);
      console.log(`  ${c.updated("Updated:")}  .opencode/package.json`);
    } else {
      console.log(`  ${c.exists("Exists:")}   .opencode/package.json`);
    }

    const configExists = existsSync(configPath);
    if (!configExists || options.force) {
      writeFileSync(configPath, generateDefaultConfigJson(), "utf-8");
      console.log(`  ${configExists ? c.updated("Updated:") : c.created("Created:")} opencode-rag.json`);
    } else {
      console.log(`  ${c.exists("Exists:")}   opencode-rag.json`);
    }

    if (!options.skipInstall) {
      console.log(`\n${c.heading("Installing workspace-local plugin dependencies...")}\n`);
      installWorkspaceDependencies(opencodeDir);
      console.log(`\n  ${c.success("Installed:")} .opencode/node_modules/`);
      const updatedGlobalConfigs = removeStaleGlobalPluginRegistrations(os.homedir(), packageMetadata.name);
      if (updatedGlobalConfigs.length > 0) {
        for (const configPath of updatedGlobalConfigs) {
          console.log(`  ${c.warn("Removed stale plugin registration from")} ${configPath}`);
        }
      }
      console.log(`  ${c.dim("OpenCode loads the plugin from .opencode/plugins/rag-plugin.js; no global plugin registration is required.")}`);
    } else {
      console.log(`\n  ${c.exists("Skipped:")}   dependency installation (--skip-install)`);
    }

    console.log(`\n${c.success("Done.")} Restart OpenCode if it is running, then run ${c.file("'opencode-rag index'")} in this workspace.`);
  });

/**
 * Determine whether the CLI should auto-run for the current module.
 * Resolves the first argv entry so symlinked binaries compare against the
 * real file path, and returns false if the path cannot be resolved.
 */
function dedupeResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];
  for (const result of results) {
    const chunk = result.chunk;
    const key = [
      chunk.metadata.filePath,
      chunk.metadata.startLine,
      chunk.metadata.endLine,
      chunk.content,
    ].join(":");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }
  return deduped;
}

export function shouldAutoRunCli(moduleUrl: string, argv1?: string): boolean {
  if (!argv1) {
    return false;
  }

  try {
    const resolvedPath = realpathSync(argv1).replace(/\\/g, "/");
    const normalizedUrl = moduleUrl.replace(/\\/g, "/");
    return normalizedUrl === `file://${resolvedPath}` || normalizedUrl.endsWith(`/${resolvedPath}`) || normalizedUrl.includes(resolvedPath);
  } catch {
    return false;
  }
}

if (shouldAutoRunCli(import.meta.url, process.argv[1])) {
  void program.parseAsync(process.argv);
} else {
  // Fallback: if the module appears to be running as a CLI (has argv with commands like 'init', 'index', etc.)
  // and not being imported as a library, parse the arguments anyway
  const commands = ['init', 'index', 'query', 'clear', 'status', 'list', 'show', 'dump'];
  const cmd = process.argv[2];
  if (process.argv.length > 2 && cmd && commands.includes(cmd.toLowerCase())) {
    void program.parseAsync(process.argv);
  }
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  await program.parseAsync(argv);
}
