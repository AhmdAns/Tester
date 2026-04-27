import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger.js';
import type { VectorChunk, SearchResult } from './types.js';

const TABLE_NAME = 'chunks';

export class VectorStore {
  private conn: unknown = null;
  private table: unknown = null;

  constructor(private readonly storeDir: string) {
    fs.mkdirSync(path.join(storeDir, 'vectors'), { recursive: true });
  }

  private get vectorsDir(): string {
    return path.join(this.storeDir, 'vectors');
  }

  private async getConnection(): Promise<unknown> {
    if (!this.conn) {
      const lancedb = await import('@lancedb/lancedb');
      this.conn = await lancedb.connect(this.vectorsDir);
    }
    return this.conn;
  }

  private async getTable(): Promise<unknown> {
    if (!this.table) {
      const conn = await this.getConnection();
      const lancedb = await import('@lancedb/lancedb');
      const tableNames: string[] = await (conn as { tableNames(): Promise<string[]> }).tableNames();
      if (tableNames.includes(TABLE_NAME)) {
        this.table = await (conn as { openTable(name: string): Promise<unknown> }).openTable(
          TABLE_NAME,
        );
      } else {
        // Create with a dummy row so LanceDB knows the schema
        const dummy: LanceRow = {
          id: '__init__',
          workItemId: 0,
          chunkType: 'title_ac',
          text: '',
          vector: new Array(384).fill(0) as number[],
        };
        this.table = await (
          conn as { createTable(name: string, data: unknown[]): Promise<unknown> }
        ).createTable(TABLE_NAME, [dummy]);
      }
    }
    return this.table;
  }

  async upsertChunks(chunks: VectorChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const table = await this.getTable();
    const rows: LanceRow[] = chunks.map((c) => ({
      id: c.id,
      workItemId: c.workItemId,
      chunkType: c.chunkType,
      text: c.text,
      vector: c.vector,
    }));

    // Delete existing rows for these work item IDs to avoid duplicates
    const wids = [...new Set(chunks.map((c) => c.workItemId))];
    for (const wid of wids) {
      try {
        await (
          table as { delete(filter: string): Promise<void> }
        ).delete(`workItemId = ${wid}`);
      } catch {
        // Table might be empty — fine
      }
    }

    await (table as { add(data: unknown[]): Promise<void> }).add(rows);
    logger.debug({ count: chunks.length }, 'Upserted vector chunks');
  }

  async search(queryVector: number[], topK = 10): Promise<SearchResult[]> {
    const table = await this.getTable();
    try {
      const rawResults = await (
        table as {
          search(vector: number[]): {
            limit(k: number): { toArray(): Promise<LanceRow[]> };
          };
        }
      )
        .search(queryVector)
        .limit(topK)
        .toArray();

      return rawResults
        .filter((r) => r.id !== '__init__')
        .map((r) => ({
          workItemId: r.workItemId,
          chunkType: r.chunkType,
          text: r.text,
          score: (r as LanceRow & { _distance?: number })._distance ?? 0,
        }));
    } catch {
      return [];
    }
  }

  async deleteByWorkItemId(workItemId: number): Promise<void> {
    const table = await this.getTable();
    await (table as { delete(filter: string): Promise<void> }).delete(
      `workItemId = ${workItemId}`,
    );
  }
}

interface LanceRow {
  id: string;
  workItemId: number;
  chunkType: string;
  text: string;
  vector: number[];
  _distance?: number;
}
