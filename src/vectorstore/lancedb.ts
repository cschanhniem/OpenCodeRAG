import * as lancedb from "@lancedb/lancedb";
import type { Connection, Table, Version } from "@lancedb/lancedb";
import fs from "node:fs/promises";
import type { VectorStore, Chunk, SearchResult } from "../core/interfaces.js";
import { normalizeFilePath, manifestPathFor } from "../core/manifest.js";

const TABLE_NAME = "chunks";
const VECTOR_COLUMN = "embedding";

const QUERY_COLUMNS = ["id", "content", "description", "filePath", "startLine", "endLine", "language"];

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

export class LanceDBStore implements VectorStore {
  private dbPath: string;
  private vectorDimension: number;
  private db: Connection | null = null;
  private table: Table | null = null;
  private tableInit: Promise<Table> | null = null;

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

    await this.table.delete('id = "__seed__"');

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

    await table.add(rows as unknown as Record<string, unknown>[]);
  }

  async search(embedding: number[], topK: number): Promise<SearchResult[]> {
    try {
      return await this.searchInternal(embedding, topK);
    } catch (err) {
      if (this.isCorruptionError(err)) {
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

  async listFiles(): Promise<{ filePath: string; language: string; chunkCount: number }[]> {
    const table = await this.getTable();
    const count = await table.countRows();
    if (count === 0) return [];

    const rows = await table.query().select(["filePath", "language"]).toArray();
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
    return results.map((row) => this.rowToSearchResult(row));
  }

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

  async dropDatabase(): Promise<void> {
    this.table = null;
    this.db = null;
    try {
      await fs.rm(this.dbPath, { recursive: true, force: true });
    } catch {}
  }

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

  private isCorruptionError(err: unknown): boolean {
    return isCorruptionError(err);
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
