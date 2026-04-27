import axios, { type AxiosInstance } from 'axios';
import { logger } from '../../utils/logger.js';
import { withRetry } from '../../utils/retry.js';
import type { TestCase, TestStep } from '../designer/types.js';

const API_VERSION = '7.1';

export class AdoTestClient {
  private readonly http: AxiosInstance;
  private readonly httpWit: AxiosInstance;
  private readonly baseUrl: string;

  constructor(opts: { org: string; project: string; pat: string }) {
    const token = Buffer.from(`:${opts.pat}`).toString('base64');
    const auth = `Basic ${token}`;
    this.baseUrl = `https://dev.azure.com/${opts.org}/${opts.project}`;

    this.http = axios.create({
      baseURL: `${this.baseUrl}/_apis/testplan`,
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
    });

    this.httpWit = axios.create({
      baseURL: `${this.baseUrl}/_apis/wit`,
      headers: { Authorization: auth, 'Content-Type': 'application/json-patch+json' },
    });
  }

  async getOrCreatePlan(name: string, areaPath?: string, iterationPath?: string): Promise<number> {
    return withRetry(async () => {
      const list = await this.http.get<{ value: Array<{ id: number; name: string }> }>('/plans', {
        params: { 'api-version': API_VERSION },
      });
      const existing = list.data.value.find((p) => p.name === name);
      if (existing) {
        logger.info({ planId: existing.id }, 'Using existing test plan');
        return existing.id;
      }

      const created = await this.http.post<{ id: number }>(
        '/plans',
        {
          name,
          areaPath: areaPath ?? '',
          iteration: iterationPath ?? '',
        },
        { params: { 'api-version': API_VERSION } },
      );
      logger.info({ planId: created.data.id }, 'Created test plan');
      return created.data.id;
    });
  }

  async getOrCreateSuite(planId: number, suiteName: string): Promise<number> {
    return withRetry(async () => {
      const suites = await this.http.get<{ value: Array<{ id: number; name: string }> }>(
        `/plans/${planId}/suites`,
        { params: { 'api-version': API_VERSION } },
      );
      const existing = suites.data.value.find((s) => s.name === suiteName);
      if (existing) {
        logger.info({ suiteId: existing.id }, 'Using existing test suite');
        return existing.id;
      }

      // Get root suite ID
      const root = suites.data.value[0];
      if (!root) throw new Error('No root suite found in test plan');

      const created = await this.http.post<{ id: number }>(
        `/plans/${planId}/suites`,
        {
          suiteType: 'staticTestSuite',
          name: suiteName,
          parentSuite: { id: root.id },
        },
        { params: { 'api-version': API_VERSION } },
      );
      logger.info({ suiteId: created.data.id }, 'Created test suite');
      return created.data.id;
    });
  }

  async createTestCaseWorkItem(
    tc: TestCase,
    automationStatus: string,
  ): Promise<number> {
    return withRetry(async () => {
      const stepsXml = buildStepsXml(tc.steps);
      const patch = [
        { op: 'add', path: '/fields/System.Title', value: tc.title },
        { op: 'add', path: '/fields/System.Description', value: tc.description },
        { op: 'add', path: '/fields/Microsoft.VSTS.Common.Priority', value: tc.priority },
        { op: 'add', path: '/fields/System.AreaPath', value: tc.areaPath },
        { op: 'add', path: '/fields/System.IterationPath', value: tc.iterationPath },
        { op: 'add', path: '/fields/Microsoft.VSTS.TCM.Steps', value: stepsXml },
        {
          op: 'add',
          path: '/fields/Microsoft.VSTS.TCM.AutomationStatus',
          value: automationStatus,
        },
        { op: 'add', path: '/fields/Microsoft.VSTS.TCM.LocalDataSource', value: '' },
        { op: 'add', path: '/fields/Microsoft.VSTS.TCM.TestSuiteType', value: 'Static' },
        {
          op: 'add',
          path: '/fields/System.Tags',
          value: tc.tags.join('; '),
        },
      ];

      // Add preconditions and expected outcome to description if present
      if (tc.preconditions || tc.expectedOutcome) {
        const fullDesc = [
          tc.description,
          tc.preconditions ? `**Preconditions:** ${tc.preconditions}` : '',
          tc.expectedOutcome ? `**Expected Outcome:** ${tc.expectedOutcome}` : '',
        ]
          .filter(Boolean)
          .join('\n\n');
        patch[1].value = fullDesc;
      }

      const res = await this.httpWit.post<{ id: number }>(
        '/workitems/$Test%20Case',
        patch,
        { params: { 'api-version': API_VERSION } },
      );
      return res.data.id;
    });
  }

  async linkTestCaseToWorkItem(testCaseId: number, workItemId: number): Promise<void> {
    await withRetry(async () => {
      await this.httpWit.patch(
        `/workitems/${testCaseId}`,
        [
          {
            op: 'add',
            path: '/relations/-',
            value: {
              rel: 'Microsoft.VSTS.Common.TestedBy-Reverse',
              url: `${this.baseUrl}/_apis/wit/workItems/${workItemId}`,
            },
          },
        ],
        { params: { 'api-version': API_VERSION } },
      );
    });
  }

  async addTestCasesToSuite(
    planId: number,
    suiteId: number,
    testCaseIds: number[],
  ): Promise<void> {
    if (testCaseIds.length === 0) return;
    await withRetry(async () => {
      await this.http.post(
        `/plans/${planId}/suites/${suiteId}/testcase`,
        testCaseIds.map((id) => ({ workItem: { id } })),
        { params: { 'api-version': API_VERSION } },
      );
    });
  }

  async validateConnection(): Promise<boolean> {
    try {
      await this.http.get('/plans', { params: { 'api-version': API_VERSION } });
      return true;
    } catch {
      return false;
    }
  }

  buildPlanUrl(planId: number): string {
    return `${this.baseUrl}/_testManagement?planId=${planId}`;
  }

  buildSuiteUrl(planId: number, suiteId: number): string {
    return `${this.baseUrl}/_testManagement?planId=${planId}&suiteId=${suiteId}`;
  }
}

function buildStepsXml(steps: TestStep[]): string {
  const stepElements = steps
    .map(
      (s) =>
        `<step id="${s.stepNumber}" type="ActionStep">` +
        `<parameterizedString isformatted="true">&lt;DIV&gt;&lt;P&gt;${escapeXml(s.action)}${s.testData ? ` [Test Data: ${escapeXml(s.testData)}]` : ''}&lt;/P&gt;&lt;/DIV&gt;</parameterizedString>` +
        `<parameterizedString isformatted="true">&lt;DIV&gt;&lt;P&gt;${escapeXml(s.expectedResult)}&lt;/P&gt;&lt;/DIV&gt;</parameterizedString>` +
        `<description/></step>`,
    )
    .join('');
  return `<steps id="0" last="${steps.length}">${stepElements}</steps>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
