/**
 * @fileoverview Generates AI and fallback descriptions for code chunks.
 */
import type { Chunk, DescriptionProvider } from "../core/interfaces.js";

/** Result of a description generation run, including per-chunk descriptions and any failures. */
export interface DescriptionResult {
  descriptionMap: Map<string, string>;
  failures: Array<{ chunkId: string; error: string }>;
}

interface Logger {
  warn(message: string): void;
  debug(message: string): void;
}

/**
 * Generate AI or fallback descriptions for a set of code chunks.
 *
 * Chunks that already have a description (e.g. from docstrings) are skipped.
 * Oversized chunks exceeding `maxContentChars` receive a fallback description
 * instead of being sent to the LLM.  Remaining chunks are sent in batch to
 * the description provider, with individual fallback on batch failure.
 *
 * @param chunks - Chunks to describe.
 * @param descriptionProvider - Provider that generates AI descriptions.
 * @param logger - Optional logger for diagnostic messages.
 * @param maxContentChars - Optional maximum content length for LLM submission;
 *   chunks longer than this get a fallback description.
 * @returns A map of chunk ID to description and a list of failures.
 */
export async function generateDescriptions(
  chunks: Chunk[],
  descriptionProvider: DescriptionProvider,
  logger?: Logger,
  maxContentChars?: number,
): Promise<DescriptionResult> {
  const descriptionMap = new Map<string, string>();
  const failures: Array<{ chunkId: string; error: string }> = [];

  if (chunks.length === 0) {
    return { descriptionMap, failures };
  }

  const nonImageChunks = chunks.filter(
    (c) => c.metadata.contentType !== "image" && !c.description,
  );

  const oversizedChunks = maxContentChars
    ? nonImageChunks.filter((c) => c.content.length > maxContentChars)
    : [];
  const llmChunks = maxContentChars
    ? nonImageChunks.filter((c) => c.content.length <= maxContentChars)
    : nonImageChunks;

  for (const chunk of oversizedChunks) {
    chunk.description = buildFallbackDescription(chunk);
    descriptionMap.set(chunk.id, chunk.description);
    logger?.debug(`  description [${chunk.id}] (oversized fallback): ${chunk.description}`);
  }

  const preDocumentedCount = chunks.filter((c) => c.description).length;
  if (preDocumentedCount > 0) {
    logger?.debug(`  Skipping LLM descriptions for ${preDocumentedCount} already-documented chunks`);
  }

  let batchMap: Map<string, string> | null = null;
  if (llmChunks.length > 1) {
    logger?.debug(`  Generating batch descriptions for ${llmChunks.length} chunks...`);
    try {
      batchMap = await descriptionProvider.generateBatchDescriptions(
        llmChunks,
        (msg: string) => logger?.debug(msg),
      );
      logger?.debug(`  Batch descriptions received for ${batchMap.size} chunks`);
    } catch (err) {
      logger?.warn(
        `Batch description failed, falling back to individual: ${(err as Error).message}`,
      );
    }
  }

  for (const chunk of chunks) {
    if (chunk.description) {
      descriptionMap.set(chunk.id, chunk.description);
      logger?.debug(`  description [${chunk.id}] (docstring): ${chunk.description.substring(0, 100)}...`);
      continue;
    }

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

/**
 * Build a simple fallback description from a chunk's file location metadata.
 * Used when AI description generation is unavailable or fails.
 *
 * @param chunk - The chunk to describe.
 * @returns A description string like `"lines 10-25, typescript"`.
 */
export function buildFallbackDescription(chunk: Chunk): string {
  return `lines ${chunk.metadata.startLine}-${chunk.metadata.endLine}, ${chunk.metadata.language}`;
}
