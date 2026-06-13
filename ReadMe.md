# OpenCodeRAG

OpenCodeRAG is a **local-first RAG plugin** for semantic code search. It ingests your codebase into a vector index and retrieves relevant code chunks on natural language queries — saving tokens by replacing full-file reads with targeted chunk retrieval. Integrates seamlessly with [OpenCode](https://opencode.ai) and works standalone via CLI.

[![npm version](https://img.shields.io/npm/v/opencode-rag-plugin.svg)](https://www.npmjs.com/package/opencode-rag-plugin)

> ⚠️ **Note:** Don't confuse this with `opencode-rag` (a discontinued package by a different author). Use **`opencode-rag-plugin`**.

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/your-org/OpenCodeRAG.git
cd OpenCodeRAG
npm install --legacy-peer-deps
npm run build
./install.sh                          # global install (optional)

# 2. Initialize in your project
cd /path/to/your/project
opencode-rag init

# 3. Index your workspace
opencode-rag index

# 4. Search
opencode-rag query "authentication middleware"
```

**Prerequisites:** Node.js v22+, [Ollama](https://ollama.ai) (default) or OpenAI-compatible API.

## Key Features

| Feature | Description |
|---|---|
| **AST chunking** | 17 languages via tree-sitter (TS, JS, Python, Java, Go, Rust, C/C++, C#, Ruby, Kotlin, Swift, JSON, HTML, CSS, XML) |
| **Document support** | Markdown, LaTeX, PDF, DOCX, DOC, Excel |
| **Hybrid search** | Vector similarity + TF×IDF keyword fusion |
| **OpenCode plugin** | Auto-inject context, read-tool override, TUI settings |
| **Incremental indexing** | File-hash manifest, background watcher, auto-rebuild on corruption |
| **Privacy-first** | All processing stays local with Ollama |
| **CLI** | `index`, `query`, `status`, `list`, `show`, `dump`, `clear`, `init` |
| **Proxy-aware** | Corporate proxy support with raw-socket localhost bypass |
| **OpenAI / Cohere** | Alternate embedding providers with API key auto-resolution |

## Documentation

| Document | Contents |
|---|---|
| [Architecture](doc/architecture.md) | Module design, data flow, tech stack |
| [Installation](doc/installation.md) | Full install guide, global setup, uninstall |
| [Configuration](doc/configuration.md) | All options: embedding, indexing, retrieval, description, plugin |
| [Chunking](doc/chunking.md) | Language matrix, adding new chunkers, custom chunkers |
| [Embedding](doc/embedding.md) | Providers, model recommendations, proxy, dimension probing |
| [Retrieval](doc/retrieval.md) | Pipeline, hybrid search, score fusion, caching |
| [Plugin](doc/plugin.md) | OpenCode integration, tools, hooks, TUI, troubleshooting |
| [CLI Reference](doc/cli.md) | All commands, options, examples |
| [Development](doc/development.md) | Setup, testing, conventions, adding providers |
| [Troubleshooting](doc/troubleshooting.md) | Common issues, logging, debugging |
| [Roadmap](doc/roadmap.md) | Completed items, short/mid/long-term plans |

## AGENTS.md Setup

Add this to your workspace's `AGENTS.md` so OpenCode agents know how to use the plugin:

```markdown
## OpenCodeRAG Plugin

This workspace has OpenCodeRAG installed for semantic code retrieval.

### `opencode-rag-context` tool
Before planning, editing, or answering, use this tool to retrieve relevant code
chunks with file paths, line ranges, and surrounding implementation.
- `query` (required) — narrow, specific search, e.g. `"authentication middleware setup"`
- `pathHints` (optional) — up to 10 path filters, e.g. `["src/auth/"]`
- `languageHints` (optional) — up to 10 language filters, e.g. `["typescript"]`
- `topK` (optional) — result count (1–25, default 10)

### `search_semantic` tool
Search indexed code by meaning, not keywords. Use for conceptual questions like
"How does authentication work?" or "Where is the chunking logic?".
- `query` (required) — natural language description of what you're looking for
- `pathHints` (optional) — up to 10 path filters
- `languageHints` (optional) — up to 10 language filters
- `topK` (optional) — result count (1–25, default 10)

### `get_file_skeleton` tool
Get a quick structural overview of a file without reading the full contents.
Returns functions, classes, interfaces, and other declarations with line numbers.
- `filePath` (required) — path to the file (relative to workspace root or absolute)

### `find_usages` tool
**Essential before editing a function or type.** Find every line in the
indexed codebase that references a given symbol, with surrounding context.
- `symbolName` (required) — the symbol to search for (function, variable, class, etc.)
- `pathHint` (optional) — narrow search to a specific directory
- `topK` (optional) — max results (1–50, default 30)

### Indexing
- Changed files are auto-indexed in the background (debounced 5s).
- If searches return no results, run `opencode-rag index` in the terminal.
```

## OpenCode Integration

When using OpenCode, the plugin enhances your agent with two main features:

### 1. Auto-Injection (Background Context)
After every message you send, the plugin effectively searches your vector-indexed codebase:
- **High-confidence results (score ≥ 0.75):** Actual code chunks are injected directly into your prompt, giving the agent instant context without a tool-call round-trip.
- **Lower-confidence results:** A compact list of suggested files is appended instead (e.g., `src/plugin.ts (lines 10-42)`).

### 2. Specialized Agent Tools

The plugin registers several tools that OpenCode agents can invoke for code retrieval and analysis:

| Tool | Purpose | Best Use Case |
|------|---------|--------------|
| `opencode-rag-context` | General-purpose code retrieval | Any code search with optional path/language filters |
| `search_semantic` | Conceptual code search | *"How does authentication work?"*, *"Where is the chunking logic?"* |
| `get_file_skeleton` | Quick file overview via AST parsing | Orienting in an unfamiliar file without reading it entirely |
| `find_usages` | Symbol reference search | **Essential before editing** — shows every call site with context |
| `read` (optional) | RAG-enhanced file read | Full file contents with supplementary context chunks |

The system prompt automatically lists all available tools so agents know when to use each one.

---

## Privacy & Security

**100% local by default.** Embeddings are generated locally via Ollama. The vector database stays in your project directory. **No source code or embeddings leave your machine** unless you explicitly configure a third-party API.

## License

MIT
