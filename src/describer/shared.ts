import type { Chunk } from "../core/interfaces.js";

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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
