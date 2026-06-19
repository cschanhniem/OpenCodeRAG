import type { TuiPluginModule } from "@opencode-ai/plugin/tui";
import type { JSX } from "@opentui/solid";
import { createElement, insert, setProp } from "@opentui/solid";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Provider } from "@opencode-ai/sdk/v2";
import { loadRuntimeOverrides, saveRuntimeOverride } from "./core/runtime-overrides.js";
import { PROVIDER_DEFAULTS } from "./core/provider-defaults.js";
import { loadConfig } from "./core/config.js";
import { setPendingRagInjection } from "./core/rag-injection-flag.js";

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

type WatcherState = {
  running: boolean;
  lastRunAt: number | undefined;
};

type RagStatus = {
  chunkCount: number;
  provider: string;
  model: string;
  lastIndexedAt: number | undefined;
  indexed: boolean;
  watcher: WatcherState;
};

const DEFAULT_STATUS: RagStatus = {
  chunkCount: 0,
  provider: "ollama",
  model: "",
  lastIndexedAt: undefined,
  indexed: false,
  watcher: { running: false, lastRunAt: undefined },
};

function loadWatcherStatus(storePath: string): WatcherState {
  const statusPath = join(storePath, "watcher-status.json");
  if (!existsSync(statusPath)) return { running: false, lastRunAt: undefined };
  try {
    const raw: Record<string, unknown> = JSON.parse(readFileSync(statusPath, "utf-8"));
    return {
      running: raw.running === true,
      lastRunAt: typeof raw.lastRunAt === "number" ? raw.lastRunAt : undefined,
    };
  } catch {
    return { running: false, lastRunAt: undefined };
  }
}

function loadRagStatus(worktree: string): RagStatus {
  const status = { ...DEFAULT_STATUS };

  for (const loc of ["opencode-rag.json", ".opencode/opencode-rag.json", ".opencode/rag.json"]) {
    const configPath = join(worktree, loc);
    if (!existsSync(configPath)) continue;
    try {
      const cfg: Record<string, unknown> = JSON.parse(readFileSync(configPath, "utf-8"));
      const embedding = cfg.embedding as Record<string, unknown> | undefined;
      if (embedding) {
        status.provider = (embedding.provider as string) ?? status.provider;
        status.model = (embedding.model as string) ?? status.model;
      }
      const vs = cfg.vectorStore as Record<string, unknown> | undefined;
      const storeRelPath = (vs?.path as string) ?? ".opencode/rag_db";
      const storePath = resolve(worktree, storeRelPath);

      const manifestPath = join(storePath, "manifest.json");
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
        const files = manifest.files as Record<string, { chunkCount?: number }> | undefined;
        if (files && typeof files === "object") {
          status.chunkCount = Object.values(files).reduce(
            (sum: number, entry) => sum + (entry.chunkCount ?? 0),
            0
          );
        }
        status.lastIndexedAt = manifest.lastIndexedAt as number | undefined;
        status.indexed = status.chunkCount > 0;
      }

      status.watcher = loadWatcherStatus(storePath);
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

function formatKeybinding(key: string): string {
  return key
    .split("+")
    .map((k) => k.charAt(0).toUpperCase() + k.slice(1))
    .join("+");
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
  theme: { accent: unknown; text: unknown; textMuted: unknown },
  version: string,
  status: RagStatus,
  tuiConfig?: { fileListKeybinding: string; chunksKeybinding: string },
): JSX.Element {
  const statusLine = status.indexed
    ? `${status.chunkCount} chunks \u00B7 ${status.provider}/${status.model}`
    : "Not indexed";
  const timeLine = `Indexed ${formatRelativeTime(status.lastIndexedAt)}`;

  const watcherRunning = status.watcher.running;
  const watcherLine = watcherRunning
    ? "Watcher running\u2026"
    : `Watcher idle \u00B7 last ${formatRelativeTime(status.watcher.lastRunAt)}`;

  const fileListKey = tuiConfig?.fileListKeybinding ?? "ctrl+enter";
  const chunksKey = tuiConfig?.chunksKeybinding ?? "ctrl+alt+enter";

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
      text({ fg: watcherRunning ? theme.accent : theme.textMuted }, [watcherLine]),
      text({ fg: theme.textMuted }, ["Ctrl+Shift+R → Settings"]),
      text({ fg: theme.textMuted }, [`${formatKeybinding(fileListKey)} → Add Files`]),
      text({ fg: theme.textMuted }, [`${formatKeybinding(chunksKey)} → Add Chunks`]),
    ],
  );
}

// ── Settings dialog ────────────────────────────────────────────────

function getConfigPath(worktree: string): string | undefined {
  for (const loc of ["opencode-rag.json", ".opencode/opencode-rag.json", ".opencode/rag.json"]) {
    const p = join(worktree, loc);
    if (existsSync(p)) return p;
  }
  return undefined;
}

function readJsonFile<T = Record<string, unknown>>(filePath: string): T | undefined {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

type SettingEntry = {
  path: string[];
  label: string;
  type: "boolean" | "number" | "string";
  currentValue: boolean | number | string;
  options?: { title: string; value: string; description?: string; category?: string }[];
};

type SettingCategory = {
  id: string;
  label: string;
  description: string;
  entries: SettingEntry[];
};

function buildModelOptions(providers: readonly Provider[]): { title: string; value: string; description?: string; category?: string }[] {
  const options: { title: string; value: string; description?: string; category?: string }[] = [];
  for (const provider of providers) {
    if (!provider.models) continue;
    for (const [modelId, model] of Object.entries(provider.models)) {
      options.push({
        title: model.name ?? modelId,
        value: `${provider.id}/${modelId}`,
        description: provider.name,
        category: provider.name,
      });
    }
  }
  options.sort((a, b) => {
    if ((a.category ?? "") < (b.category ?? "")) return -1;
    if ((a.category ?? "") > (b.category ?? "")) return 1;
    return (a.title ?? "").localeCompare(b.title ?? "");
  });
  options.push({ title: "Custom\u2026", value: "__custom__", description: "Enter provider/model manually" });
  return options;
}

function providerIdToRagProvider(providerId: string): string {
  if (providerId === "ollama") return "ollama";
  const defaults = PROVIDER_DEFAULTS[providerId];
  if (defaults) return providerId;
  return "openai";
}

function resolveProviderBaseUrl(provider: Provider): string {
  const baseUrl = (provider.options?.baseURL as string) ?? "";
  if (provider.id === "ollama") {
    const clean = baseUrl.replace(/\/+$/, "");
    return clean ? `${clean}/api` : PROVIDER_DEFAULTS.ollama!.defaultBaseUrl + "/api";
  }
  const defaults = PROVIDER_DEFAULTS[provider.id];
  return baseUrl || (defaults?.defaultBaseUrl ?? "https://api.openai.com/v1");
}

function saveConfigValue(configPath: string, path: string[], value: unknown): void {
  try {
    const data: Record<string, unknown> = JSON.parse(readFileSync(configPath, "utf-8"));
    let target = data;
    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i]!;
      if (!target[key] || typeof target[key] !== "object") {
        target[key] = {};
      }
      target = target[key] as Record<string, unknown>;
    }
    target[path[path.length - 1]!] = value;
    writeFileSync(configPath, JSON.stringify(data, null, 2), "utf-8");
  } catch {
    // silently ignore write errors
  }
}

function saveModelSelection(
  storePath: string,
  configPath: string,
  selectionValue: string,
  path: string[],
  providers?: readonly Provider[]
): string | undefined {
  const section = path[0]!;
  if (selectionValue === "__custom__") return undefined;

  const parts = selectionValue.split("/");
  if (parts.length < 2) return undefined;

  const providerId = parts[0]!;
  const modelId = parts.slice(1).join("/");

  const provider = providers?.find((p) => p.id === providerId);
  const ragProvider = providerIdToRagProvider(providerId);
  const baseUrl = provider ? resolveProviderBaseUrl(provider) : "";

  saveRuntimeOverride(storePath, [section, "provider"], ragProvider);
  saveConfigValue(configPath, [section, "provider"], ragProvider);
  saveRuntimeOverride(storePath, [section, "model"], modelId);
  saveConfigValue(configPath, [section, "model"], modelId);
  if (baseUrl) {
    saveRuntimeOverride(storePath, [section, "baseUrl"], baseUrl);
    saveConfigValue(configPath, [section, "baseUrl"], baseUrl);
  }

  const apiKey = (provider?.options?.apiKey as string) ?? "";
  if (apiKey) {
    saveRuntimeOverride(storePath, [section, "apiKey"], apiKey);
    saveConfigValue(configPath, [section, "apiKey"], apiKey);
  }

  return selectionValue;
}

function buildSettingCategories(
  cfg: Record<string, unknown>,
  ro: Record<string, unknown>,
  providers?: readonly Provider[],
): SettingCategory[] {
  const retrievalCfg = (cfg.retrieval ?? {}) as Record<string, unknown>;
  const retrievalRo = (ro.retrieval ?? {}) as Record<string, unknown>;
  const retrievalHybridCfg = (retrievalCfg.hybridSearch ?? {}) as Record<string, unknown>;
  const retrievalHybridRo = (retrievalRo.hybridSearch ?? {}) as Record<string, unknown>;

  const openCodeCfg = (cfg.openCode ?? {}) as Record<string, unknown>;
  const openCodeRo = (ro.openCode ?? {}) as Record<string, unknown>;
  const aiCfg = (openCodeCfg.autoIndex ?? {}) as Record<string, unknown>;
  const aiRo = (openCodeRo.autoIndex ?? {}) as Record<string, unknown>;
  const ajCfg = (openCodeCfg.autoInject ?? {}) as Record<string, unknown>;
  const ajRo = (openCodeRo.autoInject ?? {}) as Record<string, unknown>;

  const descCfg = (cfg.description ?? {}) as Record<string, unknown>;
  const descRo = (ro.description ?? {}) as Record<string, unknown>;

  const embeddingCfg = (cfg.embedding ?? {}) as Record<string, unknown>;
  const embeddingRo = (ro.embedding ?? {}) as Record<string, unknown>;

  const tuiCfg = (cfg.tui ?? {}) as Record<string, unknown>;
  const tuiRo = (ro.tui ?? {}) as Record<string, unknown>;

  const modelOptions = providers ? buildModelOptions(providers) : undefined;

  function displayModel(roProvider: unknown, roModel: unknown, cfgProvider: unknown, cfgModel: unknown, defaultProvider: string, defaultModel: string): string {
    const p = (roProvider as string) ?? (cfgProvider as string) ?? defaultProvider;
    const m = (roModel as string) ?? (cfgModel as string) ?? defaultModel;
    return `${p}/${m}`;
  }

  return [
    {
      id: "retrieval",
      label: "Retrieval",
      description: "Configure the retrieval options",
      entries: [
        {
          path: ["retrieval", "topK"],
          label: "Top-K results",
          type: "number",
          currentValue: (retrievalRo.topK as number) ?? (retrievalCfg.topK as number) ?? 10,
        },
        {
          path: ["retrieval", "minScore"],
          label: "Min relevance score",
          type: "number",
          currentValue: (retrievalRo.minScore as number) ?? (retrievalCfg.minScore as number) ?? 0.5,
        },
        {
          path: ["retrieval", "hybridSearch", "enabled"],
          label: "Hybrid search",
          type: "boolean",
          currentValue: (retrievalHybridRo.enabled as boolean) ?? (retrievalHybridCfg.enabled as boolean) ?? true,
        },
        {
          path: ["retrieval", "hybridSearch", "keywordWeight"],
          label: "Keyword weight",
          type: "number",
          currentValue: (retrievalHybridRo.keywordWeight as number) ?? (retrievalHybridCfg.keywordWeight as number) ?? 0.4,
        },
      ],
    },
    {
      id: "autoindex",
      label: "Auto-Indexing",
      description: "Configure automatic indexing of your workspace",
      entries: [
        {
          path: ["openCode", "autoIndex", "enabled"],
          label: "Auto-index watcher",
          type: "boolean",
          currentValue: (aiRo.enabled as boolean) ?? (aiCfg.enabled as boolean) ?? true,
        },
        {
          path: ["openCode", "autoIndex", "debounceMs"],
          label: "Debounce (ms)",
          type: "number",
          currentValue: (aiRo.debounceMs as number) ?? (aiCfg.debounceMs as number) ?? 2000,
        },
      ],
    },
    {
      id: "autoinject",
      label: "Auto-Inject",
      description: "Configure automatic context injection",
      entries: [
        {
          path: ["openCode", "autoInject", "enabled"],
          label: "Auto-inject context",
          type: "boolean",
          currentValue: (ajRo.enabled as boolean) ?? (ajCfg.enabled as boolean) ?? true,
        },
        {
          path: ["openCode", "autoInject", "minScore"],
          label: "Inject min score",
          type: "number",
          currentValue: (ajRo.minScore as number) ?? (ajCfg.minScore as number) ?? 0.75,
        },
        {
          path: ["openCode", "autoInject", "maxChunks"],
          label: "Inject max chunks",
          type: "number",
          currentValue: (ajRo.maxChunks as number) ?? (ajCfg.maxChunks as number) ?? 3,
        },
      ],
    },
    {
      id: "embedding",
      label: "Embedding",
      description: "Configure the embedding model and provider",
      entries: [
        {
          path: ["embedding", "model"],
          label: "Model",
          type: "string",
          currentValue: displayModel(embeddingRo.provider, embeddingRo.model, embeddingCfg.provider, embeddingCfg.model, "ollama", "embeddinggemma:latest"),
          options: modelOptions,
        },
      ],
    },
    {
      id: "description",
      label: "LLM Descriptions",
      description: "Configure LLM-based chunk descriptions",
      entries: [
        {
          path: ["description", "enabled"],
          label: "LLM descriptions",
          type: "boolean",
          currentValue: (descRo.enabled as boolean) ?? (descCfg.enabled as boolean) ?? true,
        },
        {
          path: ["description", "model"],
          label: "Model",
          type: "string",
          currentValue: displayModel(descRo.provider, descRo.model, descCfg.provider, descCfg.model, "ollama", "qwen2.5:3b"),
          options: modelOptions,
        },
      ],
    },
    {
      id: "keybindings",
      label: "Keybindings",
      description: "Configure keyboard shortcuts",
      entries: [
        {
          path: ["tui", "fileListKeybinding"],
          label: "Add file list",
          type: "string",
          currentValue: (tuiRo.fileListKeybinding as string) ?? (tuiCfg.fileListKeybinding as string) ?? "ctrl+enter",
        },
        {
          path: ["tui", "chunksKeybinding"],
          label: "Add chunks",
          type: "string",
          currentValue: (tuiRo.chunksKeybinding as string) ?? (tuiCfg.chunksKeybinding as string) ?? "ctrl+alt+enter",
        },
      ],
    },
  ];
}

async function openSettingsDialog(api: {
  ui: {
    dialog: { replace: (fn: () => JSX.Element, onClose?: () => void) => void; clear: () => void };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    DialogSelect: (props: any) => JSX.Element;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    DialogPrompt: (props: any) => JSX.Element;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toast: (input: any) => void;
  };
  state: { path: { worktree: string | undefined }; provider?: readonly Provider[] };
}): Promise<void> {
  const worktree = api.state.path.worktree;
  if (!worktree) return;

  const configPath = getConfigPath(worktree);
  if (!configPath) {
    api.ui.toast({ variant: "error", title: "Settings", message: "No config file found" });
    return;
  }

  const cfgRaw = readJsonFile(configPath);
  if (!cfgRaw) {
    api.ui.toast({ variant: "error", title: "Settings", message: "Cannot read config" });
    return;
  }

  const cfg: Record<string, unknown> = cfgRaw;
  const vs = cfg.vectorStore as Record<string, unknown> | undefined;
  const storeRelPath = (vs?.path as string) ?? ".opencode/rag_db";
  const storePath = resolve(worktree, storeRelPath);
  const providers = api.state.provider;

  function getCurrentOverrides(): Record<string, unknown> {
    return loadRuntimeOverrides(storePath) as unknown as Record<string, unknown>;
  }

  function showCategoryMenu(): void {
    const ro = getCurrentOverrides();
    const cats = buildSettingCategories(cfg, ro, providers);
    const options = [
      ...cats.map((c) => ({
        title: c.label,
        value: c.id,
        description: c.description,
      })),
      { title: "Done", value: "__done__", description: "Close settings" },
    ];

    api.ui.dialog.replace(
      () =>
        api.ui.DialogSelect({
          title: "OpenCodeRAG Settings",
          placeholder: "Select a category",
          options,
          onSelect: (option: { title: string; value: string }) => {
            if (option.value === "__done__") {
              api.ui.dialog.clear();
              return;
            }
            const cat = cats.find((c) => c.id === option.value);
            if (cat) showSettingMenu(cat);
          },
        }),
    );
  }

  function showSettingMenu(cat: SettingCategory): void {
    const options = [
      ...cat.entries.map((s) => ({
        title: `${s.label}: ${s.type === "boolean" ? (s.currentValue ? "Yes" : "No") : String(s.currentValue)}`,
        value: s.path.join("."),
        description: s.options ? "Select to open model picker" : (s.type === "boolean" ? "Select to toggle" : "Select to edit"),
      })),
      { title: "\u2190 Back", value: "__back__", description: "Return to categories" },
    ];

    api.ui.dialog.replace(
      () =>
        api.ui.DialogSelect({
          title: cat.label,
          placeholder: "Select a setting",
          options,
          onSelect: (option: { title: string; value: string }) => {
            if (option.value === "__back__") {
              showCategoryMenu();
              return;
            }
            const entry = cat.entries.find((s) => s.path.join(".") === option.value);
            if (!entry) return;

            if (entry.options) {
              showModelPicker(entry, cat);
            } else if (entry.type === "boolean") {
              const newVal = !entry.currentValue;
              saveRuntimeOverride(storePath, entry.path, newVal);
              saveConfigValue(configPath!, entry.path, newVal);
              api.ui.toast({
                variant: "success",
                title: "Settings",
                message: `${entry.label}: ${newVal ? "Yes" : "No"}`,
              });
              entry.currentValue = newVal;
              showSettingMenu(cat);
            } else if (entry.type === "number") {
              api.ui.dialog.replace(
                () =>
                  api.ui.DialogPrompt({
                    title: `Edit ${entry.label}`,
                    placeholder: "Enter new value",
                    value: String(entry.currentValue),
                    onConfirm: (input: string) => {
                      const num = parseFloat(input);
                      if (!isNaN(num)) {
                        saveRuntimeOverride(storePath, entry.path, num);
                        saveConfigValue(configPath!, entry.path, num);
                        api.ui.toast({
                          variant: "success",
                          title: "Settings",
                          message: `${entry.label}: ${num}`,
                        });
                        entry.currentValue = num;
                      }
                      showSettingMenu(cat);
                    },
                    onCancel: () => {
                      showSettingMenu(cat);
                    },
                  }),
              );
            } else {
              api.ui.dialog.replace(
                () =>
                  api.ui.DialogPrompt({
                    title: `Edit ${entry.label}`,
                    placeholder: "Enter new value",
                    value: String(entry.currentValue),
                    onConfirm: (input: string) => {
                      saveRuntimeOverride(storePath, entry.path, input);
                      saveConfigValue(configPath!, entry.path, input);
                      api.ui.toast({
                        variant: "success",
                        title: "Settings",
                        message: `${entry.label}: ${input}`,
                      });
                      entry.currentValue = input;
                      showSettingMenu(cat);
                    },
                    onCancel: () => {
                      showSettingMenu(cat);
                    },
                  }),
              );
            }
          },
        }),
    );
  }

  function showModelPicker(entry: SettingEntry, cat: SettingCategory): void {
    api.ui.dialog.replace(
      () =>
        api.ui.DialogSelect({
          title: `Select ${entry.label}`,
          placeholder: "Search models\u2026",
          options: entry.options ?? [],
          onSelect: (option: { title: string; value: string }) => {
            if (option.value === "__custom__") {
              api.ui.dialog.replace(
                () =>
                  api.ui.DialogPrompt({
                    title: `Custom ${entry.label}`,
                    placeholder: "e.g. ollama/my-model or openai/custom-model",
                    value: typeof entry.currentValue === "string" ? entry.currentValue : "",
                    onConfirm: (input: string) => {
                      const saved = saveModelSelection(storePath, configPath!, input, entry.path, providers);
                      if (saved) {
                        entry.currentValue = saved;
                      } else if (input) {
                        saveRuntimeOverride(storePath, entry.path, input);
                        saveConfigValue(configPath!, entry.path, input);
                        entry.currentValue = input;
                      }
                      showSettingMenu(cat);
                    },
                    onCancel: () => showSettingMenu(cat),
                  }),
              );
              return;
            }
            const saved = saveModelSelection(storePath, configPath!, option.value, entry.path, providers);
            if (saved) {
              entry.currentValue = saved;
              api.ui.toast({
                variant: "success",
                title: "Settings",
                message: `${entry.label}: ${saved}`,
              });
              const isEmbedding = entry.path[0] === "embedding";
              if (isEmbedding) {
                api.ui.toast({
                  variant: "warning",
                  title: "Settings",
                  message: "Embedding changed. Re-index may be required. Restart OpenCode for changes.",
                });
              }
            }
            showSettingMenu(cat);
          },
        }),
    );
  }

  showCategoryMenu();
}

// ── Plugin export ──────────────────────────────────────────────────

const plugin: TuiPluginModule & { id: string } = {
  id: `${PLUGIN_NAME}:tui`,
  tui: async (api, _options, meta) => {
    const version = meta.version ?? getVersion();
    let cachedStatus: RagStatus = DEFAULT_STATUS;
    let lastRefresh = 0;
    const REFRESH_INTERVAL_MS = Number(process.env.OPENCODE_RAG_TUI_REFRESH_MS) || 3600000;

    // Load tui config for keybinding display
    let tuiConfig: { fileListKeybinding: string; chunksKeybinding: string } | undefined;
    const worktree = api.state.path.worktree;
    if (worktree) {
      const configPath = getConfigPath(worktree);
      if (configPath) {
        try {
          const cfg = loadConfig(configPath);
          tuiConfig = cfg.tui;
        } catch {
          // use defaults
        }
      }
    }

    function refreshStatus() {
      const wt = api.state.path.worktree;
      if (wt) {
        cachedStatus = loadRagStatus(wt);
        lastRefresh = Date.now();
      }
    }

    refreshStatus();

    // Register sidebar slot
    api.slots.register({
      order: 900,
      slots: {
        sidebar_content() {
          if (Date.now() - lastRefresh > REFRESH_INTERVAL_MS) {
            refreshStatus();
          }
          return renderSidebar(api.theme.current, version, cachedStatus, tuiConfig);
        },
      },
    });

    // Register prompt slots — return null to let host render its default prompt.
    // The host's api.ui.Prompt() wrapper drops ref/right/sessionID props, so
    // replacing the prompt doesn't work. Instead, keybinding handlers set a
    // global flag consumed by the chat.message hook in the server plugin.
    api.slots.register({
      order: 901,
      slots: {
        session_prompt() {
          return null;
        },
        home_prompt() {
          return null;
        },
      },
    });

    // Compute storePath for flag-based IPC with server plugin
    let flagStorePath: string | undefined;
    const worktreeForFlag = api.state.path.worktree;
    if (worktreeForFlag) {
      try {
        const flagConfigPath = getConfigPath(worktreeForFlag);
        if (flagConfigPath) {
          const flagCfg = loadConfig(flagConfigPath);
          const vs = flagCfg.vectorStore as Record<string, unknown> | undefined;
          const storeRelPath = (vs?.path as string) ?? ".opencode/rag_db";
          flagStorePath = resolve(worktreeForFlag, storeRelPath);
        }
      } catch {
        // ignore
      }
    }

    // Register keybinding for settings dialog
    try {
      api.keymap.registerLayer({
        bindings: [{ key: "ctrl+shift+r", cmd: "opencode-rag:settings" }],
        commands: [
          {
            name: "opencode-rag:settings",
            run: () => {
              openSettingsDialog({
                ui: api.ui,
                state: api.state,
              });
              return undefined;
            },
          },
        ],
      });
    } catch (err) {
      // Keymap registration may fail in older OpenCode versions; silently skip
    }

    // Register keybinding for "Add File List" (configurable)
    try {
      const fileListKey = tuiConfig?.fileListKeybinding ?? "ctrl+enter";
      api.keymap.registerLayer({
        bindings: [{ key: fileListKey, cmd: "opencode-rag:show-file-list" }],
        commands: [
          {
            name: "opencode-rag:show-file-list",
            run: () => {
              if (flagStorePath) setPendingRagInjection(flagStorePath, "files");
              api.keymap.dispatchCommand("prompt.submit");
              return undefined;
            },
          },
        ],
      });
    } catch (err) {
      // Keymap registration may fail in older OpenCode versions; silently skip
    }

    // Register keybinding for "Add RAG Chunks" (configurable)
    try {
      const chunksKey = tuiConfig?.chunksKeybinding ?? "ctrl+alt+enter";
      api.keymap.registerLayer({
        bindings: [{ key: chunksKey, cmd: "opencode-rag:add-chunks" }],
        commands: [
          {
            name: "opencode-rag:add-chunks",
            run: () => {
              if (flagStorePath) setPendingRagInjection(flagStorePath, "chunks");
              api.keymap.dispatchCommand("prompt.submit");
              return undefined;
            },
          },
        ],
      });
    } catch (err) {
      // Keymap registration may fail in older OpenCode versions; silently skip
    }
  },
};

export default plugin;
