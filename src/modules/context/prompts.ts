import type { WorkItemCluster } from './types.js';

export const CONTEXT_SYSTEM_PROMPT = `You are a senior QA engineer who has just finished reading a set of product work items.
Your job is to distill this into a structured knowledge document that a testing team can use as a reference.
Focus on WHAT THE SYSTEM DOES and WHAT THE RULES ARE — not on the work item management process.
Be specific and concrete. Extract actual rules, limits, and flows from the acceptance criteria.`;

export function buildContextPrompt(cluster: WorkItemCluster, maxItemsToInclude = 40): string {
  const items = cluster.items.slice(0, maxItemsToInclude);
  const truncated = cluster.items.length > maxItemsToInclude;

  const itemsSummary = items
    .map((item) => {
      const lines = [
        `### [${item.type}] #${item.id}: ${item.title}`,
        `State: ${item.state} | Priority: ${item.priority} | Area: ${item.areaPath}`,
      ];
      if (item.description.trim()) {
        lines.push(`Description: ${item.description.slice(0, 400)}`);
      }
      if (item.acceptanceCriteria.trim()) {
        lines.push(`Acceptance Criteria:\n${item.acceptanceCriteria.slice(0, 600)}`);
      }
      if (item.tags.length > 0) {
        lines.push(`Tags: ${item.tags.join(', ')}`);
      }
      return lines.join('\n');
    })
    .join('\n\n---\n\n');

  const truncationNote = truncated
    ? `\n\n> Note: ${cluster.items.length - maxItemsToInclude} additional items were omitted due to size.`
    : '';

  return `You are reading ${items.length} work items from the "${cluster.name}" area of the product.${truncationNote}

${itemsSummary}

---

Based on these work items, produce a structured business context document with exactly these sections:

## Domain Overview
2-3 sentences describing what this area of the product does and who uses it.

## Key Business Rules
A numbered list of explicit and implicit business rules found in the acceptance criteria and descriptions.
Each rule should be specific and testable (e.g. "Password must be 8-64 characters and contain at least one number").

## Core User Flows
The main happy-path flows a user follows in this area. Use sub-bullets for steps.

## Constraints & Boundaries
- Input limits (field lengths, numeric ranges, file sizes, etc.)
- Permission and role requirements
- Time or rate limits
- Data dependencies or prerequisites

## Edge Cases & Known Issues
Unusual scenarios, error conditions, or known bugs mentioned across these work items.

## Domain Vocabulary
A short glossary of terms specific to this area that a tester needs to know.

Write only the markdown sections above. No preamble, no closing remarks.`;
}

export function buildContextMd(
  cluster: WorkItemCluster,
  generatedContent: string,
): string {
  const lines: string[] = [
    '---',
    `clusterId: ${cluster.id}`,
    `clusterName: "${cluster.name.replace(/"/g, '\\"')}"`,
    `clusterType: ${cluster.type}`,
    `areaPath: "${cluster.areaPath}"`,
    `itemCount: ${cluster.items.length}`,
    `workItemIds: [${cluster.items.map((i) => i.id).join(', ')}]`,
    `lastBuilt: ${new Date().toISOString()}`,
    '---',
    '',
    `# Business Context: ${cluster.name}`,
    '',
    generatedContent.trim(),
    '',
    '## Work Items in this Context',
    '',
    '| ID | Type | Title | State | Priority |',
    '|----|------|-------|-------|----------|',
    ...cluster.items.map(
      (i) => `| ${i.id} | ${i.type} | ${i.title.slice(0, 80)} | ${i.state} | ${i.priority} |`,
    ),
  ];

  return lines.join('\n');
}
