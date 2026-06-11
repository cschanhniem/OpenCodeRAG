# OpenCodeRAG

OpenCodeRAG is a RAG (Retrieval-Augmented Generation) plugin for semantic code search powered by locally-hosted embedding models. 
It features a seamless integration with [OpenCode](https://opencode.ai) and offers a CLI interface for external usage.

[![npm version](https://img.shields.io/npm/v/opencode-rag-plugin.svg)](https://www.npmjs.com/package/opencode-rag-plugin)

> ⚠️ **Note:** Don't confuse this with `opencode-rag`, which is a discontinued project by a different author. Ensure you are using **`opencode-rag-plugin`**.

**Why Using OpenCodeRAG?**  
OpenCodeRAG aims to reduce LLM token usage by replacing expensive full-file reads with targeted, vector-similarity-based chunk retrieval. 
Large codebases benefit massively in performance. It runs perfectly on a local dedicated GPU, but modern CPUs handle most workloads just fine. 
When using only locally hosted embedding models and LLMs, your codebase also remains 100% private.

---

## Table of Contents

- [Quick Start](#-quick-start)
- [How it Works](#-how-it-works)
- [OpenCode Integration](#-opencode-integration)
- [Configuration](#-configuration)
- [CLI Usage (Standalone)](#-cli-interface)
- [Supported Languages](#-supported-languages)
- [Developer Guide & Architecture](#-developer-guide--architecture)
- [Privacy & Security](#-privacy--security)

---

## Quick Start

### Prerequisites
- **Node.js v22+** (required for native ESM and `fetch`).
- **[Ollama](https://ollama.ai)** running locally (default model: `embeddinggemma`) OR an OpenAI-compatible API.
- **[OpenCode](https://opencode.ai)** if you want to use the automated agent features.

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/your-org/OpenCodeRAG.git
cd OpenCodeRAG

# 2. Run the install script
./install.sh          # Linux/macOS
.\install.ps1         # Windows

# 3. Initialize in your project
cd /path/to/your/project
opencode-rag init

# 4. Index your workspace
opencode-rag index
```

*(To uninstall, simply run `./install.sh uninstall` or `.\install.ps1 uninstall`)*

---

## How it Works

OpenCodeRAG intelligently processes your query in OpenCode and your codebase for high-precision retrieval:
1. **AST-aware chunking:** Intelligently splits code into functions, methods, and classes using `tree-sitter`.
2. **Local Vector Database:** Uses LanceDB to store embeddings locally without any cloud dependencies.
3. **Hybrid Search:** Combines TF×IDF keyword matching with vector similarity for superior precision on identifiers.
4. **Incremental Indexing:** Only updates files that have changed, ensuring that the vector database stays up-to-date.

---

## OpenCode Integration

When are using OpenCode, the plugin enhances your agent with two main features:

### 1. Auto-Injection (Background Context)
After every message you send, the plugin effectively searches your vector-indexed codebase:
- **High-confidence results (score ≥ 0.75):** Actual code chunks are injected directly into your prompt, giving the agent instant context without a tool-call round-trip.
- **Lower-confidence results:** A compact list of suggested files is appended instead (e.g., `src/plugin.ts (lines 10-42)`).

### 2. Direct Tool Call (`opencode-rag-context`)
Any OpenCode agent can actively invoke the RAG tool to fetch specific code chunks, filter by exact file paths, or target specific programming languages.

---

## Configuration

Running `opencode-rag init` creates the config file `opencode-rag.json` in your project root. You only need to define the values you want to override.

### Embedding Providers
```json
{
  "embedding": {
    "provider": "ollama",
    "baseUrl": "http://localhost:11434/api",
    "timeoutMs": 30000
  }
}
```
* **Ollama (Default):** Local, private, no API key needed. *(Increase `timeoutMs` if your model has a slow cold start)*.
* **OpenAI:** Set `provider` to `"openai"`, change `baseUrl` to `"https://api.openai.com/v1"`, and provide your `apiKey`.

### Plugin Settings

| Option | Default | Description |
|--------|---------|-------------|
| `openCode.readOverride` | `false` | If `true`, overrides OpenCode's default file reader to append RAG chunks as supplementary context. |
| `openCode.autoInject.enabled` | `true` | Turn background auto-injection on/off. |
| `openCode.autoInject.minScore` | `0.75` | Minimum relevance score to inject actual code (0–1). |
| `retrieval.topK` | `10` | Default number of chunks fetched per query. |
| `retrieval.hybridSearch.enabled` | `true` | Enables combined TF×IDF + vector search. |

<details>
<summary>View Logging Configuration</summary>

```json
{
  "logging": {
    "level": "info", // Options: "debug", "info", or "error"
    "logFilePath": "./.opencode/opencode-rag.log"
  }
}
```
</details>

### `AGENTS.md` Setup
To ensure the OpenCode agent knows how to leverage the plugin, add this snippet to your workspace's `AGENTS.md`:

<details>
<summary>Click to view the AGENTS.md snippet</summary>

```markdown
## OpenCodeRAG Plugin

This workspace has OpenCodeRAG installed for semantic code retrieval.

### `opencode-rag-context` tool
Before planning, editing, or answering questions, use this tool to retrieve relevant code chunks with file paths, line ranges, and surrounding implementation.
- `query` (required) — narrow, specific search, e.g. `"authentication middleware setup"`
- `pathHints` (optional) — up to 10 path filters, e.g. `["src/auth/"]`
- `languageHints` (optional) — up to 10 language filters, e.g. `["typescript"]`
- `topK` (optional) — result count (1–25, default 10)

### File suggestions
After each user message, a `chat.message` hook appends up to 10 relevant file suggestions. Look for lines like `src/file.ts (typescript, lines 10-42)` at the bottom of user input.

### Indexing
- Changed files are auto-indexed in the background.
- If searches return no results, run `opencode-rag index` in the terminal.
```
</details>

---

## CLI Interface

The CLI interface (`opencode-rag`) provides full access to build, manage, and search your project's vector database, even without opening OpenCode.
This is mainly intended for testing/debugging purposes, but can also be integrated into your own applications or scripts.

```bash
# Index the workspace (incremental by default)
opencode-rag index

# Watch for file changes and re-index automatically
opencode-rag index --watch

# Force a complete rebuild of the index
opencode-rag index --force

# Semantic search directly from the terminal
opencode-rag query "How is authentication handled?" --top-k 5

# Show index statistics or clear data
opencode-rag status
opencode-rag clear
```

---

## Supported Languages

OpenCodeRAG uses advanced AST (Abstract Syntax Tree) parsing via `tree-sitter` for major languages, falling back to regex or line-based chunking for others.

* **AST Support:** TypeScript, JavaScript, Python, Java, Go, Rust, C, C++, C#, Ruby, Kotlin, Swift, JSON, XML, HTML, CSS.
* **Regex / Structure Support:** Markdown, Razor, `.sln`, LaTeX, PDF, Word (`.docx`/`.doc`), Excel.
* **Fallback:** Raw text blocks (100 lines/chunk).

---

## 🛠 Developer Guide & Architecture

### Architecture Flow
```text
Workspace Files ──> Chunker (tree-sitter/regex) ──> Chunks
                      │
Chunks ──> Embedder (Ollama/OpenAI) ──> Vectors
                      │
Vectors ──> VectorStore (LanceDB) <──> Indexer / Retriever ──> CLI / Agent Context
```

### Tech Stack
- **Runtime:** Node.js v22 + `tsx` (ESM), TypeScript 5.8
- **Chunking:** `web-tree-sitter` (WASM) + grammars
- **Vector DB:** LanceDB (`@lancedb/lancedb`) stored locally (`.opencode/rag_db`)
- **Tests:** Node built-in test runner (`npm test`)


### Adding Custom Chunkers
You can easily inject custom chunkers without modifying the source code via `opencode-rag.json`:
```json
{
  "chunkers": [
    { "module": "./path/to/my-chunker.js", "extensions": [".xyz"] }
  ]
}
```

---

## Privacy & Security

**100% Local Processing by Default.**  
Whether you use it via CLI or as an agent plugin, OpenCodeRAG honors privacy strictly. Embeddings are generated locally by Ollama, and the vector database (LanceDB) is stored right in your project's directory. **No source code or embeddings ever leave your machine** unless you explicitly configure a third-party API like OpenAI.

