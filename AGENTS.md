# AGENTS.md — OpenCodeRAG

## Project status

MVP implemented. All core modules are built and tested:
- Chunking (17 AST languages + 4 regex-based + 1 PDF text + fallback)
- Embedding (Ollama + OpenAI)
- Vector storage (LanceDB)
- Retrieval pipeline
- CLI (index, query, clear, status)
- OpenCode plugin (chat.message hook + background auto-indexing)
- Test suite (354 tests, 0 failures)

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
  vectorstore/
    lancedb.ts        — LanceDBStore with memory:// support for tests
  retriever/
    retriever.ts      — retrieve(query, embedder, store, options)
  types/
    opencode-plugin.d.ts  — local type declaration for @opencode-ai/plugin
  indexer.ts          — runIndexPass, scanWorkspace, createWatchPassScheduler, createWatchIgnore
  watcher.ts          — createBackgroundIndexer (chokidar + debounced scheduler + periodic timer)
  cli.ts              — commander: index, query, clear, status
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

### Plugin architecture — chat.message file suggestions
- The plugin registers an `opencode-rag-context` tool (for chunk-level retrieval) and a `chat.message` hook.
- On each user message, the `chat.message` hook runs retrieval and appends a compact file suggestion list to `output.parts[0].text`.
- `formatFileList()` in `src/plugin.ts` groups results by file path, sorts by best score, and formats as `path (lang, lines N-M)` — max 10 files, no scores or snippets.
- Paths in file suggestions are made relative via `path.relative(worktree, ...)`.
- `extractUserMessageText()` attempts to find user message text from `output.message` (via parts/text) then falls back to `output.message.content`.
- The old read override (`src/opencode/`, 5 modules) and `tool.execute.after` hooks (glob/grep/list) have been removed in favor of this single chat.message hook.
- `overrideRead` config option kept for backward compatibility, defaults to `false`.

### Plugins and module structure
- `createRagHooks` now accepts optional pre-created `store` and `embedder` instances via `CreateRagHooksOptions`, allowing the plugin to create them with a probed vector dimension before passing them in.
- The plugin probes the embedding dimension by sending a single `"dimension-probe"` request at startup; falls back to **384** if the probe fails.

### Global plugin installation — install scripts
- `install.ps1` / `install.sh` install the plugin globally by: (1) `npm run build` + `npm pack`, (2) `npm install --prefix ~/.opencode/` and `--prefix ~/.config/opencode/`, (3) adding `"opencode-rag-plugin"` to `~/.config/opencode/opencode.jsonc` plugin array.
- **NEVER call `opencode plugin <name> --global` in an install script** — it downloads the npm-published version, which can differ from the locally built version. If the npm version is stale, OpenCode loads the wrong code. The `opencode.jsonc` registration alone is sufficient for plugin discovery.
- Do NOT mix manual npm-pack installation with `opencode plugin` CLI registration; choose one. Our scripts use the manual path (build from source) because the npm version may lag behind.
- To uninstall, run `install.ps1 uninstall` or `install.sh uninstall`, which removes all global copies from `~/.local/bin/`, `~/.config/opencode/node_modules/`, `~/.opencode/node_modules/`, and cleans up `.tgz` files and config entries.

### `opencode-rag init` — workspace-local plugin fallback
- `opencode-rag init` always creates `.opencode/plugins/rag-plugin.js` as a workspace-local fallback, even when global registration exists. This file re-exports from `node_modules/` and gives OpenCode a reliable local entry point.
- The install scripts clean up old `.opencode/plugins/` directories from a previous era, but the init command must recreate the local plugin file for workspaces that haven't run the global install.
- Never remove the workspace-local plugin creation from `cli.ts`; it is the safety net when global plugin loading fails.

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
