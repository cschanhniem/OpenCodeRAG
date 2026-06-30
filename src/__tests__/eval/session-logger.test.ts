import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { appendSessionEvent, readSessionEvents, listSessionIDs, deleteSession, computeSummary, compareSessions } from "../../eval/storage.js";
import { createSessionLogger } from "../../eval/session-logger.js";
import type { SessionEvent } from "../../eval/types.js";

function makeTmpDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), "eval-test-"));
}

describe("eval storage", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("appends and reads session events", () => {
    const ev: SessionEvent = {
      ts: 1000,
      event: "message",
      sessionID: "sess-1",
      messageID: "msg-1",
      role: "assistant",
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 10, write: 0 } },
      cost: 0.001,
    };

    appendSessionEvent(tmpDir, ev);
    const events = readSessionEvents(tmpDir, "sess-1");

    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0]!.sessionID, "sess-1");
    assert.strictEqual(events[0]!.tokens?.input, 100);
  });

  it("returns empty array for non-existent session", () => {
    const events = readSessionEvents(tmpDir, "no-such-session");
    assert.deepStrictEqual(events, []);
  });

  it("lists session IDs", () => {
    appendSessionEvent(tmpDir, { ts: 1, event: "message", sessionID: "a" });
    appendSessionEvent(tmpDir, { ts: 2, event: "message", sessionID: "b" });
    appendSessionEvent(tmpDir, { ts: 3, event: "message", sessionID: "a" });

    const ids = listSessionIDs(tmpDir);
    assert.deepStrictEqual(ids.sort(), ["a", "b"]);
  });

  it("deletes a session", () => {
    appendSessionEvent(tmpDir, { ts: 1, event: "message", sessionID: "s1" });
    assert.ok(existsSync(path.join(tmpDir, "eval-sessions", "s1.jsonl")));

    deleteSession(tmpDir, "s1");
    assert.ok(!existsSync(path.join(tmpDir, "eval-sessions", "s1.jsonl")));
  });

  it("deleting non-existent session does not throw", () => {
    deleteSession(tmpDir, "nope");
  });
});

describe("computeSummary", () => {
  it("computes summary from events", () => {
    const events: SessionEvent[] = [
      { ts: 100, event: "session.created", sessionID: "s1", sessionTitle: "Test Session" },
      { ts: 200, event: "message", sessionID: "s1", messageID: "m1", role: "assistant", modelID: "gpt-4o", tokens: { input: 1000, output: 200, reasoning: 0, cache: { read: 50, write: 0 } }, cost: 0.005, timeCreated: 100, timeCompleted: 200 },
      { ts: 300, event: "step", sessionID: "s1", messageID: "m1", stepTokens: { input: 500, output: 100, reasoning: 0, cache: { read: 0, write: 0 } }, stepCost: 0.002, stepReason: "stop" },
      { ts: 400, event: "tool", sessionID: "s1", messageID: "m1", tool: "search_semantic", toolStatus: "completed", toolTimeStart: 350, toolTimeEnd: 400, toolDurationMs: 50 },
      { ts: 500, event: "rag.context", sessionID: "s1", messageID: "m1", ragInjected: true, ragChunkCount: 3, ragUniqueFiles: 2, ragContextTokens: 150, ragTopScore: 0.85, ragRetrievalTimeMs: 42 },
      { ts: 600, event: "message", sessionID: "s1", messageID: "m2", role: "assistant", modelID: "gpt-4o", tokens: { input: 800, output: 150, reasoning: 10, cache: { read: 20, write: 5 } }, cost: 0.003, timeCreated: 500, timeCompleted: 600 },
    ];

    const s = computeSummary(events);

    assert.strictEqual(s.sessionID, "s1");
    assert.strictEqual(s.title, "Test Session");
    assert.strictEqual(s.messageCount, 2);
    assert.strictEqual(s.totalTokens.input, 1800);
    assert.strictEqual(s.totalTokens.output, 350);
    assert.strictEqual(s.totalTokens.reasoning, 10);
    assert.strictEqual(s.totalTokens.cacheRead, 70);
    assert.strictEqual(s.totalTokens.cacheWrite, 5);
    assert.strictEqual(s.totalCost, 0.008);
    assert.strictEqual(s.totalSteps, 1);
    assert.strictEqual(s.ragContextCount, 1);
    assert.strictEqual(s.ragContextTokens, 150);
    assert.strictEqual(s.ragToolCalls, 1);
    assert.deepStrictEqual(s.models, ["gpt-4o"]);
    assert.strictEqual(s.toolCallCounts["search_semantic"], 1);
    assert.ok(s.avgResponseTimeMs != null);
  });

  it("handles empty events", () => {
    const s = computeSummary([]);
    assert.strictEqual(s.sessionID, "");
    assert.strictEqual(s.messageCount, 0);
    assert.strictEqual(s.totalTokens.input, 0);
  });
});

describe("compareSessions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("compares two sessions", () => {
    appendSessionEvent(tmpDir, { ts: 100, event: "message", sessionID: "a", role: "assistant", tokens: { input: 500, output: 100, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.002 });
    appendSessionEvent(tmpDir, { ts: 200, event: "rag.context", sessionID: "a", ragInjected: true, ragChunkCount: 2, ragContextTokens: 80 });

    appendSessionEvent(tmpDir, { ts: 300, event: "message", sessionID: "b", role: "assistant", tokens: { input: 1000, output: 200, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.005 });
    appendSessionEvent(tmpDir, { ts: 400, event: "rag.context", sessionID: "b", ragInjected: true, ragChunkCount: 5, ragContextTokens: 200 });

    const result = compareSessions(tmpDir, "a", "b");

    assert.ok(result !== null);
    assert.strictEqual(result!.delta.inputTokens, 500);
    assert.strictEqual(result!.delta.outputTokens, 100);
    assert.strictEqual(result!.delta.ragContextTokens, 120);
  });

  it("returns null for missing session", () => {
    appendSessionEvent(tmpDir, { ts: 1, event: "message", sessionID: "a" });
    const result = compareSessions(tmpDir, "a", "missing");
    assert.strictEqual(result, null);
  });
});

describe("createSessionLogger", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("logs message.updated events with tokens", () => {
    const logger = createSessionLogger(tmpDir);

    logger.onEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "msg-1",
          sessionID: "sess-1",
          role: "assistant",
          modelID: "gpt-4o",
          providerID: "openai",
          tokens: { input: 1000, output: 200, reasoning: 0, cache: { read: 50, write: 0 } },
          cost: 0.005,
          finish: "stop",
          time: { created: 100, completed: 200 },
        },
      },
    });

    const events = readSessionEvents(tmpDir, "sess-1");
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0]!.event, "message");
    assert.strictEqual(events[0]!.tokens?.input, 1000);
    assert.strictEqual(events[0]!.cost, 0.005);
    assert.strictEqual(events[0]!.modelID, "gpt-4o");
  });

  it("ignores user messages in message.updated", () => {
    const logger = createSessionLogger(tmpDir);

    logger.onEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "msg-1",
          sessionID: "sess-1",
          role: "user",
          time: { created: 100 },
        },
      },
    });

    const events = readSessionEvents(tmpDir, "sess-1");
    assert.strictEqual(events.length, 0);
  });

  it("logs step-finish events", () => {
    const logger = createSessionLogger(tmpDir);

    logger.onEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          sessionID: "sess-1",
          messageID: "msg-1",
          type: "step-finish",
          reason: "stop",
          tokens: { input: 500, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
          cost: 0.002,
        },
      },
    });

    const events = readSessionEvents(tmpDir, "sess-1");
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0]!.event, "step");
    assert.strictEqual(events[0]!.stepTokens?.input, 500);
  });

  it("logs tool events with timing", () => {
    const logger = createSessionLogger(tmpDir);

    logger.onEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-2",
          sessionID: "sess-1",
          messageID: "msg-1",
          type: "tool",
          tool: "search_semantic",
          state: {
            status: "completed",
            input: { query: "test" },
            time: { start: 100, end: 150 },
          },
        },
      },
    });

    const events = readSessionEvents(tmpDir, "sess-1");
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0]!.event, "tool");
    assert.strictEqual(events[0]!.tool, "search_semantic");
    assert.strictEqual(events[0]!.toolStatus, "completed");
    assert.strictEqual(events[0]!.toolDurationMs, 50);
  });

  it("logs RAG context via onRagContext", () => {
    const logger = createSessionLogger(tmpDir);

    logger.onRagContext("sess-1", "msg-1", {
      chunkCount: 3,
      uniqueFiles: 2,
      contextTokens: 150,
      topScore: 0.85,
      retrievalTimeMs: 42,
    });

    const events = readSessionEvents(tmpDir, "sess-1");
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0]!.event, "rag.context");
    assert.strictEqual(events[0]!.ragInjected, true);
    assert.strictEqual(events[0]!.ragChunkCount, 3);
    assert.strictEqual(events[0]!.ragContextTokens, 150);
  });

  it("logs RAG context with zero chunks as not injected", () => {
    const logger = createSessionLogger(tmpDir);

    logger.onRagContext("sess-1", undefined, {
      chunkCount: 0,
      uniqueFiles: 0,
      contextTokens: 0,
      topScore: 0,
      retrievalTimeMs: 10,
    });

    const events = readSessionEvents(tmpDir, "sess-1");
    assert.strictEqual(events[0]!.ragInjected, false);
  });

  it("logs session.created events", () => {
    const logger = createSessionLogger(tmpDir);

    logger.onEvent({
      type: "session.created",
      properties: {
        info: {
          id: "sess-1",
          title: "My Session",
        },
      },
    });

    const events = readSessionEvents(tmpDir, "sess-1");
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0]!.event, "session.created");
    assert.strictEqual(events[0]!.sessionTitle, "My Session");
  });

  it("never throws on malformed events", () => {
    const logger = createSessionLogger(tmpDir);

    assert.doesNotThrow(() => {
      logger.onEvent({ type: "message.updated", properties: {} });
      logger.onEvent({ type: "message.part.updated", properties: {} });
      logger.onEvent({ type: "unknown.event", properties: {} });
      logger.onEvent({ type: "message.updated", properties: { info: null } });
    });
  });
});
