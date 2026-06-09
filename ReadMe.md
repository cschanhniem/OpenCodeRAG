# OpenCodeRAG

Local-first RAG plugin for OpenCode — semantic code search powered by
embeddings and vector similarity.

**Published on npm as [`opencode-rag-plugin`](https://www.npmjs.com/package/opencode-rag-plugin)** (**not opencode-rag**).

## Features

- **AST-aware chunking** — splits code into functions, classes, methods using
  tree-sitter for 16 languages, plus regex-based chunking for 4 markup/config/doc
  formats (Markdown, Razor, .sln, LaTeX). Falls back to line-based chunking for
  unrecognized formats.
- **Incremental indexing** — manifest-backed indexing skips unchanged files,
  removes deleted entries, and updates only changed files.
- **Watch mode** — `index --watch` re-indexes on file changes with debounced,
  serialized passes.
- **Pluggable chunkers** — add custom language chunkers via config or programmatic API.
- **Configurable embeddings** — Ollama (default) or OpenAI-compatible providers.
  Batch embedding with configurable batch size.
- **Hybrid search** — TF×IDF keyword index combined with vector search (weighted fusion) for improved precision on code identifiers and function names.
- **Local vector store** — LanceDB with L2 distance scoring, memory mode for
  testing.
- **CLI** — index, query, clear, status commands.
- **OpenCode plugin** — exposes a chunk retrieval tool, suggests relevant files after each user message, and auto-injects high-confidence code chunks directly into the message to save tool-call round-trips.

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

### Global installation (recommended)

Clone the repository and run the install script:

**Windows:**
```powershell
.\install.ps1
```

**Linux/macOS:**
```bash
./install.sh
```

This will:
1. Build the plugin from source (`npm run build`)
2. Install it into OpenCode's runtime (`~/.opencode/node_modules/`)
3. Register it in the global OpenCode config (`~/.config/opencode/opencode.jsonc`)

After installation, restart OpenCode and the plugin is ready.

### Per-workspace setup

```bash
cd your-workspace
opencode-rag init
```

`opencode-rag init` bootstraps the current workspace by creating all relevant files and sample configuration.
Add `--skip-install` if you only want the files without installing dependencies.

### Uninstallation

To completely remove OpenCodeRAG from your system, run the uninstall script:

**Windows:**
```powershell
.\install.ps1 uninstall
```

**Linux/macOS:**
```bash
./install.sh uninstall
```

After uninstallation, restart OpenCode if it is running.

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
| ollama   | `http://localhost:11434/api`      | Default. No apiKey required. Proxy is disabled when `embedding.proxy.url` is empty. |
| openai   | `https://api.openai.com/v1`       | Requires apiKey.             |

`embedding.timeoutMs` defaults to 30000 ms. Increase it if your local model has a slow cold start.

OpenAI provider sends all texts in a single request. Ollama sends one request
per request to `/api/embed`. Set `embedding.proxy.url` to use the standard
proxy-aware HTTP path instead of the direct socket path.

## Usage

This extension consists of two main interfaces:
1. **CLI** — for manual indexing and querying from the terminal
2. **OpenCode plugin** — for automatic retrieval and file suggestions within the chat interface

### CLI

```bash
# Index the workspace incrementally
opencode-rag index

# Force full re-index (clears existing data first)
opencode-rag index --force

# Watch workspace and incrementally re-index on changes
opencode-rag index --watch

# Semantic search
opencode-rag query "How is authentication handled?"

# Limit results
opencode-rag query "error handling" --top-k 5

# Show indexing stats
opencode-rag status

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
#   Keyword index:     enabled (1274 chunks)

# Clear all indexed data
opencode-rag clear

# Use custom config
opencode-rag index --config ./my-config.json
```

`index` is incremental by default. A sidecar manifest is stored at
`<vectorStore.path>/manifest.json` and tracks file hashes, chunk counts, and the
last successful index timestamp. If the manifest is missing or corrupt while the
vector store already contains data, the next index pass clears and rebuilds the
store to avoid duplicates.

### Watch workflow

Start a watch session:

```bash
opencode-rag index --watch
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

#### Chat Message Context Auto-Injection

After you send a message, the plugin:
1. Extracts the user's message text
2. Runs semantic retrieval against the indexed workspace
3. **If high-confidence chunks are found** (relevance ≥ 0.75): injects the actual code chunks directly into the message, so the agent has relevant context immediately without needing a tool call:
   ```
   ---
   **Auto-retrieved code context** _(context: 2 chunks, 1 file, relevance 0.88–0.92)_
   ---
   [src/auth.ts:12-30] (typescript, score: 0.92)
   ```typescript
   function login() { ... }
   ```
   ---
   ```
4. **If no high-confidence results**: falls back to a compact file list (max 10 files):
   ```
   src/plugin.ts (typescript, lines 10-42, relevance 0.87)
   src/core/config.ts (typescript, lines 66-145, relevance 0.72)
   ```

The auto-injection saves a tool-call round-trip for ~70% of code-related messages. The agent can still call `opencode-rag-context` for more targeted or additional context.

**Config:**

| Option | Default | Description |
| ------ | ------- | ----------- |
| `openCode.readOverride` | `false` | Set to `true` to register a RAG-backed `read` tool that shadows OpenCode's built-in read. When enabled, agent read requests return indexed code chunks instead of full file contents. |
| `openCode.maxContextChunks` | `5` | Maximum chunks per retrieval (affects `opencode-rag-context` tool output) |
| `openCode.autoInject.enabled` | `true` | Enable/disable auto-injection of high-confidence chunks |
| `openCode.autoInject.minScore` | `0.75` | Minimum relevance score for auto-injection (0–1) |
| `openCode.autoInject.maxChunks` | `3` | Maximum chunks to auto-inject per message |
| `openCode.autoInject.maxTokens` | `2000` | Token budget for injected content (estimated at ~4 chars/token) |
| `retrieval.topK` | `10` | Number of chunks fetched per query (controls chat.message file suggestion breadth) |
| `retrieval.hybridSearch.enabled` | `true` | Enable/disable hybrid search (TF×IDF keyword + vector) |
| `retrieval.hybridSearch.keywordWeight` | `0.4` | Weight for keyword scores in hybrid fusion (0–1). Higher = more keyword influence. |

Errors during retrieval are silently caught — a failed search won't break the
chat.

#### Install from source

After cloning and installing dependencies:

```bash
# Option 1: Install globally via the install script (recommended)
./install.sh        # Linux/macOS
.\install.ps1       # Windows

# Option 2: Build and pack manually, then register globally
npm run build
npm pack
npm install --prefix ~/.opencode/ opencode-rag-plugin-1.2.0.tgz
npm install --prefix ~/.config/opencode/ opencode-rag-plugin-1.2.0.tgz
# Add "opencode-rag-plugin" to the plugin array in ~/.config/opencode/opencode.jsonc

# Option 3: Bootstrap workspace only (uses npm version)
opencode-rag init

# Uninstall (removes all global copies)
./install.sh uninstall     # Linux/macOS
.\install.ps1 uninstall    # Windows
```

The plugin reads its configuration from `opencode-rag.json` in the project root.
Remember to restart OpenCode after changing plugin files or plugin configuration.

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

#### AGENTS.md hints for using the plugin

Add a section like this to the target workspace's `AGENTS.md` so the agent
knows how to use the plugin correctly:

```markdown
## OpenCodeRAG Plugin

This workspace has OpenCodeRAG installed for semantic code retrieval.

### `opencode-rag-context` tool
Before planning, editing, or answering, use this tool to retrieve relevant code
chunks with file paths, line ranges, and surrounding implementation.
- `query` (required) — narrow, specific search, e.g. `"authentication middleware setup"`
- `pathHints` (optional) — up to 10 path filters, e.g. `["src/auth/"]`
- `languageHints` (optional) — up to 10 language filters, e.g. `["typescript"]`
- `topK` (optional) — result count (1-25, default 10)

### File suggestions
After each user message, a `chat.message` hook appends up to 10 relevant file
suggestions to the message. Look for lines like
`src/file.ts (typescript, lines 10-42)` at the bottom of user input.

### Indexing
- The plugin auto-indexes changed files in the background (debounced 5s)
- If no results come back, the workspace may not be indexed yet —
  run `opencode-rag index` from the terminal (or `npx opencode-rag-plugin`)  
- Tiny files (under 1 KB), excluded extensions, and excluded directories
  (`node_modules`, `.git`, `.opencode`, `dist`, etc.) are silently skipped
```

The plugin registers itself in the system prompt via the
`experimental.chat.system.transform` hook, so that the opencode agents will see a
reminder about the `opencode-rag-context` tool in their system instructions.

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
| LaTeX      | Regex section split            | chapter/section/subsection/subsubsection boundaries |
| PDF        | Paragraph-based (text extraction) | groups small paragraphs, splits oversized |
| Word (docx) | Paragraph-based (text extraction) | extracts raw text via mammoth, groups small paragraphs, splits oversized |
| Word (doc) | Paragraph-based (text extraction) | extracts raw text via word-extractor, groups small paragraphs, splits oversized |
| Excel (xls/xlsx) | Row-batch (text extraction) | extracts CSV per sheet via @e965/xlsx, splits by sheet then by row batches |
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
import { registerChunker } from "opencode-rag-plugin/library";
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

Test framework is Node's built-in runner (`node:test`) with `tsx` for TypeScript
imports. No test library dependencies.

## Privacy

All processing is local. Embeddings are generated via local Ollama by default.
No data leaves the machine unless configured to use a remote embedding API.
