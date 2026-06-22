import path from "node:path";
import type { ExtractResult } from "./types.js";
import {
  getMimeType,
  SUPPORTED_IMAGE_EXTENSIONS,
  type ImageVisionProvider,
} from "../chunker/image.js";

export { SUPPORTED_IMAGE_EXTENSIONS };

export function isImageFile(fp: string): boolean {
  const lower = fp.toLowerCase();
  for (const ext of SUPPORTED_IMAGE_EXTENSIONS) {
    if (lower.endsWith(ext.toLowerCase())) return true;
  }
  return false;
}

export async function extract(
  filePath: string,
  buffer: Buffer,
  visionProvider: ImageVisionProvider,
  prompt: string,
): Promise<ExtractResult> {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = getMimeType(ext);
    const b64 = buffer.toString("base64");
    const content = await visionProvider.describeImage(b64, mimeType, prompt);
    return { content, ok: true };
  } catch (err) {
    return { content: "", ok: false, error: (err as Error).message };
  }
}
