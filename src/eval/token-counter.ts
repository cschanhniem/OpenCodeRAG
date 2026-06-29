/**
 * @fileoverview Token counting with tiktoken BPE (cl100k_base) and character-based heuristic fallback.
 */
/**
 * Token counting with tiktoken BPE + fallback heuristic.
 *
 * Uses js-tiktoken (cl100k_base encoding) for BPE-accurate counts.
 * Falls back to ceil(text.length / 4) when tiktoken is unavailable.
 *
 * cl100k_base is the encoding used by GPT-4, GPT-4o, Claude, and most
 * modern LLMs. It is the closest universal approximation available locally.
 */

import { createRequire } from "node:module";
import type { SearchResult } from "../core/interfaces.js";

type TiktokenEncoder = {
  encode(text: string, allowedSpecial?: string[], disallowedSpecial?: string[]): number[];
};

let cachedEncoder: TiktokenEncoder | null = null;
let loadFailed = false;

const _require = createRequire(import.meta.url);

function getEncoder(): TiktokenEncoder | null {
  if (loadFailed) return null;
  if (cachedEncoder) return cachedEncoder;

  try {
    const mod = _require("js-tiktoken") as { getEncoding(name: string): TiktokenEncoder };
    cachedEncoder = mod.getEncoding("cl100k_base");
    return cachedEncoder;
  } catch {
    loadFailed = true;
    return null;
  }
}

function fallbackEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Count the number of tokens in a text string.
 *
 * Uses tiktoken BPE (cl100k_base) when available, falls back to
 * the ceil(characters / 4) heuristic otherwise.
 */
export function countTokens(text: string): number {
  if (text.length === 0) return 0;

  const encoder = getEncoder();
  if (encoder) {
    try {
      return encoder.encode(text, [], []).length;
    } catch {
      // Encoding failed — fall through to heuristic
    }
  }

  return fallbackEstimate(text);
}

/**
 * Count tokens for multiple texts individually.
 * Returns an array of token counts, one per input text.
 */
export function countTokensBatch(texts: string[]): number[] {
  return texts.map(countTokens);
}

/**
 * Sum token counts for multiple texts.
 */
export function sumTokens(texts: string[]): number {
  let total = 0;
  for (const text of texts) {
    total += countTokens(text);
  }
  return total;
}

/**
 * Estimate the token overhead of auto-injected RAG context.
 *
 * Counts each chunk's content + description + formatting overhead individually,
 * providing a more accurate estimate than counting the fully-assembled string.
 *
 * @param chunks - Search results to count
 */
export function estimateContextTokensFormatted(
  chunks: SearchResult[],
  _worktree?: string,
): number {
  if (chunks.length === 0) return 0;

  let tokens = 0;
  for (const r of chunks) {
    // Content tokens
    tokens += countTokens(r.chunk.content);
    // Description tokens
    if (r.chunk.description) {
      tokens += countTokens(r.chunk.description);
    }
    // Formatting overhead: file path, line range, language, score, backticks, newlines
    tokens += 12;
  }

  // Header overhead: "Auto-retrieved code context" + metadata line + separators
  tokens += 30;

  return tokens;
}

/**
 * Returns the tokenizer method used ("tiktoken" or "heuristic").
 */
export function tokenizerMethod(): "tiktoken" | "heuristic" {
  return getEncoder() ? "tiktoken" : "heuristic";
}
