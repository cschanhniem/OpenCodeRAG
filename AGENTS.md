# AGENTS.md — OpenCodeRAG

## Project status

MVP implemented. All core modules are built and tested:
- Chunking (5 languages + fallback)
- Embedding (Ollama + OpenAI)
- Vector storage (LanceDB)
- Retrieval pipeline
- CLI (index, query, clear, status)
- OpenCode plugin (chat.message hook + background auto-indexing)
- Test suite (342 tests, 0 failures)

Design docs: `ReadMe.md` (project docs), `PLANNING.md` (roadmap + brainstorming),
`docs/designs/2026-05-28-rag-plugin-mvp-design.md` (architecture design).

## Tech Stack

| Layer         | Choice                                           |
| ------------- | ------------------------------------------------ |
| Runtime       | Node.js v22.14 + tsx (ESM, `"type": "module"`)   |
| Language      | TypeScript 5.8                                   |
| Package mgr   | npm                                              |
| Chunking      | web-tree-sitter (WASM, v0.26.9)                  |
| Grammars      | tree-sitter-wasm (v1.0.2, pre-built WASM files)  |
| Vector DB     | @lancedb/lancedb (v0.29.0)                       |
| Arrow types   | apache-arrow (peer dep for LanceDB)              |
| CLI framework | commander (v13.1.0)                               |
| Test runner   | Node.js built-in (`node:test`) with tsx import    |
| Plugin types  | local `.d.ts` in `src/types/` (module in .opencode) |

## Module Structure

```
src/
  core/
    interfaces.ts     — Chunk, SearchResult, Chunker, EmbeddingProvider, VectorStore
    config.ts         — RagConfig, DEFAULT_CONFIG, loadConfig() with deep merge
  chunker/
    grammar.ts        — tree-sitter init, language loader, walkTree()
    base.ts           — TreeSitterChunker abstract class
    typescript.ts     — nodeTypes: function_declaration, method_definition, class_declaration, ...
    python.ts         — nodeTypes: function_definition, class_definition, decorated_definition
    java.ts           — nodeTypes: method_declaration, class_declaration, interface_declaration, ...
    go.ts             — nodeTypes: function_declaration, method_declaration, type_declaration
    markdown.ts       — regex heading-splitter, code-block aware
    fallback.ts       — line-based 100-line chunks
    factory.ts        — getChunker(filePath) by extension, chunkFile()
    uuid.ts           — simple UUID v4 generator
  embedder/
    ollama.ts         — POST /embed, one text per request
    openai.ts         — POST /embed, batched input with auth header
    factory.ts        — createEmbedder(config), embedBatch()
  vectorstore/
    lancedb.ts        — LanceDBStore with memory:// support for tests
  retriever/
    retriever.ts      — retrieve(query, embedder, store, options)
  types/
    opencode-plugin.d.ts  — local type declaration for @opencode-ai/plugin
  indexer.ts          — runIndexPass, scanWorkspace, createWatchPassScheduler, createWatchIgnore
  watcher.ts          — createBackgroundIndexer (chokidar watcher + debounced scheduler + periodic timer)
  cli.ts              — commander: index, query, clear, status
  plugin.ts           — ragPlugin: chat.message hook + background auto-indexing
  index.ts            — public API re-exports + plugin default export
  __tests__/          — mirrors module structure
```

## Commands

```bash
npm test              # node --import tsx --test --test-force-exit "src/**/*.test.ts"
npm run typecheck     # tsc --noEmit
npm run cli           # tsx src/cli.ts
```

## Conventions

- **ESM only** — all imports use `.js` extensions and `node:` prefixes
- **Interfaces over classes** — module boundaries defined by interfaces in
  `core/interfaces.ts`; concrete implementations implement them
- **Factory pattern** — `getChunker()` and `createEmbedder()` for dispatch
- **Adapter pattern** — `LanceDBStore` implements `VectorStore`; provider classes
  implement `EmbeddingProvider`
- **Error resilience** — plugin and CLI catch errors silently where appropriate;
  type errors are surfaced via TypeScript
- **No build step** — tsx handles TypeScript at runtime; `tsc --noEmit` for type
  checking only
- **Node test runner** — no Jest, Mocha, or Vitest. `node:test` with `tsx` import
  hook
- **UUID generation** — internal `uuid()` in `chunker/uuid.ts` (no dependency)

## Gotchas & Lessons Learned

### npm install
- Use `--legacy-peer-deps` — LanceDB and other deps have peer dependency
  conflicts
- Corporate SSL issues: `set NODE_TLS_REJECT_UNAUTHORIZED=0` before `npm install`

### LanceDB type casts
LanceDB's TS API expects `Record<string, unknown>[]` for data inputs but typed
interfaces with known keys don't match. Cast through `unknown`:
```ts
await table.add(rows as unknown as Record<string, unknown>[]);
await db.createTable({ data: [seed] as unknown as Record<string, unknown>[] });
```

### LanceDB peer dependency
`@lancedb/lancedb` requires `apache-arrow` at runtime. Install it explicitly if
auto-install fails.

### tree-sitter WASM
- Native tree-sitter requires C++ build tools → unavailable on Win without
  Visual Studio
- Switched to `web-tree-sitter` (runs as WASM, no native compilation)
- `tree-sitter-wasm` package provides pre-built `.wasm` grammar files via
  `getWasmPath()`
- web-tree-sitter uses `Node` type (not `SyntaxNode`), `Parser` is a class
  (not `new Parser()`), `Language` is top-level class

### OpenCode plugin types
`@opencode-ai/plugin` lives in `.opencode/node_modules/` — not installed via
npm. Declare types locally in `src/types/opencode-plugin.d.ts` rather than
adding a dependency.

### Test runner
- Pattern: `"src/**/*.test.ts"` (quoted in package.json)
- Individual file: `node --import tsx --test src/__tests__/chunker/fallback.test.ts`
- LanceDB tests use `memory://` URI — data discarded after test
- LanceDB tests need native binary support (works on Win/Linux/Mac x64+arm)
- `--test-force-exit` is required because chokidar and LanceDB leave open handles; without it the test suite hangs after completion

### Config loading
- `loadConfig()` deep-merges per section (not recursive)
- CLI auto-detects `./opencode-rag.json` and `./.opencode/rag.json`
- Default config is the fallback when no file found

### Corporate proxy / proxy configuration
When behind a corporate proxy:

1. **Set `HTTP_PROXY` / `HTTPS_PROXY` env vars** (standard approach) — Node.js `fetch()` routes external requests through the proxy automatically. Localhost (`127.0.0.1`, `localhost`, `::1`) is always bypassed.

2. **Explicit proxy in config** — Add an `embedding.proxy` section to `opencode-rag.json`:
   ```json
   {
     "embedding": {
       "proxy": {
         "url": "http://proxy.krz.uni-heidelberg.de:8080",
         "username": "your-username",
         "password": "your-password",
         "noProxy": "localhost,127.0.0.1,.local,.internal"
       }
     }
   }
   ```
   - `url` is the proxy URL
   - `username`/`password` are sent as `Proxy-Authorization: Basic` header
   - `noProxy` is a comma-separated list of hosts to bypass (localhost always bypassed)

3. **OpenCode plugin localhost bypass** — When running inside OpenCode, the runtime can interfere with the normal Node HTTP stack and cause localhost Ollama calls to be redirected or proxied unexpectedly. `directRequest()` in `http.ts` now uses raw `net`/`tls` sockets for direct requests so localhost traffic bypasses the patched HTTP stack entirely.

4. **Proxy auth encoding** — Basic auth is computed in `buildProxyAuthHeader()` in `http.ts`. The `username` and `password` fields are Base64-encoded and sent as the `Proxy-Authorization` header on `fetch()` calls.

5. **Env var override behavior** — If both `HTTP_PROXY` env vars and config `proxy.url` are set, env vars take precedence. If only one is set, it's used. Neither is required.

### Ollama response quirks
- Ollama may return either `{ embedding: number[] }` or `{ embeddings: number[][] }`; accept both shapes.
- `embedding.timeoutMs` defaults to 30000 ms. The previous 5000 ms default was too short for cold starts and caused indexing failures.
- If OpenCode starts returning no context, check whether the embedding call is still reaching the raw socket path before assuming retrieval is empty.

### Background auto-indexing
- `createBackgroundIndexer()` in `src/watcher.ts` manages a chokidar file watcher, a debounced reindex scheduler, and a periodic safety-net timer.
- The watcher uses `createWatchIgnore()` (exported from `src/indexer.ts`) to exclude the vector store path, manifest file, and configured `excludeDirs`.
- The plugin (`src/plugin.ts`) spawns one background indexer per workspace directory using a `Map<string, BackgroundIndexer>` for cleanup on reload.
- `autoIndex` config (`openCode.autoIndex`) controls `enabled`, `debounceMs` (default 5000), and `intervalMs` (default 300000).
- `minFileSizeBytes` in `indexing` (default 1024) skips tiny files during indexing; files below the threshold are also removed from the store if previously indexed.

### Plugins and module structure
- `createRagHooks` now accepts optional pre-created `store` and `embedder` instances via `CreateRagHooksOptions`, allowing the plugin to create them with a probed vector dimension before passing them in.
- The plugin probes the embedding dimension by sending a single `"dimension-probe"` request at startup; falls back to **384** if the probe fails.

## Adding a New Language Chunker

1. Create `src/chunker/<lang>.ts` extending `TreeSitterChunker`
2. Set `language`, `fileExtensions`, `grammarName`, `nodeTypes`
3. Add the new chunker instance to the `chunkers` array in `factory.ts`
4. Verify the grammar exists in `tree-sitter-wasm` (see
   `node_modules/tree-sitter-wasm/README.md` for supported names)
5. Add extension to defaults in `DEFAULT_CONFIG.indexing.includeExtensions`

## Adding a New Embedding Provider

1. Create `src/embedder/<name>.ts` implementing `EmbeddingProvider`
2. Add provider dispatch in `createEmbedder()` in `factory.ts`
3. Update `RagConfig.embedding.provider` union type in `config.ts`
