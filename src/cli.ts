import { Command, type OptionValues } from 'commander';
import { logger } from './utils/logger.js';
import { loadConfig } from './config/loader.js';
import { Fetcher } from './modules/fetcher/fetcher.js';

interface GlobalOpts extends OptionValues {
  dryRun: boolean;
  verbose: boolean;
  config?: string;
}

interface FetchOpts extends OptionValues {
  from?: string;
  to?: string;
  ids?: string;
  types?: string;
  area?: string;
  iteration?: string;
  includeRelations: boolean;
  org?: string;
  project?: string;
  pat?: string;
  output: string;
}

const program = new Command();

program
  .name('testhelper')
  .description('AI-powered test engineering CLI for Azure DevOps')
  .version('0.1.0')
  .option('--dry-run', 'Show what would happen without calling LLMs or ADO write APIs', false)
  .option('--verbose', 'Enable debug logging', false)
  .option('--config <path>', 'Path to config file');

program.hook('preAction', (_, actionCommand) => {
  const opts = actionCommand.optsWithGlobals<GlobalOpts>();
  if (opts.verbose) {
    logger.level = 'debug';
  }
});

// ── init ──────────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Create .testhelper.json config in current directory and update .gitignore')
  .action(async () => {
    const { initCommand } = await import('./commands/init.js');
    await initCommand();
  });

// ── fetch ─────────────────────────────────────────────────────────────────────

const fetchCmd = program
  .command('fetch')
  .description('Fetch work items from Azure DevOps')
  .option('--from <date>', 'Start date (ISO 8601, e.g. 2024-01-01)')
  .option('--to <date>', 'End date (ISO 8601)')
  .option('--ids <ids>', 'Comma-separated work item IDs (e.g. 12345,12346)')
  .option('--types <types>', 'Work item type filter, comma-separated (e.g. "User Story,Bug")')
  .option('--area <path>', 'Area path filter')
  .option('--iteration <path>', 'Iteration path filter')
  .option('--include-relations', 'Include related work items', true)
  .option('--org <org>', 'Azure DevOps organization (overrides config / env)')
  .option('--project <project>', 'Azure DevOps project (overrides config / env)')
  .option('--pat <pat>', 'Personal Access Token (prefer TESTHELPER_ADO_PAT env var)')
  .option('--output <format>', 'Output format: json | summary', 'summary')
  .action(async (opts: FetchOpts) => {
    const globalOpts = fetchCmd.optsWithGlobals<GlobalOpts>();
    const config = await loadConfig(globalOpts.config);

    const org = opts.org ?? config.ado.org;
    const project = opts.project ?? config.ado.project;
    const pat = opts.pat ?? config.ado.pat;

    if (!org) {
      logger.error('Organization is required. Use --org, TESTHELPER_ADO_ORG env var, or ado.org in config.');
      process.exit(1);
    }
    if (!project) {
      logger.error('Project is required. Use --project, TESTHELPER_ADO_PROJECT env var, or ado.project in config.');
      process.exit(1);
    }
    if (!pat) {
      logger.error('PAT is required. Use --pat, TESTHELPER_ADO_PAT env var, or ado.pat in config.');
      process.exit(1);
    }

    if (globalOpts.dryRun) {
      logger.info({ org, project, opts }, '[dry-run] Would fetch with these options');
      return;
    }

    const fetcher = new Fetcher(config.cache.dir, config.cache.ttlMinutes * 60 * 1000);
    let items;

    if (opts.ids) {
      const ids = opts.ids
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => n > 0);
      if (ids.length === 0) {
        logger.error('No valid IDs found in --ids value');
        process.exit(1);
      }
      items = await fetcher.fetchByIds({
        org,
        project,
        pat,
        ids,
        includeRelations: opts.includeRelations,
      });
    } else if (opts.from && opts.to) {
      const types = opts.types?.split(',').map((s) => s.trim());
      items = await fetcher.fetchByDateRange({
        org,
        project,
        pat,
        from: opts.from,
        to: opts.to,
        types,
        areaPath: opts.area,
        iterationPath: opts.iteration,
        includeRelations: opts.includeRelations,
      });
    } else {
      logger.error('Provide either --ids or both --from and --to');
      process.exit(1);
      return;
    }

    if (opts.output === 'json') {
      process.stdout.write(JSON.stringify(items, null, 2) + '\n');
    } else {
      console.log(`\nFetched ${items.length} work item(s):\n`);
      for (const item of items) {
        console.log(`  [${item.type}] #${item.id} — ${item.title} (${item.state})`);
        if (item.relations.length > 0) {
          const relSummary = item.relations
            .map((r) => `${r.type}:#${r.id}`)
            .join(', ');
          console.log(`    Relations: ${relSummary}`);
        }
      }
      console.log('');
    }
  });

// ── context ───────────────────────────────────────────────────────────────────

const contextCmd = program.command('context').description('Manage product context knowledge base');

const contextBuildCmd = contextCmd
  .command('build')
  .description('Fetch work items and build a product-awareness knowledge base')
  .option('--from <date>', 'Start date ISO 8601 (e.g. 2024-01-01)')
  .option('--to <date>', 'End date ISO 8601')
  .option('--max <n>', 'Maximum number of work items to fetch', '300')
  .option('--types <types>', 'Work item types, comma-separated (default: User Story,Bug,Feature,Epic)')
  .option('--area <path>', 'Area path filter')
  .option('--org <org>', 'Azure DevOps organization')
  .option('--project <project>', 'Azure DevOps project')
  .option('--pat <pat>', 'Personal Access Token')
  .action(async (opts: { from?: string; to?: string; max: string; types?: string; area?: string; org?: string; project?: string; pat?: string }) => {
    const globalOpts = contextBuildCmd.optsWithGlobals<GlobalOpts>();
    const config = await loadConfig(globalOpts.config);

    const org = opts.org ?? config.ado.org;
    const project = opts.project ?? config.ado.project;
    const pat = opts.pat ?? config.ado.pat;

    if (!org || !project || !pat) {
      logger.error('org, project, and pat are required');
      process.exit(1);
    }
    if (!opts.from || !opts.to) {
      logger.error('--from and --to are required');
      process.exit(1);
    }

    const { Fetcher: F } = await import('./modules/fetcher/fetcher.js');
    const { Vectorizer } = await import('./modules/vectorizer/vectorizer.js');
    const { ContextBuilder } = await import('./modules/context/context-builder.js');

    const types = opts.types
      ? opts.types.split(',').map((s) => s.trim())
      : ['User Story', 'Bug', 'Feature', 'Epic'];

    console.log(`\nFetching up to ${opts.max} work items from ${opts.from} to ${opts.to}...`);

    const fetcher = new F(config.cache.dir, config.cache.ttlMinutes * 60 * 1000);
    let items = await fetcher.fetchByDateRange({
      org, project, pat,
      from: opts.from,
      to: opts.to,
      types,
      areaPath: opts.area,
      includeRelations: true,
    });

    const max = Number(opts.max);
    if (items.length > max) {
      console.log(`  Trimming to ${max} items (fetched ${items.length})`);
      items = items.slice(0, max);
    }

    console.log(`  Fetched ${items.length} work items\n`);

    if (globalOpts.dryRun) {
      logger.info({ count: items.length }, '[dry-run] Would build context from these items');
      return;
    }

    // Step 1: Vectorize individual work items
    console.log('[1/2] Vectorizing individual work items...');
    const vec = new Vectorizer(config.vectorizer.storeDir, {
      embeddingModel: config.vectorizer.embeddingModel,
      localModel: config.vectorizer.localModel,
      openaiModel: config.vectorizer.openaiModel,
    });
    await vec.vectorizeItems(items);

    // Step 2: Build and vectorize context documents
    console.log('\n[2/2] Building product context knowledge base...');
    const builder = new ContextBuilder(config.vectorizer.storeDir);
    const docs = await builder.build(items, config.analyzer.model);
    await vec.vectorizeContextDocuments(docs);

    console.log(`\nContext knowledge base built:`);
    const meta = builder.getMeta();
    if (meta) {
      for (const c of meta.clusters) {
        console.log(`  [${c.type}] ${c.name} — ${c.itemCount} items`);
      }
    }
    console.log(`\nTotal: ${docs.length} context document(s) saved to ${config.vectorizer.storeDir}/context/`);
  });

contextCmd
  .command('rebuild')
  .description('Re-vectorize context and work item files locally (no Claude or ADO calls needed — run after git pull)')
  .action(async () => {
    const globalOpts = program.optsWithGlobals<GlobalOpts>();
    const config = await loadConfig(globalOpts.config);
    const { Vectorizer } = await import('./modules/vectorizer/vectorizer.js');
    const { ContextBuilder } = await import('./modules/context/context-builder.js');

    const vec = new Vectorizer(config.vectorizer.storeDir, {
      embeddingModel: config.vectorizer.embeddingModel,
      localModel: config.vectorizer.localModel,
      openaiModel: config.vectorizer.openaiModel,
    });
    const builder = new ContextBuilder(config.vectorizer.storeDir);

    const contextDocs = builder.listDocuments();
    const itemIds = vec.listIndexedIds();

    if (contextDocs.length === 0 && itemIds.length === 0) {
      console.log('Nothing to rebuild. Pull the latest context from your repo first.');
      return;
    }

    if (globalOpts.dryRun) {
      console.log(`[dry-run] Would rebuild: ${contextDocs.length} context document(s), ${itemIds.length} work item(s)`);
      return;
    }

    if (contextDocs.length > 0) {
      console.log(`\n[1/2] Re-vectorizing ${contextDocs.length} context document(s)...`);
      await vec.vectorizeContextDocuments(contextDocs);
      console.log('      Done.');
    }

    if (itemIds.length > 0) {
      console.log(`\n[2/2] Re-vectorizing ${itemIds.length} work item(s)...`);
      await vec.rebuildIndex();
      console.log('      Done.');
    }

    console.log('\nLocal vector index is ready.');
  });

contextCmd
  .command('status')
  .description('Show what context has been built')
  .action(async () => {
    const globalOpts = program.optsWithGlobals<GlobalOpts>();
    const config = await loadConfig(globalOpts.config);
    const { ContextBuilder } = await import('./modules/context/context-builder.js');

    const builder = new ContextBuilder(config.vectorizer.storeDir);
    const meta = builder.getMeta();

    if (!meta) {
      console.log('No context built yet. Run: testhelper context build --from <date> --to <date>');
      return;
    }

    console.log(`\nProduct context knowledge base`);
    console.log(`Built: ${meta.builtAt}`);
    console.log(`Total items indexed: ${meta.totalItems}`);
    console.log(`\nClusters (${meta.clusters.length}):\n`);
    for (const c of meta.clusters) {
      console.log(`  [${c.type.padEnd(10)}] ${c.name} (${c.itemCount} items)`);
    }
    console.log('');
  });

contextCmd
  .command('search')
  .description('Search the product context knowledge base')
  .argument('<query>', 'Search query')
  .option('--top <k>', 'Number of results', '5')
  .action(async (query: string, opts: { top: string }) => {
    const globalOpts = program.optsWithGlobals<GlobalOpts>();
    const config = await loadConfig(globalOpts.config);
    const { Vectorizer } = await import('./modules/vectorizer/vectorizer.js');

    const vec = new Vectorizer(config.vectorizer.storeDir, {
      embeddingModel: config.vectorizer.embeddingModel,
      localModel: config.vectorizer.localModel,
      openaiModel: config.vectorizer.openaiModel,
    });

    const results = await vec.search(query, Number(opts.top));
    const contextResults = results.filter((r) => r.chunkType === 'context');

    if (contextResults.length === 0) {
      console.log('No context results. Run "testhelper context build" first.');
      return;
    }

    console.log(`\nContext matches for: "${query}"\n`);
    for (const r of contextResults) {
      console.log(`Score: ${r.score.toFixed(4)}`);
      console.log(r.text.split('\n').slice(0, 5).join('\n'));
      console.log('');
    }
  });

// ── vectorize ─────────────────────────────────────────────────────────────────

const vectorizeCmd = program
  .command('vectorize')
  .description('Convert fetched work items to Markdown and index them in the local vector store')
  .option('--ids <ids>', 'Comma-separated work item IDs to vectorize (must be already fetched)')
  .option('--org <org>', 'Azure DevOps organization')
  .option('--project <project>', 'Azure DevOps project')
  .option('--pat <pat>', 'Personal Access Token')
  .action(async (opts: { ids?: string; org?: string; project?: string; pat?: string }) => {
    const globalOpts = vectorizeCmd.optsWithGlobals<GlobalOpts>();
    const config = await loadConfig(globalOpts.config);
    const { Vectorizer } = await import('./modules/vectorizer/vectorizer.js');
    const { Fetcher: F } = await import('./modules/fetcher/fetcher.js');

    const org = opts.org ?? config.ado.org;
    const project = opts.project ?? config.ado.project;
    const pat = opts.pat ?? config.ado.pat;

    const vec = new Vectorizer(config.vectorizer.storeDir, {
      embeddingModel: config.vectorizer.embeddingModel,
      localModel: config.vectorizer.localModel,
      openaiModel: config.vectorizer.openaiModel,
    });

    if (opts.ids) {
      // Fetch specified items and vectorize
      if (!org || !project || !pat) {
        logger.error('org, project, and pat are required to fetch items for vectorization');
        process.exit(1);
      }
      const ids = opts.ids.split(',').map((s) => Number(s.trim())).filter((n) => n > 0);
      const fetcher = new F(config.cache.dir, config.cache.ttlMinutes * 60 * 1000);
      const items = await fetcher.fetchByIds({ org, project, pat, ids, includeRelations: true });
      if (globalOpts.dryRun) {
        logger.info({ ids }, '[dry-run] Would vectorize these items');
        return;
      }
      await vec.vectorizeItems(items);
    } else {
      // Re-vectorize all already-indexed items
      const indexed = vec.listIndexedIds();
      if (indexed.length === 0) {
        logger.warn('No items found in .testhelper/items/. Run "testhelper fetch" first.');
        return;
      }
      if (globalOpts.dryRun) {
        logger.info({ count: indexed.length }, '[dry-run] Would re-vectorize all indexed items');
        return;
      }
      await vec.rebuildIndex();
    }
  });

// ── rebuild-index ─────────────────────────────────────────────────────────────

program
  .command('rebuild-index')
  .description('Full reindex of all items in .testhelper/items/')
  .action(async () => {
    const globalOpts = program.optsWithGlobals<GlobalOpts>();
    const config = await loadConfig(globalOpts.config);
    const { Vectorizer } = await import('./modules/vectorizer/vectorizer.js');

    const vec = new Vectorizer(config.vectorizer.storeDir, {
      embeddingModel: config.vectorizer.embeddingModel,
      localModel: config.vectorizer.localModel,
      openaiModel: config.vectorizer.openaiModel,
    });

    if (globalOpts.dryRun) {
      const ids = vec.listIndexedIds();
      logger.info({ count: ids.length }, '[dry-run] Would rebuild index for these items');
      return;
    }

    await vec.rebuildIndex();
  });

// ── search ────────────────────────────────────────────────────────────────────

const searchCmd = program
  .command('search')
  .description('Semantic search across indexed work items')
  .argument('<query>', 'Search query')
  .option('--top <k>', 'Number of results to return', '10')
  .action(async (query: string, opts: { top: string }) => {
    const globalOpts = searchCmd.optsWithGlobals<GlobalOpts>();
    const config = await loadConfig(globalOpts.config);
    const { Vectorizer } = await import('./modules/vectorizer/vectorizer.js');

    const vec = new Vectorizer(config.vectorizer.storeDir, {
      embeddingModel: config.vectorizer.embeddingModel,
      localModel: config.vectorizer.localModel,
      openaiModel: config.vectorizer.openaiModel,
    });

    const results = await vec.search(query, Number(opts.top));
    if (results.length === 0) {
      console.log('No results found. Have you run "testhelper vectorize" yet?');
      return;
    }

    console.log(`\nTop ${results.length} result(s) for: "${query}"\n`);
    for (const [i, r] of results.entries()) {
      console.log(`${i + 1}. [#${r.workItemId}] [${r.chunkType}] (score: ${r.score.toFixed(4)})`);
      console.log(`   ${r.text.split('\n')[0]?.slice(0, 120) ?? ''}`);
      console.log('');
    }
  });

// ── analyze ───────────────────────────────────────────────────────────────────

const analyzeCmd = program
  .command('analyze')
  .description('Run AI-powered analysis on work items')
  .argument('<id>', 'Work item ID to analyze')
  .option('--type <types>', 'Comma-separated analysis types: ambiguity,gap,overlap,contradiction,dependency,impact,completeness,testability (or "all")', '')
  .option('--output <path>', 'Save report to file (default: print to stdout)')
  .action(async (idStr: string, opts: { type: string; output?: string }) => {
    const globalOpts = analyzeCmd.optsWithGlobals<GlobalOpts>();
    const config = await loadConfig(globalOpts.config);
    const { Analyzer } = await import('./modules/analyzer/analyzer.js');
    const { Vectorizer } = await import('./modules/vectorizer/vectorizer.js');
    const fs = await import('fs');

    const id = Number(idStr);
    if (isNaN(id)) {
      logger.error('Work item ID must be a number');
      process.exit(1);
    }

    const allTypes = ['ambiguity', 'gap', 'overlap', 'contradiction', 'dependency', 'impact', 'completeness', 'testability'] as const;
    type AT = typeof allTypes[number];

    const requestedTypes: AT[] =
      opts.type === 'all' || opts.type === ''
        ? (config.analyzer.defaultAnalyses as AT[])
        : (opts.type.split(',').map((s) => s.trim()) as AT[]);

    const vec = new Vectorizer(config.vectorizer.storeDir, {
      embeddingModel: config.vectorizer.embeddingModel,
      localModel: config.vectorizer.localModel,
      openaiModel: config.vectorizer.openaiModel,
    });

    const workItemMd = vec.getMarkdown(id);
    if (!workItemMd) {
      logger.error(`Work item #${id} not indexed. Run "testhelper fetch --ids ${id}" then "testhelper vectorize --ids ${id}" first.`);
      process.exit(1);
    }

    const searchResults = await vec.search(workItemMd.slice(0, 200), 5);
    const contextIds = [...new Set(searchResults.map((r) => r.workItemId).filter((wid) => wid !== id))];
    const contextMd = contextIds
      .map((wid) => vec.getMarkdown(wid))
      .filter(Boolean)
      .join('\n\n---\n\n');

    if (globalOpts.dryRun) {
      logger.info({ id, requestedTypes, contextItems: contextIds.length }, '[dry-run] Would run analysis with this context');
      console.log('--- Assembled prompt preview ---');
      console.log(workItemMd.slice(0, 500));
      console.log(`\n[Context: ${contextIds.length} related items]`);
      return;
    }

    const analyzer = new Analyzer({ model: config.analyzer.model });
    const reports = await analyzer.analyze(id, workItemMd, requestedTypes, { contextMd });
    const formatted = analyzer.formatReports(reports);

    if (opts.output) {
      fs.default.writeFileSync(opts.output, formatted, 'utf-8');
      console.log(`Report saved to ${opts.output}`);
    } else {
      console.log(formatted);
    }
  });

// ── design ────────────────────────────────────────────────────────────────────

const designCmd = program
  .command('design')
  .description('Generate test cases for a user story using AI and project context')
  .argument('<id>', 'User story work item ID')
  .option('--format <fmt>', 'Output format: json | md | csv | xlsx', 'json')
  .option('--output <path>', 'Save to file path (e.g. ./tests/12345-tests.json)')
  .option('--org <org>', 'Azure DevOps organization')
  .option('--project <project>', 'Azure DevOps project')
  .option('--pat <pat>', 'Personal Access Token')
  .option('--no-context', 'Skip RAG context retrieval')
  .action(async (idStr: string, opts: { format: string; output?: string; org?: string; project?: string; pat?: string; context: boolean }) => {
    const globalOpts = designCmd.optsWithGlobals<GlobalOpts>();
    const config = await loadConfig(globalOpts.config);
    const { Designer } = await import('./modules/designer/designer.js');
    const { Vectorizer } = await import('./modules/vectorizer/vectorizer.js');
    const { Fetcher: F } = await import('./modules/fetcher/fetcher.js');
    const { saveOutput, toJson, toMarkdown, toCsv } = await import('./modules/designer/formatter.js');

    const id = Number(idStr);
    if (isNaN(id)) { logger.error('Work item ID must be a number'); process.exit(1); }

    const org = opts.org ?? config.ado.org;
    const project = opts.project ?? config.ado.project;
    const pat = opts.pat ?? config.ado.pat;

    if (!org || !project || !pat) {
      logger.error('org, project, and pat are required. Use options or set env vars / config.');
      process.exit(1);
    }

    const fetcher = new F(config.cache.dir, config.cache.ttlMinutes * 60 * 1000);
    const items = await fetcher.fetchByIds({ org, project, pat, ids: [id], includeRelations: true });
    const workItem = items[0];
    if (!workItem) { logger.error(`Work item #${id} not found`); process.exit(1); return; }

    const vec = opts.context
      ? new Vectorizer(config.vectorizer.storeDir, {
          embeddingModel: config.vectorizer.embeddingModel,
          localModel: config.vectorizer.localModel,
          openaiModel: config.vectorizer.openaiModel,
        })
      : null;

    const { ContextBuilder } = await import('./modules/context/context-builder.js');
    const ctxBuilder = new ContextBuilder(config.vectorizer.storeDir);
    const hasContext = ctxBuilder.getMeta() !== null;
    if (!hasContext) {
      logger.warn('No product context built. Run "testhelper context build" for richer test design.');
    }

    if (globalOpts.dryRun) {
      const designer = new Designer({ model: config.designer.model });
      const { contextTokens, itemsIncluded, prompt } = await designer.dryRun(workItem, vec, {
        contextTopK: config.designer.contextTopK,
        coverageRules: config.designer.coverageRules,
      }, hasContext ? ctxBuilder : undefined);
      console.log(`\n[dry-run] Design for #${id}: ${workItem.title}`);
      console.log(`Context: ${contextTokens} estimated tokens, ${itemsIncluded.length} items`);
      console.log('\n--- Prompt preview (first 1000 chars) ---\n');
      console.log(prompt.slice(0, 1000));
      return;
    }

    const designer = new Designer({ model: config.designer.model });
    const testCases = await designer.design(workItem, vec, {
      contextTopK: config.designer.contextTopK,
      coverageRules: config.designer.coverageRules,
    }, hasContext ? ctxBuilder : undefined);

    console.log(`\nGenerated ${testCases.length} test case(s) for #${id}: ${workItem.title}\n`);

    const fmt = opts.format as 'json' | 'md' | 'csv' | 'xlsx';
    if (opts.output) {
      await saveOutput(testCases, fmt, opts.output);
      console.log(`Saved to ${opts.output}`);
    } else {
      if (fmt === 'json') process.stdout.write(toJson(testCases) + '\n');
      else if (fmt === 'md') process.stdout.write(toMarkdown(testCases) + '\n');
      else if (fmt === 'csv') process.stdout.write(toCsv(testCases) + '\n');
      else {
        logger.error('--output <path> is required for xlsx format');
        process.exit(1);
      }
    }
  });

// ── publish ───────────────────────────────────────────────────────────────────

const publishCmd = program
  .command('publish')
  .description('Push test cases to Azure DevOps Test Plans')
  .option('--from-file <path>', 'Path to JSON file of test cases')
  .option('--story <id>', 'User story ID to design and publish in one step')
  .option('--plan <name>', 'Test plan name')
  .option('--suite <name>', 'Test suite name')
  .option('--org <org>', 'Azure DevOps organization')
  .option('--project <project>', 'Azure DevOps project')
  .option('--pat <pat>', 'Personal Access Token')
  .action(async (opts: { fromFile?: string; story?: string; plan?: string; suite?: string; org?: string; project?: string; pat?: string }) => {
    const globalOpts = publishCmd.optsWithGlobals<GlobalOpts>();
    const config = await loadConfig(globalOpts.config);
    const fs = await import('fs');

    const org = opts.org ?? config.ado.org;
    const project = opts.project ?? config.ado.project;
    const pat = opts.pat ?? config.ado.pat;

    if (!org || !project || !pat) {
      logger.error('org, project, and pat are required');
      process.exit(1);
    }

    let testCases;
    let associatedUserStoryId: number | undefined;

    if (opts.fromFile) {
      const raw = JSON.parse(fs.default.readFileSync(opts.fromFile, 'utf-8')) as unknown;
      testCases = raw as import('./modules/designer/types.js').TestCase[];
    } else if (opts.story) {
      const storyId = Number(opts.story);
      const { Fetcher: F } = await import('./modules/fetcher/fetcher.js');
      const { Vectorizer } = await import('./modules/vectorizer/vectorizer.js');
      const { Designer } = await import('./modules/designer/designer.js');

      const fetcher = new F(config.cache.dir, config.cache.ttlMinutes * 60 * 1000);
      const items = await fetcher.fetchByIds({ org, project, pat, ids: [storyId], includeRelations: true });
      const workItem = items[0];
      if (!workItem) { logger.error(`Work item #${storyId} not found`); process.exit(1); return; }

      const vec = new Vectorizer(config.vectorizer.storeDir, {
        embeddingModel: config.vectorizer.embeddingModel,
        localModel: config.vectorizer.localModel,
        openaiModel: config.vectorizer.openaiModel,
      });
      await vec.vectorizeItems(items);

      const designer = new Designer({ model: config.designer.model });
      testCases = await designer.design(workItem, vec, { coverageRules: config.designer.coverageRules });
      associatedUserStoryId = storyId;
    } else {
      logger.error('Provide either --from-file or --story');
      process.exit(1);
      return;
    }

    const { Publisher } = await import('./modules/publisher/publisher.js');
    const publisher = new Publisher({ org, project, pat });

    const planName = opts.plan ?? config.publisher.defaultPlanName;
    const suiteName = opts.suite ?? `TestHelper Suite ${new Date().toISOString().slice(0, 10)}`;

    const result = await publisher.publish(testCases, {
      org, project, pat,
      planName,
      suiteName,
      associatedUserStoryId,
      areaPath: config.publisher.defaultAreaPath,
      iterationPath: config.publisher.defaultIterationPath,
      automationStatus: config.publisher.automationStatus,
      dryRun: globalOpts.dryRun,
    });

    if (!globalOpts.dryRun) {
      console.log(`\nPublished ${result.testCaseIds.length} test case(s):`);
      console.log(`  Plan: ${result.planUrl}`);
      console.log(`  Suite: ${result.suiteUrl}`);
      if (result.skipped > 0) console.log(`  Skipped: ${result.skipped} (errors)`);
    }
  });

// ── run (full pipeline) ───────────────────────────────────────────────────────

const runCmd = program
  .command('run')
  .description('Full pipeline: fetch → vectorize → analyze → design [→ publish]')
  .argument('<id>', 'User story work item ID')
  .option('--ids <ids>', 'Comma-separated IDs (alternative to positional arg for batch)')
  .option('--publish', 'Also publish test cases to ADO after design', false)
  .option('--plan <name>', 'Test plan name (for publish)')
  .option('--suite <name>', 'Test suite name (for publish)')
  .option('--org <org>', 'Azure DevOps organization')
  .option('--project <project>', 'Azure DevOps project')
  .option('--pat <pat>', 'Personal Access Token')
  .action(async (idStr: string, opts: { ids?: string; publish: boolean; plan?: string; suite?: string; org?: string; project?: string; pat?: string }) => {
    const globalOpts = runCmd.optsWithGlobals<GlobalOpts>();
    const config = await loadConfig(globalOpts.config);

    const org = opts.org ?? config.ado.org;
    const project = opts.project ?? config.ado.project;
    const pat = opts.org ?? config.ado.pat;

    if (!org || !project || !pat) {
      logger.error('org, project, and pat are required');
      process.exit(1);
    }

    const ids = opts.ids
      ? opts.ids.split(',').map((s) => Number(s.trim())).filter((n) => n > 0)
      : [Number(idStr)];

    const { Fetcher: F } = await import('./modules/fetcher/fetcher.js');
    const { Vectorizer } = await import('./modules/vectorizer/vectorizer.js');
    const { Analyzer } = await import('./modules/analyzer/analyzer.js');
    const { Designer } = await import('./modules/designer/designer.js');

    const fetcher = new F(config.cache.dir, config.cache.ttlMinutes * 60 * 1000);
    const vec = new Vectorizer(config.vectorizer.storeDir, {
      embeddingModel: config.vectorizer.embeddingModel,
      localModel: config.vectorizer.localModel,
      openaiModel: config.vectorizer.openaiModel,
    });

    for (const storyId of ids) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Running pipeline for #${storyId}`);
      console.log('='.repeat(60));

      // Step 1: Fetch
      console.log('\n[1/4] Fetching work items...');
      const items = await fetcher.fetchByIds({ org, project, pat, ids: [storyId], includeRelations: true });
      const workItem = items[0];
      if (!workItem) { logger.error(`Work item #${storyId} not found`); continue; }
      console.log(`      Fetched ${items.length} item(s)`);

      // Step 2: Vectorize
      console.log('\n[2/4] Vectorizing...');
      if (!globalOpts.dryRun) {
        await vec.vectorizeItems(items);
        console.log(`      Indexed ${items.length} item(s)`);
      } else {
        console.log('      [dry-run] Skipped');
      }

      // Step 3: Analyze
      console.log('\n[3/4] Analyzing...');
      if (!globalOpts.dryRun) {
        const analyzer = new Analyzer({ model: config.analyzer.model });
        const md = vec.getMarkdown(storyId) ?? '';
        const reports = await analyzer.analyze(storyId, md, config.analyzer.defaultAnalyses);
        for (const r of reports) {
          const icon = r.severity === 'critical' ? '!!!' : r.severity === 'high' ? '!!' : '!';
          console.log(`\n  ${icon} [${r.analysisType}] ${r.severity.toUpperCase()}: ${r.findings.length} finding(s)`);
          for (const f of r.findings.slice(0, 3)) {
            console.log(`     - ${f.location}: ${f.description.slice(0, 100)}`);
          }
        }
      } else {
        console.log('      [dry-run] Skipped');
      }

      // Step 4: Design
      console.log('\n[4/4] Designing test cases...');
      let testCases: import('./modules/designer/types.js').TestCase[] = [];
      if (!globalOpts.dryRun) {
        const designer = new Designer({ model: config.designer.model });
        testCases = await designer.design(workItem, vec, { coverageRules: config.designer.coverageRules });
        console.log(`\n      Generated ${testCases.length} test case(s)`);
      } else {
        const designer = new Designer({ model: config.designer.model });
        const { contextTokens, itemsIncluded } = await designer.dryRun(workItem, vec, { coverageRules: config.designer.coverageRules });
        console.log(`      [dry-run] Would design with ${contextTokens} context tokens from ${itemsIncluded.length} items`);
      }

      // Optional: Publish
      if (opts.publish && !globalOpts.dryRun && testCases.length > 0) {
        console.log('\n[5/5] Publishing to ADO...');
        const { Publisher } = await import('./modules/publisher/publisher.js');
        const publisher = new Publisher({ org, project, pat });
        const planName = opts.plan ?? config.publisher.defaultPlanName;
        const suiteName = opts.suite ?? `US-${storyId}: ${workItem.title.slice(0, 60)}`;
        const result = await publisher.publish(testCases, {
          org, project, pat,
          planName, suiteName,
          associatedUserStoryId: storyId,
          automationStatus: config.publisher.automationStatus,
        });
        console.log(`      Published ${result.testCaseIds.length} test case(s)`);
        console.log(`      Plan: ${result.planUrl}`);
        console.log(`      Suite: ${result.suiteUrl}`);
      }
    }

    console.log('\nDone!');
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${msg}`);
  process.exit(1);
});
