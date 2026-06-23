import type { Chunk, DescriptionProvider } from "../core/interfaces.js";
import type { DescriptionConfig, ProxyConfig } from "../core/config.js";
import { postJson } from "../embedder/http.js";
import { buildUserMessage, sleep } from "./shared.js";
import pLimit from "p-limit";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
}

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export class AnthropicDescriptionProvider implements DescriptionProvider {
  private readonly config: DescriptionConfig;

  constructor(config: DescriptionConfig) {
    this.config = config;
  }

  async generateDescription(chunk: Chunk): Promise<string> {
    const messages: AnthropicMessage[] = [
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
    messages: AnthropicMessage[],
    timeoutMs: number,
  ): Promise<string> {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, "");
    const apiKey = this.config.apiKey ?? "";
    const systemPrompt = this.config.systemPrompt;

    const body: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: 4096,
      messages: [{ role: "user", content: systemPrompt + "\n\n" + messages.map((m) => `${m.role}: ${m.content}`).join("\n\n") + "\n\nassistant:" }],
    };

    const headers: Record<string, string> = {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    };

    const retryMax = this.config.retryMax ?? 3;
    const retryBaseDelayMs = this.config.retryBaseDelayMs ?? 1000;

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= retryMax; attempt++) {
      const response = await postJson(
        `${baseUrl}/messages`,
        body,
        headers,
        timeoutMs,
        this.config.proxy,
      );

      if (response.ok) {
        const json = (await response.json()) as AnthropicResponse;
        const text = json.content?.[0]?.text;
        if (text && text.trim().length > 0) {
          return text.trim();
        }
        throw new Error(`Anthropic returned empty response: ${JSON.stringify(json)}`);
      }

      const text = await response.text();
      const error = new Error(
        `Anthropic LLM request failed (${response.status}): ${text}`,
      );

      if (!RETRYABLE_STATUSES.has(response.status) || attempt === retryMax) {
        throw error;
      }

      lastError = error;
      const delayMs = retryBaseDelayMs * Math.pow(2, attempt);
      await sleep(delayMs);
    }

    throw lastError ?? new Error("Anthropic LLM request failed: unknown error");
  }
}


