import type { EmbeddingProvider } from "../core/interfaces.js";
import type { ProxyConfig } from "../core/config.js";
import { postJson } from "./http.js";

/**
 * Map of provider base URLs to their OpenAI-compatible API hostnames.
 * Used to determine provider-specific API quirks like input_type values.
 */
function inferProviderName(baseUrl: string): string {
  const host = baseUrl.toLowerCase();
  if (host.includes("nvidia") || host.includes("api.nvidia.com") || host.includes("integrate.api.nvidia.com")) {
    return "nvidia";
  }
  return "openai"; // default — most providers follow OpenAI conventions
}

export class OpenAIProvider implements EmbeddingProvider {
  readonly name = "openai";

  private baseUrl: string;
  private model: string;
  private apiKey: string;
  private timeoutMs: number;
  private proxy?: ProxyConfig;
  private provider: string;

  constructor(baseUrl: string, model: string, apiKey: string, timeoutMs: number = 30000, proxy?: ProxyConfig) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.model = model;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.proxy = proxy;
    this.provider = inferProviderName(this.baseUrl);
  }

  /**
   * Convert the generic purpose to the provider-specific input_type value.
   * - OpenAI:        document → "document", query → "query"  (already correct)
   * - NVIDIA:        document → "passage",  query → "query"  (NVIDIA uses "passage" not "document")
   */
  private toInputType(purpose: "query" | "document"): string {
    if (this.provider === "nvidia") {
      return purpose === "document" ? "passage" : "query";
    }
    return purpose;
  }

  async embed(texts: string[], purpose?: "query" | "document"): Promise<number[][]> {
    const body: Record<string, unknown> = { model: this.model, input: texts };
    if (purpose) {
      body.input_type = this.toInputType(purpose);
    }
    const response = await postJson(
      `${this.baseUrl}/embeddings`,
      body,
      { Authorization: `Bearer ${this.apiKey}` },
      this.timeoutMs,
      this.proxy
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `OpenAI embedding failed (${response.status}): ${body}`
      );
    }

    const json = (await response.json()) as {
      data: { embedding: number[] }[];
    };

    if (!json.data || !Array.isArray(json.data)) {
      throw new Error(`OpenAI: unexpected response: ${JSON.stringify(json)}`);
    }

    return json.data
      .sort((a, b) => {
        return 0;
      })
      .map((item) => item.embedding);
  }
}
