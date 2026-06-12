# 🛣️ Roadmap

## ✅ Completed / Shipped

### Chunking & Indexing

- [x] AST-based code chunking for 16 languages: TypeScript, Python, Java, Go, C, C++, C#, JavaScript, Rust, Ruby, Kotlin, Swift, JSON, HTML, CSS, XML
- [x] Regex/document chunking for Markdown, Razor, .sln, and LaTeX
- [x] Document text extraction for PDF, DOCX, DOC, and Excel
- [x] Line-based fallback chunking for unsupported formats
- [x] Pluggable chunkers via `Chunker` interface and config-loaded custom chunkers (`loadChunkersFromConfig()`)
- [x] Incremental indexing (file-hash-based, manifest-backed, diff-aware)
- [x] File watching and background re-indexing with debounced, serialized passes, watcher status file
- [x] Enhanced chunk descriptions with relative paths and line numbers in both LLM and non-LLM modes

### Embedding & Storage

- [x] Embedding providers (Ollama + OpenAI, factory-pattern dispatch)
- [x] Proxy-aware embedding transport with config/env support, auth headers, and raw socket localhost bypass
- [x] Dimension probing at startup (auto-detect embedding size, fallback to 384)
- [x] Vector storage (LanceDB with `memory://` test mode)
- [x] Pluggable storage via `VectorStore` interface
- [x] Pluggable embedders via `EmbeddingProvider` interface
- [x] Batch embedding (configurable batch size)
- [x] Auto-detection of LanceDB schema (`tableHasDescriptionColumn()`) for seamless upgrades
- [x] Robust `clear()` via `dropDatabase()`

### Retrieval

- [x] Retrieval pipeline (embed → search → score → return)
- [x] Hybrid search (TF×IDF keyword + vector fusion) — weighted `(1-kw)*vScore + kw*kScore` merging with CamelCase/snake_case tokenizer
- [x] Session-level retrieval cache (avoids re-embedding repeated queries)
- [x] Auto-context injection on `chat.message` — high-confidence chunks are injected directly into messages, saving tool-call round-trips
- [x] Configurable auto-inject settings (`minScore`, `maxChunks`, `maxTokens`, `enabled`)

### OpenCode Plugin

- [x] `opencode-rag-context` tool for chunk-level retrieval
- [x] `chat.message` hook with file suggestions and auto-injection
- [x] RAG-backed read override tool — shadows OpenCode's built-in read, appends related code chunks and suggests related files when retrieval finds relevant results
- [x] TUI plugin module (OpenTUI + Solid.js sidebar panel) with model picker dropdowns for embedding/description providers
- [x] `PluginModule` export pattern for OpenCode v1.17.0 compatibility
- [x] Background auto-indexing via `createBackgroundIndexer()` with watcher status file
- [x] API key auto-resolution from OpenCode provider config files

### CLI & Distribution

- [x] CLI (`init`, `index`, `query`, `clear`, `status`, `list`, `show`, `dump` via commander)
- [x] Full `init` command lifecycle: generates `.opencode/plugins/rag-plugin.js` + `rag-tui.js`, `.gitignore`, `package.json`; runs `npm install`; cleans stale global plugin registrations; `--skip-install` flag
- [x] Install scripts (`install.ps1` / `install.sh`) — build, pack, install to `~/.opencode/`, register in `opencode.jsonc`, CLI wrapper, full uninstall mode
- [x] Release automation script (`scripts/release-patch.js` with `--dry` support)
- [x] Multi-entry package exports: plugin, server, library, TUI
- [x] Published npm package: `opencode-rag-plugin`
- [x] CLI query results deduplication
- [x] `clear` command uses `store.dropDatabase()` for clean slate

### Config & Quality

- [x] JSON config with deep-merged partial overrides
- [x] Runtime overrides system (`runtime-overrides.json`) for live TUI config changes with 5s TTL
- [x] Configurable file logging
- [x] Manifest schema versioning with corruption detection and automatic rebuild
- [x] Expanded automated test suite (589+ tests, Node built-in runner)

## Short Term

- [ ] LLM-based re-ranking layer (cross-encoder or lightweight model after vector search)
- [ ] Query rewriting / multi-variant expansion
- [ ] Context window optimization (dedup, merge adjacent chunks)
- [ ] Better ranking/diversity for `chat.message` file suggestions
- [ ] Clearer retrieval/debug surfaces for why files or chunks were returned

## Mid Term

- [ ] Cross-file relationship graph (imports, call graph)
- [ ] Dependency-aware search
- [ ] Multi-repo / cross-workspace search
- [ ] IDE context awareness (current file, cursor position)
- [ ] Prompt template customization
- [ ] Debugging tools (inspecting embeddings, result explanations)
- [ ] Memory / persistent context across sessions (retain coding patterns, decisions, and conventions)

## Long Term

- [ ] Evaluation framework (benchmark queries, precision@K, recall)
- [ ] Code execution-aware retrieval
- [ ] Semantic refactoring assistant
- [ ] Agent-based code navigation
- [ ] Richer non-code / multimodal support (diagrams, API specs, JSON schemas, YAML configs)
- [ ] Access control (per-folder permissions, sensitive file exclusion)
- [ ] Web UI for browsing indexed chunks, search results, and index health

---

# 💡 Brainstorming: Future Enhancements

## 1. 🔁 Incremental Indexing + Watch Mode

**✅ Implemented.** Manifest sidecar beside the LanceDB dataset. Indexing hashes
files, skips unchanged, updates modified, removes deleted/empty/too-small files,
and safely rebuilds if manifest is missing or corrupt.

Watch mode (`index --watch`) uses chokidar for debounced incremental passes.
Passes are serialized. The plugin uses the same scheduling for background
auto-indexing inside OpenCode, now writing `watcher-status.json` to the store
path for observability of background indexing state.

## 2. 🧠 Query Enhancement

Improve retrieval quality by expanding shorthand queries into multiple semantic
variants before searching.

## 3. 🔗 Code Graph Awareness

Build a structural understanding of the codebase: function call graphs, import
dependencies, class hierarchies. Enables "where is this function used?" and
"what depends on this module?" queries.

## 4. 📊 Re-ranking Layer

After vector search, use a cross-encoder or lightweight LLM to re-rank results.
Drastically improves precision for ambiguous queries.

## 5. 🧱 Hybrid Search (Keyword + Vector)

**✅ Implemented.** TF×IDF inverted index with zero dependencies.
`retrieval.hybridSearch.keywordWeight` controls the fusion balance (default 0.4).
Tokenizer handles CamelCase, snake_case, and code-specific patterns.

## 6. 🧾 Context Window Optimization

Prevent token overload by deduplicating similar chunks, merging adjacent
chunks, and ranking by diversity. Currently `maxContextChunks` limits the
count, but no quality filtering is applied.

## 7. 🧑‍💻 IDE/Editor Context Awareness

Integrate with the editor's current context: active file, cursor position, and
selected code. Boost retrieval relevance by weighting results near the user's
current focus.

## 8. 🧪 Evaluation Framework

Measure retrieval quality with benchmark queries, precision@K, and recall.
Needed before tuning chunking strategies or embedding models.

## 9. 🔐 Access Control

Per-folder permissions and sensitive file exclusion for enterprise or
multi-user environments.

## 10. 🧠 Caching Layer

Cache embeddings and query results to avoid recomputation. Batch embedding
already reduces API calls but does not persist results across sessions.

## 11. 🧵 Parallel Processing

Batch embedding is implemented (`embedBatch` with configurable batch size).
Further work: multi-threaded file scanning for large repos and parallel
chunking during indexing.

## 12. 🧩 Embedding Provider Extensibility

Already implemented via `EmbeddingProvider` interface and `createEmbedder()`
factory. Adding a new provider means writing one class and adding a switch
case. See `AGENTS.md` for the step-by-step guide.

## 13. 🧠 Non-Code / Multimodal Retrieval

Initial document support is already in place via extracted text for PDF, DOC,
DOCX, and Excel files. Future work extends beyond text extraction to richer
artifacts such as diagrams, JSON schemas, API specs, and YAML configs.

## 14. 🧾 Prompt Templates

Allow users to customize how retrieved context is formatted and injected into
LLM prompts. The plugin currently uses a fixed formatting pattern.

## 15. 🕵️ Debugging Tools

Inspect embeddings visually, show vector distances between results, explain
why a particular chunk or file was retrieved for a query.

## 16. 📉 Memory & Storage Optimization

Quantized embeddings to reduce storage, pruning stale entries, and garbage
collection on unused chunks.

## 17. 🧠 Persistent Session Memory

Retain coding patterns, project conventions, and past decisions across sessions.
Inspired by [opencode-mem](https://github.com/tickernelz/opencode-mem)'s
approach: store structured memories in a local vector DB, auto-capture insights
from conversations, and inject relevant memories into future prompts. Could
complement the existing RAG retrieval with a "project memory" layer.

## 18. 🌐 Web UI for Index Inspection

A lightweight web dashboard (like opencode-mem's `http://127.0.0.1:4747`) for
browsing indexed chunks, inspecting search results, viewing index health/stats,
and debugging retrieval quality. Useful for understanding what the system
"knows" about a codebase.

## 19. 🏢 Multi-Workspace Awareness

Support indexing and searching across multiple related repositories. Enable
cross-project queries for monorepo setups or microservice architectures. Could
use per-workspace vector shards with a unified query layer (similar to
opencode-mem's `scope: "all-projects"`).

---

# 🎯 Summary

**OpenCodeRAG** delivers a local-first semantic code search pipeline with
AST and document-aware chunking, incremental/background indexing, configurable
embeddings with proxy support, LanceDB vector storage, a full-lifecycle CLI,
OpenCode plugin integration with read-override and TUI modules, and
install/release automation.

Key strengths:

- Local + privacy-first
- Modular architecture (interfaces + factory/adapter patterns)
- Workspace-native bootstrap via `opencode-rag init` (plugins, gitignore, npm install, stale cleanup)
- Broad source and document coverage without native grammar build tools
- RAG-backed read tool that enriches file reads with related code chunks
- Hybrid keyword + vector search with configurable fusion weights
- TUI settings menu with model picker for embedding and description providers
- Runtime overrides system for live config changes without editing JSON files
- API key auto-resolution from OpenCode provider config
- Manifest schema versioning with auto-rebuild on format changes
- Install scripts for one-command global setup and uninstall

Key next steps:

1. LLM-based re-ranking for retrieval precision
2. Code graph integration for structural code understanding
3. Context window optimization for better prompt packing
4. Query rewriting and retrieval explainability
5. Persistent session memory across coding sessions
6. Web UI for index inspection and search result browsing
