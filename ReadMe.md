# OpenCodeRAG

> A RAG (Retrieval-Augmented Generation) plugin for [OpenCode](https://opencode.ai) that adds **semantic code search** powered by locally-hosted embedding models.

**Published on npm: [`opencode-rag-plugin`](https://www.npmjs.com/package/opencode-rag-plugin)**

> ⚠️ **Do not confuse with `opencode-rag`** — that is a discontinued project by a different author.

OpenCodeRAG reduces token usage by replacing expensive file-read tool calls with targeted, vector-similarity-based chunk retrieval. Large codebases along with a local dedicated GPU benefit most, but even a modern CPU handles most workloads without a GPU.

---

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Installation](#installation)
  - [Global Installation (Recommended)](#global-installation-recommended)
  - [Per-Workspace Setup](#per-workspace-setup)
  - [Manual Installation](#manual-installation)
  - [Uninstallation](#uninstallation)
- [Configuration](#configuration)
  - [Embedding Providers](#embedding-providers)
  - [Logging](#logging)
- [Usage](#usage)
  - [CLI](#cli)
  - [OpenCode Plugin](#opencode-plugin)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Chunking Language Support](#chunking-language-support)
  - [Adding Custom Chunkers](#adding-custom-chunkers)
- [Data Model](#data-model)
- [Vector Store](#vector-store)
- [Development](#development)
- [Privacy](#privacy)

---

## Features

| Feature | Description |
|---------|-------------|
| **AST-aware chunking** | Splits code into functions, classes, and methods via tree-sitter for 16 languages; regex-based for Markdown, Razor, `.sln`, and LaTeX; line-based fallback for everything else |
| **Incremental indexing** | Skips unchanged files, removes deleted entries, re-indexes only what changed |
| **Watch mode** | `index --watch` debounces file changes and re-indexes automatically |
| **Pluggable chunkers** | Add custom language chunkers via config file or programmatic API |
| **Configurable embeddings** | Ollama (default, fully local) or any OpenAI-compatible provider; configurable batch size |
| **Hybrid search** | TF×IDF keyword index fused with vector similarity — better precision on identifiers and function names |
| **Local vector store** | LanceDB with L2 distance scoring; in-memory mode for testing |
| **CLI** | `index`, `query`, `clear`, `status` commands |
| **OpenCode integration** | Auto-injects relevant code chunks into each message; suggests related files; exposes a retrieval tool the agent can call directly |

---

## Prerequisites

- **[OpenCode](https://opencode.ai)** installed and configured
- **Node.js v22+** (required for native ESM and `fetch`)
- **[Ollama](https://ollama.ai)** running locally with an embedding model (default: `nomic-embed-text`)
  — or any OpenAI-compatible embedding API

---

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/your-org/OpenCodeRAG.git
cd OpenCodeRAG

# 2. Run the install script
./install.sh          # Linux/macOS
.\install.ps1         # Windows

# 3. Go to your project and initialize
cd /path/to/your/project
opencode-rag init

# 4. Index the workspace
opencode-rag index

# 5. Restart OpenCode — the plugin is active
```

---

## Installation

### Global Installation (Recommended)

Clone the repository and run the platform-specific install script:

```bash
# Linux/macOS
./install.sh

# Windows
.\install.ps1
```

The script will:
1. Build the plugin from source (`npm run build`)
2. Install it into OpenCode's runtime (`~/.opencode/node_modules/`)
3. Register it in the global OpenCode config (`~/.config/opencode/opencode.jsonc`)

**Restart OpenCode after installation.**

---

### Per-Workspace Setup

```bash
cd your-workspace
opencode-rag init
```

Bootstraps the current directory with all required files and a sample configuration.
Add `--skip-install` to generate the files only, without installing dependencies.

---

### Manual Installation

If you prefer to build and install without the script:

```bash
npm run build
npm pack

# Install into OpenCode's runtime
npm install --prefix ~/.opencode/ opencode-rag-plugin-1.2.0.tgz
npm install --prefix ~/.config/opencode/ opencode-rag-plugin-1.2.0.tgz

# Then add "opencode-rag-plugin" to the plugins array in:
# ~/.config/opencode/opencode.jsonc
```

---

### Uninstallation

```bash
# Linux/macOS
./install.sh uninstall

# Windows
.\install.ps1 uninstall
```

**Restart OpenCode after uninstalling.**

> **Automatic dependencies:** `apache-arrow` (LanceDB peer dependency) and `tree-sitter-wasm` (pre-built WASM grammars) are installed automatically.

---

## Configuration

Create `opencode-rag.json` in your project root (auto-detected), or point to it explicitly with `--config ./path/to/config.json`.

The repository's own [`opencode-rag.json`](./opencode-rag.json) is a complete, annotated example covering all available options.

**Partial overrides are supported:** only the keys you set are applied — everything else falls back to defaults. Sections are deep-merged.

---

### Embedding Providers

| Provider | `baseUrl` | Notes |
|----------|-----------|-------|
| `ollama` | `http://localhost:11434/api` | **Default.** No API key required. |
| `openai` | `https://api.openai.com/v1` | Requires `apiKey`. Sends all texts in one batch request. |

- `embedding.timeoutMs` defaults to `30000` ms. Increase it if your local model has a slow cold start.
- Ollama sends one request per batch to `/api/embed`. Set `embedding.proxy.url` to route through a standard HTTP proxy.

---

### Logging

```json
{
  "logging": {
    "level": "info",
    "logFilePath": "./.opencode/opencode-rag.log"
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `level` | `"info"` | `"debug"`, `"info"`, or `"error"` |
| `logFilePath` | `"./.opencode/opencode-rag.log"` | Relative paths resolve against the workspace root |

The `LOG_FILE_PATH` environment variable is a fallback when no config value is set. Config takes precedence over the env var.

---

## Usage

OpenCodeRAG provides two interfaces:

| Interface | Best for |
|-----------|----------|
| **CLI** | Manual indexing, searching, and diagnostics |
| **OpenCode plugin** | Automatic retrieval and file suggestions while chatting |

---

### CLI

```bash
# Index the workspace (incremental by default)
opencode-rag index

# Force a complete re-index
opencode-rag index --force

# Watch for changes and re-index automatically
opencode-rag index --watch

# Semantic search
opencode-rag query "How is authentication handled?"
opencode-rag query "error handling" --top-k 5

# Show index statistics
opencode-rag status

# Clear all indexed data
opencode-rag clear

# Use a custom config file
opencode-rag index --config ./my-config.json
```

**Example `status` output:**
```
Indexed chunks:      1247
Store path:          /home/user/project/.opencode/rag_db
Embedding provider:  ollama
Embedding model:     nomic-embed-text
Manifest status:     ok
Manifest entries:    42
Last indexed:        2026-05-28 10:45:02
Up-to-date files:    42
Pending files:       0
Keyword index:       enabled (1274 chunks)
```

#### How Incremental Indexing Works

A manifest is stored at `<vectorStore.path>/manifest.json` and tracks file hashes, chunk counts, and the last successful index timestamp.

- Only **changed files** are re-embedded; **deleted files** are removed from the store.
- If the manifest is missing or corrupt while the store already has data, the next pass **clears and rebuilds** the entire store to prevent duplicates.

#### Watch Mode

```bash
opencode-rag index --watch
```

- Runs a full initial index pass, then listens for `add`, `change`, `unlink`, and `unlinkDir` events.
- Changes are debounced (300 ms) before triggering an incremental pass.
- If a pass is already running, one follow-up pass is queued and starts immediately after.
- The watcher ignores excluded directories, the vector store path, and the manifest file itself.
- Press `Ctrl+C` to stop.

---

### OpenCode Plugin

Once installed, the plugin registers two hooks:

| Hook | What it does |
|------|-------------|
| `opencode-rag-context` | A retrieval tool the agent can call directly to fetch code chunks with file paths and line ranges |
| `chat.message` | After each user message, retrieves relevant files and appends them to the message |

#### Auto-Injection

After each message you send, the plugin:

1. Extracts your message text
2. Runs semantic retrieval against the indexed workspace
3. **High-confidence results** (relevance ≥ `autoInject.minScore`, default `0.75`): injects the actual code chunks directly into the message — the agent gets context without a tool-call round-trip:
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
4. **No high-confidence results**: falls back to a compact file list (max 10 files):
   ```
   src/plugin.ts (typescript, lines 10-42, relevance 0.87)
   src/core/config.ts (typescript, lines 66-145, relevance 0.72)
   ```

This eliminates a tool-call round-trip for roughly 70% of code-related messages. The agent can still call `opencode-rag-context` for more targeted or additional context.

> **Note:** Retrieval errors are silently caught — a failed search will never break the chat.

---

#### Plugin Configuration Reference

| Option | Default | Description |
|--------|---------|-------------|
| `openCode.readOverride` | `false` | When `true`, registers a RAG-backed `read` tool that shadows OpenCode's built-in file reader — the agent gets indexed chunks instead of full file contents |
| `openCode.maxContextChunks` | `5` | Maximum chunks returned by `opencode-rag-context` |
| `openCode.autoInject.enabled` | `true` | Enable or disable auto-injection |
| `openCode.autoInject.minScore` | `0.75` | Minimum relevance score for auto-injection (0–1) |
| `openCode.autoInject.maxChunks` | `3` | Maximum chunks to inject per message |
| `openCode.autoInject.maxTokens` | `2000` | Token budget for injected content (~4 chars/token) |
| `retrieval.topK` | `10` | Chunks fetched per query (controls file suggestion breadth) |
| `retrieval.hybridSearch.enabled` | `true` | Enable or disable hybrid TF×IDF + vector search |
| `retrieval.hybridSearch.keywordWeight` | `0.4` | Keyword weight in hybrid fusion (0–1; higher = more keyword influence) |

---

#### AGENTS.md Snippet

Add this section to your workspace's `AGENTS.md` so the agent knows how to use the plugin:

```markdown
## OpenCodeRAG Plugin

This workspace has OpenCodeRAG installed for semantic code retrieval.

### `opencode-rag-context` tool
Before planning, editing, or answering questions, use this tool to retrieve relevant
code chunks with file paths, line ranges, and surrounding implementation.
- `query` (required) — narrow, specific search, e.g. `"authentication middleware setup"`
- `pathHints` (optional) — up to 10 path filters, e.g. `["src/auth/"]`
- `languageHints` (optional) — up to 10 language filters, e.g. `["typescript"]`
- `topK` (optional) — result count (1–25, default 10)

### File suggestions
After each user message, a `chat.message` hook appends up to 10 relevant file
suggestions. Look for lines like `src/file.ts (typescript, lines 10-42)` at the
bottom of user input.

### Indexing
- Changed files are auto-indexed in the background (debounced 5 s).
- If searches return no results, the workspace may not be indexed yet —
  run `opencode-rag index` from the terminal (or `npx opencode-rag-plugin`).
- Files under 1 KB, excluded extensions, and excluded directories
  (`node_modules`, `.git`, `.opencode`, `dist`, etc.) are silently skipped.
```

The plugin also injects a reminder about `opencode-rag-context` into the agent's system prompt via `experimental.chat.system.transform`.

---

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

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js v22 + tsx (ESM) |
| Language | TypeScript 5.8 |
| Chunking | web-tree-sitter (WASM) + tree-sitter-wasm grammars |
| Embeddings | Ollama / OpenAI-compatible (native fetch) |
| Vector DB | LanceDB (`@lancedb/lancedb`) |
| CLI | commander |
| Tests | Node built-in test runner (`node --test`) |
| Package manager | npm (with `--legacy-peer-deps`) |

---

## Chunking Language Support

| Language | Strategy | Captures |
|----------|----------|---------|
| TypeScript | AST (tree-sitter) | functions, methods, classes, interfaces |
| JavaScript | AST (tree-sitter) | functions, classes, arrow functions, exports |
| Python | AST (tree-sitter) | functions, classes, decorated definitions |
| Java | AST (tree-sitter) | methods, classes, interfaces, enums |
| Go | AST (tree-sitter) | functions, methods, type declarations |
| Rust | AST (tree-sitter) | functions, structs, enums, traits, impl blocks, modules, types |
| C | AST (tree-sitter) | functions, structs, enums, unions, typedefs |
| C++ | AST (tree-sitter) | functions, classes, structs, enums, namespaces, templates |
| C# | AST (tree-sitter) | classes, interfaces, structs, enums, methods, namespaces, records |
| Ruby | AST (tree-sitter) | methods, classes, modules, singleton methods |
| Kotlin | AST (tree-sitter) | functions, classes, interfaces, objects, properties |
| Swift | AST (tree-sitter) | functions, classes, structs, enums, protocols, extensions, variables |
| JSON | AST (tree-sitter) | key-value pairs |
| XML | AST (tree-sitter) | elements (1 chunk per root element) |
| HTML | AST (tree-sitter) | `<script>` / `<style>` blocks |
| CSS | AST (tree-sitter) | rule sets, at-rules, media, keyframes |
| Razor | Regex (brace matching) | `@code` / `@functions` blocks, template regions |
| Markdown | Regex heading split | h1/h2 sections + trailing content |
| Solution (`.sln`) | Regex (section boundary) | project entries and global sections |
| LaTeX | Regex section split | chapter/section/subsection/subsubsection boundaries |
| PDF | Paragraph-based | groups small paragraphs, splits oversized ones |
| Word (`.docx`) | Paragraph-based | extracts via mammoth; groups small paragraphs, splits oversized |
| Word (`.doc`) | Paragraph-based | extracts via word-extractor; groups small paragraphs, splits oversized |
| Excel (`.xls`/`.xlsx`) | Row-batch | extracts CSV per sheet via `@e965/xlsx`; splits by sheet, then by row batch |
| *(other)* | Line-based (100 lines/chunk) | raw text blocks |

### Adding Custom Chunkers

Custom chunkers can be registered without modifying the project source.

**Via config file** — add to `opencode-rag.json`:

```json
{
  "chunkers": [
    { "module": "./path/to/my-chunker.js", "extensions": [".xyz"] }
  ]
}
```

The module path is resolved relative to the config file. The module must export (as default or named) an object implementing the `Chunker` interface:

```typescript
interface Chunker {
  readonly language: string;
  readonly fileExtensions?: string[];
  chunk(filePath: string, content: string): Promise<Chunk[]>;
}
```

**Via programmatic API:**

```typescript
import { registerChunker } from "opencode-rag-plugin/library";
registerChunker(myChunker, [".xyz"]); // second arg overrides fileExtensions
```

> If a built-in chunker already handles the requested extension, the new registration is skipped and a warning is emitted.

---

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
  score: number; // 1 / (1 + L2_distance), range [0, 1]
}
```

---

## Vector Store

LanceDB stores chunks in a `chunks` table with columns: `id`, `content`, `embedding` (vector), `filePath`, `startLine`, `endLine`, `language`.

| Mode | Description |
|------|-------------|
| **Disk** | Files written to `vectorStore.path` (default: `.opencode/rag_db`) |
| **Memory** | `memory://` URI — for tests only; data is lost when the process exits |

Additional details:
- Schema is auto-inferred from a seed row on first table creation
- L2 distance search; score = `1 / (1 + distance)`
- File paths are normalized to absolute forward-slash paths
- `manifest.json` in the store directory tracks indexed files for incremental updates

---

## Development

```bash
# TypeScript typecheck
npm run typecheck

# Run all tests
npm test

# Run a specific test file
node --import tsx --test src/__tests__/chunker/fallback.test.ts
```

Tests use Node's built-in runner (`node:test`) with `tsx` for TypeScript imports. No external test library is required.

---

## Privacy

All processing runs locally. By default, embeddings are generated by Ollama on your own machine. **No data leaves your machine** unless you configure a remote embedding API.
