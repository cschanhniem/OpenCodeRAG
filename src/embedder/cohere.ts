import type { EmbeddingProvider } from "../core/interfaces.js";
import type { ProxyConfig } from "../core/config.js";
import { postJson } from "./http.js";

export class CohereProvider implements EmbeddingProvider {
  readonly name = "cohere";

  private baseUrl: string;
  private model: string;
  private apiKey: string;
  private timeoutMs: number;
  private proxy?: ProxyConfig;

  constructor(baseUrl: string, model: string, apiKey: string, timeoutMs: number = 30000, proxy?: ProxyConfig) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = model;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.proxy = proxy;
  }

  async embed(texts: string[], purpose?: "query" | "document"): Promise<number[][]> {
    const inputType = purpose === "query" ? "search_query" : "search_document";
    const body: Record<string, unknown> = {
      texts,
      model: this.model,
      input_type: inputType,
    };
    const response = await postJson(
      `${this.baseUrl}/embed`,
      body,
      { Authorization: `Bearer ${this.apiKey}` },
      this.timeoutMs,
      this.proxy,
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Cohere embedding failed (${response.status}): ${body}`);
    }

    const json = (await response.json()) as {
      embeddings?: number[][];
    };

    if (!json.embeddings || !Array.isArray(json.embeddings)) {
      throw new Error(`Cohere: unexpected response: ${JSON.stringify(json)}`);
    }

    return json.embeddings;
  }
}
