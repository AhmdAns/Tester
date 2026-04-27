import { callClaude } from '../../utils/claude-client.js';
import { logger } from '../../utils/logger.js';
import { DESIGNER_SYSTEM_PROMPT, buildDesignPrompt } from './prompts.js';
import { assembleContext } from './retriever.js';
import type { TestCase, DesignOptions } from './types.js';
import type { WorkItem } from '../fetcher/types.js';
import type { Vectorizer } from '../vectorizer/vectorizer.js';
import type { ContextBuilder } from '../context/context-builder.js';
import { buildMarkdown } from '../vectorizer/md-builder.js';

export class Designer {
  private readonly model: string;

  constructor(opts: { model?: string } = {}) {
    this.model = opts.model ?? 'claude-sonnet-4-6';
  }

  async design(
    workItem: WorkItem,
    vectorizer: Vectorizer | null,
    opts: DesignOptions = {},
    contextBuilder?: ContextBuilder,
  ): Promise<TestCase[]> {
    const workItemMd = buildMarkdown(workItem);

    let contextMd = '';
    let estimatedTokens = 0;

    if (vectorizer) {
      const ctx = await assembleContext(workItem, vectorizer, opts.contextTopK ?? 10, contextBuilder);
      contextMd = ctx.contextMd;
      estimatedTokens = ctx.estimatedTokens;
      logger.info(
        { itemsIncluded: ctx.itemsIncluded.length, estimatedTokens },
        'Context assembled for design',
      );
    }

    const userContent = buildDesignPrompt(workItemMd, contextMd, estimatedTokens, opts);

    logger.info({ workItemId: workItem.id, model: this.model }, 'Designing test cases');
    process.stderr.write(`\n[Designing tests for #${workItem.id}: ${workItem.title}]\n`);

    let accumulated = '';
    let testCount = 0;

    const raw = await callClaude(DESIGNER_SYSTEM_PROMPT, userContent, {
      model: this.model,
      onChunk: (text) => {
        accumulated += text;
        const newCount = (accumulated.match(/"title":/g) ?? []).length;
        if (newCount > testCount) {
          testCount = newCount;
          process.stderr.write(`\r  Generating... ${testCount} test case(s) so far`);
        }
      },
    });

    process.stderr.write(`\r  Done! Generated ${testCount} test case(s).               \n`);

    return this.parseTestCases(raw, workItem);
  }

  private parseTestCases(raw: string, workItem: WorkItem): TestCase[] {
    try {
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error('No JSON array found');
      const parsed = JSON.parse(jsonMatch[0]) as Partial<TestCase>[];

      return parsed.map((tc, i) => ({
        title: String(tc.title ?? `Test Case ${i + 1}`).slice(0, 255),
        description: String(tc.description ?? ''),
        priority: ([1, 2, 3, 4].includes(Number(tc.priority))
          ? Number(tc.priority)
          : 2) as 1 | 2 | 3 | 4,
        areaPath: String(tc.areaPath ?? workItem.areaPath),
        iterationPath: String(tc.iterationPath ?? workItem.iterationPath),
        automationStatus: (['Not Automated', 'Planned', 'Automated'].includes(
          String(tc.automationStatus),
        )
          ? tc.automationStatus
          : 'Not Automated') as 'Not Automated' | 'Planned' | 'Automated',
        tags: Array.isArray(tc.tags) ? tc.tags.map(String) : [],
        testType: (tc.testType ?? 'Happy Path') as TestCase['testType'],
        preconditions: String(tc.preconditions ?? ''),
        expectedOutcome: String(tc.expectedOutcome ?? ''),
        associatedWorkItems: Array.isArray(tc.associatedWorkItems)
          ? tc.associatedWorkItems.map(Number)
          : [workItem.id],
        steps: Array.isArray(tc.steps)
          ? tc.steps.map((s, si) => ({
              stepNumber: Number((s as { stepNumber?: unknown }).stepNumber ?? si + 1),
              action: String((s as { action?: unknown }).action ?? ''),
              expectedResult: String((s as { expectedResult?: unknown }).expectedResult ?? ''),
              testData: (s as { testData?: unknown }).testData
                ? String((s as { testData?: unknown }).testData)
                : undefined,
            }))
          : [],
      }));
    } catch (err) {
      logger.warn({ err }, 'Failed to parse test case JSON');
      return [];
    }
  }

  async dryRun(
    workItem: WorkItem,
    vectorizer: Vectorizer | null,
    opts: DesignOptions = {},
    contextBuilder?: ContextBuilder,
  ): Promise<{ contextTokens: number; itemsIncluded: number[]; prompt: string }> {
    const workItemMd = buildMarkdown(workItem);
    let contextMd = '';
    let estimatedTokens = 0;
    let itemsIncluded: number[] = [];

    if (vectorizer) {
      const ctx = await assembleContext(workItem, vectorizer, opts.contextTopK ?? 10, contextBuilder);
      contextMd = ctx.contextMd;
      estimatedTokens = ctx.estimatedTokens;
      itemsIncluded = ctx.itemsIncluded;
    }

    const prompt = buildDesignPrompt(workItemMd, contextMd, estimatedTokens, opts);
    return { contextTokens: estimatedTokens, itemsIncluded, prompt };
  }
}
