import fs from 'fs';
import path from 'path';
import type { TestCase } from './types.js';

export function toJson(testCases: TestCase[]): string {
  return JSON.stringify(testCases, null, 2);
}

export function toMarkdown(testCases: TestCase[]): string {
  const lines: string[] = [
    `# Test Cases (${testCases.length} total)`,
    '',
    '| # | Title | Type | Priority | Steps |',
    '|---|-------|------|----------|-------|',
    ...testCases.map(
      (tc, i) =>
        `| ${i + 1} | ${tc.title.slice(0, 60)} | ${tc.testType} | P${tc.priority} | ${tc.steps.length} |`,
    ),
    '',
  ];

  for (const [i, tc] of testCases.entries()) {
    lines.push(`## ${i + 1}. ${tc.title}`);
    lines.push('');
    lines.push(`**Type:** ${tc.testType}  |  **Priority:** P${tc.priority}  |  **Automation:** ${tc.automationStatus}`);
    if (tc.areaPath) lines.push(`**Area:** ${tc.areaPath}`);
    if (tc.iterationPath) lines.push(`**Iteration:** ${tc.iterationPath}`);
    if (tc.tags.length > 0) lines.push(`**Tags:** ${tc.tags.join(', ')}`);
    lines.push('');
    if (tc.description) {
      lines.push(`**Objective:** ${tc.description}`);
      lines.push('');
    }
    if (tc.preconditions) {
      lines.push(`**Preconditions:** ${tc.preconditions}`);
      lines.push('');
    }
    lines.push('**Steps:**');
    lines.push('');
    lines.push('| Step | Action | Expected Result | Test Data |');
    lines.push('|------|--------|-----------------|-----------|');
    for (const step of tc.steps) {
      lines.push(
        `| ${step.stepNumber} | ${step.action} | ${step.expectedResult} | ${step.testData ?? ''} |`,
      );
    }
    lines.push('');
    if (tc.expectedOutcome) {
      lines.push(`**Expected Outcome:** ${tc.expectedOutcome}`);
      lines.push('');
    }
    if (tc.associatedWorkItems.length > 0) {
      lines.push(`**Associated Work Items:** ${tc.associatedWorkItems.map((id) => `#${id}`).join(', ')}`);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

export function toCsv(testCases: TestCase[]): string {
  const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;

  const headers = [
    'Title',
    'Type',
    'Priority',
    'Area Path',
    'Iteration Path',
    'Automation Status',
    'Tags',
    'Preconditions',
    'Expected Outcome',
    'Description',
    'Steps (Action → Expected)',
    'Associated Work Items',
  ];

  const rows = testCases.map((tc) => {
    const stepsText = tc.steps
      .map((s) => `${s.stepNumber}. ${s.action} → ${s.expectedResult}`)
      .join(' | ');
    return [
      tc.title,
      tc.testType,
      String(tc.priority),
      tc.areaPath,
      tc.iterationPath,
      tc.automationStatus,
      tc.tags.join('; '),
      tc.preconditions,
      tc.expectedOutcome,
      tc.description,
      stepsText,
      tc.associatedWorkItems.join('; '),
    ].map(escape);
  });

  return [headers.map(escape).join(','), ...rows.map((r) => r.join(','))].join('\n');
}

export async function toXlsx(testCases: TestCase[], outputPath: string): Promise<void> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Test Cases');

  ws.columns = [
    { header: 'Title', key: 'title', width: 60 },
    { header: 'Type', key: 'testType', width: 20 },
    { header: 'Priority', key: 'priority', width: 10 },
    { header: 'Area Path', key: 'areaPath', width: 30 },
    { header: 'Iteration', key: 'iterationPath', width: 20 },
    { header: 'Automation', key: 'automationStatus', width: 20 },
    { header: 'Tags', key: 'tags', width: 30 },
    { header: 'Preconditions', key: 'preconditions', width: 40 },
    { header: 'Expected Outcome', key: 'expectedOutcome', width: 40 },
    { header: 'Description', key: 'description', width: 40 },
    { header: 'Steps', key: 'steps', width: 80 },
    { header: 'Associated Work Items', key: 'associatedWorkItems', width: 30 },
  ];

  // Style header row
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' },
  };
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  for (const tc of testCases) {
    const stepsText = tc.steps
      .map((s) => `${s.stepNumber}. ${s.action}\n   → ${s.expectedResult}${s.testData ? `\n   Data: ${s.testData}` : ''}`)
      .join('\n\n');

    ws.addRow({
      title: tc.title,
      testType: tc.testType,
      priority: tc.priority,
      areaPath: tc.areaPath,
      iterationPath: tc.iterationPath,
      automationStatus: tc.automationStatus,
      tags: tc.tags.join('; '),
      preconditions: tc.preconditions,
      expectedOutcome: tc.expectedOutcome,
      description: tc.description,
      steps: stepsText,
      associatedWorkItems: tc.associatedWorkItems.join(', '),
    });
  }

  // Auto-height rows
  ws.eachRow((row) => {
    row.alignment = { wrapText: true, vertical: 'top' };
  });

  await wb.xlsx.writeFile(outputPath);
}

export async function saveOutput(
  testCases: TestCase[],
  format: 'json' | 'md' | 'csv' | 'xlsx',
  outputPath: string,
): Promise<void> {
  const dir = path.dirname(outputPath);
  if (dir) fs.mkdirSync(dir, { recursive: true });

  if (format === 'xlsx') {
    await toXlsx(testCases, outputPath);
    return;
  }

  const content = format === 'json' ? toJson(testCases)
    : format === 'md' ? toMarkdown(testCases)
    : toCsv(testCases);

  fs.writeFileSync(outputPath, content, 'utf-8');
}
