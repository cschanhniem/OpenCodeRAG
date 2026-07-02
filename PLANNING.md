# 🛣️ Roadmap

## Completed ✓

- [x] AST-aware chunking for JavaScript/TypeScript (+ 25 languages via tree-sitter: Python, Java, Go, C#, Kotlin, Swift, Rust, Ruby, PHP, SQL, YAML, TOML, XML, HTML, CSS, JSON, Markdown, Bash, Dockerfile, PowerShell, INI, TeX, Razor, SLN, StarLIMS SSL)
- [x] Document chunking for PDF, DOCX, DOC, Excel
- [x] Hybrid keyword + vector search with configurable fusion weights
- [x] LanceDB vector storage with incremental indexing
- [x] Background indexing with file watching (chokidar-based live re-indexing)
- [x] Configurable embeddings with proxy support (custom HTTP client with connection pooling, raw TCP/TLS sockets, NO_PROXY matching)
- [x] API key auto-resolution from OpenCode provider config
- [x] Manifest schema versioning with auto-rebuild
- [x] Runtime overrides system (no JSON editing required)
- [x] OpenCode plugin integration with `search_semantic`, `get_file_skeleton`, `find_usages`, `describe_image` tools
- [x] TUI settings menu with model picker for embedding and description providers
- [x] RAG-backed read tool with related code enrichment
- [x] Install/uninstall scripts for global setup
- [x] Workspace-native bootstrap (`opencode-rag init`)
- [x] Web UI with chunk browser, file explorer, and evaluation dashboard
- [x] MCP server (`opencode-rag mcp`) — expose `search_semantic`, `get_file_skeleton`, `find_usages`, `describe_image` via stdio MCP for any MCP-compatible client
- [x] Programmatic TypeScript API (`search()`, `indexWorkspace()`, `getContext()`, `validateConfig()`, `scanWorkspace()`, `createBackgroundIndexer()`, `getIndexStatusSummary()`)
- [x] Retrieval debug surfaces (explain why files/chunks were returned) — `SearchExplanation` type, `getMatchedTerms()`, `--explain` CLI flag, `explain` param on API calls
- [x] Image description via vision LLMs — `describe_image` tool in OpenCode plugin, MCP server, and CLI; 4 vision providers (Ollama, OpenAI, Anthropic, Gemini); image resizing via sharp; image chunking with searchable vector chunks
- [x] Evaluation framework — session event capture, token usage analysis, RAG impact measurement, cross-session comparison (`eval:sessions`, `eval:analyze`, `eval:compare` commands)
- [x] Multi-provider description generation — Anthropic Claude, Google Gemini, and OpenAI-compatible providers with batch description support
- [x] Self-updater via npm — check/install updates via `npm update -g opencode-rag-plugin`
- [x] Provider health checking — validates all configured providers (embedding, description, image_description) at startup
- [x] Enhanced CLI — 16 commands: `index`, `query`, `show`, `dump`, `status`, `init`, `clear`, `list`, `eval`, `describe-image`, `mcp`, `ui`, `update`, plus progress tracking
- [x] Pluggable chunker loading — dynamic import of custom chunker modules from config
- [x] In-memory vector store — ephemeral alternative to LanceDB for testing/embedding
- [x] Lock-file concurrency protection for index passes
- [x] Data-loss detection in indexing pipeline
- [x] Batch description generation with failure tracking and retry
- [x] Live terminal progress table with pipeline breadcrumbs (Chunking → Description → Embedding → Finished)
- [x] Documentation mode progress tracking (`doc-mode-progress.json`)
- [x] SSL/STARLIMS chunker for procedural script files
- [x] Cohere embedding provider with health check
- [x] Config validation at startup — validate `opencode-rag.json` schema with clear error messages
- [x] Better ranking/diversity for `chat.message` file suggestions

## Short Term
- [ ] Git-aware incremental indexing — `git diff --name-only` since last indexed commit, skips unchanged tracked files
- [ ] LLM-based re-ranking layer (cross-encoder or lightweight model after vector search)
- [ ] Query rewriting / multi-variant expansion
- [ ] Context window optimization (dedup, merge adjacent chunks)
- [ ] Persistent query cache (disk-based, not just in-memory)

## Mid Term

- [ ] Cross-file relationship graph (imports, call graph)
- [ ] Dependency-aware search
- [ ] Multi-repo / cross-workspace search
- [ ] IDE context awareness (current file, cursor position)
- [ ] Prompt template customization
- [ ] Memory / persistent context across sessions

## Long Term

- [ ] Code execution-aware retrieval
- [ ] Semantic refactoring assistant
- [ ] Agent-based code navigation
- [ ] Richer non-code / multimodal support (diagrams, API specs, JSON schemas, YAML configs)
- [ ] Access control (per-folder permissions, sensitive file exclusion)
- [ ] Index export/import — serialize the index for CI/CD, team sharing, or backup/restore
- [ ] Performance benchmark suite — measure index time, query latency, memory usage across repo sizes

---

# 💡 Brainstorming: Future Enhancements

## Query Enhancement

Improve retrieval quality by expanding shorthand queries into multiple semantic variants before searching.

## Code Graph Awareness

Build a structural understanding of the codebase: function call graphs, import dependencies, class hierarchies. Enables "where is this function used?" and "what depends on this module?" queries.

## Re-ranking Layer

After vector search, use a cross-encoder or lightweight LLM to re-rank results. Drastically improves precision for ambiguous queries.

## Context Window Optimization

Prevent token overload by deduplicating similar chunks, merging adjacent chunks, and ranking by diversity. Currently `maxContextChunks` limits the count, but no quality filtering is applied.

## IDE/Editor Context Awareness

Integrate with the editor's current context: active file, cursor position, and selected code. Boost retrieval relevance by weighting results near the user's current focus.

## Access Control

Per-folder permissions and sensitive file exclusion for enterprise or multi-user environments.

## Persistent Query Cache

Persist query→results on disk (not just in-memory session cache) so repeated queries across restarts are instant.

## Non-Code / Multimodal Retrieval

Initial document support already in place via extracted text for PDF, DOCX, DOC, and Excel. Future work: diagrams, JSON schemas, API specs, YAML configs.

## Prompt Templates

Allow users to customize how retrieved context is formatted and injected into LLM prompts. Currently uses a fixed pattern.

## Memory & Storage Optimization

Quantized embeddings to reduce storage, pruning stale entries, garbage collection on unused chunks.

## Persistent Session Memory

Retain coding patterns, project conventions, and past decisions across sessions. Inspired by [opencode-mem](https://github.com/tickernelz/opencode-mem): store structured memories in a local vector DB, auto-capture insights, inject relevant memories into future prompts.

## Multi-Workspace Awareness

Support indexing and searching across multiple repositories. Enable cross-project queries for monorepo setups or microservice architectures. Could use per-workspace vector shards with a unified query layer.

## Index Export / Import

Serialize the full index (vectors + metadata + keyword index) to a portable format. Enables: CI/CD pipelines that pre-index and ship the index, team sharing of a common index, and backup/restore across machines.

## Performance Benchmark Suite

Automated suite measuring: index time by repo size, query latency p50/p95/p99, memory/disk usage. Track regressions across releases. Essential before optimizing chunking or storage.

## Config Validation at Startup

Validate `opencode-rag.json` against a JSON schema on load. Surface clear, actionable error messages for invalid or missing fields instead of silent fallback to defaults.

## Per-Language Chunking Config

Allow per-extension overrides for `nodeTypes`, `chunkSize`, `overlap` in config. E.g., Python gets smaller AST nodes than Java; Go gets different function boundaries.

## Concurrent Chunking

Parallel file scanning and chunking for large repos. LanceDB already handles concurrent writes via promise guard; the bottleneck is sequential chunking in `runIndexPass`.

## Auto-Generated Codebase Summaries

LLM produces directory-level summaries from indexed chunks. Useful for onboarding, project overview retrieval ("what does the auth module do?"), and context injection.

## Chunk Quality Heuristics

Score chunks during indexing for size, coherence, and boundary quality. Flag poorly-chunked files for improvement. Could guide chunker selection or parameter tuning.
