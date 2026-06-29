/**
 * @fileoverview Public API barrel exports for the evaluation framework (session logging, token counting, analysis).
 */
/**
 * Evaluation framework — session logging, token counting, and analysis.
 *
 * Provides event capture via the OpenCode plugin hook, JSONL storage,
 * session summarization, token usage analysis, and RAG-vs-no-RAG comparison.
 */
export type { SessionEvent, SessionSummary, ComparisonResult, TokenUsage } from "./types.js";
export { RAG_TOOL_NAMES, isRagTool } from "./types.js";
export {
  appendSessionEvent,
  readSessionEvents,
  listSessionIDs,
  listSessions,
  getSession,
  deleteSession,
  computeSummary,
  compareSessions,
} from "./storage.js";
export { createSessionLogger } from "./session-logger.js";
export type { SessionLogger } from "./session-logger.js";
export {
  analyzeTokenUsage,
  compareTokenAnalyses,
  formatTokenReport,
  estimateContextTokens,
  projectTokenSavings,
} from "./token-analysis.js";
export type { TokenAnalysis, PerQueryBreakdown } from "./token-analysis.js";
export {
  countTokens,
  countTokensBatch,
  sumTokens,
  estimateContextTokensFormatted,
  tokenizerMethod,
} from "./token-counter.js";
