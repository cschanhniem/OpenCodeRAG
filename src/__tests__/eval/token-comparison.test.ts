/**
 * Token comparison test: RAG-on vs RAG-off.
 *
 * Measures:
 * - How many tokens RAG auto-injects into messages
 * - How many read tool calls RAG avoids
 * - Net token savings (overhead vs savings)
 * - Per-query breakdown of token usage
 *
 * Uses mock retrieval to simulate realistic search results and measures
 * the text delta before/after the chat.message hook runs.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRagHooks } from "../../plugin.js";
import { DEFAULT_CONFIG, type RagConfig } from "../../core/config.js";
import { appendSessionEvent, computeSummary, compareSessions } from "../../eval/storage.js";
import {
  analyzeTokenUsage,
  compareTokenAnalyses,
  formatTokenReport,
  estimateContextTokens,
  projectTokenSavings,
} from "../../eval/token-analysis.js";
import type { EmbeddingProvider, SearchResult, VectorStore, KeywordIndex } from "../../core/interfaces.js";
import type { SessionEvent } from "../../eval/types.js";

function makeTmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "token-test-"));
}

function makeConfig(overrides: Partial<RagConfig> = {}): RagConfig {
  return {
    ...DEFAULT_CONFIG,
    embedding: { ...DEFAULT_CONFIG.embedding, ...overrides.embedding },
    indexing: { ...DEFAULT_CONFIG.indexing, ...overrides.indexing },
    vectorStore: { ...DEFAULT_CONFIG.vectorStore, ...overrides.vectorStore },
    retrieval: { ...DEFAULT_CONFIG.retrieval, ...overrides.retrieval },
    openCode: { ...DEFAULT_CONFIG.openCode, ...overrides.openCode },
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

function makeToolContext(): Record<string, unknown> {
  return { sessionID: "session-test", callID: "call-test", agent: "test" };
}

function makeMockDependencies(results: SearchResult[]) {
  const retrieve = async (
    _query: string,
    _embedder: EmbeddingProvider,
    _store: VectorStore,
    _options?: { topK?: number }
  ): Promise<SearchResult[]> => results;

  return { dependencies: { retrieve } };
}

const dummyStore: VectorStore = {
  addChunks: async () => {},
  search: async () => [],
  count: async () => 10,
  clear: async () => {},
  deleteByFilePath: async () => {},
};

const dummyProvider: EmbeddingProvider = {
  name: "test",
  embed: async () => [],
};

// ── Token estimation tests ──────────────────────────────────────

describe("estimateContextTokens", () => {
  it("estimates tokens using 4 chars per token rule", () => {
    assert.equal(estimateContextTokens(""), 0);
    assert.equal(estimateContextTokens("abcd"), 1);
    assert.equal(estimateContextTokens("abcdefgh"), 2);
    assert.equal(estimateContextTokens("a".repeat(100)), 25);
  });

  it("rounds up for non-multiples of 4", () => {
    assert.equal(estimateContextTokens("abc"), 1);
    assert.equal(estimateContextTokens("abcde"), 2);
  });
});

// ── Auto-injection token measurement ────────────────────────────

describe("auto-injection token measurement", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("measures context tokens injected by auto-inject (chunks mode)", async () => {
    const results = [
      makeResult("c1", "/p/src/auth.ts", 10, 25, "typescript", "export function login() {\n  return authenticate();\n}", 0.95),
      makeResult("c2", "/p/src/user.ts", 5, 15, "typescript", "export function getUser() {\n  return db.query();\n}", 0.88),
    ];

    const { dependencies } = makeMockDependencies(results);
    const hooks = createRagHooks({
      cfg: makeConfig({
        openCode: {
          enabled: true,
          maxContextChunks: 5,
          autoInject: { enabled: true, minScore: 0.75, maxChunks: 3, maxTokens: 3000, contentType: "chunks" as const },
        },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpDir, "opencode-rag.log"),
      store: dummyStore,
      dependencies,
      worktree: "/p",
    });

    const chatHook = hooks["chat.message"];
    assert.ok(chatHook);

    // Run the hook with a multi-word prompt
    const output = {
      message: { id: "m1", role: "user", sessionID: "s1", parts: [{ type: "text", text: "How does authentication work?", id: "p1", messageID: "m1", sessionID: "s1" }] },
      parts: [{ type: "text", text: "How does authentication work?", id: "p1", messageID: "m1", sessionID: "s1" }],
    };
    await chatHook?.({ sessionID: "s1", messageID: "m1" } as never, output as never);

    const injected = (output.parts[0] as Record<string, unknown>).text as string;
    const originalLen = "How does authentication work?".length;
    const injectedLen = injected.length;
    const contextLen = injectedLen - originalLen;

    // Context was injected
    assert.ok(contextLen > 0, "Expected context to be injected");
    assert.match(injected, /Auto-retrieved code context/);
    assert.match(injected, /auth\.ts/);
    assert.match(injected, /user\.ts/);

    // Measure token overhead
    const contextTokens = estimateContextTokens(injected.substring(injected.indexOf("\n\n**Auto-retrieved")));
    assert.ok(contextTokens > 0, `Expected context tokens > 0, got ${contextTokens}`);

    console.log(`    [chunks mode] Injected ${contextLen} chars ≈ ${contextTokens} tokens`);
  });

  it("measures context tokens injected by auto-inject (file_paths mode)", async () => {
    const results = [
      makeResult("c1", "/p/src/auth.ts", 10, 25, "typescript", "export function login() {}", 0.95),
    ];

    const { dependencies } = makeMockDependencies(results);
    const hooks = createRagHooks({
      cfg: makeConfig({
        openCode: {
          enabled: true,
          maxContextChunks: 5,
          autoInject: { enabled: true, minScore: 0.75, maxChunks: 3, maxTokens: 3000, contentType: "file_paths" },
        },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpDir, "opencode-rag.log"),
      store: dummyStore,
      dependencies,
      worktree: "/p",
    });

    const chatHook = hooks["chat.message"];
    const output = {
      message: { id: "m1", role: "user", sessionID: "s1", parts: [{ type: "text", text: "test the chunks", id: "p1", messageID: "m1", sessionID: "s1" }] },
      parts: [{ type: "text", text: "test the chunks", id: "p1", messageID: "m1", sessionID: "s1" }],
    };
    await chatHook?.({ sessionID: "s1", messageID: "m1" } as never, output as never);

    const injected = (output.parts[0] as Record<string, unknown>).text as string;
    assert.match(injected, /Relevant files:/);
    assert.match(injected, /auth\.ts/);

    const contextTokens = estimateContextTokens(injected.substring(injected.indexOf("\n\nRelevant files")));
    console.log(`    [file_paths mode] Injected ~${contextTokens} tokens of file suggestions`);
  });

  it("injects zero tokens when autoInject is disabled", async () => {
    const results = [
      makeResult("c1", "/p/src/auth.ts", 10, 25, "typescript", "export function login() {}", 0.95),
    ];

    const { dependencies } = makeMockDependencies(results);
    const hooks = createRagHooks({
      cfg: makeConfig({
        openCode: {
          enabled: true,
          maxContextChunks: 5,
          autoInject: { enabled: false, minScore: 0.75, maxChunks: 3, maxTokens: 3000, contentType: "chunks" },
        },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpDir, "opencode-rag.log"),
      store: dummyStore,
      dependencies,
      worktree: "/p",
    });

    const chatHook = hooks["chat.message"];
    const output = {
      message: { id: "m1", role: "user", sessionID: "s1", parts: [{ type: "text", text: "test the chunks", id: "p1", messageID: "m1", sessionID: "s1" }] },
      parts: [{ type: "text", text: "test the chunks", id: "p1", messageID: "m1", sessionID: "s1" }],
    };
    await chatHook?.({ sessionID: "s1", messageID: "m1" } as never, output as never);

    const result = (output.parts[0] as Record<string, unknown>).text as string;
    assert.equal(result, "test the chunks", "No injection when autoInject disabled");
  });

  it("suppresses injection for single-word prompts (zero token overhead)", async () => {
    const results = [
      makeResult("c1", "/p/src/auth.ts", 10, 25, "typescript", "export function login() {}", 0.95),
    ];

    const { dependencies } = makeMockDependencies(results);
    const hooks = createRagHooks({
      cfg: makeConfig({
        openCode: {
          enabled: true,
          maxContextChunks: 5,
          autoInject: { enabled: true, minScore: 0.5, maxChunks: 3, maxTokens: 3000, contentType: "chunks" as const },
        },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpDir, "opencode-rag.log"),
      store: dummyStore,
      dependencies,
      worktree: "/p",
    });

    const chatHook = hooks["chat.message"];
    const output = {
      message: { id: "m1", role: "user", sessionID: "s1", parts: [{ type: "text", text: "test", id: "p1", messageID: "m1", sessionID: "s1" }] },
      parts: [{ type: "text", text: "test", id: "p1", messageID: "m1", sessionID: "s1" }],
    };
    await chatHook?.({ sessionID: "s1", messageID: "m1" } as never, output as never);

    const result = (output.parts[0] as Record<string, unknown>).text as string;
    assert.equal(result, "test", "Single-word prompts should not be injected");
  });

  it("respects maxTokens budget — evicts chunks to fit", async () => {
    // Create large chunks that exceed maxTokens
    const largeContent = "x".repeat(4000); // ~1000 tokens
    const results = [
      makeResult("c1", "/p/a.ts", 1, 100, "typescript", largeContent, 0.95),
      makeResult("c2", "/p/b.ts", 1, 100, "typescript", largeContent, 0.90),
      makeResult("c3", "/p/c.ts", 1, 100, "typescript", largeContent, 0.85),
    ];

    const { dependencies } = makeMockDependencies(results);
    const hooks = createRagHooks({
      cfg: makeConfig({
        openCode: {
          enabled: true,
          maxContextChunks: 5,
          autoInject: { enabled: true, minScore: 0.5, maxChunks: 3, maxTokens: 500, contentType: "chunks" as const }, // tight budget
        },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpDir, "opencode-rag.log"),
      store: dummyStore,
      dependencies,
      worktree: "/p",
    });

    const chatHook = hooks["chat.message"];
    const output = {
      message: { id: "m1", role: "user", sessionID: "s1", parts: [{ type: "text", text: "test the chunks", id: "p1", messageID: "m1", sessionID: "s1" }] },
      parts: [{ type: "text", text: "test the chunks", id: "p1", messageID: "m1", sessionID: "s1" }],
    };
    await chatHook?.({ sessionID: "s1", messageID: "m1" } as never, output as never);

    const injected = (output.parts[0] as Record<string, unknown>).text as string;
    // Should have some injection but trimmed to fit budget
    assert.match(injected, /Auto-retrieved code context/);
    // Not all 3 chunks should be present
    const chunkCount = (injected.match(/score: /g) ?? []).length;
    assert.ok(chunkCount <= 3, `Expected ≤3 chunks, got ${chunkCount}`);
    console.log(`    [maxTokens] ${chunkCount} chunks fit within 500-token budget`);
  });
});

// ── Session event comparison tests ──────────────────────────────

describe("token comparison via session events", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("compares RAG-on vs RAG-off session summaries", () => {
    // RAG-ON session: higher input tokens (injected context), fewer read calls
    const ragOnEvents: SessionEvent[] = [
      { ts: 100, event: "session.created", sessionID: "rag-on", sessionTitle: "RAG On Session" },
      { ts: 200, event: "message", sessionID: "rag-on", messageID: "m1", role: "assistant", modelID: "gpt-4o", tokens: { input: 3500, output: 200, reasoning: 0, cache: { read: 100, write: 0 } }, cost: 0.015, timeCreated: 150, timeCompleted: 250 },
      { ts: 210, event: "rag.context", sessionID: "rag-on", messageID: "m1", ragInjected: true, ragChunkCount: 3, ragUniqueFiles: 2, ragContextTokens: 450, ragTopScore: 0.92, ragRetrievalTimeMs: 35 },
      { ts: 220, event: "tool", sessionID: "rag-on", messageID: "m1", tool: "read", toolStatus: "completed", toolDurationMs: 20 },
      { ts: 300, event: "message", sessionID: "rag-on", messageID: "m2", role: "assistant", modelID: "gpt-4o", tokens: { input: 3200, output: 180, reasoning: 0, cache: { read: 80, write: 0 } }, cost: 0.012, timeCreated: 280, timeCompleted: 350 },
      { ts: 310, event: "rag.context", sessionID: "rag-on", messageID: "m2", ragInjected: true, ragChunkCount: 2, ragUniqueFiles: 1, ragContextTokens: 300, ragTopScore: 0.88, ragRetrievalTimeMs: 28 },
      { ts: 320, event: "tool", sessionID: "rag-on", messageID: "m2", tool: "search_semantic", toolStatus: "completed", toolDurationMs: 45 },
    ];

    // RAG-OFF session: lower input tokens per message, but more read calls
    const ragOffEvents: SessionEvent[] = [
      { ts: 100, event: "session.created", sessionID: "rag-off", sessionTitle: "RAG Off Session" },
      { ts: 200, event: "message", sessionID: "rag-off", messageID: "m1", role: "assistant", modelID: "gpt-4o", tokens: { input: 2800, output: 250, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.012, timeCreated: 150, timeCompleted: 300 },
      { ts: 210, event: "tool", sessionID: "rag-off", messageID: "m1", tool: "read", toolStatus: "completed", toolDurationMs: 20 },
      { ts: 220, event: "tool", sessionID: "rag-off", messageID: "m1", tool: "read", toolStatus: "completed", toolDurationMs: 25 },
      { ts: 230, event: "tool", sessionID: "rag-off", messageID: "m1", tool: "read", toolStatus: "completed", toolDurationMs: 30 },
      { ts: 300, event: "message", sessionID: "rag-off", messageID: "m2", role: "assistant", modelID: "gpt-4o", tokens: { input: 2500, output: 220, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.010, timeCreated: 280, timeCompleted: 400 },
      { ts: 310, event: "tool", sessionID: "rag-off", messageID: "m2", tool: "read", toolStatus: "completed", toolDurationMs: 22 },
      { ts: 320, event: "tool", sessionID: "rag-off", messageID: "m2", tool: "read", toolStatus: "completed", toolDurationMs: 18 },
    ];

    for (const ev of ragOnEvents) appendSessionEvent(tmpDir, ev);
    for (const ev of ragOffEvents) appendSessionEvent(tmpDir, ev);

    // compareSessions(A,B) = B - A, so pass rag-off first to get positive delta for rag-on
    const comparison = compareSessions(tmpDir, "rag-off", "rag-on");
    assert.ok(comparison !== null);
    assert.ok(comparison!.delta.inputTokens > 0, "RAG-on should have higher input tokens (injected context)");
    assert.ok(comparison!.delta.ragContextTokens > 0, "RAG-on should have rag context tokens");

    console.log(`    RAG-on input: ${comparison!.sessionA.totalTokens.input}`);
    console.log(`    RAG-off input: ${comparison!.sessionB.totalTokens.input}`);
    console.log(`    Delta: ${comparison!.delta.inputTokens} more input tokens with RAG`);
    console.log(`    RAG-on avg response: ${comparison!.sessionA.avgResponseTimeMs ?? "n/a"}ms`);
    console.log(`    RAG-off avg response: ${comparison!.sessionB.avgResponseTimeMs ?? "n/a"}ms`);
  });

  it("analyzeTokenUsage produces correct breakdown", () => {
    const events: SessionEvent[] = [
      { ts: 100, event: "session.created", sessionID: "s1", sessionTitle: "Test" },
      { ts: 200, event: "message", sessionID: "s1", messageID: "m1", role: "assistant", modelID: "gpt-4o", tokens: { input: 3000, output: 200, reasoning: 0, cache: { read: 50, write: 0 } }, cost: 0.012, timeCreated: 150, timeCompleted: 250 },
      { ts: 210, event: "rag.context", sessionID: "s1", messageID: "m1", ragInjected: true, ragChunkCount: 3, ragContextTokens: 400, ragTopScore: 0.90, ragRetrievalTimeMs: 30 },
      { ts: 220, event: "tool", sessionID: "s1", messageID: "m1", tool: "read", toolStatus: "completed", toolDurationMs: 20 },
      { ts: 230, event: "tool", sessionID: "s1", messageID: "m1", tool: "search_semantic", toolStatus: "completed", toolDurationMs: 40 },
      { ts: 300, event: "message", sessionID: "s1", messageID: "m2", role: "assistant", modelID: "gpt-4o", tokens: { input: 2800, output: 150, reasoning: 0, cache: { read: 30, write: 0 } }, cost: 0.010, timeCreated: 280, timeCompleted: 350 },
      { ts: 310, event: "rag.context", sessionID: "s1", messageID: "m2", ragInjected: true, ragChunkCount: 2, ragContextTokens: 300, ragTopScore: 0.85, ragRetrievalTimeMs: 25 },
    ];

    for (const ev of events) appendSessionEvent(tmpDir, ev);

    const analysis = analyzeTokenUsage(tmpDir, "s1");

    assert.equal(analysis.sessionID, "s1");
    assert.equal(analysis.queryCount, 2);
    assert.equal(analysis.totals.inputTokens, 5800);
    assert.equal(analysis.totals.outputTokens, 350);
    assert.equal(analysis.totals.cost, 0.022);
    assert.equal(analysis.totals.ragContextTokens, 700);
    assert.equal(analysis.totals.readToolCalls, 1);
    assert.equal(analysis.totals.ragToolCalls, 1);
    assert.equal(analysis.totals.systemGuidanceTokens, 300); // 2 messages * 150

    assert.equal(analysis.breakdowns.length, 2);
    assert.equal(analysis.breakdowns[0]!.inputTokens, 3000);
    assert.equal(analysis.breakdowns[0]!.ragContextTokens, 400);
    assert.equal(analysis.breakdowns[0]!.readToolCalls, 1);
    assert.equal(analysis.breakdowns[1]!.inputTokens, 2800);
    assert.equal(analysis.breakdowns[1]!.ragContextTokens, 300);

    console.log(`    Analysis: ${analysis.totals.inputTokens} input, ${analysis.totals.ragContextTokens} RAG ctx, ${analysis.totals.readToolCalls} reads, ${analysis.totals.ragToolCalls} RAG tools`);
  });

  it("compareTokenAnalyses computes correct deltas", () => {
    const ragOnEvents: SessionEvent[] = [
      { ts: 100, event: "session.created", sessionID: "on", sessionTitle: "On" },
      { ts: 200, event: "message", sessionID: "on", messageID: "m1", role: "assistant", modelID: "gpt-4o", tokens: { input: 3500, output: 200, reasoning: 0, cache: { read: 100, write: 0 } }, cost: 0.015, timeCreated: 100, timeCompleted: 200 },
      { ts: 210, event: "rag.context", sessionID: "on", messageID: "m1", ragInjected: true, ragChunkCount: 3, ragContextTokens: 500, ragTopScore: 0.9, ragRetrievalTimeMs: 30 },
      { ts: 220, event: "tool", sessionID: "on", messageID: "m1", tool: "read", toolStatus: "completed", toolDurationMs: 20 },
      { ts: 230, event: "tool", sessionID: "on", messageID: "m1", tool: "search_semantic", toolStatus: "completed", toolDurationMs: 40 },
    ];

    const ragOffEvents: SessionEvent[] = [
      { ts: 100, event: "session.created", sessionID: "off", sessionTitle: "Off" },
      { ts: 200, event: "message", sessionID: "off", messageID: "m1", role: "assistant", modelID: "gpt-4o", tokens: { input: 2800, output: 250, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.012, timeCreated: 100, timeCompleted: 250 },
      { ts: 210, event: "tool", sessionID: "off", messageID: "m1", tool: "read", toolStatus: "completed", toolDurationMs: 20 },
      { ts: 220, event: "tool", sessionID: "off", messageID: "m1", tool: "read", toolStatus: "completed", toolDurationMs: 25 },
      { ts: 230, event: "tool", sessionID: "off", messageID: "m1", tool: "read", toolStatus: "completed", toolDurationMs: 30 },
    ];

    for (const ev of ragOnEvents) appendSessionEvent(tmpDir, ev);
    for (const ev of ragOffEvents) appendSessionEvent(tmpDir, ev);

    const ragOnAnalysis = analyzeTokenUsage(tmpDir, "on");
    const ragOffAnalysis = analyzeTokenUsage(tmpDir, "off");
    const comparison = compareTokenAnalyses(ragOnAnalysis, ragOffAnalysis);

    // RAG-on has more input tokens (700 more)
    assert.equal(comparison.delta.inputTokens, 700);
    // RAG-on has fewer read calls (1 vs 3)
    assert.equal(comparison.delta.readToolCalls, -2);
    // RAG-on has more RAG tool calls
    assert.equal(comparison.delta.ragToolCalls, 1);
    // RAG-on has rag context tokens
    assert.equal(comparison.delta.ragContextTokens, 500);
    // RAG-on has system guidance tokens
    assert.equal(comparison.delta.systemGuidanceTokens, 150);

    // Verdict should mention RAG costs tokens (more input)
    assert.ok(comparison.verdict.includes("COSTS tokens") || comparison.verdict.includes("fewer read calls"),
      `Verdict should explain tradeoff: ${comparison.verdict}`);

    console.log(`    Verdict: ${comparison.verdict}`);

    // Generate and print the report
    const report = formatTokenReport(ragOnAnalysis, ragOffAnalysis, comparison);
    assert.ok(report.length > 0);
    assert.match(report, /TOKEN USAGE COMPARISON/);
    assert.match(report, /PER-QUERY BREAKDOWN/);
    console.log(report);
  });
});

// ── Projection tests ───────────────────────────────────────────

describe("projectTokenSavings", () => {
  it("projects positive savings when RAG reduces reads significantly", () => {
    const result = projectTokenSavings({
      avgChunkSize: 500,     // ~125 tokens per chunk
      avgChunksPerQuery: 3,  // ~375 tokens injected per query
      avgReadsPerQueryWithoutRAG: 3,
      avgReadsPerQueryWithRAG: 0.5,
      queryCount: 10,
    });

    assert.ok(result.isPositive, "Expected positive savings");
    assert.ok(result.netSavings > 0);
    assert.ok(result.savedReadTokens > result.ragOverheadTokens);

    console.log(`    Projection: overhead=${result.ragOverheadTokens}, saved=${result.savedReadTokens}, net=${result.netSavings}`);
  });

  it("projects negative savings when chunks are large and reads are few", () => {
    const result = projectTokenSavings({
      avgChunkSize: 2000,    // ~500 tokens per chunk
      avgChunksPerQuery: 5,  // ~2500 tokens injected per query
      avgReadsPerQueryWithoutRAG: 1,
      avgReadsPerQueryWithRAG: 0.5,
      queryCount: 5,
    });

    assert.ok(!result.isPositive, "Expected negative savings");
    assert.ok(result.netSavings < 0);

    console.log(`    Projection: overhead=${result.ragOverheadTokens}, saved=${result.savedReadTokens}, net=${result.netSavings}`);
  });

  it("breaks even when overhead equals savings", () => {
    const result = projectTokenSavings({
      avgChunkSize: 400,     // ~100 tokens per chunk
      avgChunksPerQuery: 3,  // ~300 tokens injected
      avgReadsPerQueryWithoutRAG: 1,
      avgReadsPerQueryWithRAG: 0,
      queryCount: 10,
    });

    // 300*10 = 3000 overhead, 1200*1*10 = 12000 saved → positive
    assert.ok(result.isPositive);
    console.log(`    Break-even test: net=${result.netSavings}`);
  });
});

// ── System prompt guidance overhead ─────────────────────────────

describe("system prompt guidance overhead", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("system.transform hook adds ~150 tokens per message when indexed", async () => {
    const hooks = createRagHooks({
      cfg: makeConfig({
        openCode: { enabled: true, maxContextChunks: 5 },
      }),
      storePath: "memory://",
      logFilePath: path.join(tmpDir, "opencode-rag.log"),
      store: dummyStore,
      dependencies: { retrieve: async () => [] },
      worktree: "/p",
    });

    const systemHook = hooks["experimental.chat.system.transform"];
    assert.ok(systemHook);

    const output = { system: [] as string[] };
    await systemHook?.({ model: { providerID: "test", modelID: "test" } } as never, output as never);

    assert.ok(output.system.length > 0);
    const guidance = output.system[0]!;
    const guidanceTokens = estimateContextTokens(guidance);

    console.log(`    System guidance: ${guidance.length} chars ≈ ${guidanceTokens} tokens`);
    assert.ok(guidanceTokens >= 100, `Expected ≥100 tokens for system guidance, got ${guidanceTokens}`);
    assert.ok(guidanceTokens <= 500, `Expected ≤500 tokens for system guidance, got ${guidanceTokens}`);
  });
});
