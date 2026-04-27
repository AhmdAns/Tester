import type { AnalysisType } from './types.js';

export const ANALYZER_SYSTEM_PROMPT = `You are a senior Business Analyst and QA Architect reviewing Azure DevOps work items.
Your role is to surface actionable intelligence about requirements quality before test design begins.
Respond with a JSON object matching the schema described in each prompt.
Be specific: cite the exact text that is problematic, not general observations.
Be concise: findings should be actionable, not academic.`;

export function buildAnalysisPrompt(
  analysisType: AnalysisType,
  workItemMd: string,
  contextMd: string,
): string {
  const schema = `{
  "severity": "critical|high|medium|low|info",
  "findings": [
    { "location": "<field or AC clause>", "description": "<what is wrong>", "suggestion": "<how to fix>" }
  ],
  "recommendations": [
    { "priority": "critical|high|medium|low", "action": "<what to do>", "rationale": "<why>" }
  ],
  "relatedItems": [<list of related work item IDs referenced>]
}`;

  const descriptions: Record<AnalysisType, string> = {
    ambiguity: `Identify vague language, missing specificity, undefined actors, relative terms without anchors
    (e.g. "shortly", "fast", "appropriate"), and acceptance criteria that cannot be objectively verified.`,

    gap: `Find missing requirements: unspecified error states, missing non-functional requirements,
    absent boundary definitions, undefined authentication/authorization requirements, missing rollback/undo behavior.`,

    overlap: `Detect functional duplication between this work item and the related items in context.
    Note any cases where two items describe the same behavior, which could lead to conflicting implementations.`,

    contradiction: `Find logically conflicting requirements. For example: one item says a field is required, another says optional;
    one item says max 100 chars, another says 255 chars for the same field.`,

    dependency: `Map implicit and explicit dependency chains. Flag any dependencies on external systems, APIs, or
    other work items that are not captured in the ADO relations, and any circular dependencies.`,

    impact: `Given changes described in this work item, identify all downstream work items, features, and
    test areas likely to be affected. Flag regression risks.`,

    completeness: `Score this work item against a completeness rubric:
    - Has description (non-trivial): yes/no
    - Has acceptance criteria: yes/no
    - Has priority set: yes/no
    - Has area path: yes/no
    - Has iteration path: yes/no
    - Has at least one relation: yes/no
    - Is sized (story points or effort): yes/no
    List what is missing and suggest fixes.`,

    testability: `Score each acceptance criterion on whether it is directly testable as written.
    An AC is testable if it specifies: who does what, under what conditions, with what expected outcome.
    Flag ACs that are not directly testable and suggest rewrites.`,
  };

  const contextSection = contextMd.trim()
    ? `\n\n## Related Work Items Context\n\n${contextMd}`
    : '';

  return `## Work Item Under Analysis\n\n${workItemMd}${contextSection}

## Analysis Task: ${analysisType}

${descriptions[analysisType]}

Respond with ONLY a JSON object matching this schema (no markdown fences, no preamble):
${schema}`;
}

export function formatReport(
  report: import('./types.js').AnalysisReport,
  workItemId: number,
): string {
  const lines: string[] = [
    `# Analysis Report — [${report.analysisType}] Work Item #${workItemId}`,
    `**Severity:** ${report.severity}  |  **Generated:** ${report.timestamp}`,
    '',
  ];

  if (report.findings.length === 0) {
    lines.push('No significant findings.');
  } else {
    lines.push('## Findings');
    for (const f of report.findings) {
      lines.push(`\n### ${f.location}`);
      lines.push(f.description);
      if (f.suggestion) lines.push(`\n> **Suggestion:** ${f.suggestion}`);
    }
  }

  if (report.recommendations.length > 0) {
    lines.push('\n## Recommendations');
    for (const r of report.recommendations) {
      lines.push(`\n**[${r.priority.toUpperCase()}]** ${r.action}`);
      lines.push(`*Rationale:* ${r.rationale}`);
    }
  }

  if (report.relatedItems.length > 0) {
    lines.push(`\n## Related Items Referenced`);
    lines.push(report.relatedItems.map((id) => `#${id}`).join(', '));
  }

  return lines.join('\n');
}
