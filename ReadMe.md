# OpenCodeRAG

OpenCodeRAG is a **local-first RAG plugin** for semantic code search. It converts your codebase into vector indices and retrieves relevant code chunks on natural language queries. The primary aim is to save tokens by replacing full-file reads with targeted chunk retrieval and to speed-up tool calls for large codebases. Integrates seamlessly with [OpenCode](https://opencode.ai) and works standalone via CLI. 

You don't need a dedicated GPU to run embedding LLMs, smaller models can still run performant on modern CPUs.

[![npm version](https://img.shields.io/npm/v/opencode-rag-plugin.svg)](https://www.npmjs.com/package/opencode-rag-plugin)

> ⚠️ **Note:** Don't confuse this with the npm package `opencode-rag` (a discontinued project by a different author).

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

**Prerequisites:** Node.js v22+, [Ollama](https://ollama.ai) (default) or other LLM-hosters with installed embedding model (e.g. embeddinggemma).

## Key Features

| Feature | Description |
|---|---|
| **AST chunking** | 17 languages via tree-sitter (TS, JS, Python, Java, Go, Rust, C/C++, C#, Ruby, Kotlin, Swift, JSON, HTML, CSS, XML) |
| **Document support** | Markdown, LaTeX, PDF, DOCX, DOC, Excel |
| **Hybrid search** | Vector similarity + TF×IDF keyword fusion |
| **OpenCode plugin** | Auto-inject context, read-tool override, TUI settings, Ctrl+Enter to add RAG context |
| **Incremental indexing** | File-hash manifest, background watcher, auto-rebuild on corruption |
| **Privacy-first** | All processing stays local with Ollama |
| **CLI** | `index`, `query`, `status`, `list`, `show`, `dump`, `clear`, `init`, `ui` |
| **Proxy-aware** | Corporate proxy support with raw-socket localhost bypass |
| **OpenAI / Cohere** | Alternate embedding providers with API key auto-resolution |

## Web UI

A browser-based dashboard for exploring the indexed vector database - browse and inspect chunks and evaluate the OpenCode sessions in terms of retrieved chunks, relevance scores, and more.

![OpenCodeRAG Web UI](doc/assets/eval.png)

Launch with `opencode-rag ui`. See [Web UI documentation](doc/webui.md) for details.

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
| [Web UI](doc/webui.md) | Dashboard, chunk browser, file explorer, compare view |
| [Development](doc/development.md) | Setup, testing, conventions, adding providers |
| [Troubleshooting](doc/troubleshooting.md) | Common issues, logging, debugging |
| [Roadmap](doc/roadmap.md) | Completed items, short/mid/long-term plans |

## Agent Discovery

OpenCodeRAG registers tools that agents can invoke directly. Agents discover these tools via the OpenCode **skill system** - when `opencode-rag init` runs, it creates `.opencode/skills/opencode-rag/SKILL.md` which teaches agents the recommended workflow:

1. **Skeleton first** - `get_file_skeleton(filePath)` to orient in a file
2. **Find usages** - `find_usages(symbolName)` before editing any symbol
3. **Search** - `opencode-rag-context(query)` or `search_semantic(query)` to find relevant code
4. **Read** - use `read` on specific line ranges
5. **Edit** - make changes with full context

### Available Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| `opencode-rag-context` | General-purpose code retrieval | Before any code task when you haven't read the relevant code |
| `search_semantic` | Conceptual code search | "How does X work?", "Where is Y?" |
| `get_file_skeleton` | Quick file overview via AST | Before reading a large file to decide which sections matter |
| `find_usages` | Symbol reference search | **Before editing** any function, variable, or class |
| `read` (optional) | RAG-enhanced file read | Full file contents with supplementary context chunks |

## OpenCode Integration

When using OpenCode, the plugin enhances your agent with three discovery mechanisms:

### 1. Skill-Based Discovery (Recommended)
`opencode-rag init` creates `.opencode/skills/opencode-rag/SKILL.md` - an OpenCode skill that teaches agents the tool workflow. Agents load it on demand via the `skill` tool, keeping token overhead minimal.

### 2. Auto-Injection (Background Context)
After every message you send, the plugin searches your vector-indexed codebase:
- **High-confidence results (score ≥ 0.75):** Actual code chunks are injected directly into your prompt, giving the agent instant context without a tool-call round-trip.
- **Lower-confidence results:** A compact list of suggested files is appended instead (e.g., `src/plugin.ts (lines 10-42)`).

### 3. System Prompt Guidance (Conditional)
When chunks are indexed, a brief tool list is prepended to the system prompt so agents know the tools exist. This is skipped when no chunks are indexed to save tokens.

### 4. On-Demand RAG Context (Ctrl+Enter / Ctrl+Alt+Enter)
Press **Ctrl+Enter** in the terminal prompt to retrieve and append a relevant file list to your current prompt. Press **Ctrl+Alt+Enter** to append full code chunks instead. The query is taken from your typed text — if the prompt is empty, a toast reminds you to type first. Results are appended directly to the prompt as formatted code blocks with file paths, line ranges, and relevance scores. No dialogs are opened. Keybindings are configurable in the settings menu (Ctrl+Shift+R).

---

## Privacy & Security

**100% local by default.** Embeddings are generated locally via Ollama. The vector database stays in your project directory. **No source code or embeddings leave your machine** unless you explicitly configure a third-party API.

## License

MIT
