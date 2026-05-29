# OpenCodeRAG

Local-first RAG plugin for OpenCode — semantic code search powered by
embeddings and vector similarity.

## Features

- **AST-aware chunking** — splits code into functions, classes, methods using
  tree-sitter for 16 languages, plus regex-based chunking for 3 markup/config
  formats (Markdown, Razor, .sln). Falls back to line-based chunking for
  unrecognized formats.
- **Incremental indexing** — manifest-backed indexing skips unchanged files,
  removes deleted entries, and updates only changed files.
- **Watch mode** — `index --watch` re-indexes on file changes with debounced,
  serialized passes.
- **Pluggable chunkers** — add custom language chunkers via config or programmatic API.
- **Configurable embeddings** — Ollama (default) or OpenAI-compatible providers.
  Batch embedding with configurable batch size.
- **Local vector store** — LanceDB with L2 distance scoring, memory mode for
  testing.
- **CLI** — index, query, clear, status commands.
- **OpenCode plugin** — exposes a chunk retrieval tool and suggests relevant files after each user message via the `chat.message` hook.

## Architecture

```
Workspace Files
       │
       ▼
┌──────────────┐
│   Chunker    │  AST-based (tree-sitter) or line-based fallback
└──────┬───────┘
       │ chunks
       ▼
┌──────────────┐
│   Embedder   │  Ollama / OpenAI-compatible API
└──────┬───────┘
       │ vectors
       ▼
┌──────────────┐
│  VectorStore │  LanceDB (local files or memory:// for tests)
└──────┬───────┘
       │ + manifest.json
       ▼
┌──────────────┐
│ Indexer/Retr.│  incremental index or query/search
└──────┬───────┘
       │ results
       ▼
   LLM Context
```

## Tech Stack

| Layer       | Technology                                          |
| ----------- | --------------------------------------------------- |
| Runtime     | Node.js v22 + tsx (ESM)                             |
| Language    | TypeScript 5.8                                      |
| Chunking    | web-tree-sitter (WASM) + tree-sitter-wasm grammars  |
| Embeddings  | Ollama / OpenAI-compatible (native fetch)           |
| Vector DB   | LanceDB (`@lancedb/lancedb`)                        |
| CLI         | commander                                           |
| Tests       | Node built-in test runner (`node --test`)           |
| Package mgr | npm (with `--legacy-peer-deps`)                     |

## Installation

```bash
git clone <repo-url>
cd OpenCodeRAG
npm install --legacy-peer-deps
```

### Dependencies

- **Node.js v22+** for native ESM and fetch support
- **apache-arrow** — peer dependency for LanceDB (auto-installed)
- **tree-sitter-wasm** — ships pre-built WASM grammars for all supported languages

## Configuration

Create `opencode-rag.json` in the project root (auto-detected) or pass via
`--config`. The repository's own [`opencode-rag.json`](./opencode-rag.json) serves
as a complete example with all available options.

Config files support partial overrides — missing keys fall back to defaults.
Deep merging is applied per section.

### Embedding Providers

| Provider | `baseUrl` example                 | Notes                        |
| -------- | --------------------------------- | ---------------------------- |
| ollama   | `http://localhost:11434/api`       | Default. No apiKey required. Proxy is disabled when `embedding.proxy.url` is empty. |
| openai   | `https://api.openai.com/v1`       | Requires apiKey.             |

`embedding.timeoutMs` defaults to 30000 ms. Increase it if your local model has a slow cold start.

OpenAI provider sends all texts in a single request. Ollama sends one request
per request to `/api/embed`. Set `embedding.proxy.url` to use the standard
proxy-aware HTTP path instead of the direct socket path.

## Usage

### Logging

Logging is configured under the `logging` key:

```json
{
  "logging": {
    "level": "info",
    "logFilePath": "./.opencode/opencode-rag.log"
  }
}
```

| Option       | Default                        | Description                                  |
| ------------ | ------------------------------ | -------------------------------------------- |
| `level`      | `"info"`                       | Log level: `"debug"`, `"info"`, or `"error"` |
| `logFilePath` | `"./.opencode/opencode-rag.log"` | Path to the log file (relative paths are resolved against the workspace directory) |

The resolved log file path also falls back to the `LOG_FILE_PATH` environment variable when the config value is not set. Config takes precedence over the env var when both are provided.

### CLI

```bash
# Index the workspace incrementally
npx tsx src/cli.ts index

# Force full re-index (clears existing data first)
npx tsx src/cli.ts index --force

# Watch workspace and incrementally re-index on changes
npx tsx src/cli.ts index --watch

# Semantic search
npx tsx src/cli.ts query "How is authentication handled?"

# Limit results
npx tsx src/cli.ts query "error handling" --top-k 5

# Show indexing stats
npx tsx src/cli.ts status

# Example output:
#   Indexed chunks:    1247
#   Store path:        /home/user/project/.opencode/rag_db
#   Embedding provider: ollama
#   Embedding model:   nomic-embed-text
#   Manifest status:   ok
#   Manifest entries:  42
#   Last indexed:      2026-05-28 10:45:02
#   Up-to-date files:  42
#   Pending files:     0
#   Watch mode:        off

# Clear all indexed data
npx tsx src/cli.ts clear

# Use custom config
npx tsx src/cli.ts index --config ./my-config.json
```

`index` is incremental by default. A sidecar manifest is stored at
`<vectorStore.path>/manifest.json` and tracks file hashes, chunk counts, and the
last successful index timestamp. If the manifest is missing or corrupt while the
vector store already contains data, the next index pass clears and rebuilds the
store to avoid duplicates.

### Watch workflow

Start a watch session:

```bash
npx tsx src/cli.ts index --watch
```

The initial pass indexes the workspace, then watches for file changes. On each
`add`, `change`, `unlink`, or `unlinkDir` event, the watch debounces (300 ms)
and triggers a new incremental pass. If a pass is already running, the re-index
queues one follow-up pass and runs it as soon as the current pass finishes.

The watcher ignores excluded directories, the vector store path, and the
manifest file itself. Press `Ctrl+C` to stop.

### OpenCode Plugin

The plugin registers:

1. **`opencode-rag-context`** — a custom retrieval tool for chunk-level evidence
2. **`chat.message`** — after each user message, automatically retrieves relevant indexed files and appends a compact suggestion list to the message text

#### Chat Message File Suggestions

After you send a message, the plugin:
1. Extracts the user's message text
2. Runs semantic retrieval against the indexed workspace
3. Groups results by file, sorts by best chunk score, and formats a compact file list:
   ```
   src/plugin.ts (typescript, lines 10-42)
   src/core/config.ts (typescript, lines 66-145)
   ```
4. Appends the list (max 10 files) to your message text

Only file paths, language, and line ranges are shown — no scores or code snippets. This gives the agent lightweight hints about which files are relevant without inflating the context window.

**Config:**

| Option | Default | Description |
| ------ | ------- | ----------- |
| `openCode.overrideRead` | `false` | Set to `true` to restore the legacy RAG-backed `read` tool (deprecated) |
| `openCode.maxContextChunks` | `5` | Maximum chunks per retrieval (affects `opencode-rag-context` tool output) |
| `retrieval.topK` | `10` | Number of chunks fetched per query (controls chat.message file suggestion breadth) |

Errors during retrieval are silently caught — a failed search won't break the
chat.

#### Install from source

After cloning and installing dependencies:

```bash
# Option 1: Use the project-local auto-loaded plugin
# The repo already includes .opencode/plugins/rag-plugin.ts

# Option 2: Build and install via npm pack
npm run build
npm pack
opencode plugin .\opencode-rag-0.1.0.tgz

# Option 3: Install from npm (once published)
opencode plugin opencode-rag
```

The plugin auto-detects configuration from `opencode-rag.json` or
`.opencode/rag.json` in the project root.

If you use the project-local plugin file, OpenCode auto-loads it from
`.opencode/plugins/` at startup and no `plugin` entry is required in
`.opencode/opencode.json`.

Restart OpenCode after changing plugin files or plugin configuration.

## Data Model

```typescript
interface Chunk {
  id: string;
  content: string;
  embedding?: number[];
  metadata: {
    filePath: string;
    startLine: number;
    endLine: number;
    language: string;
  };
}

interface SearchResult {
  chunk: Chunk;
  score: number;   // 1 / (1 + L2_distance), range [0, 1]
}
```

## Chunking

| Language   | Strategy                       | Captures                                  |
| ---------- | ------------------------------ | ----------------------------------------- |
| TypeScript | AST (tree-sitter)              | functions, methods, classes, interfaces   |
| Python     | AST (tree-sitter)              | functions, classes, decorated definitions |
| Java       | AST (tree-sitter)              | methods, classes, interfaces, enums       |
| Go         | AST (tree-sitter)              | functions, methods, type declarations     |
| C          | AST (tree-sitter)              | functions, structs, enums, unions, typedefs |
| C++        | AST (tree-sitter)              | functions, classes, structs, enums, namespaces, templates |
| C#         | AST (tree-sitter)              | classes, interfaces, structs, enums, methods, namespaces, records |
| JavaScript | AST (tree-sitter)              | functions, classes, arrow functions, exports |
| JSON       | AST (tree-sitter)              | key-value pairs                           |
| XML        | AST (tree-sitter)              | elements (1 chunk per root element)       |
| HTML       | AST (tree-sitter)              | `<script>` / `<style>` blocks             |
| CSS        | AST (tree-sitter)              | rule sets, at-rules, media, keyframes     |
| Razor      | Regex (brace matching)         | `@code` / `@functions` blocks, template regions |
| Markdown   | Regex heading split            | h1/h2 sections + trailing content         |
| Solution   | Regex (section boundary)       | project entries and global sections       |
| Rust       | AST (tree-sitter)              | functions, structs, enums, traits, impl blocks, modules, types |
| Ruby       | AST (tree-sitter)              | methods, classes, modules, singleton methods |
| Kotlin     | AST (tree-sitter)              | functions, classes, interfaces, objects, properties |
| Swift      | AST (tree-sitter)              | functions, classes, structs, enums, protocols, extensions, variables |
| (other)    | Line-based (100 lines/chunk)   | raw text blocks                           |

Custom chunkers can be added without modifying the project source code. Two
registration paths are supported:

### Config file

Add a `chunkers` array to `opencode-rag.json`:

```json
{
  "chunkers": [
    { "module": "./path/to/rust-chunker.js", "extensions": [".rs"] }
  ]
}
```

The module path is resolved relative to the config file. The loaded module must
export (as default or named) an object implementing the `Chunker` interface:

```typescript
interface Chunker {
  readonly language: string;
  readonly fileExtensions?: string[];
  chunk(filePath: string, content: string): Promise<Chunk[]>;
}
```

### Programmatic

```typescript
import { registerChunker } from "opencode-rag/library";
registerChunker(myChunker, [".rs"]);
```

The optional second argument overrides the chunker's `fileExtensions`. If a
built-in chunker already covers the requested extension, the new registration is
skipped and a warning is emitted.

## Vector Store

LanceDB stores chunks in a `chunks` table with columns: `id`, `content`,
`embedding` (vector), `filePath`, `startLine`, `endLine`, `language`.

- **Disk mode**: files in `vectorStore.path` (default `.opencode/rag_db`)
- **Memory mode**: `memory://` URI — for tests only, data lost on close
- **Manifest sidecar**: `manifest.json` in the store directory tracks indexed
  files for incremental updates
- Schema is auto-inferred from a seed row on first table creation
- L2 distance search, score = `1 / (1 + distance)`
- Stored file paths are normalized to absolute forward-slash paths

## Development

```bash
# TypeScript typecheck
npm run typecheck

# Run all tests
npm test

# Run specific test file
node --import tsx --test src/__tests__/chunker/fallback.test.ts
```

Project structure:
```
  src/
    core/          — interfaces.ts, config.ts
    chunker/       — grammar.ts, base.ts, language chunkers, fallback.ts, factory.ts, uuid.ts
    embedder/      — ollama.ts, openai.ts, factory.ts
    vectorstore/   — lancedb.ts
    retriever/     — retriever.ts
    types/         — opencode-plugin.d.ts
    indexer.ts     — incremental indexing + watch scheduling
    watcher.ts     — background indexer (chokidar + debounced scheduler + periodic timer)
    cli.ts, plugin.ts, plugin-entry.ts, index.ts
    __tests__/     — mirrors the module structure
```

Test framework is Node's built-in runner (`node:test`) with `tsx` for TypeScript
imports. No test library dependencies.

## Limitations

- Embedding model dimension is auto-probed at startup; falls back to 384 if probing fails.
- 19 built-in chunkers (AST for 16, regex for 3) + configurable fallback

## Privacy

All processing is local. Embeddings are generated via local Ollama by default.
No data leaves the machine unless configured to use a remote embedding API.
