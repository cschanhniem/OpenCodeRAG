export interface Chunk {
  id: string;
  content: string;
  description?: string;
  embedding?: number[];
  metadata: {
    filePath: string;
    startLine: number;
    endLine: number;
    language: string;
    contentType?: string;
  };
}

export interface DescriptionProvider {
  generateDescription(chunk: Chunk): Promise<string>;
  generateBatchDescriptions(chunks: Chunk[], logDebug?: (msg: string) => void): Promise<Map<string, string>>;
}

export interface SearchExplanation {
  scoreBreakdown: {
    vectorScore: number;
    keywordScore: number;
    rawVectorScore: number;
    rawKeywordScore: number;
    keywordWeight: number;
  };
  matchedTerms?: string[];
}

export interface SearchResult {
  chunk: Chunk;
  score: number;
  explanation?: SearchExplanation;
}

export interface Chunker {
  readonly language: string;
  readonly fileExtensions?: string[];
  chunk(filePath: string, content: string): Promise<Chunk[]>;
}

export interface EmbeddingProvider {
  readonly name: string;
  embed(texts: string[], purpose?: "query" | "document"): Promise<number[][]>;
}

export interface KeywordIndex {
  addChunks(chunks: Chunk[]): void;
  removeByFilePath(filePath: string): void;
  search(query: string, topK: number): SearchResult[];
  getMatchedTerms(query: string, chunkId: string): string[];
  clear(): void;
  count(): number;
  save(filePath?: string): Promise<void>;
}

export interface VectorStore {
  addChunks(chunks: Chunk[]): Promise<void>;
  search(embedding: number[], topK: number): Promise<SearchResult[]>;
  count(): Promise<number>;
  clear(): Promise<void>;
  deleteByFilePath(filePath: string): Promise<void>;
  close(): Promise<void>;
}
