import type { Chunker, Chunk } from "../core/interfaces.js";
import type { ImageDescriptionConfig, ProxyConfig } from "../core/config.js";
import { postJson } from "../embedder/http.js";
import { uuid } from "./uuid.js";

const MAX_CHUNK_CHARS = 4000;
const MIN_GROUP_CHARS = 300;
const PARAGRAPH_SPLIT = /\n\s*\n/;
const VISION_RETRY_MAX = 2;
const VISION_RETRY_BASE_DELAY_MS = 1000;
const VISION_RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function visionSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp",
]);

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

export function getMimeType(ext: string): string {
  return MIME_TYPES[ext.toLowerCase().replace(/^\./, "")] || "image/png";
}

export interface ImageVisionProvider {
  describeImage(imageBase64: string, mimeType: string, prompt: string, abort?: AbortSignal): Promise<string>;
}

class OllamaImageVisionProvider implements ImageVisionProvider {
  private baseUrl: string;
  private model: string;
  private timeoutMs: number;
  private think: boolean;
  private numCtx?: number;
  private proxy?: ProxyConfig;

  constructor(config: ImageDescriptionConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.model = config.model;
    this.timeoutMs = config.timeoutMs;
    this.think = config.think ?? false;
    this.numCtx = config.numCtx;
    this.proxy = config.proxy;
  }

  async describeImage(imageBase64: string, mimeType: string, prompt: string, abort?: AbortSignal): Promise<string> {
    const body = {
      model: this.model,
      messages: [
        {
          role: "user",
          content: prompt,
          images: [imageBase64],
        },
      ],
      stream: false,
      think: this.think,
      options: { num_ctx: this.numCtx },
    };

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= VISION_RETRY_MAX; attempt++) {
      const response = await postJson(
        `${this.baseUrl}/chat`,
        body,
        {},
        this.timeoutMs,
        this.proxy,
      );

      if (!response.ok) {
        const text = await response.text();
        const error = new Error(`Ollama vision request failed (${response.status}): ${text}`);
        if (VISION_RETRYABLE_STATUSES.has(response.status) && attempt < VISION_RETRY_MAX) {
          lastError = error;
          await visionSleep(VISION_RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        throw error;
      }

      const json = (await response.json()) as {
        message?: { content?: string; thinking?: string };
      };
      const content = json.message?.content;
      if (content && content.trim().length > 0) {
        return content.trim();
      }

      lastError = new Error(`Ollama vision returned empty response: ${JSON.stringify(json)}`);
      if (attempt < VISION_RETRY_MAX) {
        await visionSleep(VISION_RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
      }
    }

    throw lastError!;
  }
}

class OpenAIImageVisionProvider implements ImageVisionProvider {
  private baseUrl: string;
  private model: string;
  private apiKey: string;
  private timeoutMs: number;
  private proxy?: ProxyConfig;

  constructor(config: ImageDescriptionConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.model = config.model;
    this.apiKey = config.apiKey ?? "";
    this.timeoutMs = config.timeoutMs;
    this.proxy = config.proxy;
  }

  async describeImage(imageBase64: string, mimeType: string, prompt: string, abort?: AbortSignal): Promise<string> {
    const url = `${this.baseUrl}${this.baseUrl.endsWith("/v1") ? "" : "/v1"}/chat/completions`;

    const body = {
      model: this.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${imageBase64}` },
            },
          ],
        },
      ],
      max_tokens: 2048,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= VISION_RETRY_MAX; attempt++) {
      const response = await postJson(url, body, headers, this.timeoutMs, this.proxy);

      if (!response.ok) {
        const text = await response.text();
        const error = new Error(`OpenAI vision request failed (${response.status}): ${text}`);
        if (VISION_RETRYABLE_STATUSES.has(response.status) && attempt < VISION_RETRY_MAX) {
          lastError = error;
          await visionSleep(VISION_RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        throw error;
      }

      const json = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json.choices?.[0]?.message?.content;
      if (content && content.trim().length > 0) {
        return content.trim();
      }

      lastError = new Error(`OpenAI vision returned empty response: ${JSON.stringify(json)}`);
      if (attempt < VISION_RETRY_MAX) {
        await visionSleep(VISION_RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
      }
    }

    throw lastError!;
  }
}

class AnthropicImageVisionProvider implements ImageVisionProvider {
  private baseUrl: string;
  private model: string;
  private apiKey: string;
  private timeoutMs: number;
  private proxy?: ProxyConfig;

  constructor(config: ImageDescriptionConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.model = config.model;
    this.apiKey = config.apiKey ?? "";
    this.timeoutMs = config.timeoutMs;
    this.proxy = config.proxy;
  }

  async describeImage(imageBase64: string, mimeType: string, prompt: string, abort?: AbortSignal): Promise<string> {
    const body = {
      model: this.model,
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mimeType, data: imageBase64 },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    };

    const headers: Record<string, string> = {
      "x-api-key": this.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    };

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= VISION_RETRY_MAX; attempt++) {
      const response = await postJson(
        `${this.baseUrl}/messages`,
        body,
        headers,
        this.timeoutMs,
        this.proxy,
      );

      if (!response.ok) {
        const text = await response.text();
        const error = new Error(`Anthropic vision request failed (${response.status}): ${text}`);
        if (VISION_RETRYABLE_STATUSES.has(response.status) && attempt < VISION_RETRY_MAX) {
          lastError = error;
          await visionSleep(VISION_RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        throw error;
      }

      const json = (await response.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const text = json.content?.find((c) => c.type === "text")?.text;
      if (text && text.trim().length > 0) {
        return text.trim();
      }

      lastError = new Error(`Anthropic vision returned empty response: ${JSON.stringify(json)}`);
      if (attempt < VISION_RETRY_MAX) {
        await visionSleep(VISION_RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
      }
    }

    throw lastError!;
  }
}

class GeminiImageVisionProvider implements ImageVisionProvider {
  private baseUrl: string;
  private model: string;
  private apiKey?: string;
  private timeoutMs: number;
  private proxy?: ProxyConfig;

  constructor(config: ImageDescriptionConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs;
    this.proxy = config.proxy;
  }

  async describeImage(imageBase64: string, mimeType: string, prompt: string, abort?: AbortSignal): Promise<string> {
    const body = {
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mimeType,
                data: imageBase64,
              },
            },
          ],
        },
      ],
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const url = this.apiKey
      ? `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`
      : `${this.baseUrl}/models/${this.model}:generateContent`;

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= VISION_RETRY_MAX; attempt++) {
      const response = await postJson(url, body, headers, this.timeoutMs, this.proxy);

      if (!response.ok) {
        const text = await response.text();
        const error = new Error(`Gemini vision request failed (${response.status}): ${text}`);
        if (VISION_RETRYABLE_STATUSES.has(response.status) && attempt < VISION_RETRY_MAX) {
          lastError = error;
          await visionSleep(VISION_RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
          continue;
        }
        throw error;
      }

      const json = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> };
        }>;
      };
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text && text.trim().length > 0) {
        return text.trim();
      }

      lastError = new Error(`Gemini vision returned empty response: ${JSON.stringify(json)}`);
      if (attempt < VISION_RETRY_MAX) {
        await visionSleep(VISION_RETRY_BASE_DELAY_MS * Math.pow(2, attempt));
      }
    }

    throw lastError!;
  }
}

export function createImageVisionProvider(config: ImageDescriptionConfig): ImageVisionProvider {
  if (config.provider === "anthropic") {
    if (!config.apiKey) {
      throw new Error("Anthropic image provider requires an apiKey");
    }
    return new AnthropicImageVisionProvider(config);
  }
  if (config.provider === "google") {
    return new GeminiImageVisionProvider(config);
  }
  if (config.provider === "openai") {
    if (!config.apiKey) {
      throw new Error("OpenAI image provider requires an apiKey");
    }
    return new OpenAIImageVisionProvider(config);
  }
  return new OllamaImageVisionProvider(config);
}

export class ImageChunker implements Chunker {
  readonly language = "image";
  readonly fileExtensions: string[];

  constructor(extensions: string[]) {
    this.fileExtensions = extensions;
  }

  async chunk(filePath: string, content: string): Promise<Chunk[]> {
    if (content.trim().length === 0) return [];

    const paragraphs = content.split(PARAGRAPH_SPLIT).filter((p) => p.trim().length > 0);
    if (paragraphs.length === 0) return [];

    const chunks: Chunk[] = [];
    let currentGroup: string[] = [];
    let currentSize = 0;
    let paragraphIndex = 0;

    function flush() {
      const text = currentGroup.join("\n\n").trim();
      if (text.length === 0) return;
      chunks.push({
        id: uuid(),
        content: text,
        metadata: {
          filePath,
          startLine: paragraphIndex - currentGroup.length + 1,
          endLine: paragraphIndex,
          language: "image",
        },
      });
      currentGroup = [];
      currentSize = 0;
    }

    for (const para of paragraphs) {
      paragraphIndex++;
      const paraLen = para.length;

      if (paraLen > MAX_CHUNK_CHARS) {
        if (currentGroup.length > 0) flush();
        chunks.push({
          id: uuid(),
          content: para,
          metadata: {
            filePath,
            startLine: paragraphIndex,
            endLine: paragraphIndex,
            language: "image",
          },
        });
        continue;
      }

      if (currentGroup.length > 0 && currentSize + paraLen > MAX_CHUNK_CHARS) {
        flush();
      }

      currentGroup.push(para);
      currentSize += paraLen;

      if (currentSize >= MIN_GROUP_CHARS && currentGroup.length >= 1) {
        const nextParaStillSmall =
          paragraphIndex < paragraphs.length &&
          paragraphs[paragraphIndex]!.length < MIN_GROUP_CHARS;
        if (!nextParaStillSmall) {
          flush();
        }
      }
    }

    if (currentGroup.length > 0) {
      flush();
    }

    return chunks;
  }
}