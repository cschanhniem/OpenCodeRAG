import type { TuiPluginModule } from "@opencode-ai/plugin/tui";
import type { JSX } from "@opentui/solid";
import { createElement, insert, setProp } from "@opentui/solid";
import { readFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let _version: string | undefined;
function getVersion(): string {
  if (_version !== undefined) return _version;
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
    _version = pkg.version ?? "dev";
  } catch {
    _version = "dev";
  }
  return _version!;
}

type RagStatus = {
  chunkCount: number;
  provider: string;
  model: string;
  lastIndexedAt: number | undefined;
  indexed: boolean;
};

const DEFAULT_STATUS: RagStatus = {
  chunkCount: 0,
  provider: "ollama",
  model: "",
  lastIndexedAt: undefined,
  indexed: false,
};

function loadRagStatus(worktree: string): RagStatus {
  const status = { ...DEFAULT_STATUS };

  for (const loc of ["opencode-rag.json", ".opencode/opencode-rag.json", ".opencode/rag.json"]) {
    const configPath = join(worktree, loc);
    if (!existsSync(configPath)) continue;
    try {
      const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
      if (cfg.embedding) {
        status.provider = cfg.embedding.provider ?? status.provider;
        status.model = cfg.embedding.model ?? status.model;
      }
      const storePath = cfg.vectorStore?.path ?? ".opencode/rag_db";
      const manifestPath = join(worktree, storePath, "manifest.json");
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
        if (manifest.files && typeof manifest.files === "object") {
          status.chunkCount = Object.values(manifest.files as Record<string, { chunkCount?: number }>)
            .reduce((sum: number, entry) => sum + (entry.chunkCount ?? 0), 0);
        }
        status.lastIndexedAt = manifest.lastIndexedAt;
        status.indexed = status.chunkCount > 0;
      }
      break;
    } catch {
      continue;
    }
  }

  return status;
}

function formatRelativeTime(timestamp: number | undefined): string {
  if (timestamp === undefined) return "never";
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type Child = JSX.Element | string | number | null | undefined | false;

const PLUGIN_NAME = "opencode-rag-plugin";

function element(
  tag: string,
  props: Record<string, unknown>,
  children: Child[] = [],
): JSX.Element {
  const node = createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) setProp(node, key, value);
  }

  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    insert(node, child);
  }

  return node as unknown as JSX.Element;
}

function text(props: Record<string, unknown>, children: Child[] = []): JSX.Element {
  return element("text", props, children);
}

function box(props: Record<string, unknown>, children: Child[] = []): JSX.Element {
  return element("box", props, children);
}

function renderSidebar(
  theme: {
    accent: unknown;
    text: unknown;
    textMuted: unknown;
  },
  version: string,
  status: RagStatus,
): JSX.Element {
  const statusLine = status.indexed
    ? `${status.chunkCount} chunks \u00B7 ${status.provider}/${status.model}`
    : "Not indexed";
  const timeLine = `Indexed ${formatRelativeTime(status.lastIndexedAt)}`;

  return box(
    {
      width: "100%",
      flexDirection: "column",
      border: { type: "single" },
      borderColor: theme.accent,
      paddingTop: 1,
      paddingBottom: 1,
      paddingLeft: 1,
      paddingRight: 1,
    },
    [
      box(
        {
          width: "100%",
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        },
        [
          box({ paddingLeft: 1, paddingRight: 1, backgroundColor: theme.accent }, [
            text({ fg: "#000000" }, ["OpenCodeRAG"]),
          ]),
          text({ fg: theme.textMuted }, [`v${version}`]),
        ],
      ),
      text({ fg: theme.text }, [statusLine]),
      text({ fg: theme.textMuted }, [timeLine]),
    ],
  );
}

const plugin: TuiPluginModule & { id: string } = {
  id: `${PLUGIN_NAME}:tui`,
  tui: async (api, _options, meta) => {
    const version = meta.version ?? getVersion();
    let cachedStatus: RagStatus = DEFAULT_STATUS;
    let lastRefresh = 0;
    const REFRESH_INTERVAL_MS = 30_000;

    function refreshStatus() {
      const worktree = api.state.path.worktree;
      if (worktree) {
        cachedStatus = loadRagStatus(worktree);
        lastRefresh = Date.now();
      }
    }

    refreshStatus();

    api.slots.register({
      order: 900,
      slots: {
        sidebar_content() {
          if (Date.now() - lastRefresh > REFRESH_INTERVAL_MS) {
            refreshStatus();
          }
          return renderSidebar(api.theme.current, version, cachedStatus);
        },
      },
    });
  },
};

export default plugin;
