import fs from "node:fs/promises";
import path from "node:path";
import type { RagConfig } from "../core/config.js";
import { computeFileHash, normalizeFilePath } from "../core/manifest.js";
import {
  createImageVisionProvider,
  type ImageVisionProvider,
} from "../chunker/image.js";
import type { ExtractResult } from "./types.js";
import * as pdfExtractor from "./pdf.js";
import * as docxExtractor from "./docx.js";
import * as docExtractor from "./doc.js";
import * as excelExtractor from "./excel.js";
import * as imageExtractor from "./image.js";

export interface WorkspaceFile {
  filePath: string;
  normalizedPath: string;
  content: string;
  hash: string;
  isEmpty: boolean;
  isTooSmall: boolean;
  extractionStatus: "ok" | "skipped" | "failed";
  extractionError?: string;
}

interface Logger {
  info(message: string): void;
  warn(message: string): void;
  debug(message: string): void;
}

export async function walkFiles(
  dir: string,
  extensions: Set<string>,
  excludeDirs: Set<string>,
): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (excludeDirs.has(entry.name)) continue;
      if (entry.name.startsWith(".") && !extensions.size) continue;
      results.push(...(await walkFiles(fullPath, extensions, excludeDirs)));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const basename = entry.name.toLowerCase();
      if (extensions.has(ext) || extensions.has(basename)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

async function dispatchExtraction(
  filePath: string,
  buffer: Buffer,
  imageVisionProvider: ImageVisionProvider | null,
  imagePrompt: string | undefined,
): Promise<ExtractResult> {
  const lower = filePath.toLowerCase();

  if (pdfExtractor.PDF_EXTENSIONS.has(lower)) {
    return pdfExtractor.extract(filePath, buffer);
  }
  if (docxExtractor.DOCX_EXTENSIONS.has(lower)) {
    return docxExtractor.extract(filePath, buffer);
  }
  if (docExtractor.DOC_EXTENSIONS.has(lower)) {
    return docExtractor.extract(filePath, buffer);
  }
  if (excelExtractor.EXCEL_EXTENSIONS.has(lower)) {
    return excelExtractor.extract(filePath, buffer);
  }
  if (imageVisionProvider && imageExtractor.isImageFile(filePath)) {
    return imageExtractor.extract(filePath, buffer, imageVisionProvider, imagePrompt ?? "");
  }

  try {
    const content = await fs.readFile(filePath, "utf-8");
    return { content, ok: true };
  } catch (err) {
    return { content: "", ok: false, error: (err as Error).message };
  }
}

export async function scanWorkspaceFiles(
  cwd: string,
  config: RagConfig,
  logger?: Logger,
): Promise<WorkspaceFile[]> {
  const extensions = new Set(config.indexing.includeExtensions);

  let imageVisionProvider: ImageVisionProvider | null = null;
  let imagePrompt: string | undefined;
  const imageCfg = config.imageDescription;
  if (imageCfg?.enabled) {
    for (const ext of imageExtractor.SUPPORTED_IMAGE_EXTENSIONS) {
      extensions.add(ext.toLowerCase());
    }
    imageVisionProvider = createImageVisionProvider(imageCfg);
    imagePrompt = imageCfg.prompt;
  }

  const files = await walkFiles(
    cwd,
    extensions,
    new Set(config.indexing.excludeDirs),
  );

  logger?.info(`Found ${files.length} files to scan`);

  const minSize = config.indexing.minFileSizeBytes ?? 0;
  const workspaceFiles: WorkspaceFile[] = [];
  const totalFiles = files.length;

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i]!;
    const isBinary =
      pdfExtractor.PDF_EXTENSIONS.has(filePath.toLowerCase()) ||
      docxExtractor.DOCX_EXTENSIONS.has(filePath.toLowerCase()) ||
      docExtractor.DOC_EXTENSIONS.has(filePath.toLowerCase()) ||
      excelExtractor.EXCEL_EXTENSIONS.has(filePath.toLowerCase()) ||
      (imageVisionProvider !== null && imageExtractor.isImageFile(filePath));

    const buffer = isBinary ? await fs.readFile(filePath) : Buffer.alloc(0);
    const result = await dispatchExtraction(filePath, buffer, imageVisionProvider, imagePrompt);

    if (!result.ok) {
      logger?.warn(`  ${filePath} (extraction failed: ${result.error})`);
    }

    const content = result.content;
    const byteLength = Buffer.byteLength(content, "utf-8");

    workspaceFiles.push({
      filePath,
      normalizedPath: normalizeFilePath(filePath),
      content,
      hash: computeFileHash(content),
      isEmpty: content.trim().length === 0,
      isTooSmall: !content.trim().length === false && byteLength < minSize,
      extractionStatus: result.ok ? "ok" : "failed",
      extractionError: result.ok ? undefined : result.error,
    });

    if (totalFiles > 20 && (i + 1) % 50 === 0) {
      logger?.info(`  Scanning files... ${i + 1}/${totalFiles}`);
    }
    logger?.debug(`  scanWorkspaceFiles: ${filePath}`);
  }

  return workspaceFiles;
}
