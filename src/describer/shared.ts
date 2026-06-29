/**
 * @fileoverview Shared utilities for building description provider user messages and implementing sleep delays.
 */
import type { Chunk } from "../core/interfaces.js";

/**
 * Build a formatted user message string from a code chunk for LLM description requests.
 *
 * Includes file path, language, line range, and the chunk content wrapped in a markdown code block.
 * Truncates content to maxContentChars if specified.
 *
 * @param chunk - The code chunk to describe
 * @param maxContentChars - Optional maximum number of characters to include from the chunk content
 * @returns Formatted message string ready to send to an LLM
 */
export function buildUserMessage(chunk: Chunk, maxContentChars?: number): string {
  const parts: string[] = [];

  if (chunk.metadata.filePath) {
    parts.push(`File: ${chunk.metadata.filePath}`);
  }
  if (chunk.metadata.language) {
    parts.push(`Language: ${chunk.metadata.language}`);
  }
  parts.push(`Lines: ${chunk.metadata.startLine}-${chunk.metadata.endLine}`);
  parts.push("");
  parts.push("```" + (chunk.metadata.language || ""));

  let content = chunk.content;
  if (maxContentChars && content.length > maxContentChars) {
    content = content.slice(0, maxContentChars) + "\n... [truncated]";
  }

  parts.push(content);
  parts.push("```");

  return parts.join("\n");
}

/** Promise-based delay for use with async/await. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
