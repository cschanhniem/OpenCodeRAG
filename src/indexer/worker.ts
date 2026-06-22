import path from "node:path";
import { chunkFile } from "../chunker/factory.js";
import { uuid } from "../chunker/uuid.js";
import { isImageFile } from "../content/image.js";
import type { WorkspaceFile } from "../content/reader.js";
import type {
  Chunk,
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

export interface PreparedFile {
  normalizedPath: string;
  hash: string;
  fileLabel: string;
  isModified: boolean;
  earlyResult?: WorkerResult;
  chunks?: Chunk[];
  textToEmbed?: string[];
}

interface Logger {
  info(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
}

interface ManifestFile {
  hash: string;
  chunkCount: number;
  indexedAt?: number;
}

export async function prepareFile(
  file: WorkspaceFile,
  cwd: string,
  previous: ManifestFile | undefined,
  config: {
    embedding: { documentPrefix?: string };
    chunking?: { nodeTypes?: Record<string, string[]> };
  },
  keywordIndex: KeywordIndex | undefined,
  descriptionProvider: DescriptionProvider | undefined,
  logger: Logger,
): Promise<PreparedFile> {
  const fileLabel = path.relative(cwd, file.filePath);

  if (file.isEmpty) {
    return {
      normalizedPath: file.normalizedPath, hash: file.hash, fileLabel,
      isModified: false,
      earlyResult: {
        normalizedPath: file.normalizedPath, hash: file.hash, chunkCount: 0, fileLabel,
        isNew: false, isModified: false, isUnchanged: false, isEmpty: true, isTooSmall: false, isRemoved: !!previous, hadChunks: false,
      },
    };
  }

  if (file.isTooSmall) {
    return {
      normalizedPath: file.normalizedPath, hash: file.hash, fileLabel,
      isModified: false,
      earlyResult: {
        normalizedPath: file.normalizedPath, hash: file.hash, chunkCount: 0, fileLabel,
        isNew: false, isModified: false, isUnchanged: false, isEmpty: false, isTooSmall: true, isRemoved: !!previous, hadChunks: false,
      },
    };
  }

  if (previous && previous.hash === file.hash) {
    return {
      normalizedPath: file.normalizedPath, hash: file.hash, fileLabel,
      isModified: false,
      earlyResult: {
        normalizedPath: file.normalizedPath, hash: file.hash, chunkCount: 0, fileLabel,
        isNew: false, isModified: false, isUnchanged: true, isEmpty: false, isTooSmall: false, isRemoved: false, hadChunks: false,
      },
    };
  }

  const isModified = !!previous;

  let chunks: Chunk[] | null;

  if (isImageFile(file.filePath) && file.content.trim().length > 0) {
    const imgExt = path.extname(file.filePath).toLowerCase();
    const imgRelPath = path.relative(cwd, file.filePath).replace(/\\/g, "/");
    const metaHeader = `[image] [${imgExt.slice(1)}] [${imgRelPath}]`;
    chunks = [{
      id: uuid(),
      content: metaHeader + " " + file.content,
      metadata: {
        filePath: file.filePath, startLine: 1, endLine: 1,
        language: "image", contentType: "image",
      },
    }];
  } else {
    chunks = await chunkFile(file.filePath, file.content, config.chunking?.nodeTypes).catch((err) => {
      logger.warn(`  ${fileLabel} (chunking failed: ${(err as Error).message})`);
      return null;
    });
  }

  if (chunks === null || chunks.length === 0) {
    if (chunks === null && previous) {
      return {
        normalizedPath: file.normalizedPath, hash: file.hash, fileLabel,
        isModified: false,
        earlyResult: {
          normalizedPath: file.normalizedPath, hash: file.hash, chunkCount: previous.chunkCount, fileLabel,
          isNew: false, isModified: false, isUnchanged: true, isEmpty: false, isTooSmall: false, isRemoved: false, hadChunks: true,
        },
      };
    }
    return {
      normalizedPath: file.normalizedPath, hash: file.hash, fileLabel,
      isModified: false,
      earlyResult: {
        normalizedPath: file.normalizedPath, hash: file.hash, chunkCount: 0, fileLabel,
        isNew: false, isModified: false, isUnchanged: false, isEmpty: false, isTooSmall: false, isRemoved: true, hadChunks: false,
      },
    };
  }

  logger.debug(`  ${fileLabel}: ${chunks.length} chunks produced`);
  keywordIndex?.addChunks(chunks);

  const docPrefix = config.embedding.documentPrefix ?? "";
  const relPath = path.relative(cwd, file.filePath).replace(/\\/g, "/");
  const isImage = isImageFile(file.filePath);
  const metaHeader = isImage ? "" : buildFileMetadataHeader(file.filePath, cwd, file.content);
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

  logger.debug(`  ${fileLabel}: textToEmbed ${textToEmbed.length} entries (descProvider: ${descriptionProvider ? "yes" : "no"})`);

  return {
    normalizedPath: file.normalizedPath,
    hash: file.hash,
    fileLabel,
    isModified,
    chunks,
    textToEmbed,
  };
}

export async function storeFileChunks(
  prep: PreparedFile,
  embeddings: number[][],
  store: VectorStore,
  logger?: Logger,
): Promise<WorkerResult> {
  if (prep.earlyResult) return prep.earlyResult;
  if (!prep.chunks || !prep.textToEmbed) {
    return {
      normalizedPath: prep.normalizedPath, hash: prep.hash, chunkCount: 0, fileLabel: prep.fileLabel,
      isNew: false, isModified: false, isUnchanged: false, isEmpty: false, isTooSmall: false, isRemoved: true, hadChunks: false,
    };
  }

  for (let i = 0; i < prep.chunks.length; i++) {
    const emb = embeddings[i];
    if (Array.isArray(emb) && emb.length > 0 && typeof emb[0] === "number") {
      prep.chunks[i]!.embedding = emb as number[];
    } else {
      prep.chunks[i]!.embedding = undefined;
    }
  }

  const validChunks = prep.chunks.filter((c) => c.embedding && c.embedding.length > 0);
  if (validChunks.length > 0) {
    await store.addChunks(validChunks);
  }

  logger?.info(`  ${prep.fileLabel} (${prep.chunks.length} chunks${prep.isModified ? ", modified" : ", new"})`);

  return {
    normalizedPath: prep.normalizedPath,
    hash: prep.hash,
    chunkCount: prep.chunks.length,
    fileLabel: prep.fileLabel,
    isNew: !prep.isModified,
    isModified: prep.isModified,
    isUnchanged: false,
    isEmpty: false,
    isTooSmall: false,
    isRemoved: false,
    hadChunks: prep.chunks.length > 0,
  };
}

export async function processFile(
  file: WorkspaceFile,
  cwd: string,
  previous: ManifestFile | undefined,
  config: {
    embedding: { documentPrefix?: string };
    indexing: { embedBatchSize: number; embedConcurrency?: number };
    chunking?: { nodeTypes?: Record<string, string[]> };
  },
  store: VectorStore,
  keywordIndex: KeywordIndex | undefined,
  embedder: EmbeddingProvider,
  descriptionProvider: DescriptionProvider | undefined,
  logger: Logger,
): Promise<WorkerResult> {
  const prep = await prepareFile(file, cwd, previous, config, keywordIndex, descriptionProvider, logger);

  if (prep.earlyResult) {
    if ((prep.earlyResult.isEmpty || prep.earlyResult.isTooSmall) && prep.earlyResult.isRemoved) {
      await store.deleteByFilePath(prep.normalizedPath);
      keywordIndex?.removeByFilePath(prep.normalizedPath);
    }
    return prep.earlyResult;
  }

  if (prep.isModified) {
    await store.deleteByFilePath(prep.normalizedPath);
    keywordIndex?.removeByFilePath(prep.normalizedPath);
  }

  if (!prep.textToEmbed || prep.textToEmbed.length === 0) {
    return {
      normalizedPath: prep.normalizedPath, hash: prep.hash, chunkCount: 0, fileLabel: prep.fileLabel,
      isNew: false, isModified: false, isUnchanged: true, isEmpty: false, isTooSmall: false, isRemoved: false, hadChunks: false,
    };
  }

  try {
    const { embedBatch } = await import("../embedder/factory.js");
    const embeddings = await embedBatch(embedder, prep.textToEmbed, config.indexing.embedBatchSize, "document", config.indexing.embedConcurrency ?? 1);
    const result = await storeFileChunks(prep, embeddings, store);
    return result;
  } catch (err) {
    logger.warn(`  ${prep.fileLabel} (embed/store failed: ${(err as Error).message})`);
    return {
      normalizedPath: prep.normalizedPath, hash: prep.hash, chunkCount: 0, fileLabel: prep.fileLabel,
      isNew: false, isModified: false, isUnchanged: false, isEmpty: false, isTooSmall: false, isRemoved: true, hadChunks: false,
    };
  }
}
