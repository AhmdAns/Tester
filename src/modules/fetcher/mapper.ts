import type { WorkItem, WorkItemRelation } from './types.js';
import type { RawWorkItem } from './ado-client.js';

export function htmlToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function getRelationType(rel: string): string {
  if (rel.includes('Hierarchy-Reverse')) return 'parent';
  if (rel.includes('Hierarchy-Forward')) return 'child';
  if (rel.includes('Blocks-Forward')) return 'blocks';
  if (rel.includes('Blocks-Reverse')) return 'blocked-by';
  if (rel.includes('TestedBy')) return 'tested-by';
  return 'related';
}

export function parseRelations(
  rawRelations?: Array<{ rel: string; url: string; attributes: Record<string, unknown> }>,
): WorkItemRelation[] {
  if (!rawRelations) return [];
  return rawRelations
    .filter((r) => r.url.includes('/workItems/'))
    .map((r) => ({
      type: getRelationType(r.rel),
      id: Number(r.url.split('/workItems/')[1]),
      title: String(r.attributes['name'] ?? ''),
      url: r.url,
    }));
}

export function mapRawToWorkItem(raw: RawWorkItem): WorkItem {
  const f = raw.fields;

  const tags = String(f['System.Tags'] ?? '')
    .split(';')
    .map((t) => t.trim())
    .filter(Boolean);

  const assignedTo = f['System.AssignedTo'];
  const assignedToName =
    assignedTo !== null && typeof assignedTo === 'object'
      ? String((assignedTo as Record<string, unknown>)['displayName'] ?? '')
      : String(assignedTo ?? '');

  return {
    id: raw.id,
    type: String(f['System.WorkItemType'] ?? ''),
    title: String(f['System.Title'] ?? ''),
    description: htmlToText(String(f['System.Description'] ?? '')),
    acceptanceCriteria: htmlToText(
      String(f['Microsoft.VSTS.Common.AcceptanceCriteria'] ?? ''),
    ),
    state: String(f['System.State'] ?? ''),
    priority: Number(f['Microsoft.VSTS.Common.Priority'] ?? 0),
    assignedTo: assignedToName,
    areaPath: String(f['System.AreaPath'] ?? ''),
    iterationPath: String(f['System.IterationPath'] ?? ''),
    tags,
    relations: parseRelations(raw.relations),
    attachments: [],
    history: [],
    createdDate: String(f['System.CreatedDate'] ?? ''),
    changedDate: String(f['System.ChangedDate'] ?? ''),
    rawFields: f,
  };
}
