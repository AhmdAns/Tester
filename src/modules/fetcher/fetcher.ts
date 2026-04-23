import { AdoClient } from './ado-client.js';
import { mapRawToWorkItem } from './mapper.js';
import { FileCache } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';
import type {
  WorkItem,
  FetchByDateRangeOptions,
  FetchByIdsOptions,
  FetchByWiqlOptions,
} from './types.js';

export class Fetcher {
  private readonly cache: FileCache;

  constructor(
    cacheDir = '.testhelper/cache',
    cacheTtlMs = 15 * 60 * 1000,
  ) {
    this.cache = new FileCache(cacheDir, cacheTtlMs);
  }

  async fetchByIds(opts: FetchByIdsOptions): Promise<WorkItem[]> {
    const cacheKey = `ids_${opts.org}_${opts.project}_${[...opts.ids].sort().join('-')}`;
    const cached = this.cache.get<WorkItem[]>(cacheKey);
    if (cached) {
      logger.debug({ count: cached.length }, 'Returning cached work items');
      return cached;
    }

    const client = new AdoClient({ org: opts.org, project: opts.project, pat: opts.pat });
    logger.info({ ids: opts.ids }, 'Fetching work items by ID');

    const raw = await client.getWorkItemsBatch(opts.ids, opts.includeRelations ?? true);
    const items = raw.map(mapRawToWorkItem);

    this.cache.set(cacheKey, items);
    logger.info({ count: items.length }, 'Fetched work items');
    return items;
  }

  async fetchByDateRange(opts: FetchByDateRangeOptions): Promise<WorkItem[]> {
    const typeFilter =
      opts.types && opts.types.length > 0
        ? `AND [System.WorkItemType] IN (${opts.types.map((t) => `'${t}'`).join(', ')})`
        : '';
    const areaFilter = opts.areaPath
      ? `AND [System.AreaPath] UNDER '${opts.areaPath}'`
      : '';
    const iterFilter = opts.iterationPath
      ? `AND [System.IterationPath] UNDER '${opts.iterationPath}'`
      : '';

    const wiql = `
      SELECT [System.Id]
      FROM WorkItems
      WHERE [System.TeamProject] = '${opts.project}'
        AND [System.ChangedDate] >= '${opts.from}'
        AND [System.ChangedDate] <= '${opts.to}'
        ${typeFilter}
        ${areaFilter}
        ${iterFilter}
      ORDER BY [System.ChangedDate] DESC
    `;

    const cacheKey = `daterange_${opts.org}_${opts.project}_${opts.from}_${opts.to}_${typeFilter}_${areaFilter}_${iterFilter}`;
    const cached = this.cache.get<WorkItem[]>(cacheKey);
    if (cached) {
      logger.debug({ count: cached.length }, 'Returning cached work items');
      return cached;
    }

    const client = new AdoClient({ org: opts.org, project: opts.project, pat: opts.pat });
    logger.info({ from: opts.from, to: opts.to }, 'Fetching work items by date range');

    const ids = await client.runWiql(wiql);
    if (ids.length === 0) {
      logger.info('No work items found in date range');
      return [];
    }

    const raw = await client.getWorkItemsBatch(ids, opts.includeRelations ?? true);
    const items = raw.map(mapRawToWorkItem);

    this.cache.set(cacheKey, items);
    logger.info({ count: items.length }, 'Fetched work items');
    return items;
  }

  async fetchByWiql(opts: FetchByWiqlOptions): Promise<WorkItem[]> {
    const client = new AdoClient({ org: opts.org, project: opts.project, pat: opts.pat });
    logger.info('Fetching work items by WIQL query');

    const ids = await client.runWiql(opts.query);
    if (ids.length === 0) return [];

    const raw = await client.getWorkItemsBatch(ids, true);
    return raw.map(mapRawToWorkItem);
  }
}
