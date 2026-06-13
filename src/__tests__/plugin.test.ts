import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";
import type { ToolDefinition } from "@opencode-ai/plugin/tool";
import { createRagHooks, ragPlugin } from "../plugin.js";
import { DEFAULT_CONFIG, type RagConfig } from "../core/config.js";
import type { EmbeddingProvider, SearchResult, VectorStore } from "../core/interfaces.js";

function makeConfig(overrides: Partial<RagConfig> = {}): RagConfig {
  return {
    ...DEFAULT_CONFIG,
    embedding: {
      ...DEFAULT_CONFIG.embedding,
      ...overrides.embedding,
    },
    indexing: {
      ...DEFAULT_CONFIG.indexing,
      ...overrides.indexing,
    },
    vectorStore: {
      ...DEFAULT_CONFIG.vectorStore,
      ...overrides.vectorStore,
    },
    retrieval: {
      ...DEFAULT_CONFIG.retrieval,
      ...overrides.retrieval,
    },
    openCode: {
      ...DEFAULT_CONFIG.openCode,
      ...overrides.openCode,
    },
    chunkers: overrides.chunkers ?? DEFAULT_CONFIG.chunkers,
  };
}

function makeResult(
  id: string,
  filePath: string,
  startLine: number,
  endLine: number,
  language: string,
  content: string,
  score: number,
  description?: string
): SearchResult {
  return {
    score,
    chunk: {
      id,
      content,
      description,
      metadata: { filePath, startLine, endLine, language },
    },
  };
}

const testWorktree = process.cwd();

const dummyProvider: EmbeddingProvider = {
  name: "test",
  embed: async () => [],
};

const dummyStore: VectorStore = {
  addChunks: async () => {},
  search: async () => [],
  count: async () => 0,
  clear: async () => {},
  deleteByFilePath: async () => {},
};

const populatedStore: VectorStore = {
  addChunks: async () => {},
  search: async () => [],
  count: async () => 5,
  clear: async () => {},
  deleteByFilePath: async () => {},
};

type SeenRetrieveCall = {
  query: string;
  topK: number;
};

function makeDependencies(
  results: SearchResult[],
  count: number
): {
  dependencies: { retrieve: typeof retrieve };
  getSeen: () => SeenRetrieveCall;
} {
  let seen: SeenRetrieveCall = { query: "", topK: 0 };

  const retrieve = async (
    query: string,
    _embedder: EmbeddingProvider,
    _store: VectorStore,
    options?: { topK?: number }
  ): Promise<SearchResult[]> => {
    seen = { query, topK: options?.topK ?? 0 };
    return results;
  };

  return {
    dependencies: { retrieve },
    getSeen: () => seen,
  };
}

function makeToolContext(): Record<string, unknown> {
  return {
    sessionID: "session-test",
    callID: "call-test",
    agent: "test",
  };
}

describe("ragPlugin", () => {
  it("loads config per workspace directory", async () => {
    const disabledDir = mkdtempSync(path.join(tmpdir(), "opencode-rag-disabled-"));
    const enabledDir = mkdtempSync(path.join(tmpdir(), "opencode-rag-enabled-"));

    try {
      writeFileSync(
        path.join(disabledDir, "opencode-rag.json"),
        JSON.stringify({ openCode: { enabled: false } })
      );
      writeFileSync(
        path.join(enabledDir, "opencode-rag.json"),
        JSON.stringify({ openCode: { enabled: true } })
      );

      const disabledHooks = await ragPlugin({ directory: disabledDir } as PluginInput, {});
      assert.deepStrictEqual(disabledHooks, {});

      const enabledHooks = await ragPlugin({ directory: enabledDir } as PluginInput, {});
      assert.equal(typeof enabledHooks["chat.message"], "function");
      assert.ok(enabledHooks.tool?.["opencode-rag-context"]);
      assert.ok(enabledHooks.tool?.["search_semantic"], "expected search_semantic tool");
      assert.ok(enabledHooks.tool?.["get_file_skeleton"], "expected get_file_skeleton tool");
      assert.ok(enabledHooks.tool?.["find_usages"], "expected find_usages tool");
    } finally {
      rmSync(disabledDir, { recursive: true, force: true });
      rmSync(enabledDir, { recursive: true, force: true });
    }
  });

  it("exposes an explicit chunk retrieval tool", async () => {
    const results = [
      makeResult(
        "chunk-1",
        "src/plugin.ts",
        12,
        20,
        "typescript",
        "export function chunkEntryPoint() { return true; }",
        0.93
      ),
      makeResult(
        "chunk-2",
        "src/retriever/retriever.ts",
        1,
        30,
        "typescript",
        "export async function retrieve() { /* ... */ }",
        0.82
      ),
    ];

    const { dependencies, getSeen } = makeDependencies(results, 2);
    const hooks = createRagHooks({
      cfg: makeConfig({
        retrieval: { topK: 7, minScore: 0 },
        openCode: { enabled: true, maxContextChunks: 5 },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      store: populatedStore,
      dependencies,
      worktree: testWorktree,
    });

    const retrievalTool = hooks.tool?.["opencode-rag-context"] as ToolDefinition;
    assert.ok(retrievalTool, "expected chunk retrieval tool to be registered");

    const result = await retrievalTool.execute(
      {
        query: "Locate the chunking entry point",
        pathHints: ["src/plugin.ts"],
        languageHints: ["typescript"],
        topK: 4,
      },
      makeToolContext() as never
    );

    assert.notEqual(typeof result, "string");
    const structured = result as {
      title?: string;
      output: string;
      metadata?: Record<string, unknown>;
    };

    assert.equal(structured.title, "OpenCodeRAG context (2 chunks)");
    assert.match(structured.output, /opencode-rag retrieved context/);
    assert.match(structured.output, /src\/plugin\.ts:12-20/);
    assert.match(structured.output, /src\/retriever\/retriever\.ts:1-30/);
    assert.match(structured.output, /chunkEntryPoint/);
    assert.equal(structured.metadata?.chunks, 2);
    assert.deepStrictEqual(structured.metadata?.pathHints, ["src/plugin.ts"]);
    assert.deepStrictEqual(structured.metadata?.languageHints, ["typescript"]);

    const seen = getSeen();
    assert.match(seen.query, /Locate the chunking entry point/);
    assert.match(seen.query, /Path hints: src\/plugin\.ts/);
    assert.match(seen.query, /Language hints: typescript/);
    assert.equal(seen.topK, 4);
  });

  it("writes multiline chunk contents to the log file", async () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "opencode-rag-log-"));

    try {
      const results = [
        makeResult(
          "chunk-1",
          "src/plugin.ts",
          12,
          20,
          "typescript",
          "export function chunkEntryPoint() {\n  return true;\n}\n",
          0.93
        ),
      ];

      const { dependencies } = makeDependencies(results, 1);
      const logFilePath = path.join(tempDir, ".opencode", "opencode-rag.log");
      const hooks = createRagHooks({
      cfg: makeConfig({
        retrieval: { topK: 7, minScore: 0 },
        openCode: { enabled: true, maxContextChunks: 5 },
      }),
      storePath: "memory://",
      logFilePath,
      store: populatedStore,
      dependencies,
      worktree: testWorktree,
    });

    const retrievalTool = hooks.tool?.["opencode-rag-context"] as ToolDefinition;
    assert.ok(retrievalTool, "expected chunk retrieval tool to be registered");

    await retrievalTool.execute(
      {
        query: "Locate the chunking entry point",
        pathHints: ["src/plugin.ts"],
        languageHints: ["typescript"],
        topK: 4,
      },
      makeToolContext() as never
    );

    const logContent = readFileSync(logFilePath, "utf8");
      assert.ok(logContent.includes("  export function chunkEntryPoint() {\n    return true;\n  }"));
      assert.ok(!logContent.includes("export function chunkEntryPoint() {\\n  return true;\\n}"));
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("includes description in formatted context when present", async () => {
    const results = [
      makeResult(
        "chunk-1",
        "src/plugin.ts",
        12,
        20,
        "typescript",
        "export function chunkEntryPoint() { return true; }",
        0.93,
        "A function that serves as the entry point for chunking operations."
      ),
      makeResult(
        "chunk-2",
        "src/retriever.ts",
        1,
        10,
        "typescript",
        "export async function retrieve() {}",
        0.82
      ),
    ];

    const { dependencies } = makeDependencies(results, 2);
    const hooks = createRagHooks({
      cfg: makeConfig({
        retrieval: { topK: 7, minScore: 0 },
        openCode: { enabled: true, maxContextChunks: 5 },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      store: populatedStore,
      dependencies,
      worktree: testWorktree,
    });

    const retrievalTool = hooks.tool?.["opencode-rag-context"] as ToolDefinition;
    const result = await retrievalTool.execute(
      { query: "chunk entry point" },
      makeToolContext() as never
    );

    const structured = result as { output: string };
    assert.match(structured.output, /A function that serves as the entry point/);
    assert.match(structured.output, /export function chunkEntryPoint/);
    // Second chunk has no description, so no blockquote for it
    assert.match(structured.output, /export async function retrieve/);
  });

  it("returns a helpful message when the index is empty", async () => {
    const { dependencies } = makeDependencies([], 0);
    const hooks = createRagHooks({
      cfg: makeConfig(),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      dependencies: {
        ...dependencies,
        retrieve: async () => {
          assert.fail("retrieve should not run when the index is empty");
        },
      },
      worktree: testWorktree,
    });

    const retrievalTool = hooks.tool?.["opencode-rag-context"] as ToolDefinition;
    assert.ok(retrievalTool);

    const result = await retrievalTool!.execute(
      { query: "anything" },
      makeToolContext() as never
    );

    assert.notEqual(typeof result, "string");
    const structured = result as {
      title?: string;
      output: string;
      metadata?: Record<string, unknown>;
    };

    assert.equal(structured.title, "OpenCodeRAG context");
    assert.match(structured.output, /No indexed chunks are available yet/);
    assert.equal(structured.metadata?.indexed, false);
    assert.equal(structured.metadata?.chunks, 0);
  });

  it("registers search_semantic tool that returns results", async () => {
    const results = [
      makeResult(
        "chunk-1",
        "src/auth.ts",
        10,
        25,
        "typescript",
        "export function login() { return 'token'; }",
        0.91
      ),
    ];

    const { dependencies } = makeDependencies(results, 1);
    const hooks = createRagHooks({
      cfg: makeConfig({
        retrieval: { topK: 7, minScore: 0 },
        openCode: { enabled: true, maxContextChunks: 5 },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      store: populatedStore,
      dependencies,
      worktree: testWorktree,
    });

    const semTool = hooks.tool?.["search_semantic"] as ToolDefinition;
    assert.ok(semTool, "expected search_semantic tool to be registered");

    const result = await semTool.execute(
      { query: "How does authentication work?" },
      makeToolContext() as never
    );

    assert.notEqual(typeof result, "string");
    const structured = result as { title?: string; output: string };
    assert.match(structured.title ?? "", /Semantic search/);
    assert.match(structured.output, /auth\.ts:10-25/);
    assert.match(structured.output, /login/);
  });

  it("returns empty result when search_semantic finds no matches", async () => {
    const { dependencies } = makeDependencies([], 0);
    const hooks = createRagHooks({
      cfg: makeConfig(),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      dependencies,
      worktree: testWorktree,
    });

    const semTool = hooks.tool?.["search_semantic"] as ToolDefinition;
    assert.ok(semTool);

    const result = await semTool.execute(
      { query: "something not in the index" },
      makeToolContext() as never
    );

    const structured = result as { output: string; metadata?: Record<string, unknown> };
    assert.match(structured.output, /empty/);
    assert.equal(structured.metadata?.indexed, false);
  });

  it("registers get_file_skeleton tool and reads current file", async () => {
    const hooks = createRagHooks({
      cfg: makeConfig(),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      dependencies: makeDependencies([], 0).dependencies,
      worktree: testWorktree,
    });

    const skeletonTool = hooks.tool?.["get_file_skeleton"] as ToolDefinition;
    assert.ok(skeletonTool, "expected get_file_skeleton tool");

    // Read plugin.ts's own skeleton
    const result = await skeletonTool.execute(
      { filePath: "src/plugin.ts" },
      makeToolContext() as never
    );

    const structured = result as { title?: string; output: string };
    assert.match(structured.title ?? "", /Skeleton/);
    // Should include known symbols from plugin.ts
    assert.match(structured.output, /createRagHooks/);
    assert.match(structured.output, /extractUserMessageText/);
  });

  it("registers find_usages tool", async () => {
    const results = [
      makeResult(
        "chunk-1",
        "src/auth.ts",
        10,
        25,
        "typescript",
        "export function login() {\n  const token = authenticate();\n  return token;\n}",
        0.93
      ),
    ];

    const storeWithResults: VectorStore = {
      addChunks: async () => {},
      search: async () => [],
      count: async () => 5,
      clear: async () => {},
      deleteByFilePath: async () => {},
    };

    const { dependencies } = makeDependencies(results, 1);
    const hooks = createRagHooks({
      cfg: makeConfig({
        retrieval: { topK: 7, minScore: 0 },
        openCode: { enabled: true, maxContextChunks: 5 },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      store: storeWithResults,
      dependencies,
      worktree: testWorktree,
    });

    const usageTool = hooks.tool?.["find_usages"] as ToolDefinition;
    assert.ok(usageTool, "expected find_usages tool to be registered");

    const result = await usageTool.execute(
      { symbolName: "authenticate" },
      makeToolContext() as never
    );

    const structured = result as { title?: string; output: string; metadata?: Record<string, unknown> };
    assert.match(structured.title ?? "", /Usages/);
    // Even though results come from the mock, the tool should process them
    assert.ok(structured.metadata !== undefined);
  });

  it("adds system guidance mentioning all tools", async () => {
    const { dependencies } = makeDependencies([], 1);
    const hooks = createRagHooks({
      cfg: makeConfig(),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      dependencies,
      worktree: testWorktree,
    });

    const systemHook = hooks["experimental.chat.system.transform"];
    assert.ok(systemHook);

    const output = { system: [] as string[] };
    await systemHook?.({ model: { providerID: "test", modelID: "test" } } as never, output as never);

    assert.ok(output.system.length > 0);
    const guidance = output.system[0]!;
    assert.match(guidance, /opencode-rag-context/);
    assert.match(guidance, /search_semantic/);
    assert.match(guidance, /get_file_skeleton/);
    assert.match(guidance, /find_usages/);
  });

  it("suggests related files on chat.message", async () => {
    const results = [
      makeResult(
        "chunk-1",
        "/home/user/project/src/embedder/openai.ts",
        10,
        25,
        "typescript",
        "export class OpenAIProvider {}",
        0.92
      ),
      makeResult(
        "chunk-2",
        "/home/user/project/src/embedder/ollama.ts",
        5,
        15,
        "typescript",
        "export class OllamaProvider {}",
        0.85
      ),
    ];

    const { dependencies } = makeDependencies(results, 2);
    const hooks = createRagHooks({
      cfg: makeConfig({
        openCode: { enabled: true, maxContextChunks: 5 },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      store: populatedStore,
      dependencies,
      worktree: "/home/user/project",
    });

    const chatMessageHook = hooks["chat.message"];
    assert.ok(chatMessageHook);

    const output = {
      message: {
        id: "msg-1",
        role: "user",
        sessionID: "session-1",
        parts: [{
          type: "text",
          text: "show me the OpenAI API files",
          id: "prt-1",
          messageID: "msg-1",
          sessionID: "session-1",
        }],
      },
      parts: [{
        type: "text",
        text: "show me the OpenAI API files",
        id: "prt-1",
        messageID: "msg-1",
        sessionID: "session-1",
      }],
    };

    await chatMessageHook?.({ sessionID: "session-1" } as never, output as never);
    assert.match((output.parts[0] as Record<string, unknown>).text as string, /src\/embedder\/openai\.ts.*typescript/);
    assert.match((output.parts[0] as Record<string, unknown>).text as string, /src\/embedder\/ollama\.ts.*typescript/);
  });

  it("auto-injects chunk content when scores exceed threshold", async () => {
    const results = [
      makeResult(
        "chunk-1",
        "/project/src/auth.ts",
        12,
        30,
        "typescript",
        "export function login() {\n  const token = getToken();\n  return token;\n}",
        0.92
      ),
      makeResult(
        "chunk-2",
        "/project/src/auth.ts",
        40,
        55,
        "typescript",
        "export function validateToken(token: string): boolean {\n  return token.length > 0;\n}",
        0.88
      ),
    ];

    const storeWithResults: VectorStore = {
      addChunks: async () => {},
      search: async () => [],
      count: async () => 5,
      clear: async () => {},
      deleteByFilePath: async () => {},
    };

    const { dependencies } = makeDependencies(results, 2);
    const hooks = createRagHooks({
      cfg: makeConfig({
        openCode: {
          enabled: true,
          maxContextChunks: 5,
          autoInject: { enabled: true, minScore: 0.75, maxChunks: 3, maxTokens: 2000 },
        },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      store: storeWithResults,
      dependencies,
      worktree: "/project",
    });

    const chatMessageHook = hooks["chat.message"];
    assert.ok(chatMessageHook);

    const output = {
      message: {
        id: "msg-1",
        role: "user",
        sessionID: "session-2",
        parts: [{
          type: "text",
          text: "how does login work?",
          id: "prt-1",
          messageID: "msg-1",
          sessionID: "session-2",
        }],
      },
      parts: [{
        type: "text",
        text: "how does login work?",
        id: "prt-1",
        messageID: "msg-1",
        sessionID: "session-2",
      }],
    };

    await chatMessageHook?.({ sessionID: "session-2" } as never, output as never);

    const resultText = (output.parts[0] as Record<string, unknown>).text as string;
    assert.match(resultText, /Auto-retrieved code context/);
    assert.match(resultText, /login\(\)/);
    assert.match(resultText, /validateToken/);
    assert.match(resultText, /auth\.ts:12-30/);
    assert.doesNotMatch(resultText, /Showing top.*relevant files/);
  });

  it("falls back to file list when scores are below autoInject threshold", async () => {
    const results = [
      makeResult(
        "chunk-1",
        "/project/src/auth.ts",
        12,
        30,
        "typescript",
        "export function login() {}",
        0.5
      ),
    ];

    const storeWithResults: VectorStore = {
      addChunks: async () => {},
      search: async () => [],
      count: async () => 5,
      clear: async () => {},
      deleteByFilePath: async () => {},
    };

    const { dependencies } = makeDependencies(results, 1);
    const hooks = createRagHooks({
      cfg: makeConfig({
        openCode: {
          enabled: true,
          maxContextChunks: 5,
          autoInject: { enabled: true, minScore: 0.75, maxChunks: 3, maxTokens: 2000 },
        },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      store: storeWithResults,
      dependencies,
      worktree: "/project",
    });

    const chatMessageHook = hooks["chat.message"];
    assert.ok(chatMessageHook);

    const output = {
      message: {
        id: "msg-1",
        role: "user",
        sessionID: "session-3",
        parts: [{
          type: "text",
          text: "auth stuff",
          id: "prt-1",
          messageID: "msg-1",
          sessionID: "session-3",
        }],
      },
      parts: [{
        type: "text",
        text: "auth stuff",
        id: "prt-1",
        messageID: "msg-1",
        sessionID: "session-3",
      }],
    };

    await chatMessageHook?.({ sessionID: "session-3" } as never, output as never);

    const resultText = (output.parts[0] as Record<string, unknown>).text as string;
    assert.doesNotMatch(resultText, /Auto-retrieved code context/);
    assert.match(resultText, /Relevant files:/);
  });

  it("respects maxChunks limit for auto-injection", async () => {
    const results = [
      makeResult("c1", "/p/a.ts", 1, 10, "ts", "fn a() {}", 0.95),
      makeResult("c2", "/p/b.ts", 1, 10, "ts", "fn b() {}", 0.90),
      makeResult("c3", "/p/c.ts", 1, 10, "ts", "fn c() {}", 0.85),
    ];

    const storeWithResults: VectorStore = {
      addChunks: async () => {},
      search: async () => [],
      count: async () => 3,
      clear: async () => {},
      deleteByFilePath: async () => {},
    };

    const { dependencies } = makeDependencies(results, 3);
    const hooks = createRagHooks({
      cfg: makeConfig({
        openCode: {
          enabled: true,
          maxContextChunks: 5,
          autoInject: { enabled: true, minScore: 0.5, maxChunks: 1, maxTokens: 99999 },
        },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      store: storeWithResults,
      dependencies,
      worktree: "/p",
    });

    const chatMessageHook = hooks["chat.message"];
    assert.ok(chatMessageHook);

    const output = {
      message: {
        id: "msg-1",
        role: "user",
        sessionID: "session-4",
        parts: [{
          type: "text",
          text: "test",
          id: "prt-1",
          messageID: "msg-1",
          sessionID: "session-4",
        }],
      },
      parts: [{
        type: "text",
        text: "test",
        id: "prt-1",
        messageID: "msg-1",
        sessionID: "session-4",
      }],
    };

    await chatMessageHook?.({ sessionID: "session-4" } as never, output as never);

    const resultText = (output.parts[0] as Record<string, unknown>).text as string;
    assert.match(resultText, /Auto-retrieved code context/);
    assert.match(resultText, /1 chunk/);
    assert.match(resultText, /fn a\(\)/);
    assert.doesNotMatch(resultText, /fn b\(\)/);
  });

  it("disabled autoInject falls back to file list", async () => {
    const results = [
      makeResult(
        "chunk-1",
        "/project/src/main.ts",
        1,
        10,
        "typescript",
        "export function main() {}",
        0.99
      ),
    ];

    const storeWithResults: VectorStore = {
      addChunks: async () => {},
      search: async () => [],
      count: async () => 5,
      clear: async () => {},
      deleteByFilePath: async () => {},
    };

    const { dependencies } = makeDependencies(results, 1);
    const hooks = createRagHooks({
      cfg: makeConfig({
        openCode: {
          enabled: true,
          maxContextChunks: 5,
          autoInject: { enabled: false, minScore: 0.75, maxChunks: 3, maxTokens: 2000 },
        },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      store: storeWithResults,
      dependencies,
      worktree: "/project",
    });

    const chatMessageHook = hooks["chat.message"];
    assert.ok(chatMessageHook);

    const output = {
      message: {
        id: "msg-1",
        role: "user",
        sessionID: "session-5",
        parts: [{
          type: "text",
          text: "test",
          id: "prt-1",
          messageID: "msg-1",
          sessionID: "session-5",
        }],
      },
      parts: [{
        type: "text",
        text: "test",
        id: "prt-1",
        messageID: "msg-1",
        sessionID: "session-5",
      }],
    };

    await chatMessageHook?.({ sessionID: "session-5" } as never, output as never);

    const resultText = (output.parts[0] as Record<string, unknown>).text as string;
    assert.doesNotMatch(resultText, /Auto-retrieved code context/);
    assert.match(resultText, /src\/main\.ts/);
  });

  it("uses relative paths in auto-injected context", async () => {
    const results = [
      makeResult(
        "chunk-1",
        "/home/user/workspace/src/app.ts",
        1,
        5,
        "typescript",
        "const x = 1;",
        0.95
      ),
    ];

    const storeWithResults: VectorStore = {
      addChunks: async () => {},
      search: async () => [],
      count: async () => 5,
      clear: async () => {},
      deleteByFilePath: async () => {},
    };

    const { dependencies } = makeDependencies(results, 1);
    const hooks = createRagHooks({
      cfg: makeConfig({
        openCode: {
          enabled: true,
          maxContextChunks: 5,
          autoInject: { enabled: true, minScore: 0.5, maxChunks: 3, maxTokens: 2000 },
        },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpdir(), "opencode-rag.log"),
      store: storeWithResults,
      dependencies,
      worktree: "/home/user/workspace",
    });

    const chatMessageHook = hooks["chat.message"];
    assert.ok(chatMessageHook);

    const output = {
      message: {
        id: "msg-1",
        role: "user",
        sessionID: "session-6",
        parts: [{
          type: "text",
          text: "test",
          id: "prt-1",
          messageID: "msg-1",
          sessionID: "session-6",
        }],
      },
      parts: [{
        type: "text",
        text: "test",
        id: "prt-1",
        messageID: "msg-1",
        sessionID: "session-6",
      }],
    };

    await chatMessageHook?.({ sessionID: "session-6" } as never, output as never);

    const resultText = (output.parts[0] as Record<string, unknown>).text as string;
    assert.match(resultText, /src\/app\.ts/);
    assert.doesNotMatch(resultText, /home\/user\/workspace/);
  });

});
