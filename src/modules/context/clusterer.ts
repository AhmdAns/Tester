import type { WorkItem } from '../fetcher/types.js';
import type { WorkItemCluster } from './types.js';

function slugify(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function topTwoLevels(areaPath: string): string {
  const parts = areaPath.split('\\');
  return parts.slice(0, 2).join('\\') || areaPath || 'Unknown';
}

export function clusterWorkItems(items: WorkItem[]): WorkItemCluster[] {
  const clusters: WorkItemCluster[] = [];

  // --- Cluster 1: by Epic hierarchy ---
  // Find all Epics and group their descendants under them
  const epics = items.filter((i) => i.type === 'Epic');
  const assignedIds = new Set<number>();

  for (const epic of epics) {
    const members: WorkItem[] = [epic];
    assignedIds.add(epic.id);

    // Direct children via relations
    const childIds = new Set(
      epic.relations.filter((r) => r.type === 'child').map((r) => r.id),
    );

    // Also find items that list this epic as a parent
    for (const item of items) {
      if (item.id === epic.id) continue;
      const isChild =
        childIds.has(item.id) ||
        item.relations.some((r) => r.type === 'parent' && r.id === epic.id);
      if (isChild) {
        members.push(item);
        assignedIds.add(item.id);
      }
    }

    if (members.length > 1) {
      clusters.push({
        id: `epic-${epic.id}`,
        name: epic.title,
        type: 'epic',
        areaPath: epic.areaPath,
        epicId: epic.id,
        items: members,
      });
    }
  }

  // --- Cluster 2: remaining items grouped by Area Path (top 2 levels) ---
  const byArea = new Map<string, WorkItem[]>();

  for (const item of items) {
    if (assignedIds.has(item.id)) continue;
    const area = topTwoLevels(item.areaPath);
    if (!byArea.has(area)) byArea.set(area, []);
    byArea.get(area)!.push(item);
  }

  for (const [area, areaItems] of byArea) {
    // Skip single-item area clusters — not enough context to be useful
    if (areaItems.length < 2) continue;
    clusters.push({
      id: `area-${slugify(area)}`,
      name: area,
      type: 'area',
      areaPath: area,
      items: areaItems,
    });
    for (const item of areaItems) assignedIds.add(item.id);
  }

  // --- Cluster 3: ungrouped remainder (single-item areas, etc.) ---
  const ungrouped = items.filter((i) => !assignedIds.has(i.id));
  if (ungrouped.length > 0) {
    clusters.push({
      id: 'ungrouped',
      name: 'Ungrouped Items',
      type: 'ungrouped',
      areaPath: '',
      items: ungrouped,
    });
  }

  return clusters;
}

export function slugifyCluster(cluster: WorkItemCluster): string {
  return slugify(cluster.id);
}
