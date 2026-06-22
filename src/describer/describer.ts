import type { Chunk, DescriptionProvider } from "../core/interfaces.js";
import type { DescriptionConfig, ProxyConfig } from "../core/config.js";
import { postJson } from "../embedder/http.js";
import pLimit from "p-limit";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatResponse {
  message?: { content?: string; thinking?: string };
  choices?: Array<{ message?: { content?: string } }>;
}

const RETRYABLE_STATUSES = new Set([404, 408, 429, 500, 502, 503, 504]);

export class LLMDescriptionProvider implements DescriptionProvider {
  private readonly config: DescriptionConfig;

  constructor(config: DescriptionConfig) {
    this.config = config;
  }

  async generateDescription(chunk: Chunk): Promise<string> {
    const messages: ChatMessage[] = [
      { role: "system", content: this.config.systemPrompt },
      { role: "user", content: buildUserMessage(chunk) },
    ];

    return this.chatRequest(messages, this.config.timeoutMs ?? 60000);
  }

  async generateBatchDescriptions(chunks: Chunk[]): Promise<Map<string, string>> {
    if (chunks.length === 1) {
      const desc = await this.generateDescription(chunks[0]!);
      return new Map([[chunks[0]!.id, desc]]);
    }

    const batchMaxChunks = this.config.batchMaxChunks ?? 25;
    const batchConcurrency = this.config.batchConcurrency ?? 3;
    const batches: Chunk[][] = [];
    for (let i = 0; i < chunks.length; i += batchMaxChunks) {
      batches.push(chunks.slice(i, i + batchMaxChunks));
    }

    const result = new Map<string, string>();
    const batchLimit = pLimit(batchConcurrency);
    await Promise.all(
      batches.map((batch) =>
        batchLimit(async () => {
          try {
            const batchResult = await this.executeBatch(batch);
            for (const [id, desc] of batchResult) {
              result.set(id, desc);
            }
          } catch {
            // Batch failed — individual fallback loop below will handle missing chunks
          }
        }),
      ),
    );

    const missingChunks = chunks.filter((c) => !result.has(c.id));
    if (missingChunks.length > 0) {
      const fallbackLimit = pLimit(batchConcurrency);
      await Promise.all(
        missingChunks.map((chunk) =>
          fallbackLimit(async () => {
            try {
              const desc = await this.generateDescription(chunk);
              result.set(chunk.id, desc);
            } catch {
              // skip — caller will fall back to content
            }
          }),
        ),
      );
    }

    return result;
  }

  private async executeBatch(chunks: Chunk[]): Promise<Map<string, string>> {
    const messages: ChatMessage[] = [
      { role: "system", content: this.config.systemPrompt },
      { role: "user", content: buildBatchUserMessage(chunks) },
    ];

    const timeoutMs = this.config.batchTimeoutMs ?? 120000;
    const responseText = await this.chatRequest(messages, timeoutMs);

    return parseBatchResponse(responseText, chunks);
  }

  private async chatRequest(
    messages: ChatMessage[],
    timeoutMs: number
  ): Promise<string> {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const isOllama = this.config.provider === "ollama";

    const url = isOllama
      ? `${baseUrl}/chat`
      : `${baseUrl}${baseUrl.endsWith("/v1") ? "" : "/v1"}/chat/completions`;

    const body = isOllama
      ? { model: this.config.model, messages, stream: false, think: this.config.think ?? false, options: { num_ctx: this.config.numCtx } }
      : { model: this.config.model, messages };

    const headers: Record<string, string> = {};
    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`;
    }

    const retryMax = this.config.retryMax ?? 3;
    const retryBaseDelayMs = this.config.retryBaseDelayMs ?? 1000;

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= retryMax; attempt++) {
      const response = await postJson(url, body, headers, timeoutMs, this.config.proxy);

      if (response.ok) {
        const json = (await response.json()) as ChatResponse;
        return extractResponseText(json, isOllama);
      }

      const text = await response.text();
      const error = new Error(
        `Description LLM request failed (${response.status}): ${text}`
      );

      if (!RETRYABLE_STATUSES.has(response.status) || attempt === retryMax) {
        throw error;
      }

      lastError = error;
      const delayMs = retryBaseDelayMs * Math.pow(2, attempt);
      await sleep(delayMs);
    }

    throw lastError ?? new Error("Description LLM request failed: unknown error");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildUserMessage(chunk: Chunk): string {
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
  parts.push(chunk.content);
  parts.push("```");

  return parts.join("\n");
}

export function buildBatchUserMessage(chunks: Chunk[]): string {
  const first = chunks[0]!;
  const parts: string[] = [];

  if (first.metadata.filePath) {
    parts.push(`File: ${first.metadata.filePath}`);
  }
  if (first.metadata.language) {
    parts.push(`Language: ${first.metadata.language}`);
  }
  parts.push(`Chunks: ${chunks.length}`);
  parts.push("");

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    const lang = chunk.metadata.language || "";
    parts.push(`=== CHUNK ${i} (lines ${chunk.metadata.startLine}-${chunk.metadata.endLine}) ===`);
    parts.push("```" + lang);
    parts.push(chunk.content);
    parts.push("```");
    parts.push("");
  }

  return parts.join("\n");
}

export function parseBatchResponse(text: string, chunks: Chunk[]): Map<string, string> {
  const result = new Map<string, string>();
  const chunkPattern = /^CHUNK\s+(\d+)\s*[):-]?\s*/i;

  const lines = text.split("\n");
  let currentIndex: number | null = null;
  let currentDesc: string[] = [];

  for (const line of lines) {
    const match = chunkPattern.exec(line.trim());
    if (match) {
      if (currentIndex !== null && currentDesc.length > 0) {
        const desc = currentDesc.join(" ").trim();
        if (desc.length > 0 && currentIndex >= 0 && currentIndex < chunks.length) {
          result.set(chunks[currentIndex]!.id, desc);
        }
      }
      currentIndex = parseInt(match[1]!, 10);
      currentDesc = [line.slice(match[0]!.length).trim()];
    } else if (currentIndex !== null) {
      currentDesc.push(line.trim());
    }
  }

  if (currentIndex !== null && currentDesc.length > 0) {
    const desc = currentDesc.join(" ").trim();
    if (desc.length > 0 && currentIndex >= 0 && currentIndex < chunks.length) {
      result.set(chunks[currentIndex]!.id, desc);
    }
  }

  return result;
}

function extractResponseText(json: ChatResponse, isOllama: boolean): string {
  if (isOllama) {
    const content = json.message?.content;
    if (typeof content === "string" && content.trim().length > 0) {
      return content.trim();
    }
  }

  const content = json.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim().length > 0) {
    return content.trim();
  }

  throw new Error(
    `Description LLM returned empty response: ${JSON.stringify(json)}`
  );
}
