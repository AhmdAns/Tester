import type { WorkItem } from '../fetcher/types.js';

export function buildMarkdown(item: WorkItem): string {
  const lines: string[] = [];

  // Frontmatter
  lines.push('---');
  lines.push(`id: ${item.id}`);
  lines.push(`type: ${item.type}`);
  lines.push(`title: "${item.title.replace(/"/g, '\\"')}"`);
  lines.push(`state: ${item.state}`);
  lines.push(`priority: ${item.priority}`);
  lines.push(`area: ${item.areaPath}`);
  lines.push(`iteration: ${item.iterationPath}`);
  lines.push(`tags: [${item.tags.join(', ')}]`);
  if (item.relations.length > 0) {
    lines.push('relations:');
    for (const r of item.relations) {
      lines.push(`  - type: ${r.type}`);
      lines.push(`    id: ${r.id}`);
      lines.push(`    title: "${r.title.replace(/"/g, '\\"')}"`);
    }
  }
  lines.push('---');
  lines.push('');

  // Title
  const prefix = item.type.replace(/\s+/g, '').slice(0, 2).toUpperCase();
  lines.push(`# [${prefix}-${item.id}] ${item.title}`);
  lines.push('');

  // Description
  if (item.description) {
    lines.push('## Description');
    lines.push(item.description);
    lines.push('');
  }

  // Acceptance Criteria
  if (item.acceptanceCriteria) {
    lines.push('## Acceptance Criteria');
    lines.push(item.acceptanceCriteria);
    lines.push('');
  }

  // Relations
  if (item.relations.length > 0) {
    lines.push('## Relations Context');
    const parents = item.relations.filter((r) => r.type === 'parent');
    const children = item.relations.filter((r) => r.type === 'child');
    const related = item.relations.filter((r) => r.type === 'related');
    const blocks = item.relations.filter((r) => r.type === 'blocks' || r.type === 'blocked-by');

    if (parents.length > 0) {
      lines.push('### Parents');
      for (const r of parents) lines.push(`- [${r.id}] ${r.title}`);
      lines.push('');
    }
    if (children.length > 0) {
      lines.push('### Children');
      for (const r of children) lines.push(`- [${r.id}] ${r.title}`);
      lines.push('');
    }
    if (related.length > 0) {
      lines.push('### Related');
      for (const r of related) lines.push(`- [${r.id}] ${r.title}`);
      lines.push('');
    }
    if (blocks.length > 0) {
      lines.push('### Blocks / Blocked-by');
      for (const r of blocks) lines.push(`- [${r.type}] [${r.id}] ${r.title}`);
      lines.push('');
    }
  }

  // History
  if (item.history.length > 0) {
    lines.push('## Change History');
    lines.push('| Date | Author | Changes |');
    lines.push('|------|--------|---------|');
    for (const rev of item.history.slice(0, 10)) {
      const changes = Object.entries(rev.fields)
        .map(([f, v]) => `${f}: ${JSON.stringify(v.newValue)}`)
        .join('; ');
      lines.push(`| ${rev.changedDate} | ${rev.changedBy} | ${changes} |`);
    }
    lines.push('');
  }

  // Tags
  if (item.tags.length > 0) {
    lines.push('## Tags');
    lines.push(item.tags.join(', '));
    lines.push('');
  }

  return lines.join('\n');
}

export function chunkMarkdown(
  item: WorkItem,
  md: string,
): Array<{ chunkType: 'title_ac' | 'description' | 'relations' | 'history'; text: string }> {
  const chunks: Array<{ chunkType: 'title_ac' | 'description' | 'relations' | 'history'; text: string }> = [];

  const titleAc = [
    `[${item.type}] ${item.title}`,
    item.acceptanceCriteria ? `Acceptance Criteria:\n${item.acceptanceCriteria}` : '',
    `State: ${item.state} | Priority: ${item.priority} | Area: ${item.areaPath}`,
    item.tags.length > 0 ? `Tags: ${item.tags.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  if (titleAc.trim()) {
    chunks.push({ chunkType: 'title_ac', text: titleAc });
  }

  if (item.description.trim()) {
    chunks.push({ chunkType: 'description', text: item.description });
  }

  if (item.relations.length > 0) {
    const relText = item.relations
      .map((r) => `${r.type}: [${r.id}] ${r.title}`)
      .join('\n');
    chunks.push({ chunkType: 'relations', text: relText });
  }

  if (item.history.length > 0) {
    const histText = item.history
      .slice(0, 5)
      .map(
        (rev) =>
          `${rev.changedDate} by ${rev.changedBy}: ${Object.keys(rev.fields).join(', ')}`,
      )
      .join('\n');
    chunks.push({ chunkType: 'history', text: histText });
  }

  // Ensure at least one chunk
  if (chunks.length === 0) {
    chunks.push({ chunkType: 'title_ac', text: md.slice(0, 2000) });
  }

  return chunks;
}
