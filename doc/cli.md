# CLI Reference

The CLI interface (`opencode-rag`) provides full access to build, manage, and search your project's vector database. It's primarily intended for testing, debugging, and scripting, but works independently of OpenCode.

## Global Options

| Flag | Description |
|---|---|
| `-c, --config <path>` | Path to config file |
| `-V, --version` | Show version number |
| `-h, --help` | Show help |

## Commands

### `init`

Configure the current workspace for OpenCodeRAG.

```bash
opencode-rag init [options]
```

**Options:**
| Flag | Default | Description |
|---|---|---|
| `-f, --force` | `false` | Overwrite existing files |
| `--skip-install` | `false` | Skip npm install step |
| `--skip-health-check` | `false` | Skip provider connectivity and model availability check |

**Creates:**
- `.opencode/` directory structure
- `.opencode/plugins/rag-plugin.js` — workspace-local plugin fallback
- `.opencode/plugins/rag-tui.js` — TUI plugin module
- `.opencode/opencode.json` — OpenCode workspace config
- `.opencode/tui.json` — TUI plugin settings
- `.opencode/package.json` — workspace dependencies
- `opencode-rag.json` — runtime configuration
- `.opencode/.gitignore` — ignores `node_modules/` and `rag_db/`
- Runs `npm install` to install workspace dependencies

**Health check:**
After writing config files, `init` validates provider connectivity and model availability for all configured models (embedding + description + image description if enabled). For Ollama, if models are missing, you're prompted to pull them automatically. Use `--skip-health-check` to bypass (e.g., for offline environments).

### `index`

Index workspace files into the vector database.

```bash
opencode-rag index [options]
```

**Options:**
| Flag | Default | Description |
|---|---|---|
| `-f, --force` | `false` | Force full rebuild (clears existing index) |
| `-w, --watch` | `false` | Watch for file changes and re-index automatically |
| `-c, --config <path>` | auto-detected | Path to config file |

**How it works:**
1. Scans workspace files matching `indexing.includeExtensions`
2. Compares file hashes against the manifest
3. Chunks changed/new files via the appropriate chunker
4. Generates descriptions (if enabled) and embeddings
5. Stores vectors in LanceDB and tokens in KeywordIndex
6. Serializes manifest and keyword index

**Incremental:** Only changed files are reprocessed. Unchanged files are skipped.

**Full rebuild (`--force`):** Clears the store, clears keyword index, and re-indexes everything.

**Watch mode (`--watch`):** Uses chokidar to monitor file changes. Re-indexes debounced changes automatically.

### `query`

Search the indexed codebase.

```bash
opencode-rag query <query> [options]
```

**Options:**
| Flag | Default | Description |
|---|---|---|
| `-n, --top-k <number>` | config default | Number of results |
| `-c, --config <path>` | auto-detected | Path to config file |

**Output:** Formatted results showing:
- File path (relative)
- Relevance score
- Language
- Line range
- Chunk description
- Content preview

### `status`

Show index statistics and health.

```bash
opencode-rag status [options]
```

**Options:**
| Flag | Default | Description |
|---|---|---|
| `-c, --config <path>` | auto-detected | Path to config file |

**Shows:**
- Total chunk count
- Store path
- Embedding provider and model
- Number of indexed extensions
- Manifest status (ok/missing/corrupt)
- Last indexed timestamp
- Up-to-date files vs. pending files
- Keyword index chunk count

### `list`

List all indexed files with chunk counts.

```bash
opencode-rag list [options]
```

**Options:**
| Flag | Default | Description |
|---|---|---|
| `-c, --config <path>` | auto-detected | Path to config file |

**Output:** Each indexed file with its chunk count, sorted by file path.

### `show`

Show all chunks for a specific file.

```bash
opencode-rag show <file> [options]
```

**Options:**
| Flag | Default | Description |
|---|---|---|
| `-c, --config <path>` | auto-detected | Path to config file |

**Output:** All chunks for the given file path, including:
- Chunk ID
- Line range
- Description
- Content preview

### `dump`

Dump all indexed chunks (paginated).

```bash
opencode-rag dump [options]
```

**Options:**
| Flag | Default | Description |
|---|---|---|
| `--offset <number>` | `0` | Starting offset |
| `--limit <number>` | `100` | Max chunks to dump |
| `-c, --config <path>` | auto-detected | Path to config file |

### `clear`

Clear all indexed data.

```bash
opencode-rag clear [options]
```

**Options:**
| Flag | Default | Description |
|---|---|---|
| `-c, --config <path>` | auto-detected | Path to config file |

Uses `store.dropDatabase()` for a clean slate, also clears the keyword index and manifest.

### `update`

Check for and install OpenCodeRAG updates from GitHub.

```bash
opencode-rag update [options]
```

**Options:**
| Flag | Default | Description |
|---|---|---|
| `--check` | `false` | Only check for updates, don't install |
| `-y, --yes` | `false` | Skip confirmation prompt |
| `-v, --verbose` | `false` | Show build/install output |

**How it works:**
1. Checks GitHub Releases API for the latest version
2. Compares against the current `package.json` version
3. If an update is available, prompts for confirmation (unless `--yes`)
4. Runs `git pull`, `npm run build`, `npm pack`, and `npm install` to apply the update
5. Preserves the vector index (`rag_db/`) across updates

**Examples:**
```bash
# Check for updates only
opencode-rag update --check

# Install update with confirmation
opencode-rag update

# Install update without confirmation
opencode-rag update --yes
```

## Examples

```bash
# Initialize a workspace
opencode-rag init

# Full index
opencode-rag index

# Incremental index with file watching
opencode-rag index --watch

# Force rebuild
opencode-rag index --force

# Semantic search
opencode-rag query "How is authentication handled?"

# Limit results
opencode-rag query "database connection pool" --top-k 5

# Show index status
opencode-rag status

# List indexed files
opencode-rag list

# Show chunks for a file
opencode-rag show src/auth.ts

# Dump first 50 chunks
opencode-rag dump --limit 50

# Clear all data
opencode-rag clear

# Use a custom config
opencode-rag index --config ./config/my-rag-config.json
```

## Evaluation Commands

### `eval:sessions`

List all logged evaluation sessions.

```bash
opencode-rag eval:sessions [options]
```

**Options:**
| Flag | Default | Description |
|---|---|---|
| `-c, --config <path>` | auto-detected | Path to config file |

**Output:** Table of sessions with ID, message count, input tokens, RAG context tokens, and cost.

### `eval:analyze <sessionID>`

Analyze token usage for a specific session with RAG impact projection.

```bash
opencode-rag eval:analyze <sessionID> [options]
```

**Options:**
| Flag | Default | Description |
|---|---|---|
| `-c, --config <path>` | auto-detected | Path to config file |

**Output sections:**
- Total input/output/reasoning tokens, cache stats, cost
- RAG impact: context injected, system guidance overhead, tool call counts
- Projection: estimated tokens with vs without RAG, net savings percentage
- Per-query breakdown: input tokens, RAG context, reads, RAG tools, top score

### `eval:compare <sessionA> <sessionB>`

Compare token usage between two sessions (e.g. RAG-on vs RAG-off).

```bash
opencode-rag eval:compare <sessionA> <sessionB> [options]
```

**Options:**
| Flag | Default | Description |
|---|---|---|
| `-c, --config <path>` | auto-detected | Path to config file |

**Output:** Formatted comparison table with delta and percentage change for each metric.

See [Evaluation documentation](evaluation.md) for interpretation and configuration guidance.

## Programmatic Use

The CLI can also be invoked programmatically:

```typescript
import { runCli } from "opencode-rag-plugin/library";

await runCli(["query", "auth middleware", "--top-k", "5"]);
```
