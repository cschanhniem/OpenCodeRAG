import * as lancedb from "@lancedb/lancedb";
import type { Connection, Table, Version } from "@lancedb/lancedb";
import fs from "node:fs/promises";
import type { VectorStore, Chunk, SearchResult } from "../core/interfaces.js";
import { normalizeFilePath, manifestPathFor } from "../core/manifest.js";

const TABLE_NAME = "chunks";
const VECTOR_COLUMN = "embedding";

const QUERY_COLUMNS = ["id", "content", "description", "filePath", "startLine", "endLine", "language"];

/**
 * Check whether an error is a LanceDB corruption error (table not found / broken).
 * @param err - The error to inspect.
 * @returns True if the error matches a known corruption pattern.
 */
export function isCorruptionError(err: unknown): boolean {
  if (err instanceof Error) {
    return (
      err.message.includes("Not found") &&
      err.message.includes(".lance") &&
      err.message.includes("lance error")
    );
  }
  return false;
}

/** Internal row shape stored in the LanceDB table. */
interface ChunkRow {
  id: string;
  content: string;
  description: string;
  embedding: number[];
  filePath: string;
  startLine: number;
  endLine: number;
  language: string;
}

/**
 * A LanceDB-backed vector store with persistent on-disk storage, vector search,
 * and chunk metadata queries. Supports automatic corruption recovery by falling
 * back to prior table versions or dropping and rebuilding the table.
 */
export class LanceDBStore implements VectorStore {
  private dbPath: string;
  private vectorDimension: number;
  private db: Connection | null = null;
  private table: Table | null = null;
  private tableInit: Promise<Table> | null = null;

  /**
   * @param dbPath - Filesystem path to the LanceDB database directory.
   * @param vectorDimension - Dimension of the embedding vectors. Default: 384.
   */
  constructor(dbPath: string, vectorDimension: number = 384) {
    this.dbPath = dbPath;
    this.vectorDimension = vectorDimension;
  }

  private async getDb(): Promise<Connection> {
    if (!this.db) {
      this.db = await lancedb.connect(this.dbPath);
    }
    return this.db;
  }

  private async getTable(): Promise<Table> {
    if (this.table) return this.table;

    if (this.tableInit) return this.tableInit;

    this.tableInit = this.initTable();
    try {
      return await this.tableInit;
    } finally {
      this.tableInit = null;
    }
  }

  private async initTable(): Promise<Table> {
    const db = await this.getDb();
    const tableNames = await db.tableNames();

    if (tableNames.includes(TABLE_NAME)) {
      this.table = await db.openTable(TABLE_NAME);
      if (await this.tableHasDescriptionColumn()) {
        return this.table;
      }
      try {
        const oldCount = await this.table.countRows();
        if (oldCount > 0) {
          console.error(`[lancedb] WARNING: Dropping table with ${oldCount} rows — schema missing 'description' column (data will be lost). Clearing manifest so index will rebuild.`);
          try {
            const manifestPath = manifestPathFor(this.dbPath);
            await fs.unlink(manifestPath).catch(() => {});
          } catch {
            // manifest not found or permission error — pipeline will detect the mismatch
          }
        }
      } catch {
        // best-effort row count
      }
      await db.dropTable(TABLE_NAME).catch(() => {});
      this.table = null;
    }

    const seedRow: ChunkRow = {
      id: "__seed__",
      content: "",
      description: "",
      embedding: new Array(this.vectorDimension).fill(0),
      filePath: "",
      startLine: 0,
      endLine: 0,
      language: "",
    };

    this.table = await db.createTable({
      name: TABLE_NAME,
      data: [seedRow] as unknown as Record<string, unknown>[],
      mode: "overwrite",
    });

    const deleted = await this.table.delete('id = "__seed__"');
    if (deleted === undefined) {
      // LanceDB may not return a count; try a direct query to verify
      const leftover = await this.table.query().filter('id = "__seed__"').limit(1).toArray();
      if (leftover.length > 0) {
        console.warn("[lancedb] WARNING: seed row still present — filtering in search");
      }
    }

    return this.table;
  }

  private async tableHasDescriptionColumn(): Promise<boolean> {
    try {
      const schema = await this.table!.schema();
      return schema.fields.some((f: { name: string }) => f.name === "description");
    } catch {
      return false;
    }
  }

  /**
   * Store chunks in the LanceDB table. Existing rows for the same file path
   * and start line are deleted before insertion. Automatically attempts repair
   * on corruption errors.
   * @param chunks - The chunks to add.
   */
  async addChunks(chunks: Chunk[]): Promise<void> {
    if (chunks.length === 0) return;
    try {
      await this.addChunksInternal(chunks);
    } catch (err) {
      if (isCorruptionError(err) && await this.tryRepair()) {
        await this.addChunksInternal(chunks);
        return;
      }
      throw err;
    }
  }

  private async addChunksInternal(chunks: Chunk[]): Promise<void> {
    const table = await this.getTable();
    const rows: ChunkRow[] = chunks
      .filter((c) => c.embedding && c.embedding.length > 0)
      .map((c) => ({
        id: c.id,
        content: c.content,
        description: c.description ?? "",
        embedding: c.embedding!,
        filePath: normalizeFilePath(c.metadata.filePath),
        startLine: c.metadata.startLine,
        endLine: c.metadata.endLine,
        language: c.metadata.language,
      }));

    if (rows.length === 0) return;

    const fileLinesMap = new Map<string, Set<number>>();
    for (const row of rows) {
      const existing = fileLinesMap.get(row.filePath);
      if (existing) {
        existing.add(row.startLine);
      } else {
        fileLinesMap.set(row.filePath, new Set([row.startLine]));
      }
    }

    for (const [filePath, startLines] of fileLinesMap) {
      const escaped = filePath.replace(/'/g, "''");
      for (const line of startLines) {
        await table.delete(`filePath = '${escaped}' AND startLine = ${line}`);
      }
    }

    await table.add(rows as unknown as Record<string, unknown>[]);
  }

  /**
   * Perform ANN (approximate nearest neighbor) search using LanceDB's native vector index.
   * Returns results scored as 1 / (1 + L2 distance). Falls back to repair on corruption.
   * @param embedding - The query embedding vector.
   * @param topK - Maximum number of results to return.
   * @returns An array of search results sorted by descending score.
   */
  async search(embedding: number[], topK: number): Promise<SearchResult[]> {
    try {
      return await this.searchInternal(embedding, topK);
    } catch (err) {
      if (isCorruptionError(err)) {
        const repaired = await this.tryRepair();
        if (repaired) {
          return this.searchInternal(embedding, topK);
        }
      }
      return [];
    }
  }

  private rowToSearchResult(row: Record<string, unknown>): SearchResult {
    return {
      score: 1 / (1 + ((row._distance as number) ?? 0)),
      chunk: {
        id: row.id as string,
        content: row.content as string,
        description: (row.description as string) ?? "",
        metadata: {
          filePath: row.filePath as string,
          startLine: row.startLine as number,
          endLine: row.endLine as number,
          language: row.language as string,
        },
      },
    };
  }

  /**
   * List all distinct file paths stored in the index, along with their language and chunk count.
   * @returns An array of file summaries sorted by file path.
   */
  async listFiles(): Promise<{ filePath: string; language: string; chunkCount: number }[]> {
    const table = await this.getTable();
    const count = await table.countRows();
    if (count === 0) return [];

    const rows = await table.query().select(["filePath", "language"]).limit(count).toArray();
    const fileMap = new Map<string, { language: string; chunkCount: number }>();
    for (const row of rows) {
      const filePath = row.filePath as string;
      const language = row.language as string;
      const existing = fileMap.get(filePath);
      if (existing) {
        existing.chunkCount++;
      } else {
        fileMap.set(filePath, { language, chunkCount: 1 });
      }
    }
    return Array.from(fileMap.entries())
      .map(([filePath, info]) => ({ filePath, ...info }))
      .sort((a, b) => a.filePath.localeCompare(b.filePath));
  }

  /**
   * Retrieve all chunks for a specific file path, sorted by start line.
   * @param filePath - The file path to query.
   * @returns An array of chunks for that file.
   */
  async getChunksByFilePath(filePath: string): Promise<Chunk[]> {
    const table = await this.getTable();
    const normalizedPath = normalizeFilePath(filePath).replace(/'/g, "''");
    const rows = await table.query()
      .select(QUERY_COLUMNS)
      .where(`filePath = '${normalizedPath}'`)
      .toArray();

    return rows
      .map((row: Record<string, unknown>) => ({
        id: row.id as string,
        content: row.content as string,
        description: (row.description as string) ?? "",
        metadata: {
          filePath: row.filePath as string,
          startLine: row.startLine as number,
          endLine: row.endLine as number,
          language: row.language as string,
        },
      }))
      .sort((a, b) => a.metadata.startLine - b.metadata.startLine);
  }

  /**
   * Retrieve a paginated list of all chunks without embeddings.
   * @param offset - Number of rows to skip (for pagination).
   * @param limit - Maximum number of rows to return.
   * @returns An array of chunk summaries.
   */
  async getChunks(offset: number, limit: number): Promise<{ id: string; filePath: string; language: string; startLine: number; endLine: number; content: string; description: string }[]> {
    const table = await this.getTable();
    const rows = await table.query()
      .select(QUERY_COLUMNS)
      .offset(offset)
      .limit(limit)
      .toArray();

    return rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      filePath: row.filePath as string,
      language: row.language as string,
      startLine: row.startLine as number,
      endLine: row.endLine as number,
      content: row.content as string,
      description: (row.description as string) ?? "",
    }));
  }

  private async searchInternal(embedding: number[], topK: number): Promise<SearchResult[]> {
    const db = await this.getDb();
    const tableNames = await db.tableNames();
    if (!tableNames.includes(TABLE_NAME)) return [];

    const table = await this.getTable();
    const count = await table.countRows();
    if (count === 0) return [];

    const results = await table.search(embedding).limit(topK).toArray();
    return results
      .map((row) => this.rowToSearchResult(row))
      .filter((r) => r.chunk.id !== "__seed__");
  }

  /**
   * Return the total number of chunks stored in the table.
   * @returns The chunk count, or 0 if the table does not exist.
   */
  async count(): Promise<number> {
    try {
      const db = await this.getDb();
      const tableNames = await db.tableNames();
      if (!tableNames.includes(TABLE_NAME)) return 0;

      const table = await this.getTable();
      return await table.countRows();
    } catch {
      return 0;
    }
  }

  /** Close the database connection and release resources. */
  async close(): Promise<void> {
    this.table?.close();
    this.table = null;
    this.db?.close();
    this.db = null;
  }

  /**
   * Remove all chunks by dropping the underlying LanceDB table.
   * Falls back to deleting the database directory if dropTable fails.
   */
  async clear(): Promise<void> {
    this.table = null;
    try {
      const db = await this.getDb();
      const tableNames = await db.tableNames();
      if (tableNames.includes(TABLE_NAME)) {
        await db.dropTable(TABLE_NAME);
      }
    } catch {
      this.db = null;
      try {
        await fs.rm(this.dbPath, { recursive: true, force: true });
      } catch {}
    }
  }

  /**
   * Completely remove the entire LanceDB database directory from disk.
   * All data is permanently lost.
   */
  async dropDatabase(): Promise<void> {
    this.table = null;
    this.db = null;
    try {
      await fs.rm(this.dbPath, { recursive: true, force: true });
    } catch {}
  }

  /**
   * Remove all chunks associated with a given file path.
   * Automatically attempts repair on corruption errors.
   * @param filePath - The file path whose chunks should be deleted.
   */
  async deleteByFilePath(filePath: string): Promise<void> {
    try {
      await this.deleteByFilePathInternal(filePath);
    } catch (err) {
      if (isCorruptionError(err) && await this.tryRepair()) {
        await this.deleteByFilePathInternal(filePath);
        return;
      }
      throw err;
    }
  }

  private async deleteByFilePathInternal(filePath: string): Promise<void> {
    const db = await this.getDb();
    const tableNames = await db.tableNames();
    if (!tableNames.includes(TABLE_NAME)) return;

    const table = await this.getTable();
    const normalizedPath = normalizeFilePath(filePath).replace(/'/g, "''");
    await table.delete(`filePath = '${normalizedPath}'`);
  }

  private async tryRepair(): Promise<boolean> {
    try {
      this.table = null;
      this.db = null;

      const db = await this.getDb();
      const tableNames = await db.tableNames();
      if (!tableNames.includes(TABLE_NAME)) return false;

      let table: Table;
      try {
        table = await db.openTable(TABLE_NAME);
      } catch {
        await this.dropDatabase();
        return true;
      }

      let versions: Version[];
      try {
        versions = await table.listVersions();
      } catch {
        await db.dropTable(TABLE_NAME).catch(() => {});
        this.table = null;
        return true;
      }

      if (versions.length <= 1) {
        await db.dropTable(TABLE_NAME).catch(() => {});
        this.table = null;
        return true;
      }

      const sorted = [...versions].sort((a, b) => b.version - a.version);

      for (const ver of sorted.slice(1)) {
        try {
          await table.checkout(ver.version);
          const count = await table.countRows();
          await table.restore();
          await table.checkoutLatest();
          this.table = table;
          return true;
        } catch {
          continue;
        }
      }

      await db.dropTable(TABLE_NAME).catch(() => {});
      this.table = null;
      return true;
    } catch {
      return false;
    }
  }
}
