import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './config/loader.js';
import { Fetcher } from './modules/fetcher/fetcher.js';
import { Vectorizer } from './modules/vectorizer/vectorizer.js';
import { Analyzer } from './modules/analyzer/analyzer.js';
import { Designer } from './modules/designer/designer.js';
import { Publisher } from './modules/publisher/publisher.js';
import type { AnalysisType } from './config/schema.js';
import type { TestCase } from './modules/designer/types.js';

async function main(): Promise<void> {
  const config = await loadConfig();
  const server = new Server(
    { name: 'testhelper', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  const fetcher = new Fetcher(config.cache.dir, config.cache.ttlMinutes * 60 * 1000);

  const vectorizer = new Vectorizer(config.vectorizer.storeDir, {
    embeddingModel: config.vectorizer.embeddingModel,
    localModel: config.vectorizer.localModel,
    openaiModel: config.vectorizer.openaiModel,
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'fetch_work_items',
        description: 'Fetch work items from Azure DevOps by date range or explicit IDs',
        inputSchema: {
          type: 'object',
          properties: {
            ids: { type: 'array', items: { type: 'number' }, description: 'Work item IDs to fetch' },
            from: { type: 'string', description: 'Start date ISO 8601 (use with "to")' },
            to: { type: 'string', description: 'End date ISO 8601' },
            types: { type: 'array', items: { type: 'string' }, description: 'Work item type filter' },
            includeRelations: { type: 'boolean', default: true },
          },
        },
      },
      {
        name: 'vectorize_work_items',
        description: 'Index fetched work items into the local vector store for semantic retrieval',
        inputSchema: {
          type: 'object',
          properties: {
            itemIds: { type: 'array', items: { type: 'number' }, description: 'Specific item IDs to vectorize (omit for all fetched)' },
          },
        },
      },
      {
        name: 'search_context',
        description: 'Semantic search across indexed work items',
        inputSchema: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string' },
            topK: { type: 'number', default: 10 },
          },
        },
      },
      {
        name: 'analyze_work_item',
        description: 'Run AI-powered analysis passes (ambiguity, gap, contradiction, testability, etc.) on a work item',
        inputSchema: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'number', description: 'Work item ID' },
            analyses: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['ambiguity', 'gap', 'overlap', 'contradiction', 'dependency', 'impact', 'completeness', 'testability'],
              },
              description: 'Analysis types to run (defaults to config)',
            },
          },
        },
      },
      {
        name: 'design_tests',
        description: 'Generate comprehensive test cases for a user story using full project context via RAG',
        inputSchema: {
          type: 'object',
          required: ['userStoryId'],
          properties: {
            userStoryId: { type: 'number' },
            contextTopK: { type: 'number', default: 10 },
            outputFormat: { type: 'string', enum: ['json', 'md', 'csv'], default: 'json' },
          },
        },
      },
      {
        name: 'publish_tests',
        description: 'Push designed test cases to Azure DevOps Test Plans',
        inputSchema: {
          type: 'object',
          required: ['testCases', 'planName', 'suiteName'],
          properties: {
            testCases: { type: 'array', description: 'Test case objects from design_tests' },
            planName: { type: 'string' },
            suiteName: { type: 'string' },
            associatedUserStoryId: { type: 'number' },
            dryRun: { type: 'boolean', default: false },
          },
        },
      },
      {
        name: 'full_pipeline',
        description: 'Run the entire pipeline: fetch → vectorize → analyze → design (→ optionally publish)',
        inputSchema: {
          type: 'object',
          required: ['userStoryId'],
          properties: {
            userStoryId: { type: 'number' },
            publishImmediately: { type: 'boolean', default: false },
            planName: { type: 'string' },
            suiteName: { type: 'string' },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      if (name === 'fetch_work_items') {
        const org = config.ado.org;
        const project = config.ado.project;
        const pat = config.ado.pat;

        let items;
        if (args.ids && Array.isArray(args.ids)) {
          items = await fetcher.fetchByIds({ org, project, pat, ids: args.ids as number[], includeRelations: (args.includeRelations ?? true) as boolean });
        } else if (args.from && args.to) {
          items = await fetcher.fetchByDateRange({
            org, project, pat,
            from: args.from as string,
            to: args.to as string,
            types: args.types as string[] | undefined,
            includeRelations: (args.includeRelations ?? true) as boolean,
          });
        } else {
          throw new Error('Provide either ids or from+to');
        }

        return { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] };
      }

      if (name === 'vectorize_work_items') {
        const ids = vectorizer.listIndexedIds();
        return {
          content: [{
            type: 'text',
            text: `Use the fetch_work_items tool first to fetch items, then this tool auto-indexes them. Currently indexed: ${ids.length} items (IDs: ${ids.join(', ') || 'none'}).`,
          }],
        };
      }

      if (name === 'search_context') {
        const results = await vectorizer.search(args.query as string, (args.topK ?? 10) as number);
        return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
      }

      if (name === 'analyze_work_item') {
        const id = args.id as number;
        const analyses = (args.analyses ?? config.analyzer.defaultAnalyses) as AnalysisType[];
        const md = vectorizer.getMarkdown(id);
        if (!md) throw new Error(`Work item #${id} not indexed. Run fetch_work_items and vectorize_work_items first.`);

        const analyzer = new Analyzer({ model: config.analyzer.model });
        const reports = await analyzer.analyze(id, md, analyses);
        return { content: [{ type: 'text', text: analyzer.formatReports(reports) }] };
      }

      if (name === 'design_tests') {
        const userStoryId = args.userStoryId as number;
        const items = await fetcher.fetchByIds({
          org: config.ado.org,
          project: config.ado.project,
          pat: config.ado.pat,
          ids: [userStoryId],
          includeRelations: true,
        });
        const workItem = items[0];
        if (!workItem) throw new Error(`Work item #${userStoryId} not found`);

        await vectorizer.vectorizeItems(items);

        const designer = new Designer({ model: config.designer.model });
        const testCases = await designer.design(workItem, vectorizer, {
          contextTopK: (args.contextTopK ?? config.designer.contextTopK) as number,
          coverageRules: config.designer.coverageRules,
        });

        const format = (args.outputFormat ?? 'json') as 'json' | 'md' | 'csv';
        let output: string;
        if (format === 'md') {
          const { toMarkdown } = await import('./modules/designer/formatter.js');
          output = toMarkdown(testCases);
        } else if (format === 'csv') {
          const { toCsv } = await import('./modules/designer/formatter.js');
          output = toCsv(testCases);
        } else {
          output = JSON.stringify(testCases, null, 2);
        }

        return { content: [{ type: 'text', text: output }] };
      }

      if (name === 'publish_tests') {
        const publisher = new Publisher({
          org: config.ado.org,
          project: config.ado.project,
          pat: config.ado.pat,
        });
        const result = await publisher.publish(args.testCases as TestCase[], {
          org: config.ado.org,
          project: config.ado.project,
          pat: config.ado.pat,
          planName: args.planName as string,
          suiteName: args.suiteName as string,
          associatedUserStoryId: args.associatedUserStoryId as number | undefined,
          dryRun: (args.dryRun ?? false) as boolean,
          areaPath: config.publisher.defaultAreaPath,
          iterationPath: config.publisher.defaultIterationPath,
          automationStatus: config.publisher.automationStatus,
        });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      if (name === 'full_pipeline') {
        const userStoryId = args.userStoryId as number;
        const results: string[] = [];

        // Fetch
        const items = await fetcher.fetchByIds({
          org: config.ado.org, project: config.ado.project, pat: config.ado.pat,
          ids: [userStoryId], includeRelations: true,
        });
        const workItem = items[0];
        if (!workItem) throw new Error(`Work item #${userStoryId} not found`);
        results.push(`Fetched: ${items.length} work item(s)`);

        // Vectorize
        await vectorizer.vectorizeItems(items);
        results.push(`Vectorized: ${items.length} item(s) indexed`);

        // Analyze
        const analyzer = new Analyzer({ model: config.analyzer.model });
        const md = vectorizer.getMarkdown(userStoryId) ?? '';
        const reports = await analyzer.analyze(userStoryId, md, config.analyzer.defaultAnalyses);
        results.push(`Analysis: ${reports.length} report(s) generated`);
        results.push(analyzer.formatReports(reports));

        // Design
        const designer = new Designer({ model: config.designer.model });
        const testCases = await designer.design(workItem, vectorizer, { coverageRules: config.designer.coverageRules });
        results.push(`\nDesigned: ${testCases.length} test case(s)`);

        // Publish
        if (args.publishImmediately && config.ado.org) {
          const publisher = new Publisher({ org: config.ado.org, project: config.ado.project, pat: config.ado.pat });
          const planName = (args.planName ?? config.publisher.defaultPlanName) as string;
          const suiteName = (args.suiteName ?? `US-${userStoryId}: ${workItem.title.slice(0, 60)}`) as string;
          const publishResult = await publisher.publish(testCases, {
            org: config.ado.org, project: config.ado.project, pat: config.ado.pat,
            planName, suiteName, associatedUserStoryId: userStoryId,
            automationStatus: config.publisher.automationStatus,
          });
          results.push(`Published: ${publishResult.testCaseIds.length} test case(s)`);
          results.push(`Plan URL: ${publishResult.planUrl}`);
          results.push(`Suite URL: ${publishResult.suiteUrl}`);
        } else {
          results.push('\nTest cases ready (not published — set publishImmediately: true to push to ADO)');
          results.push(JSON.stringify(testCases, null, 2));
        }

        return { content: [{ type: 'text', text: results.join('\n') }] };
      }

      throw new Error(`Unknown tool: ${name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
