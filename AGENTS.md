# AGENTS.md — OpenCodeRAG

## Project status

MVP implemented. All core modules are built and tested:
- Chunking (17 AST languages + 4 regex-based + 1 PDF text + 3 document text + fallback)
- Embedding (Ollama + OpenAI)
- Vector storage (LanceDB)
- Retrieval pipeline (vector + hybrid keyword/vector)
- CLI (index, query, clear, status, list, show, dump)
- OpenCode plugin (chat.message hook + auto-context injection + background auto-indexing + read-override)
- TUI settings menu (model selection for embedding/description providers)
- Runtime overrides system (`runtime-overrides.json`) for live config changes
- API key auto-resolution from OpenCode provider config
- Manifest schema versioning with corruption detection
- Test suite (589 tests, 1 integration test requiring opencode binary)

Design docs: `ReadMe.md` (project overview), `doc/` (detailed documentation),
`PLANNING.md` (roadmap + brainstorming).

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
    typescript.ts     — ...
    python.ts         — ...
    java.ts           — ...
    go.ts             — ...
    markdown.ts       — regex heading-splitter, code-block aware
    tex.ts            — regex section-splitter (chapter/section/subsection), comment-aware
    pdf.ts            — paragraph-based, groups small paragraphs, splits oversized
    fallback.ts       — line-based 100-line chunks
    factory.ts        — getChunker(filePath) by extension, chunkFile()
    uuid.ts           — simple UUID v4 generator
  embedder/
    ollama.ts         — POST /embed, one text per request
    openai.ts         — POST /embed, batched input with auth header
    factory.ts        — createEmbedder(config), embedBatch()
  describer/
    describer.ts      — LLMDescriptionProvider: LLM-based chunk description generation
    factory.ts        — createDescriptionProvider(config)
  vectorstore/
    lancedb.ts        — LanceDBStore with memory:// support, listFiles, getChunksByFilePath, getChunks
  retriever/
    retriever.ts      — retrieve(query, embedder, store, options)
    keyword-index.ts  — KeywordIndex (inverted index, TF×IDF scoring, serialization)
  types/
    opencode-plugin.d.ts  — local type declaration for @opencode-ai/plugin
  indexer.ts          — runIndexPass, scanWorkspace, createWatchPassScheduler, createWatchIgnore
  watcher.ts          — createBackgroundIndexer (chokidar + debounced scheduler + periodic timer)
  cli.ts              — commander: index, query, clear, status, list, show, dump
  plugin.ts           — ragPlugin: context tool + chat.message hook + background auto-indexing
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
- **Factory pattern** — `getChunker()`, `createEmbedder()`, and `createDescriptionProvider()` for dispatch
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

### Embedding model quality and recommendations
Benchmarks on code retrieval (CodeSearchNet) show model choice dramatically
affects quality — the gap between best and worst models can be 8×:

| Model | Type | Dims | MRR | R@1 | Cost |
|---|---|---|---|---|---|
| OpenAI text-embedding-3-small | general | 1536 | 95.0% | 91% | $0.02/1M |
| Cohere v3 | general | 1024 | 92.8% | 87% | $0.10/1M |
| MiniLM-L6 | general | 384 | 80.1% | 69% | Free |
| GraphCodeBERT | code-specific | 768 | 50.9% | 39% | Free |
| CodeBERT | code-specific | 768 | 11.7% | 6.5% | Free |

Recommended embedding models for Ollama (ranked):
1. `bge-m3` (1024d) — multilingual, top-tier quality
2. `mxbai-embed-large` (1024d) — high quality for English
3. `nomic-embed-code` (768d) — code-specific, better than general `nomic-embed-text`
   for code retrieval; supports `search_query:` / `search_document:` prefixes
4. `nomic-embed-text` (768d) — good all-purpose, same prefix support
5. `all-minilm:l6-v2` (384d) — fast, lightweight, ~80% of best quality

Avoid old/small BERT-based models — the article shows CodeBERT (12% MRR)
and GraphCodeBERT (51% MRR) perform far worse than any general-purpose
alternative.

Query vs document differentiation:
- **Text prefixing** (`documentPrefix`/`queryPrefix` in config): prepends a
  model-specific token like `search_document:` or `search_query:` to the text
  before embedding. Works with any provider.
- **`input_type` parameter** (OpenAI only): OpenAI's `text-embedding-3` accepts
  `input_type: "query"` or `"document"` in the API request body, adjusting
  model behavior internally. Both approaches are used together when using
  OpenAI — prefix adjusts the text, `input_type` adjusts the model.

### Background auto-indexing
- `createBackgroundIndexer()` in `src/watcher.ts` manages a chokidar file watcher, a debounced reindex scheduler, and a periodic safety-net timer.
- The watcher uses `createWatchIgnore()` (exported from `src/indexer.ts`) to exclude the vector store path, manifest file, and configured `excludeDirs`.
- The plugin (`src/plugin.ts`) spawns one background indexer per workspace directory using a `Map<string, BackgroundIndexer>` for cleanup on reload.
- `autoIndex` config (`openCode.autoIndex`) controls `enabled`, `debounceMs` (default 5000), and `intervalMs` (default 300000).
- `minFileSizeBytes` in `indexing` (default 1024) skips tiny files during indexing; files below the threshold are also removed from the store if previously indexed.

### Plugin architecture — chat.message auto-injection
- The plugin registers an `opencode-rag-context` tool (for chunk-level retrieval) and a `chat.message` hook.
- On each user message, the `chat.message` hook runs retrieval. If high-confidence results exist (score ≥ `autoInject.minScore`, default 0.75), it **auto-injects the actual code chunks** via `formatAutoInjectContext()` in `src/plugin.ts`, saving a tool-call round-trip. If scores are below threshold, it falls back to a file suggestion list via `formatFileList()`.
- `formatAutoInjectContext()` respects `maxChunks` (default 3) and `maxTokens` (default 2000, estimated at ~4 chars/token) budgets. Low-scoring chunks are evicted first to fit the budget.
- `formatFileList()` groups results by file path, sorts by best score, and formats as `path (lang, lines N-M)` — max 10 files, no scores or snippets.
- Paths in file suggestions and auto-injected context are made relative via `path.relative(worktree, ...)`.
- `extractUserMessageText()` attempts to find user message text from `output.message` (via parts/text) then falls back to `output.message.content`.
- When `openCode.readOverride` is `true`, the plugin registers a `read` tool backed by `createRagReadTool()` that shadows OpenCode's built-in read. The tool **always returns full file contents** from disk. When RAG chunks are available for the file (score ≥ threshold), they are appended as supplementary "Related code chunks" after the file content. If retrieval fails, the file is still returned without RAG context.
- `overrideRead` config option renamed to `readOverride`, defaults to `false`.
- `readNoResultsBehavior` config option is no longer used by the read tool (the fallback always reads the file), but is retained for backward compatibility.

### Plugins and module structure
- `createRagHooks` now accepts optional pre-created `store` and `embedder` instances via `CreateRagHooksOptions`, allowing the plugin to create them with a probed vector dimension before passing them in.
- The plugin probes the embedding dimension by sending a single `"dimension-probe"` request at startup; falls back to **384** if the probe fails.

### Hybrid search (keyword + vector)
- `KeywordIndex` in `src/retriever/keyword-index.ts` implements a zero-dependency token-based inverted index.
- Tokenizer in `tokenize()` handles CamelCase, snake_case, and special chars from source code.
- TF×IDF scoring: term frequency within a chunk × logarithm of inverse document frequency.
- `retrieve()` in `retriever.ts` runs both vector and keyword search, then merges via weighted fusion: `score = (1 - kw) * vScore + kw * kScore`, where keyword scores are normalized by the top keyword result.
- During indexing, `runIndexPass()` in `indexer.ts` maintains the keyword index alongside the vector store (add/remove/save/clear).
- The keyword index is serialized to `${storePath}/keyword-index.json` alongside `manifest.json`.
- The old `src/opencode/read-fallback.ts` and `src/opencode/create-read-tool.ts` now also pass `keywordIndex` through to all `retrieve()` calls.

### Global plugin installation — install scripts
- `install.ps1` / `install.sh` install the plugin globally by: (1) `npm run build` + `npm pack`, (2) `npm install --prefix ~/.opencode/` and `--prefix ~/.config/opencode/`, (3) adding `"opencode-rag-plugin"` to `~/.config/opencode/opencode.jsonc` plugin array.
- **NEVER call `opencode plugin <name> --global` in an install script** — it downloads the npm-published version, which can differ from the locally built version. If the npm version is stale, OpenCode loads the wrong code. The `opencode.jsonc` registration alone is sufficient for plugin discovery.
- Do NOT mix manual npm-pack installation with `opencode plugin` CLI registration; choose one. Our scripts use the manual path (build from source) because the npm version may lag behind.
- To uninstall, run `install.ps1 uninstall` or `install.sh uninstall`, which removes all global copies from `~/.local/bin/`, `~/.config/opencode/node_modules/`, `~/.opencode/node_modules/`, and cleans up `.tgz` files and config entries.

### `opencode-rag init` — workspace-local plugin fallback
- `opencode-rag init` always creates `.opencode/plugins/rag-plugin.js` as a workspace-local fallback, even when global registration exists. This file re-exports from `node_modules/` and gives OpenCode a reliable local entry point.
- The install scripts clean up old `.opencode/plugins/` directories from a previous era, but the init command must recreate the local plugin file for workspaces that haven't run the global install.
- Never remove the workspace-local plugin creation from `cli.ts`; it is the safety net when global plugin loading fails.

### "Plugin export is not a function" error (OpenCode v1.17.0)

This error occurs when OpenCode tries to load the plugin via the `"plugin"` key in
the OpenCode config (`~/.config/opencode/opencode.jsonc` or `.opencode/opencode.json`).
It is caused by module resolution differences in Bun's runtime vs Node.js.

**Fix**: Do NOT register the plugin via `"plugin": ["opencode-rag-plugin"]` in
OpenCode config. Instead, rely on `.opencode/plugins/*.js` auto-discovery:

1. Run `npx opencode-rag init` to create `.opencode/plugins/rag-plugin.js`
2. The generated file should use `import` + `export default` (not `export { default } from`):
   ```js
   import plugin from "../node_modules/opencode-rag-plugin/dist/plugin-entry.js";
   export const id = plugin.id;
   export const server = plugin.server;
   export default plugin;
   ```
3. The TUI plugin file (`.opencode/plugins/rag-tui.js`) must default-export an
   object with `server()` — OpenCode v1.17.0 no longer supports `tui`-only plugins:
   ```js
   const plugin = {
     id: "opencode-rag-plugin:tui",
     server: async () => ({}),
   };
   export default plugin;
   ```
4. Remove stale `"plugin"` entries from all OpenCode config files — they trigger
   npm resolution which fails and produces the error.

### Plugin export debugging
- If OpenCode reports "Plugin export is not a function", verify with BOTH dynamic import and require before assuming it is an OpenCode loader bug:
  ```bash
  node --input-type=module -e "const m = await import('opencode-rag-plugin'); console.log(typeof m.default, typeof m.server)"
  node -e "const m = require('opencode-rag-plugin'); console.log(typeof m.default, typeof m.server)"
  ```
- The plugin was never broken — the npm version was stale. The `opencode plugin --global` call in install scripts was the real cause: it downloaded an old version from npm, while the local build was v1.2.0.

### PluginModule export pattern
- OpenCode uses `readV1Plugin()` which expects `module.default` to be an **object**
  `{ id, server }`, not a bare function. The function is accessed as `default.server`.
- Named exports (`export const server`, `export const id`) are kept for backward
  compatibility but are not used by the V1 loader.
- The type is:
  ```typescript
  type PluginModule = { id?: string; server: Plugin; tui?: never };
  ```
- Use the direct object export form:
  ```typescript
  import { ragPlugin } from "./plugin.js";
  export const server = ragPlugin;
  export const id = "opencode-rag-plugin";
  export default { id: "opencode-rag-plugin", server: ragPlugin };
  ```
- The `default` export MUST be an object, not a bare function. If `default` is
  not a record, `readV1Plugin` returns `undefined` and OpenCode falls through to
  `getLegacyPlugins` in `packages/opencode/src/plugin/index.ts`, which iterates
  ALL exports and throws "Plugin export is not a function" for any non-function,
  non-object value (like the string `id`).
- Re-export syntax (`export { X as default } from ...`) produces the same result
  but is harder to inspect with DevTools or stack traces.

### Runtime overrides (`runtime-overrides.json`)
- The TUI settings menu writes to `${storePath}/runtime-overrides.json`. The plugin and `createRagHooks()` periodically reload these overrides (TTL: 5s) via `loadRuntimeOverrides()` + `applyRuntimeOverrides()`.
- Override values take precedence over `opencode-rag.json` config values. Supported overrides: retrieval settings (`topK`, `minScore`, `maxChunks`), description settings (`enabled`, `provider`, `model`, `baseUrl`), and embedding settings (`provider`, `model`, `baseUrl`).
- `saveRuntimeOverride()` in `src/core/runtime-overrides.ts` supports `boolean`, `number`, and `string` values.
- The TUI prompt for numeric settings (`maxChunks`) and boolean toggles all persist to both `runtime-overrides.json` AND `opencode-rag.json` for consistency.

### TUI Settings Menu
- The TUI plugin (`src/tui.ts`) registers a settings panel accessed from the OpenCode sidebar.
- Categories: Retrieval, Embedding, LLM Descriptions.
- Embedding and Description settings include a **model picker** dropdown populated from OpenCode's registered providers (reads `api.state.provider`). Models are grouped by provider name, sorted alphabetically, with a "Custom…" option for manual entry.
- Selecting a model auto-sets the corresponding provider (`ollama`/`openai`) and base URL (derived from the OpenCode provider config).
- The TUI also provides a prompt-based editor for string/number settings and toggle switches for booleans.

### Manifest schema versioning
- `src/core/manifest.ts` now includes `SCHEMA_VERSION = 1` and a `schemaVersion` field in `FileManifest`.
- `loadManifest()` checks `parsed.schemaVersion === SCHEMA_VERSION`. If the version doesn't match, it returns `status: "corrupt"`, triggering a full index rebuild.
- `createEmptyManifest()` and `saveManifest()` always set `schemaVersion = SCHEMA_VERSION`.
- This prevents data corruption issues when the manifest format changes between versions.

### API key resolution from OpenCode provider config
- `resolveApiKeyFromProviderConfig()` in `src/plugin.ts` reads OpenCode config files (`.opencode/opencode.json`, `opencode.json`, `~/.config/opencode/opencode.jsonc`) to find an `apiKey` for the `openai` provider.
- If the embedding or description provider is `"openai"` but no `apiKey` is set in `opencode-rag.json`, the plugin auto-resolves it from the OpenCode config.
- Config files may contain JSONC comments — they are stripped before parsing.

## Adding a New Language Chunker

1. Create `src/chunker/<lang>.ts` extending `TreeSitterChunker`
2. Set `language`, `fileExtensions`, `grammarName`, `nodeTypes`
3. Add the new chunker instance to the `chunkers` array in `factory.ts`
4. Verify the grammar exists in `tree-sitter-wasm` (see
   `node_modules/tree-sitter-wasm/README.md` for supported names)
5. Add extension to defaults in `DEFAULT_CONFIG.indexing.includeExtensions`

## Adding a Non-Code Chunker (e.g. PDF)

For binary or document formats:

1. Create `src/chunker/<lang>.ts` implementing `Chunker` directly (not `TreeSitterChunker`)
2. If binary, add text extraction in the chunker using dynamic imports to avoid
   startup overhead (see `pdf.ts` for the DOMMatrix polyfill + pdfjs-dist pattern)
3. Register in `factory.ts` and add extension to `DEFAULT_CONFIG.indexing.includeExtensions`
4. For binary files, update `scanWorkspace` in `indexer.ts` to read as `Buffer`
   and extract text before passing to `chunkFile()`

## Adding a New Embedding Provider

1. Create `src/embedder/<name>.ts` implementing `EmbeddingProvider`
2. Add provider dispatch in `createEmbedder()` in `factory.ts`
3. Update `RagConfig.embedding.provider` union type in `config.ts`

## Description-Based Embedding

Description-based embedding is **enabled by default**. The indexer calls an LLM
to generate a natural-language description of each code chunk before embedding.
The description is combined with the chunk's raw code for embedding, capturing
both semantic meaning and code-level similarity.

**Pipeline:** `Chunk.content` → LLM → `Chunk.description` → embedder `(description + "\n\n" + content)` → vector store

**Key behavior:**
- Keyword search still uses `chunk.content` (raw code) for TF-IDF
- Vector search uses the embedding of `description + "\n\n" + content`
- Both `content` and `description` are stored separately in LanceDB
- On LLM failure, falls back to embedding raw content and logs a warning
- Set `description.enabled: false` in config to disable and embed raw code instead
- Config is in `src/core/config.ts` (`DescriptionConfig`), provider in `src/describer/`
- Chunk descriptions now include relative path and line ranges (e.g. `src/foo.ts, lines 10-42`) even when LLM description is disabled, improving context

## OpenCodeRAG Plugin

This workspace has OpenCodeRAG installed for semantic code retrieval.

### `opencode-rag-context` tool
Before planning, editing, or answering, use this tool to retrieve relevant code
chunks with file paths, line ranges, and surrounding implementation.
- `query` (required) — narrow, specific search, e.g. `"authentication middleware setup"`
- `pathHints` (optional) — up to 10 path filters, e.g. `["src/auth/"]`
- `languageHints` (optional) — up to 10 language filters, e.g. `["typescript"]`
- `topK` (optional) — result count (1-25, default 10)

### `search_semantic` tool
Search indexed code by meaning, not keywords. Use for conceptual questions like
"How does authentication work?" or "Where is the chunking logic?".
- `query` (required) — natural language description of what you're looking for
- `pathHints` (optional) — up to 10 path filters
- `languageHints` (optional) — up to 10 language filters
- `topK` (optional) — result count (1-25, default 10)

### `get_file_skeleton` tool
Get a quick structural overview of a file without reading the full contents.
Returns functions, classes, interfaces, and other declarations with line numbers.
Uses tree-sitter for parsing (supports TypeScript, JavaScript, Python, Java, Go,
Rust, C/C++, C#, Ruby, Swift, Kotlin, CSS, Markdown, and more).
- `filePath` (required) — path to the file (relative to workspace root or absolute)

### `find_usages` tool
**Essential before editing a function or type.** Find every line in the
indexed codebase that references a given symbol, with 2 lines of surrounding
context. Uses the keyword index for precise matching and vector search for
broader discovery. Detects and excludes the symbol's own definition.
- `symbolName` (required) — the symbol to search for (function, variable, class, etc.)
- `pathHint` (optional) — narrow search to a specific directory
- `topK` (optional) — max results (1-50, default 30)

### Auto-injected context
When retrieval confidence is high (score ≥ 0.75), the relevant code chunks are
injected directly into the message. Look for blocks starting with
`**Auto-retrieved code context**`. When confidence is low, a compact file list
is shown instead — lines like `src/file.ts (typescript, lines 10-42)`.

### Indexing
- The plugin auto-indexes changed files in the background (debounced 5s)
- If no results come back, the workspace may not be indexed yet —
  run `opencode-rag index` from the terminal (or `npx opencode-rag-plugin`)
- Tiny files (under 1 KB), excluded extensions, and excluded directories
  (`node_modules`, `.git`, `.opencode`, `dist`, etc.) are silently skipped
