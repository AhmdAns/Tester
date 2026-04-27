import { logger } from '../../utils/logger.js';
import type { Vectorizer } from '../vectorizer/vectorizer.js';
import type { WorkItem } from '../fetcher/types.js';
import type { ContextBuilder } from '../context/context-builder.js';

const TOKEN_BUDGET = 80_000;
const CHARS_PER_TOKEN = 4;

export interface RetrievedContext {
  contextMd: string;
  estimatedTokens: number;
  itemsIncluded: number[];
}

export async function assembleContext(
  workItem: WorkItem,
  vectorizer: Vectorizer,
  topK = 10,
  contextBuilder?: ContextBuilder,
): Promise<RetrievedContext> {
  const included: Map<number, string> = new Map();
  let budget = TOKEN_BUDGET;
  const sections: string[] = [];

  // --- 1. Product context documents (business rules awareness) ---
  // Inject first so they anchor the test design with domain knowledge
  if (contextBuilder) {
    const relevantContextDocs = contextBuilder.getRelevantContext(
      workItem.areaPath,
      workItem.relations.find((r) => r.type === 'parent')?.id,
    );

    for (const ctxMd of relevantContextDocs) {
      const tokens = Math.ceil(ctxMd.length / CHARS_PER_TOKEN);
      if (budget - tokens < TOKEN_BUDGET * 0.2) break; // reserve 20% for work item chunks
      sections.push(`<!-- PRODUCT CONTEXT -->\n${ctxMd}`);
      budget -= tokens;
    }

    logger.debug(
      { contextDocsInjected: relevantContextDocs.length },
      'Injected product context documents',
    );
  }

  // --- 2. Related work items via relations ---
  const relationIds = workItem.relations.map((r) => r.id);

  // --- 3. Semantically similar work items via vector search ---
  const query = [workItem.title, workItem.acceptanceCriteria].filter(Boolean).join('\n');
  const searchResults = await vectorizer.search(query, topK + relationIds.length);

  const candidateIds = [
    ...relationIds,
    ...searchResults
      .filter((r) => r.workItemId > 0 && r.workItemId !== workItem.id) // skip context docs (negative IDs)
      .map((r) => r.workItemId),
  ].filter((id, idx, arr) => id !== workItem.id && arr.indexOf(id) === idx);

  for (const id of candidateIds) {
    const md = vectorizer.getMarkdown(id);
    if (!md) continue;

    const tokens = Math.ceil(md.length / CHARS_PER_TOKEN);
    if (budget - tokens < TOKEN_BUDGET * 0.1) {
      logger.debug({ id, tokens, budget }, 'Token budget reached, truncating context');
      break;
    }

    sections.push(md);
    included.set(id, md);
    budget -= tokens;
  }

  const contextMd = sections.join('\n\n---\n\n');
  const estimatedTokens = Math.ceil(contextMd.length / CHARS_PER_TOKEN);

  logger.debug(
    { workItemsIncluded: included.size, estimatedTokens },
    'Context assembled',
  );

  return {
    contextMd,
    estimatedTokens,
    itemsIncluded: [...included.keys()],
  };
}
