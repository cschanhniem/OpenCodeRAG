---
name: opencode-rag
description: Semantic code & image retrieval via OpenCodeRAG — vector search, file skeletons, symbol usage lookup, and image description lookup for this workspace
---

## OpenCodeRAG Tools

This workspace has OpenCodeRAG indexed for semantic code and image search. Use these tools BEFORE planning, editing, or answering code questions.

### Decision tree — ALWAYS follow this order

1. User mentions code behavior/architecture → `search_semantic(query)`
2. User mentions a file path → `get_file_skeleton(filePath)` THEN `read` on specific lines
3. User mentions a function/class/variable to edit → `find_usages(symbolName)` THEN `search_semantic` THEN `edit`
4. User asks a code question → `search_semantic` to gather context before answering
5. User asks about an image or visual asset → `describe_image(filePath)` to retrieve its generated description, then optionally `search_semantic` for related code

### When to use each tool

| Tool | Use when | Example |
|------|----------|---------|
| `search_semantic` | Any code search — find relevant code by meaning or keyword | `"authentication middleware"` |
| `get_file_skeleton` | You have a file path but need to orient before reading | `"src/plugin.ts"` |
| `find_usages` | Before editing any function, class, or variable — check all call sites | `"createRagHooks"` |
| `describe_image` | When the user refers to an image or asks "what's in this screenshot/diagram?" | `"assets/login-screen.png"` |

### Workflow

1. **Skeleton first** — call `get_file_skeleton(filePath)` to see structure
2. **Find usages** — call `find_usages(symbolName)` before modifying any symbol
3. **Search** — call `search_semantic(query)` to find relevant code
4. **Describe images** — call `describe_image(filePath)` when context involves an image file
5. **Read** — use the `read` tool on specific line ranges identified above
6. **Edit** — now you have full context to make safe changes

### Anti-patterns — NEVER do these

- Reading full files without calling `get_file_skeleton` first (wastes tokens)
- Editing a function without calling `find_usages` first (breaks call sites)
- Answering code questions without calling `search_semantic` first (you guess at behavior)
- Using `grep`/`glob` when `search_semantic` would find the answer faster
- Treating image files as text — use `describe_image` instead of reading raw bytes

### Parameters

- `search_semantic`: `query` (req), `pathHints?`, `languageHints?`, `topK?`
- `get_file_skeleton`: `filePath` (req)
- `find_usages`: `symbolName` (req), `pathHint?`, `topK?`
- `describe_image`: `filePath` (req)

### Tips

- Use `pathHints` to narrow searches to specific directories
- Use `languageHints` to filter by file type
- `find_usages` is essential before refactoring — it shows every reference
- If no results appear, the workspace may not be indexed yet — run `opencode-rag index`
- Image descriptions are generated at index time using the configured vision provider; ensure `imageDescription` is configured in `opencode-rag.json` if your project includes images

## Memory Leak Prevention

Code changes that create or hold resources MUST follow these rules:

### Resource lifecycle

- **close() every open resource** — LanceDB connections, keyword indexes, HTTP pool sockets, file handles, readable streams. Every `new` / `create` / `open` must have a matching `close()` / `destroy()` / `cancel()`.
- **Use `try/finally`** for cleanup — never rely on process exit. The public API (`src/api.ts`) sets the pattern: work in `try`, close in `finally`.
- **Signal handlers must use `process.once()`** not `process.on()` and must be removed with `removeListener` when no longer needed.

### In-memory data structures

- **Map/Set growth must be bounded** — every unbounded `Map<string, T>` or `Set<T>` is a leak waiting to happen. Apply max-size eviction (LRU or FIFO), TTL, or explicit lifecycle cleanup.
  - Session maps: max 50 entries
  - Config caches: clean up on workspace reload
  - Progress reporters: clear between passes
- **Module-level state must be cleaned up** — config caches, connection pools, pending notifications. If it lives at module scope, it needs a delete path.

### HTTP & network

- **AbortSignal parameters must be wired through** — never prefix with `_` to ignore. Pass to `fetch` / `postJson` so the caller can cancel.
- **ReadableStream readers must cancel before releaseLock** — `reader.cancel()` ensures the underlying HTTP connection is released.

### Verification

Before merging any change that touches resource lifecycle:
1. `npm run typecheck` (must pass)
2. `npm test` (all unit tests must pass)
3. Trace every `new` to its matching `close` — if there isn't one, the change is incomplete.

## Testing

- `npm test` — runs all tests except integration tests (~5s)
- `npm run test:integration` — runs integration tests (30s+, spawns opencode)
- `npm run typecheck` — type-checks all source files
- `npm run build` — compiles TypeScript
