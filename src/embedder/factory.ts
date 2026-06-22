import type { EmbeddingProvider } from "../core/interfaces.js";
import type { RagConfig } from "../core/config.js";
import { isOpenAiCompatible } from "../core/provider-defaults.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAIProvider } from "./openai.js";
import { CohereProvider } from "./cohere.js";
import pLimit from "p-limit";

export function createEmbedder(config: RagConfig): EmbeddingProvider {
  const { provider, baseUrl, model, apiKey, proxy, timeoutMs } = config.embedding;
  const effectiveTimeoutMs = timeoutMs ?? 30000;

  if (provider === "ollama") {
    return new OllamaProvider(baseUrl, model, apiKey, effectiveTimeoutMs, proxy, config.logging.level);
  }

  if (provider === "cohere") {
    if (!apiKey) {
      throw new Error("Cohere provider requires an apiKey");
    }
    return new CohereProvider(baseUrl, model, apiKey, effectiveTimeoutMs, proxy);
  }

  if (isOpenAiCompatible(provider)) {
    if (!apiKey) {
      throw new Error(`${provider} provider requires an apiKey`);
    }
    return new OpenAIProvider(baseUrl, model, apiKey, effectiveTimeoutMs, proxy);
  }

  throw new Error(`Unknown embedding provider: ${provider}`);
}

export async function embedBatch(
  embedder: EmbeddingProvider,
  texts: string[],
  batchSize: number = 10,
  purpose?: "query" | "document",
  concurrency: number = 1
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const batches: { index: number; texts: string[] }[] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    batches.push({ index: i, texts: texts.slice(i, i + batchSize) });
  }

  if (concurrency <= 1 || batches.length <= 1) {
    const results: number[][] = [];
    for (const batch of batches) {
      const embeddings = await embedder.embed(batch.texts, purpose);
      results.push(...embeddings);
    }
    return results;
  }

  const limit = pLimit(concurrency);
  const batchResults = await Promise.all(
    batches.map((batch) =>
      limit(async () => {
        const embeddings = await embedder.embed(batch.texts, purpose);
        return { index: batch.index, embeddings };
      }),
    ),
  );

  batchResults.sort((a, b) => a.index - b.index);
  const results: number[][] = [];
  for (const { embeddings } of batchResults) {
    results.push(...embeddings);
  }
  return results;
}
