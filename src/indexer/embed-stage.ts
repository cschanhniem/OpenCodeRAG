import pLimit from "p-limit";
import type { Chunk, EmbeddingProvider } from "../core/interfaces.js";
import { embedBatch } from "../embedder/factory.js";

export interface EmbedChunksOptions {
  chunks: Chunk[];
  embedder: EmbeddingProvider;
  batchSize: number;
  concurrency: number;
}

export async function embedChunks({
  chunks,
  embedder,
  batchSize,
  concurrency,
}: EmbedChunksOptions): Promise<Chunk[]> {
  if (chunks.length === 0) return [];

  const limit = pLimit(concurrency);

  const results = await Promise.all(
    chunks.map((chunk, index) =>
      limit(async () => {
        if (!chunk.embedding || chunk.embedding.length === 0) {
          return chunk;
        }
        return chunk;
      }),
    ),
  );

  const textsToEmbed: string[] = [];
  const chunkIndices: number[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    if (chunk.embedding && chunk.embedding.length > 0) continue;
    textsToEmbed.push(chunk.content);
    chunkIndices.push(i);
  }

  if (textsToEmbed.length > 0) {
    const embeddings = await embedBatch(embedder, textsToEmbed, batchSize, "document");

    for (let i = 0; i < chunkIndices.length; i++) {
      const chunkIdx = chunkIndices[i]!;
      const emb = embeddings[i];
      if (Array.isArray(emb) && emb.length > 0 && typeof emb[0] === "number") {
        chunks[chunkIdx]!.embedding = emb as number[];
      }
    }
  }

  return chunks;
}
