# 🛣️ Roadmap

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
- [ ] Memory / persistent context across sessions

## Long Term

- [ ] Evaluation framework (benchmark queries, precision@K, recall)
- [ ] Code execution-aware retrieval
- [ ] Semantic refactoring assistant
- [ ] Agent-based code navigation
- [ ] Richer non-code / multimodal support (diagrams, API specs, JSON schemas, YAML configs)
- [ ] Access control (per-folder permissions, sensitive file exclusion)
- [ ] MCP server — expose RAG tools via Model Context Protocol for any MCP client (VS Code, Cursor, etc.) without the OpenCode plugin
- [ ] Git-aware incremental indexing — index only files changed since last commit instead of full-file hash scan
- [ ] Index export/import — serialize the index for CI/CD, team sharing, or backup/restore
- [ ] Programmatic TypeScript API — export `search()`, `index()`, `getContext()` for embedding in scripts/tools
- [ ] Performance benchmark suite — measure index time, query latency, memory usage across repo sizes
- [ ] Config validation at startup — validate `opencode-rag.json` schema with clear error messages

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

## Evaluation Framework

Measure retrieval quality with benchmark queries, precision@K, and recall. Needed before tuning chunking strategies or embedding models.

## Access Control

Per-folder permissions and sensitive file exclusion for enterprise or multi-user environments.

## Persistent Query Cache

Persist query→results on disk (not just in-memory session cache) so repeated queries across restarts are instant.

## Non-Code / Multimodal Retrieval

Initial document support already in place via extracted text for PDF, DOCX, DOC, and Excel. Future work: diagrams, JSON schemas, API specs, YAML configs.

## Prompt Templates

Allow users to customize how retrieved context is formatted and injected into LLM prompts. Currently uses a fixed pattern.

## Debugging Tools

Inspect embeddings visually, show vector distances between results, explain why a particular chunk or file was retrieved.

## Memory & Storage Optimization

Quantized embeddings to reduce storage, pruning stale entries, garbage collection on unused chunks.

## Persistent Session Memory

Retain coding patterns, project conventions, and past decisions across sessions. Inspired by [opencode-mem](https://github.com/tickernelz/opencode-mem): store structured memories in a local vector DB, auto-capture insights, inject relevant memories into future prompts.

## Multi-Workspace Awareness

Support indexing and searching across multiple repositories. Enable cross-project queries for monorepo setups or microservice architectures. Could use per-workspace vector shards with a unified query layer.

## MCP Server

Expose OpenCodeRAG tools (`search_semantic`, `opencode-rag-context`, `get_file_skeleton`, `find_usages`) via the Model Context Protocol. Enables any MCP-compatible client (VS Code, Cursor, Claude Desktop, etc.) to use semantic code retrieval without the OpenCode plugin.

## Git-Aware Incremental Indexing

Instead of hashing every file on each index pass, detect changed files via `git diff --name-only` since the last indexed commit. Skips unchanged tracked files entirely — dramatically faster for large repos.

## Index Export / Import

Serialize the full index (vectors + metadata + keyword index) to a portable format. Enables: CI/CD pipelines that pre-index and ship the index, team sharing of a common index, and backup/restore across machines.

## Programmatic TypeScript API

Expose first-class library exports: `search(query, options)`, `indexWorkspace(path)`, `getContext(query, filePath)`. Lets users embed RAG into custom scripts, build tools, or CI pipelines without the CLI or plugin.

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

---

# 🎯 Summary

Local-first semantic code search with AST/document chunking, incremental/background indexing, pluggable embeddings + vector storage, hybrid search, CLI, OpenCode plugin (context tools, TUI, read-override), and Web UI.

**Key strengths:** privacy-first, modular architecture, workspace-native bootstrap, broad coverage, hybrid search, runtime overrides, auto API key resolution, manifest versioning, install/uninstall scripts.

**Next steps:** re-ranking, query rewriting, context optimization, code graph awareness, session memory, multi-workspace, MCP server, programmatic API, index export/import.
