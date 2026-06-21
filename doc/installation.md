# Installation

## Prerequisites

- **Node.js v22+** (required for native ESM and global `fetch`)
- **Ollama** (default) running locally, OR an OpenAI-compatible API endpoint
- **OpenCode** (optional) for agent plugin features

## Ollama Setup

If you don't have Ollama installed, download it from [ollama.com](https://ollama.com) and start the service. Then pull the required model:

```bash
# Small embedding model (required for vector search)
ollama pull qwen3-embedding:0.6b

# Small description model (optional, for LLM-generated chunk descriptions)
ollama pull qwen2.5:3b

# Small vision model (optional, for describing images)
ollama pull minicpm-v4.6
```

OpenCodeRAG uses three models:
- **Embedding model** - converts code chunks into vectors for semantic search. Configured via `embedding.model` (default: `qwen3-embedding:0.6b`).
- **Description model** - generates natural-language descriptions of code chunks before embedding. Configured via `description.model` (default: `qwen2.5:3b`).
- **Vision model** - generates natural-language descriptions of images before embedding. Configured via `imageDescription.model` (default: `minicpm-v4.6`).

> **Tip:** Smaller embedding models (≤3B) work well on CPU. For better search results, use a larger embedding model like `qwen3-embedding:1.7b` and activate description and image descripion model usage in OpenCodeRAG config (dedicated GPU recommended).

## Install

```bash
# Clone the repository
git clone https://github.com/your-org/OpenCodeRAG.git
cd OpenCodeRAG

# Install dependencies
npm install --legacy-peer-deps

# Install RAG tools globally
./install.sh          # Linux/macOS
.\install.ps1         # Windows
```

> **Important:** The install scripts build from source (npm pack). They never call `opencode plugin <name> --global`, which could download a potentially stale npm-published version. If you don't use the install script, the opencode-rag CLI and web tools would be missing.

### Uninstall

```bash
./install.sh uninstall (Linux)
.\install.ps1 uninstall (Windows)
```

This removes all copies and config entries of OpenCodeRAG.

## Workspace Initialization

After installation, initialize any project you want to use with OpenCodeRAG:

```bash
cd /path/to/your/project
opencode-rag init
```

This creates:
- `.opencode/plugins/rag-plugin.js` — workspace-local plugin fallback (re-exports from `node_modules/`)
- `.opencode/plugins/rag-tui.js` — TUI plugin module
- `.opencode/opencode.json` — OpenCode workspace config
- `.opencode/tui.json` — TUI plugin settings
- `.opencode/package.json` — workspace dependencies
- `opencode-rag.json` — Runtime configuration
- `.opencode/.gitignore` — ignores `node_modules/` and `rag_db/`
- Runs `npm install` to install workspace dependencies

Use `--skip-install` to skip the npm install step. Use `--force` to overwrite existing files. Use `--skip-health-check` to skip provider validation (useful in offline environments).

After writing config, `init` validates that your embedding provider is reachable and all configured models (embedding, description & visual) are available. For Ollama, if models are missing, you will be asked to pull them automatically.

## Running Without Global Installation

```bash
npx opencode-rag init
npx opencode-rag index
npx opencode-rag query "your search query"
```

## npm Package

The package is published as `opencode-rag-plugin` on npm:

```bash
npm install --save-dev opencode-rag-plugin
```

> ⚠️ **Note:** Do not confuse with the npm package `opencode-rag`, which is a discontinued project by a different author.

## Verifying Your Installation

```bash
opencode-rag status
```

This shows the index statistics, store path, provider, model, manifest status, and keyword index status.

## Recommended: Enable LSP

OpenCode supports Language Server Protocol (LSP) for richer code intelligence. It is recommended to enable LSP in your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "lsp": true
}
```

Then ask OpenCode to install the LSPs for the programming languages you are using. This gives agents more info about code structure and definitions, and error diagnostics to complement OpenCodeRAG's semantic search with precise type-aware context. 

## Agent Tools

Once installed, OpenCodeRAG provides three tools for AI agents to retrieve and explore code:

| Tool | Purpose |
|------|---------|
| `search_semantic` | Retrieve relevant code chunks by query or meaning |
| `get_file_skeleton` | Get structural overview of a file (functions, classes, interfaces) |
| `find_usages` | Find all references to a symbol across the codebase |

For detailed usage instructions, parameters, and examples, see [AGENTS.md](../AGENTS.md#opencoderag-plugin).
