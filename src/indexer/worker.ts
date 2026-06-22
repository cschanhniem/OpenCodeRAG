import path from "node:path";
import { chunkFile } from "../chunker/factory.js";
import { uuid } from "../chunker/uuid.js";
import { isImageFile } from "../content/image.js";
import type { WorkspaceFile } from "../content/reader.js";
import type {
  DescriptionProvider,
  EmbeddingProvider,
  KeywordIndex,
  VectorStore,
} from "../core/interfaces.js";
import { buildFileMetadataHeader } from "./metadata.js";
import { generateDescriptions, buildFallbackDescription } from "./description-stage.js";

export interface WorkerResult {
  normalizedPath: string;
  hash: string;
  chunkCount: number;
  fileLabel: string;
  isNew: boolean;
  isModified: boolean;
  isUnchanged: boolean;
  isEmpty: boolean;
  isTooSmall: boolean;
  isRemoved: boolean;
  hadChunks: boolean;
}

interface Logger {
  info(message: string): void;
  warn(message: string): void;
}

interface ManifestFile {
  hash: string;
  chunkCount: number;
  indexedAt?: number;
}

export async function processFile(
  file: WorkspaceFile,
  cwd: string,
  previous: ManifestFile | undefined,
  config: {
    embedding: { documentPrefix?: string };
    indexing: { embedBatchSize: number };
    chunking?: { nodeTypes?: Record<string, string[]> };
  },
  store: VectorStore,
  keywordIndex: KeywordIndex | undefined,
  embedder: EmbeddingProvider,
  descriptionProvider: DescriptionProvider | undefined,
  logger: Logger,
): Promise<WorkerResult> {
  const fileLabel = path.relative(cwd, file.filePath);

  if (file.isEmpty) {
    if (previous) {
      await store.deleteByFilePath(file.normalizedPath);
      keywordIndex?.removeByFilePath(file.normalizedPath);
      logger.info(`  ${fileLabel} (empty, removed from index)`);
      return { normalizedPath: file.normalizedPath, hash: file.hash, chunkCount: 0, fileLabel, isNew: false, isModified: false, isUnchanged: false, isEmpty: true, isTooSmall: false, isRemoved: true, hadChunks: false };
    }
    logger.info(`  ${fileLabel} (empty, skipped)`);
    return { normalizedPath: file.normalizedPath, hash: file.hash, chunkCount: 0, fileLabel, isNew: false, isModified: false, isUnchanged: false, isEmpty: true, isTooSmall: false, isRemoved: false, hadChunks: false };
  }

  if (file.isTooSmall) {
    if (previous) {
      await store.deleteByFilePath(file.normalizedPath);
      keywordIndex?.removeByFilePath(file.normalizedPath);
      logger.info(`  ${fileLabel} (too small, removed from index)`);
      return { normalizedPath: file.normalizedPath, hash: file.hash, chunkCount: 0, fileLabel, isNew: false, isModified: false, isUnchanged: false, isEmpty: false, isTooSmall: true, isRemoved: true, hadChunks: false };
    }
    logger.info(`  ${fileLabel} (too small, skipped)`);
    return { normalizedPath: file.normalizedPath, hash: file.hash, chunkCount: 0, fileLabel, isNew: false, isModified: false, isUnchanged: false, isEmpty: false, isTooSmall: true, isRemoved: false, hadChunks: false };
  }

  if (previous && previous.hash === file.hash) {
    logger.info(`  ${fileLabel} (unchanged)`);
    return { normalizedPath: file.normalizedPath, hash: file.hash, chunkCount: 0, fileLabel, isNew: false, isModified: false, isUnchanged: true, isEmpty: false, isTooSmall: false, isRemoved: false, hadChunks: false };
  }

  let isModified = false;
  if (previous) {
    await store.deleteByFilePath(file.normalizedPath);
    keywordIndex?.removeByFilePath(file.normalizedPath);
    isModified = true;
  }

  let chunks;

  if (isImageFile(file.filePath) && file.content.trim().length > 0) {
    const imgExt = path.extname(file.filePath).toLowerCase();
    const imgRelPath = path.relative(cwd, file.filePath).replace(/\\/g, "/");
    const metaHeader = `[image] [${imgExt.slice(1)}] [${imgRelPath}]`;
    chunks = [{
      id: uuid(),
      content: metaHeader + " " + file.content,
      metadata: {
        filePath: file.filePath,
        startLine: 1,
        endLine: 1,
        language: "image",
        contentType: "image",
      },
    }];
  } else {
    chunks = await chunkFile(file.filePath, file.content, config.chunking?.nodeTypes).catch((err) => {
      logger.warn(`  ${fileLabel} (chunking failed: ${(err as Error).message})`);
      return null;
    });
  }

  if (chunks === null || chunks.length === 0) {
    if (chunks === null) {
      if (previous) {
        return { normalizedPath: file.normalizedPath, hash: file.hash, chunkCount: previous.chunkCount, fileLabel, isNew: false, isModified: false, isUnchanged: true, isEmpty: false, isTooSmall: false, isRemoved: false, hadChunks: true };
      }
      return { normalizedPath: file.normalizedPath, hash: file.hash, chunkCount: 0, fileLabel, isNew: false, isModified: false, isUnchanged: false, isEmpty: false, isTooSmall: false, isRemoved: true, hadChunks: false };
    }
    logger.info(`  ${fileLabel} (0 chunks, removed from index)`);
    return { normalizedPath: file.normalizedPath, hash: file.hash, chunkCount: 0, fileLabel, isNew: false, isModified: false, isUnchanged: false, isEmpty: false, isTooSmall: false, isRemoved: true, hadChunks: false };
  }

  keywordIndex?.addChunks(chunks);

  try {
    const docPrefix = config.embedding.documentPrefix ?? "";
    const relPath = path.relative(cwd, file.filePath).replace(/\\/g, "/");
    const isImage = isImageFile(file.filePath);
    const metaHeader = isImage
      ? ""
      : buildFileMetadataHeader(file.filePath, cwd, file.content);
    const textToEmbed: string[] = [];

    if (descriptionProvider) {
      const { descriptionMap } = await generateDescriptions(chunks, descriptionProvider, logger);

      for (const chunk of chunks) {
        if (isImage) {
          textToEmbed.push(docPrefix + relPath + "\n\n" + chunk.description);
        } else {
          const batchDesc = descriptionMap.get(chunk.id);
          if (batchDesc && batchDesc.trim().length > 0) {
            textToEmbed.push(docPrefix + relPath + "\n\n" + metaHeader + "\n\n" + batchDesc + "\n\n" + chunk.content);
          } else if (chunk.description) {
            textToEmbed.push(docPrefix + relPath + "\n\n" + metaHeader + "\n\n" + chunk.description + "\n\n" + chunk.content);
          } else {
            textToEmbed.push(docPrefix + relPath + "\n\n" + metaHeader + "\n\n" + chunk.content);
          }
        }
      }
    } else {
      for (const chunk of chunks) {
        if (isImage) {
          chunk.description = chunk.content;
          textToEmbed.push(docPrefix + relPath + "\n\n" + chunk.description);
        } else {
          chunk.description = buildFallbackDescription(chunk);
          textToEmbed.push(docPrefix + relPath + "\n\n" + metaHeader + "\n\n" + chunk.description + "\n\n" + chunk.content);
        }
      }
    }

    const { embedBatch } = await import("../embedder/factory.js");
    const embeddings = await embedBatch(embedder, textToEmbed, config.indexing.embedBatchSize, "document");

    for (let i = 0; i < chunks.length; i++) {
      const emb = embeddings[i];
      if (Array.isArray(emb) && emb.length > 0 && typeof emb[0] === "number") {
        chunks[i]!.embedding = emb as number[];
      } else {
        chunks[i]!.embedding = undefined;
      }
    }

    const validChunks = chunks.filter((c) => c.embedding && c.embedding.length > 0);
    if (validChunks.length > 0) {
      await store.addChunks(validChunks);
    }

    logger.info(`  ${fileLabel} (${chunks.length} chunks${isModified ? ", modified" : ", new"})`);

    return {
      normalizedPath: file.normalizedPath,
      hash: file.hash,
      chunkCount: chunks.length,
      fileLabel,
      isNew: !isModified && !previous,
      isModified,
      isUnchanged: false,
      isEmpty: false,
      isTooSmall: false,
      isRemoved: false,
      hadChunks: chunks.length > 0,
    };
  } catch (err) {
    logger.warn(`  ${fileLabel} (embed/store failed: ${(err as Error).message})`);
    if (previous) {
      return { normalizedPath: file.normalizedPath, hash: file.hash, chunkCount: previous.chunkCount, fileLabel, isNew: false, isModified: false, isUnchanged: true, isEmpty: false, isTooSmall: false, isRemoved: false, hadChunks: true };
    }
    return { normalizedPath: file.normalizedPath, hash: file.hash, chunkCount: 0, fileLabel, isNew: false, isModified: false, isUnchanged: false, isEmpty: false, isTooSmall: false, isRemoved: true, hadChunks: false };
  }
}
