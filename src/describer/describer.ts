import type { Chunk, DescriptionProvider } from "../core/interfaces.js";
import type { DescriptionConfig, ProxyConfig } from "../core/config.js";
import { postJson } from "../embedder/http.js";
import { buildUserMessage, sleep } from "./shared.js";
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

  async generateBatchDescriptions(chunks: Chunk[], logDebug?: (msg: string) => void): Promise<Map<string, string>> {
    const concurrency = this.config.batchConcurrency ?? 3;
    const total = chunks.length;
    console.log(`[describer] Generating descriptions for ${total} chunks (concurrency: ${concurrency})`);

    const result = new Map<string, string>();
    const limit = pLimit(concurrency);
    let completed = 0;

    await Promise.all(
      chunks.map((chunk) =>
        limit(async () => {
          const userMsg = buildUserMessage(chunk);
          (logDebug ?? console.debug)(`[describer] REQUEST chunk ${chunk.id} (${chunk.metadata.filePath}:${chunk.metadata.startLine}):\n${userMsg}`);
          try {
            const desc = await this.generateDescription(chunk);
            result.set(chunk.id, desc);
            (logDebug ?? console.debug)(`[describer] RESPONSE chunk ${chunk.id}: ${desc}`);
          } catch (err) {
            console.warn(`[describer] Failed to describe chunk ${chunk.id} (${chunk.metadata.filePath}:${chunk.metadata.startLine}): ${err instanceof Error ? err.message : String(err)}`);
          }
          completed++;
          if (completed % 25 === 0 || completed === total) {
            console.log(`[describer] Progress: ${completed}/${total}`);
          }
        }),
      ),
    );

    console.log(`[describer] Descriptions generated: ${result.size}/${total}`);
    return result;
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
