import fs from 'fs';
import path from 'path';
import { logger } from '../../utils/logger.js';
import { AdoTestClient } from './ado-test-client.js';
import type { TestCase } from '../designer/types.js';
import type { PublishOptions, PublishResult, PublishState } from './types.js';

export class Publisher {
  private readonly client: AdoTestClient;

  constructor(opts: { org: string; project: string; pat: string }) {
    this.client = new AdoTestClient(opts);
  }

  async publish(testCases: TestCase[], opts: PublishOptions): Promise<PublishResult> {
    if (opts.dryRun) {
      return this.dryRun(testCases, opts);
    }

    logger.info('Validating ADO connection...');
    const connected = await this.client.validateConnection();
    if (!connected) {
      throw new Error('Failed to connect to Azure DevOps. Check org, project, and PAT.');
    }

    const planId = await this.client.getOrCreatePlan(
      opts.planName,
      opts.areaPath,
      opts.iterationPath,
    );
    const suiteId = await this.client.getOrCreateSuite(planId, opts.suiteName);

    const checkpointDir = opts.checkpointDir ?? '.testhelper/publish-state';
    const runId = `${planId}-${suiteId}-${Date.now()}`;
    const checkpointPath = path.join(checkpointDir, `${runId}.json`);
    fs.mkdirSync(checkpointDir, { recursive: true });

    const state: PublishState = {
      runId,
      planId,
      suiteId,
      publishedIds: [],
      timestamp: new Date().toISOString(),
    };

    const testCaseIds: number[] = [];
    let skipped = 0;

    for (const [i, tc] of testCases.entries()) {
      process.stderr.write(
        `\r  Publishing [${i + 1}/${testCases.length}] ${tc.testType}: ${tc.title.slice(0, 60)}...`,
      );

      try {
        const tcId = await this.client.createTestCaseWorkItem(
          tc,
          opts.automationStatus ?? tc.automationStatus,
        );

        if (opts.associatedUserStoryId) {
          try {
            await this.client.linkTestCaseToWorkItem(tcId, opts.associatedUserStoryId);
          } catch {
            logger.warn({ tcId }, 'Failed to link test case to user story — continuing');
          }
        }

        testCaseIds.push(tcId);
        state.publishedIds.push(tcId);

        // Save checkpoint after each successful publish
        fs.writeFileSync(checkpointPath, JSON.stringify(state, null, 2));
      } catch (err) {
        logger.error({ err, title: tc.title }, 'Failed to publish test case');
        skipped++;
      }
    }

    process.stderr.write('\n');

    // Add all test cases to the suite in one batch
    if (testCaseIds.length > 0) {
      logger.info({ count: testCaseIds.length }, 'Adding test cases to suite');
      await this.client.addTestCasesToSuite(planId, suiteId, testCaseIds);
    }

    const result: PublishResult = {
      planId,
      planUrl: this.client.buildPlanUrl(planId),
      suiteId,
      suiteUrl: this.client.buildSuiteUrl(planId, suiteId),
      testCaseIds,
      skipped,
    };

    logger.info({ result }, 'Publish complete');
    return result;
  }

  private async dryRun(testCases: TestCase[], opts: PublishOptions): Promise<PublishResult> {
    logger.info('Validating ADO connection (dry-run)...');
    const connected = await this.client.validateConnection();
    if (!connected) {
      throw new Error('Failed to connect to Azure DevOps. Check org, project, and PAT.');
    }

    console.log('\n[dry-run] Would create:');
    console.log(`  Test Plan: "${opts.planName}"`);
    console.log(`  Test Suite: "${opts.suiteName}"`);
    console.log(`  Test Cases: ${testCases.length}`);
    console.log('');

    for (const [i, tc] of testCases.entries()) {
      console.log(`  ${i + 1}. [${tc.testType}] P${tc.priority} — ${tc.title}`);
      console.log(`     ${tc.steps.length} step(s)`);
    }
    console.log('');

    return {
      planId: 0,
      planUrl: '',
      suiteId: 0,
      suiteUrl: '',
      testCaseIds: [],
      skipped: 0,
    };
  }
}
