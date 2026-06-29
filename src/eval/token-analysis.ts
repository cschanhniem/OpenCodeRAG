/**
 * @fileoverview Token usage analysis for comparing RAG-on vs RAG-off sessions with per-query breakdowns and savings projections.
 */
/**
 * Token usage analysis for comparing RAG-on vs RAG-off sessions.
 *
 * Provides functions to:
 * - Analyze per-query token breakdown from session events
 * - Estimate token savings from RAG (fewer read tool calls)
 * - Generate comparison reports between RAG-on and RAG-off sessions
 */

import { readSessionEvents, computeSummary } from "./storage.js";
import type { SessionEvent } from "./types.js";
import { countTokens } from "./token-counter.js";

/** Average tokens consumed by a `read` tool call (typical file read). */
const AVG_READ_TOOL_TOKENS = 1200;

/** Average tokens consumed by a `search_semantic` tool call. */
const AVG_SEARCH_TOOL_TOKENS = 800;

/** Average tokens for system prompt guidance injected by RAG (~150 tokens). */
const SYSTEM_GUIDANCE_TOKENS = 150;

/** Per-message token and cost breakdown used in session analysis. */
export interface PerQueryBreakdown {
  messageID: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  ragContextTokens: number;
  ragChunkCount: number;
  ragTopScore: number;
  readToolCalls: number;
  ragToolCalls: number;
  responseTimeMs: number;
}

/** Complete token usage analysis for a session including per-query breakdowns and RAG savings estimates. */
export interface TokenAnalysis {
  sessionID: string;
  queryCount: number;
  breakdowns: PerQueryBreakdown[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    ragContextTokens: number;
    readToolCalls: number;
    ragToolCalls: number;
    systemGuidanceTokens: number;
    avgResponseTimeMs: number;
    totalToolTimeMs: number;
    models: string[];
  };
  estimates: {
    tokensWithoutRAG: number;
    tokensWithRAG: number;
    netSavings: number;
    percentSavings: number;
  };
}

/**
 * Analyze token usage for a single session from its JSONL event log.
 *
 * Reads all events, groups them by message, and computes per-query breakdowns
 * including RAG context injection, tool calls, and response times.
 */
/**
 * Analyze token usage for a single session from its JSONL event log.
 *
 * Reads all events, groups them by message, and computes per-query breakdowns
 * including RAG context injection, tool calls, and response times.
 */
export function analyzeTokenUsage(storePath: string, sessionID: string): TokenAnalysis {
  const events = readSessionEvents(storePath, sessionID);
  const summary = computeSummary(events);

  // Group events by messageID
  const messageEvents = new Map<string, SessionEvent[]>();
  const ragContextByMessage = new Map<string, SessionEvent>();
  const toolCallsByMessage = new Map<string, SessionEvent[]>();

  for (const ev of events) {
    const mid = ev.messageID ?? "unknown";

    if (ev.event === "message" && ev.role === "assistant") {
      if (!messageEvents.has(mid)) messageEvents.set(mid, []);
      messageEvents.get(mid)!.push(ev);
    }

    if (ev.event === "rag.context") {
      ragContextByMessage.set(mid, ev);
    }

    if (ev.event === "tool") {
      if (!toolCallsByMessage.has(mid)) toolCallsByMessage.set(mid, []);
      toolCallsByMessage.get(mid)!.push(ev);
    }
  }

  const breakdowns: PerQueryBreakdown[] = [];
  let totalReadToolCalls = 0;
  let totalRagToolCalls = 0;
  let totalRagContextTokens = 0;
  let totalCost = 0;
  let systemGuidanceTokens = 0;

  // System guidance is injected when chunks are indexed (ragContextCount > 0)
  if (summary.ragContextCount > 0) {
    systemGuidanceTokens = SYSTEM_GUIDANCE_TOKENS * summary.messageCount;
  }

  for (const [mid, msgEvents] of messageEvents) {
    const msgEvent = msgEvents[0]!; // Should be exactly one per messageID
    const ragCtx = ragContextByMessage.get(mid);
    const tools = toolCallsByMessage.get(mid) ?? [];

    const readCalls = tools.filter((t) => t.tool === "read").length;
    const ragCalls = tools.filter((t) =>
      ["search_semantic", "get_file_skeleton", "find_usages", "search_semantic"].includes(t.tool ?? "")
    ).length;

    const timeDiff = (msgEvent.timeCreated && msgEvent.timeCompleted)
      ? msgEvent.timeCompleted - msgEvent.timeCreated
      : 0;

    totalReadToolCalls += readCalls;
    totalRagToolCalls += ragCalls;
    totalRagContextTokens += ragCtx?.ragContextTokens ?? 0;
    totalCost += msgEvent.cost ?? 0;

    breakdowns.push({
      messageID: mid,
      inputTokens: msgEvent.tokens?.input ?? 0,
      outputTokens: msgEvent.tokens?.output ?? 0,
      reasoningTokens: msgEvent.tokens?.reasoning ?? 0,
      cacheRead: msgEvent.tokens?.cache?.read ?? 0,
      cacheWrite: msgEvent.tokens?.cache?.write ?? 0,
      cost: msgEvent.cost ?? 0,
      ragContextTokens: ragCtx?.ragContextTokens ?? 0,
      ragChunkCount: ragCtx?.ragChunkCount ?? 0,
      ragTopScore: ragCtx?.ragTopScore ?? 0,
      readToolCalls: readCalls,
      ragToolCalls: ragCalls,
      responseTimeMs: timeDiff,
    });
  }

  // Aggregate execution time and models
  const responseTimes = breakdowns.filter((b) => b.responseTimeMs > 0).map((b) => b.responseTimeMs);
  const avgResponseTimeMs = responseTimes.length > 0
    ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
    : 0;
  const totalToolTimeMs = breakdowns.reduce((sum, b) => sum + b.ragToolCalls * 40 + b.readToolCalls * 25, 0); // estimated
  const modelSet = new Set<string>();
  for (const ev of events) {
    if (ev.event === "message" && ev.modelID) modelSet.add(ev.modelID);
  }

  const totals = {
    inputTokens: summary.totalTokens.input,
    outputTokens: summary.totalTokens.output,
    reasoningTokens: summary.totalTokens.reasoning,
    cacheRead: summary.totalTokens.cacheRead,
    cacheWrite: summary.totalTokens.cacheWrite,
    cost: totalCost,
    ragContextTokens: totalRagContextTokens,
    readToolCalls: totalReadToolCalls,
    ragToolCalls: totalRagToolCalls,
    systemGuidanceTokens,
    avgResponseTimeMs,
    totalToolTimeMs,
    models: [...modelSet],
  };

  // Estimate what tokens would look like without RAG:
  // - No RAG context tokens injected
  // - No system guidance tokens
  // - More read tool calls (estimated 2-3 extra per query)
  // - More search_semantic calls would become read calls
  const avgReadCallsPerQuery = summary.messageCount > 0 ? totalReadToolCalls / summary.messageCount : 0;
  const estimatedExtraReadsPerQuery = Math.max(0, 2.5 - avgReadCallsPerQuery); // RAG typically reduces reads by ~2.5
  const estimatedExtraReadTokens = estimatedExtraReadsPerQuery * AVG_READ_TOOL_TOKENS * summary.messageCount;
  const estimatedExtraSearchTokens = totalRagToolCalls * AVG_SEARCH_TOOL_TOKENS;

  const tokensWithoutRAG = totals.inputTokens
    - totals.ragContextTokens
    - totals.systemGuidanceTokens
    + estimatedExtraReadTokens
    + estimatedExtraSearchTokens;

  const tokensWithRAG = totals.inputTokens;

  const netSavings = tokensWithoutRAG - tokensWithRAG;
  const percentSavings = tokensWithoutRAG > 0 ? (netSavings / tokensWithoutRAG) * 100 : 0;

  return {
    sessionID,
    queryCount: summary.messageCount,
    breakdowns,
    totals,
    estimates: {
      tokensWithoutRAG: Math.round(tokensWithoutRAG),
      tokensWithRAG,
      netSavings: Math.round(netSavings),
      percentSavings: Math.round(percentSavings * 10) / 10,
    },
  };
}

/**
 * Compare two token analyses (RAG-on vs RAG-off) and produce a delta report.
 */
export function compareTokenAnalyses(
  ragOn: TokenAnalysis,
  ragOff: TokenAnalysis
): {
  delta: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheRead: number;
    cost: number;
    ragContextTokens: number;
    readToolCalls: number;
    ragToolCalls: number;
    systemGuidanceTokens: number;
    responseTimeMs: number;
  };
  percentChange: {
    inputTokens: number;
    outputTokens: number;
    cost: number;
    readToolCalls: number;
    responseTimeMs: number;
  };
  verdict: string;
} {
  const dInput = ragOn.totals.inputTokens - ragOff.totals.inputTokens;
  const dOutput = ragOn.totals.outputTokens - ragOff.totals.outputTokens;
  const dReasoning = ragOn.totals.reasoningTokens - ragOff.totals.reasoningTokens;
  const dCache = ragOn.totals.cacheRead - ragOff.totals.cacheRead;
  const dCost = ragOn.totals.cost - ragOff.totals.cost;
  const dRagCtx = ragOn.totals.ragContextTokens - ragOff.totals.ragContextTokens;
  const dReads = ragOn.totals.readToolCalls - ragOff.totals.readToolCalls;
  const dRagTools = ragOn.totals.ragToolCalls - ragOff.totals.ragToolCalls;
  const dSysGuidance = ragOn.totals.systemGuidanceTokens - ragOff.totals.systemGuidanceTokens;

  const avgOnTime = ragOn.breakdowns.length > 0
    ? ragOn.breakdowns.reduce((s, b) => s + b.responseTimeMs, 0) / ragOn.breakdowns.length
    : 0;
  const avgOffTime = ragOff.breakdowns.length > 0
    ? ragOff.breakdowns.reduce((s, b) => s + b.responseTimeMs, 0) / ragOff.breakdowns.length
    : 0;
  const dResponseTime = avgOnTime - avgOffTime;

  const pct = (delta: number, base: number) => base === 0 ? 0 : Math.round((delta / base) * 1000) / 10;

  // Verdict
  let verdict: string;
  if (ragOn.totals.inputTokens < ragOff.totals.inputTokens) {
    verdict = `RAG SAVES tokens: ${Math.abs(dInput)} fewer input tokens (${Math.abs(pct(dInput, ragOff.totals.inputTokens))}% reduction)`;
  } else if (ragOn.totals.inputTokens > ragOff.totals.inputTokens) {
    verdict = `RAG COSTS tokens: ${dInput} more input tokens (${pct(dInput, ragOff.totals.inputTokens)}% increase)`;
  } else {
    verdict = "RAG has no effect on input token usage";
  }

  if (dReads < 0) {
    verdict += ` | ${Math.abs(dReads)} fewer read calls`;
  }
  if (dRagTools > 0) {
    verdict += ` | ${dRagTools} additional RAG tool calls`;
  }

  return {
    delta: {
      inputTokens: dInput,
      outputTokens: dOutput,
      reasoningTokens: dReasoning,
      cacheRead: dCache,
      cost: dCost,
      ragContextTokens: dRagCtx,
      readToolCalls: dReads,
      ragToolCalls: dRagTools,
      systemGuidanceTokens: dSysGuidance,
      responseTimeMs: Math.round(dResponseTime),
    },
    percentChange: {
      inputTokens: pct(dInput, ragOff.totals.inputTokens),
      outputTokens: pct(dOutput, ragOff.totals.outputTokens),
      cost: pct(dCost, ragOff.totals.cost),
      readToolCalls: pct(dReads, ragOff.totals.readToolCalls),
      responseTimeMs: pct(dResponseTime, avgOffTime),
    },
    verdict,
  };
}

/**
 * Format a token comparison report as a human-readable string.
 */
export function formatTokenReport(
  ragOn: TokenAnalysis,
  ragOff: TokenAnalysis,
  comparison: ReturnType<typeof compareTokenAnalyses>
): string {
  const lines: string[] = [];
  const sep = "─".repeat(70);

  lines.push("");
  lines.push(sep);
  lines.push("  TOKEN USAGE COMPARISON: RAG ON vs RAG OFF");
  lines.push(sep);
  lines.push("");

  // Summary table
  lines.push("  Metric                          RAG ON        RAG OFF       Delta");
  lines.push(`  ${"─".repeat(66)}`);

  const row = (label: string, on: number | string, off: number | string, delta: number | string) => {
    const onStr = typeof on === "number" ? on.toLocaleString() : on;
    const offStr = typeof off === "number" ? off.toLocaleString() : off;
    const deltaStr = typeof delta === "number"
      ? (delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString())
      : delta;
    lines.push(`  ${label.padEnd(34)}${onStr.padStart(12)}${offStr.padStart(14)}${deltaStr.padStart(14)}`);
  };

  row("Input tokens", ragOn.totals.inputTokens, ragOff.totals.inputTokens, comparison.delta.inputTokens);
  row("Output tokens", ragOn.totals.outputTokens, ragOff.totals.outputTokens, comparison.delta.outputTokens);
  row("Reasoning tokens", ragOn.totals.reasoningTokens, ragOff.totals.reasoningTokens, comparison.delta.reasoningTokens);
  row("Cache read", ragOn.totals.cacheRead, ragOff.totals.cacheRead, comparison.delta.cacheRead);
  row("Cost ($)", `$${ragOn.totals.cost.toFixed(4)}`, `$${ragOff.totals.cost.toFixed(4)}`, `$${comparison.delta.cost.toFixed(4)}`);
  lines.push(`  ${"─".repeat(66)}`);
  row("RAG context tokens", ragOn.totals.ragContextTokens, ragOff.totals.ragContextTokens, comparison.delta.ragContextTokens);
  row("System guidance tokens", ragOn.totals.systemGuidanceTokens, ragOff.totals.systemGuidanceTokens, comparison.delta.systemGuidanceTokens);
  row("Read tool calls", ragOn.totals.readToolCalls, ragOff.totals.readToolCalls, comparison.delta.readToolCalls);
  row("RAG tool calls", ragOn.totals.ragToolCalls, ragOff.totals.ragToolCalls, comparison.delta.ragToolCalls);
  row("Avg response time (ms)", ragOn.totals.avgResponseTimeMs, ragOff.totals.avgResponseTimeMs, comparison.delta.responseTimeMs);
  row("Queries processed", ragOn.queryCount, ragOff.queryCount, ragOn.queryCount - ragOff.queryCount);

  lines.push(`  ${"─".repeat(66)}`);
  lines.push(`  Models:          ${ragOn.totals.models.join(", ") || "unknown"}`);
  lines.push(`                   ${ragOff.totals.models.join(", ") || "unknown"}`);

  lines.push("");
  lines.push(`  Verdict: ${comparison.verdict}`);
  lines.push("");

  // Per-query breakdown
  lines.push("  PER-QUERY BREAKDOWN (RAG ON)");
  lines.push(`  ${"─".repeat(66)}`);
  lines.push("  #   Input    Output   RAG ctx   Reads  RAG tools  Score");
  lines.push(`  ${"─".repeat(66)}`);

  for (let i = 0; i < ragOn.breakdowns.length; i++) {
    const b = ragOn.breakdowns[i]!;
    lines.push(
      `  ${String(i + 1).padStart(2)}  ${String(b.inputTokens).padStart(7)}  ${String(b.outputTokens).padStart(7)}  ${String(b.ragContextTokens).padStart(7)}  ${String(b.readToolCalls).padStart(5)}  ${String(b.ragToolCalls).padStart(9)}  ${b.ragTopScore.toFixed(2)}`
    );
  }

  lines.push("");
  lines.push(sep);
  lines.push("");

  return lines.join("\n");
}

/**
 * Estimate the token count for given text content.
 * Uses tiktoken BPE (cl100k_base) when available, falls back to ceil(len/4).
 */
export function estimateContextTokens(text: string): number {
  return countTokens(text);
}

/**
 * Project whether RAG would save tokens for a given query profile.
 *
 * @param avgChunkSize - Average size of injected code chunks in characters
 * @param avgChunksPerQuery - Average chunks injected per query
 * @param avgReadsPerQueryWithoutRAG - Average read calls without RAG
 * @param avgReadsPerQueryWithRAG - Average read calls with RAG
 * @param queryCount - Number of queries in the session
 */
export function projectTokenSavings(params: {
  avgChunkSize: number;
  avgChunksPerQuery: number;
  avgReadsPerQueryWithoutRAG: number;
  avgReadsPerQueryWithRAG: number;
  queryCount: number;
}): {
  ragOverheadTokens: number;
  savedReadTokens: number;
  netSavings: number;
  isPositive: boolean;
} {
  const ragOverheadTokens = Math.ceil(params.avgChunkSize / 4) * params.avgChunksPerQuery * params.queryCount;
  const savedReads = Math.max(0, params.avgReadsPerQueryWithoutRAG - params.avgReadsPerQueryWithRAG);
  const savedReadTokens = savedReads * AVG_READ_TOOL_TOKENS * params.queryCount;
  const netSavings = savedReadTokens - ragOverheadTokens;

  return {
    ragOverheadTokens,
    savedReadTokens,
    netSavings,
    isPositive: netSavings > 0,
  };
}
