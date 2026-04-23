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

program
  .command('init')
  .description('Create .testhelper.json config in current directory and update .gitignore')
  .action(async () => {
    const { initCommand } = await import('./commands/init.js');
    await initCommand();
  });

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

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${msg}`);
  process.exit(1);
});
