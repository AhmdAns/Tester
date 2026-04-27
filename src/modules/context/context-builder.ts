import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { callClaude } from '../../utils/claude-client.js';
import { clusterWorkItems, slugifyCluster } from './clusterer.js';
import { CONTEXT_SYSTEM_PROMPT, buildContextPrompt, buildContextMd } from './prompts.js';
import type { WorkItem } from '../fetcher/types.js';
import type { ContextDocument, ContextMeta, ContextBuildOptions, WorkItemCluster } from './types.js';

export class ContextBuilder {
  private readonly contextDir: string;
  private readonly metaPath: string;

  constructor(private readonly storeDir: string) {
    this.contextDir = path.join(storeDir, 'context');
    this.metaPath = path.join(storeDir, 'context-meta.json');
    fs.mkdirSync(this.contextDir, { recursive: true });
  }

  async build(
    items: WorkItem[],
    model: string,
    opts: ContextBuildOptions = {},
  ): Promise<ContextDocument[]> {
    const maxPerCluster = opts.maxItemsPerCluster ?? 40;
    const clusters = clusterWorkItems(items);

    logger.info(
      { totalItems: items.length, clusters: clusters.length },
      'Building product context',
    );

    const documents: ContextDocument[] = [];

    for (const [i, cluster] of clusters.entries()) {
      process.stderr.write(
        `\n[${i + 1}/${clusters.length}] Building context for: ${cluster.name} (${cluster.items.length} items)\n`,
      );

      const doc = await this.buildClusterDoc(cluster, model, maxPerCluster);
      documents.push(doc);

      const filePath = path.join(this.contextDir, `${slugifyCluster(cluster)}.md`);
      fs.writeFileSync(filePath, doc.content, 'utf-8');
      logger.debug({ clusterId: cluster.id, filePath }, 'Saved context document');
    }

    this.saveMeta(items.length, clusters);
    logger.info({ count: documents.length }, 'Context build complete');
    return documents;
  }

  private async buildClusterDoc(
    cluster: WorkItemCluster,
    model: string,
    maxItemsToInclude: number,
  ): Promise<ContextDocument> {
    const userPrompt = buildContextPrompt(cluster, maxItemsToInclude);

    const generated = await callClaude(CONTEXT_SYSTEM_PROMPT, userPrompt, { model });
    const fullMd = buildContextMd(cluster, generated);

    return {
      clusterId: cluster.id,
      clusterName: cluster.name,
      clusterType: cluster.type,
      areaPath: cluster.areaPath,
      itemCount: cluster.items.length,
      workItemIds: cluster.items.map((i) => i.id),
      lastBuilt: new Date().toISOString(),
      content: fullMd,
    };
  }

  listDocuments(): ContextDocument[] {
    if (!fs.existsSync(this.contextDir)) return [];

    const docs: ContextDocument[] = [];
    for (const file of fs.readdirSync(this.contextDir)) {
      if (!file.endsWith('.md')) continue;
      const content = fs.readFileSync(path.join(this.contextDir, file), 'utf-8');
      const doc = this.parseFrontmatter(content);
      if (doc) docs.push(doc);
    }
    return docs;
  }

  getDocument(clusterId: string): string | null {
    const slug = clusterId.replace(/[^a-z0-9-]/gi, '-');
    const filePath = path.join(this.contextDir, `${slug}.md`);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  }

  getMeta(): ContextMeta | null {
    if (!fs.existsSync(this.metaPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.metaPath, 'utf-8')) as ContextMeta;
    } catch {
      return null;
    }
  }

  getAllContextMd(): string {
    const docs = this.listDocuments();
    return docs.map((d) => d.content).join('\n\n---\n\n');
  }

  // Returns context documents most relevant to an area path or epic
  getRelevantContext(areaPath: string, epicId?: number): string[] {
    const docs = this.listDocuments();
    const relevant: string[] = [];

    for (const doc of docs) {
      if (
        (epicId && doc.clusterId === `epic-${epicId}`) ||
        (areaPath && doc.areaPath && areaPath.startsWith(doc.areaPath)) ||
        (areaPath && doc.areaPath && doc.areaPath.startsWith(areaPath.split('\\')[0] ?? ''))
      ) {
        relevant.push(doc.content);
      }
    }

    return relevant;
  }

  private parseFrontmatter(content: string): ContextDocument | null {
    try {
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!fmMatch) return null;

      const fm = fmMatch[1]!;
      const get = (key: string) => fm.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1] ?? '';

      const idsMatch = fm.match(/workItemIds:\s*\[([^\]]*)\]/);
      const ids = idsMatch
        ? idsMatch[1]!.split(',').map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n > 0)
        : [];

      return {
        clusterId: get('clusterId'),
        clusterName: get('clusterName').replace(/^"|"$/g, ''),
        clusterType: (get('clusterType') || 'area') as import('./types.js').ClusterType,
        areaPath: get('areaPath').replace(/^"|"$/g, ''),
        itemCount: Number(get('itemCount')) || 0,
        workItemIds: ids,
        lastBuilt: get('lastBuilt'),
        content,
      };
    } catch {
      return null;
    }
  }

  private saveMeta(totalItems: number, clusters: WorkItemCluster[]): void {
    const meta: ContextMeta = {
      builtAt: new Date().toISOString(),
      totalItems,
      clusters: clusters.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        itemCount: c.items.length,
      })),
    };
    fs.writeFileSync(this.metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  }
}
