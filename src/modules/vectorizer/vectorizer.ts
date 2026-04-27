import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger.js';
import type { WorkItem } from '../fetcher/types.js';
import { buildMarkdown, chunkMarkdown } from './md-builder.js';
import { Embedder } from './embedder.js';
import { VectorStore } from './store.js';
import type { SearchResult, VectorizeOptions } from './types.js';

export class Vectorizer {
  private readonly store: VectorStore;
  private readonly embedder: Embedder;
  private readonly itemsDir: string;

  constructor(
    private readonly storeDir: string,
    embedderOpts: {
      embeddingModel: 'local' | 'openai';
      localModel: string;
      openaiModel: string;
      openaiApiKey?: string;
    },
  ) {
    this.itemsDir = path.join(storeDir, 'items');
    fs.mkdirSync(this.itemsDir, { recursive: true });
    this.store = new VectorStore(storeDir);
    this.embedder = Embedder.fromConfig(embedderOpts);
  }

  async vectorizeItems(items: WorkItem[]): Promise<void> {
    logger.info({ count: items.length }, 'Starting vectorization');

    for (const item of items) {
      const md = buildMarkdown(item);
      const mdPath = path.join(this.itemsDir, `${item.id}.md`);
      fs.writeFileSync(mdPath, md, 'utf-8');

      const rawChunks = chunkMarkdown(item, md);
      const chunks = await Promise.all(
        rawChunks.map(async (c, i) => {
          const vector = await this.embedder.embedSingle(c.text);
          return {
            id: `${item.id}_${c.chunkType}_${i}`,
            workItemId: item.id,
            chunkType: c.chunkType,
            text: c.text,
            vector,
          };
        }),
      );

      await this.store.upsertChunks(chunks);
      logger.debug({ id: item.id }, 'Vectorized work item');
    }

    logger.info({ count: items.length }, 'Vectorization complete');
  }

  async rebuildIndex(): Promise<void> {
    const files = fs.readdirSync(this.itemsDir).filter((f) => f.endsWith('.md'));
    logger.info({ count: files.length }, 'Rebuilding index from MD files');

    for (const file of files) {
      const md = fs.readFileSync(path.join(this.itemsDir, file), 'utf-8');
      const idMatch = md.match(/^id:\s*(\d+)/m);
      if (!idMatch) continue;
      const workItemId = Number(idMatch[1]);

      const rawChunks = this.chunkFromMd(md, workItemId);
      const chunks = await Promise.all(
        rawChunks.map(async (c, i) => {
          const vector = await this.embedder.embedSingle(c.text);
          return {
            id: `${workItemId}_${c.chunkType}_${i}`,
            workItemId,
            chunkType: c.chunkType,
            text: c.text,
            vector,
          };
        }),
      );

      await this.store.upsertChunks(chunks);
      logger.debug({ id: workItemId }, 'Re-indexed work item');
    }

    logger.info('Index rebuild complete');
  }

  async search(query: string, topK = 10): Promise<SearchResult[]> {
    const queryVector = await this.embedder.embedSingle(query);
    return this.store.search(queryVector, topK);
  }

  getMarkdown(id: number): string | null {
    const mdPath = path.join(this.itemsDir, `${id}.md`);
    if (!fs.existsSync(mdPath)) return null;
    return fs.readFileSync(mdPath, 'utf-8');
  }

  listIndexedIds(): number[] {
    if (!fs.existsSync(this.itemsDir)) return [];
    return fs
      .readdirSync(this.itemsDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => Number(f.replace('.md', '')))
      .filter((n) => !isNaN(n));
  }

  private chunkFromMd(
    md: string,
    workItemId: number,
  ): Array<{ chunkType: 'title_ac' | 'description' | 'relations' | 'history'; text: string }> {
    const sections = md.split(/^## /m);
    const chunks: Array<{
      chunkType: 'title_ac' | 'description' | 'relations' | 'history';
      text: string;
    }> = [];

    const header = sections[0] ?? '';
    const titleMatch = header.match(/^# (.+)$/m);
    const acMatch = header.match(/Acceptance Criteria[\s\S]*?(?=^## |\z)/m);
    const titleAc = [titleMatch?.[1] ?? '', acMatch?.[0] ?? ''].filter(Boolean).join('\n\n');
    if (titleAc) chunks.push({ chunkType: 'title_ac', text: titleAc });

    for (const section of sections.slice(1)) {
      const title = section.split('\n')[0]?.toLowerCase() ?? '';
      const body = section.split('\n').slice(1).join('\n').trim();
      if (!body) continue;
      if (title.includes('description')) {
        chunks.push({ chunkType: 'description', text: body });
      } else if (title.includes('relations')) {
        chunks.push({ chunkType: 'relations', text: body });
      } else if (title.includes('history')) {
        chunks.push({ chunkType: 'history', text: body });
      }
    }

    if (chunks.length === 0) {
      chunks.push({ chunkType: 'title_ac', text: md.slice(0, 2000) });
    }

    return chunks;
  }

  async vectorizeContextDocuments(documents: import('../context/types.js').ContextDocument[]): Promise<void> {
    logger.info({ count: documents.length }, 'Vectorizing context documents');

    for (const doc of documents) {
      // Each cluster gets a stable negative workItemId derived from its ID string.
      // This lets upsertChunks replace old chunks for the same cluster without
      // touching other clusters or real work item chunks.
      const clusterWorkItemId = clusterIdToWorkItemId(doc.clusterId);

      const sections = this.splitContextSections(doc.content);

      const chunks = await Promise.all(
        sections.map(async (section, i) => {
          const vector = await this.embedder.embedSingle(section.text);
          return {
            id: `ctx_${doc.clusterId}_${i}`,
            workItemId: clusterWorkItemId,
            chunkType: 'context' as const,
            text: section.text,
            vector,
          };
        }),
      );

      await this.store.upsertChunks(chunks);
      logger.debug({ clusterId: doc.clusterId, chunks: chunks.length }, 'Vectorized context document');
    }

    logger.info({ count: documents.length }, 'Context vectorization complete');
  }

  private splitContextSections(md: string): Array<{ text: string }> {
    const withoutFm = md.replace(/^---[\s\S]*?---\n/, '');
    const sections = withoutFm.split(/^## /m).filter((s) => s.trim());
    if (sections.length === 0) return [{ text: withoutFm.slice(0, 3000) }];
    return sections
      .map((s) => ({ text: s.trim().slice(0, 2000) }))
      .filter((s) => s.text.length > 30);
  }

  static fromConfig(
    opts: VectorizeOptions & { storeDir: string; localModel: string; openaiModel: string },
  ): Vectorizer {
    return new Vectorizer(opts.storeDir, {
      embeddingModel: opts.embeddingModel ?? 'local',
      localModel: opts.localModel,
      openaiModel: opts.openaiModel,
      openaiApiKey: opts.openaiApiKey,
    });
  }
}

// Stable negative integer derived from a cluster ID string.
// Negative so it never collides with real ADO work item IDs (always positive).
function clusterIdToWorkItemId(clusterId: string): number {
  let hash = 0;
  for (let i = 0; i < clusterId.length; i++) {
    hash = Math.imul(31, hash) + clusterId.charCodeAt(i);
    hash |= 0;
  }
  return -(Math.abs(hash) + 1);
}
