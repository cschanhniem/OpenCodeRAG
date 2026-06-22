import type { Chunk, DescriptionProvider } from "../core/interfaces.js";

export interface DescriptionResult {
  descriptionMap: Map<string, string>;
  failures: Array<{ chunkId: string; error: string }>;
}

interface Logger {
  warn(message: string): void;
  debug(message: string): void;
}

export async function generateDescriptions(
  chunks: Chunk[],
  descriptionProvider: DescriptionProvider,
  logger?: Logger,
): Promise<DescriptionResult> {
  const descriptionMap = new Map<string, string>();
  const failures: Array<{ chunkId: string; error: string }> = [];

  if (chunks.length === 0) {
    return { descriptionMap, failures };
  }

  const nonImageChunks = chunks.filter(
    (c) => c.metadata.contentType !== "image",
  );

  let batchMap: Map<string, string> | null = null;
  if (nonImageChunks.length > 1) {
    logger?.debug(`  Generating batch descriptions for ${nonImageChunks.length} chunks...`);
    try {
      batchMap = await descriptionProvider.generateBatchDescriptions(
        nonImageChunks,
      );
      logger?.debug(`  Batch descriptions received for ${batchMap.size} chunks`);
    } catch (err) {
      logger?.warn(
        `Batch description failed, falling back to individual: ${(err as Error).message}`,
      );
    }
  }

  for (const chunk of chunks) {
    if (chunk.metadata.contentType === "image") {
      chunk.description = chunk.content;
      descriptionMap.set(chunk.id, chunk.description);
      logger?.debug(`  description [${chunk.id}] (image): ${chunk.description.substring(0, 100)}...`);
      continue;
    }

    const batchDesc = batchMap?.get(chunk.id);
    if (batchDesc && batchDesc.trim().length > 0) {
      chunk.description = batchDesc;
      descriptionMap.set(chunk.id, batchDesc);
      logger?.debug(`  description [${chunk.id}] (batch): ${batchDesc.substring(0, 100)}...`);
    } else {
      try {
        const desc = await descriptionProvider.generateDescription(chunk);
        chunk.description = desc;
        descriptionMap.set(chunk.id, desc);
        logger?.debug(`  description [${chunk.id}] (individual): ${desc.substring(0, 100)}...`);
      } catch (err) {
        const errorMsg = (err as Error).message;
        logger?.warn(
          `Description generation failed for ${chunk.id}, falling back to content: ${errorMsg}`,
        );
        failures.push({ chunkId: chunk.id, error: errorMsg });
      }
    }
  }

  return { descriptionMap, failures };
}

export function buildFallbackDescription(chunk: Chunk): string {
  return `lines ${chunk.metadata.startLine}-${chunk.metadata.endLine}, ${chunk.metadata.language}`;
}
