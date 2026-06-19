import type { Chunk, SearchResult } from "../core/interfaces.js";

const INDEX_VERSION = 1;

interface SerializedKeywordIndex {
  version: number;
  tokens: Array<[string, Array<[string, number]>]>;
  chunkMap: Record<string, {
    id: string;
    content: string;
    description?: string;
    filePath: string;
    startLine: number;
    endLine: number;
    language: string;
  }>;
}

export function tokenize(text: string): string[] {
  const tokens = new Set<string>();

  const words = text.split(/[^a-zA-Z0-9_]+/);

  for (const word of words) {
    if (word.length < 2) continue;

    const lower = word.toLowerCase();
    tokens.add(lower);

    const camelParts = word.split(/(?=[A-Z])/);
    for (const part of camelParts) {
      if (part.length >= 2) tokens.add(part.toLowerCase());
    }

    const snakeParts = word.split("_");
    for (const part of snakeParts) {
      if (part.length >= 2) tokens.add(part.toLowerCase());
    }
  }

  return [...tokens];
}

function indexPathFor(storePath: string): string {
  return storePath.replace(/\\/g, "/").replace(/\/+$/, "") + "/keyword-index.json";
}

export class KeywordIndex {
  private invertedIndex = new Map<string, Map<string, number>>();
  private chunkMap = new Map<string, Chunk>();
  private readonly storePath?: string;

  constructor(storePath?: string) {
    this.storePath = storePath;
  }

  addChunks(chunks: Chunk[]): void {
    for (const chunk of chunks) {
      const id = chunk.id;
      this.chunkMap.set(id, chunk);

      const tokens = tokenize(chunk.content);

      for (const token of tokens) {
        let docs = this.invertedIndex.get(token);
        if (!docs) {
          docs = new Map();
          this.invertedIndex.set(token, docs);
        }
        docs.set(id, (docs.get(id) ?? 0) + 1);
      }
    }
  }

  getMatchedTerms(query: string, chunkId: string): string[] {
    const queryTokens = tokenize(query);
    const matched: string[] = [];
    for (const token of queryTokens) {
      const docs = this.invertedIndex.get(token);
      if (docs && docs.has(chunkId)) {
        matched.push(token);
      }
    }
    return matched;
  }

  removeByFilePath(filePath: string): void {
    const idsToRemove: string[] = [];

    for (const [id, chunk] of this.chunkMap) {
      if (chunk.metadata.filePath === filePath) {
        idsToRemove.push(id);
      }
    }

    for (const id of idsToRemove) {
      const chunk = this.chunkMap.get(id);
      if (chunk) {
        const tokens = tokenize(chunk.content);
        for (const token of tokens) {
          const docs = this.invertedIndex.get(token);
          if (docs) {
            docs.delete(id);
            if (docs.size === 0) {
              this.invertedIndex.delete(token);
            }
          }
        }
        this.chunkMap.delete(id);
      }
    }
  }

  search(query: string, topK: number): SearchResult[] {
    if (this.chunkMap.size === 0) return [];

    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const totalChunks = this.chunkMap.size;
    const scores = new Map<string, number>();

    for (const token of queryTokens) {
      const docs = this.invertedIndex.get(token);
      if (!docs) continue;

      const df = docs.size;
      const idf = Math.log(1 + totalChunks / (df || 1));

      for (const [chunkId, freq] of docs) {
        const score = freq * idf;
        scores.set(chunkId, (scores.get(chunkId) ?? 0) + score);
      }
    }

    const sorted = [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK);

    return sorted.map(([chunkId, score]) => {
      const chunk = this.chunkMap.get(chunkId)!;
      return { chunk, score };
    });
  }

  clear(): void {
    this.invertedIndex.clear();
    this.chunkMap.clear();
  }

  count(): number {
    return this.chunkMap.size;
  }

  async save(storePath?: string): Promise<void> {
    const effectiveStorePath = storePath ?? this.storePath;
    if (!effectiveStorePath) return;

    const targetPath = indexPathFor(effectiveStorePath);
    const { mkdir, writeFile } = await import("node:fs/promises");
    const path = await import("node:path");

    await mkdir(path.dirname(targetPath), { recursive: true });

    const serialized: SerializedKeywordIndex = {
      version: INDEX_VERSION,
      tokens: [...this.invertedIndex.entries()].map(
        ([token, docs]) => [token, [...docs.entries()]] as [string, Array<[string, number]>]
      ),
      chunkMap: Object.fromEntries(
        [...this.chunkMap.entries()].map(([id, chunk]) => [
          id,
          {
            id: chunk.id,
            content: chunk.content,
            description: chunk.description ?? "",
            filePath: chunk.metadata.filePath,
            startLine: chunk.metadata.startLine,
            endLine: chunk.metadata.endLine,
            language: chunk.metadata.language,
          },
        ])
      ),
    };

    await writeFile(targetPath, JSON.stringify(serialized), "utf-8");
  }

  static async load(storePath: string): Promise<KeywordIndex> {
    const targetPath = indexPathFor(storePath);
    const { readFile, access } = await import("node:fs/promises");

    try {
      await access(targetPath);
    } catch {
      return new KeywordIndex(storePath);
    }

    const raw = await readFile(targetPath, "utf-8");
    let parsed: SerializedKeywordIndex;
    try {
      parsed = JSON.parse(raw) as SerializedKeywordIndex;
    } catch {
      return new KeywordIndex(storePath);
    }

    if (parsed.version !== INDEX_VERSION) {
      return new KeywordIndex(storePath);
    }

    const index = new KeywordIndex(storePath);

    for (const [token, docs] of parsed.tokens) {
      const docMap = new Map<string, number>(docs);
      index.invertedIndex.set(token, docMap);
    }

    for (const [id, data] of Object.entries(parsed.chunkMap)) {
      index.chunkMap.set(id, {
        id: data.id,
        content: data.content,
        description: data.description ?? "",
        metadata: {
          filePath: data.filePath,
          startLine: data.startLine,
          endLine: data.endLine,
          language: data.language,
        },
      });
    }

    return index;
  }

  static async clearFile(storePath: string): Promise<void> {
    const targetPath = indexPathFor(storePath);
    const { writeFile, mkdir } = await import("node:fs/promises");
    const path = await import("node:path");
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, JSON.stringify({ version: INDEX_VERSION, tokens: [], chunkMap: {} }), "utf-8");
  }
}
