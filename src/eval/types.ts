/**
 * @fileoverview TypeScript type definitions for the evaluation framework (session events, summaries, tokens, comparisons).
 */
/**
 * Evaluation framework types for session logging and comparison.
 *
 * Captures OpenCode session events (messages, tool calls, RAG injections)
 * via the plugin event hook and stores them as JSONL for analysis.
 */

/** Token consumption breakdown for a single LLM response or step. */
export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cache: {
    read: number;
    write: number;
  };
}

/** A structured log entry captured from OpenCode plugin event hooks. */
export interface SessionEvent {
  ts: number;
  event: "message" | "tool" | "rag.context" | "step" | "session.created" | "session.status";
  sessionID: string;
  messageID?: string;

  // event="message" — from AssistantMessage
  role?: "user" | "assistant";
  modelID?: string;
  providerID?: string;
  tokens?: TokenUsage;
  cost?: number;
  finish?: string;
  timeCreated?: number;
  timeCompleted?: number;
  errorName?: string;

  // event="tool" — from ToolPart
  tool?: string;
  toolStatus?: "pending" | "running" | "completed" | "error";
  toolTimeStart?: number;
  toolTimeEnd?: number;
  toolDurationMs?: number;

  // event="rag.context" — from chat.message hook
  ragInjected?: boolean;
  ragChunkCount?: number;
  ragUniqueFiles?: number;
  ragContextTokens?: number;
  ragTopScore?: number;
  ragRetrievalTimeMs?: number;

  // event="step" — from StepFinishPart
  stepTokens?: TokenUsage;
  stepCost?: number;
  stepReason?: string;

  // event="session.created" — from Session
  sessionTitle?: string;

  // event="session.status" — idle/busy/retry
  sessionStatus?: string;
}

/** Aggregated statistics computed from a session's event log. */
export interface SessionSummary {
  sessionID: string;
  title?: string;
  startedAt: number;
  lastEventAt: number;

  messageCount: number;
  totalTokens: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
  };
  totalCost: number;
  totalSteps: number;

  ragContextCount: number;
  ragToolCalls: number;
  ragContextTokens: number;

  toolCallCounts: Record<string, number>;

  avgResponseTimeMs?: number;
  models: string[];
}

/** Delta comparison between two session summaries. */
export interface ComparisonResult {
  sessionA: SessionSummary;
  sessionB: SessionSummary;
  delta: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    messageCount: number;
    totalSteps: number;
    ragContextCount: number;
    ragToolCalls: number;
    ragContextTokens: number;
    avgResponseTimeMs: number;
  };
}

/** Set of tool names considered RAG-related for session analysis. */
export const RAG_TOOL_NAMES = new Set([
  "search_semantic",
  "get_file_skeleton",
  "find_usages",
  "read",
]);

/** Check whether a tool name is a RAG-related tool. */
export function isRagTool(toolName: string): boolean {
  return RAG_TOOL_NAMES.has(toolName);
}
