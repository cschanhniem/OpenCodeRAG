import { Command } from "commander";
import path from "node:path";
import chokidar from "chokidar";
import { loadConfig, DEFAULT_CONFIG, type RagConfig } from "./core/config.js";
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

function logCliError(logFilePath: string, scope: string, message: string, error: unknown): void {
  console.error(message);
  appendDebugLog(logFilePath, { scope, message, error });
}

function logCliInfo(logFilePath: string, scope: string, message: string): void {
  console.log(message);
  appendDebugLog(logFilePath, { scope, message });
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

const program = new Command();

program
  .name("opencode-rag")
  .description("Local-first RAG semantic code search")
  .version("0.1.0");

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
      const logFilePath = path.resolve(cwd, ".opencode", "opencode-rag.log");
      const config = await resolveConfig(options, logFilePath);

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
      const logFilePath = path.resolve(cwd, ".opencode", "opencode-rag.log");
      const config = await resolveConfig(options, logFilePath);

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
      const logFilePath = path.resolve(cwd, ".opencode", "opencode-rag.log");
      const config = await resolveConfig(options, logFilePath);

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
      const logFilePath = path.resolve(cwd, ".opencode", "opencode-rag.log");
      const config = await resolveConfig(options, logFilePath);

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

if (
  import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
  process.argv[1]?.endsWith("cli.ts") ||
  process.argv[1]?.endsWith("cli.js")
) {
  program.parseAsync(process.argv);
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  await program.parseAsync(argv);
}
