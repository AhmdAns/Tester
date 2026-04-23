import axios, { type AxiosInstance } from 'axios';
import { logger } from '../../utils/logger.js';
import { withRetry } from '../../utils/retry.js';

const ADO_API_VERSION = '7.1';
const BATCH_SIZE = 200;

export interface AdoClientOptions {
  org: string;
  project: string;
  pat: string;
}

export interface WiqlResult {
  workItems: Array<{ id: number; url: string }>;
}

export interface RawWorkItem {
  id: number;
  fields: Record<string, unknown>;
  relations?: Array<{
    rel: string;
    url: string;
    attributes: Record<string, unknown>;
  }>;
}

export class AdoClient {
  private readonly http: AxiosInstance;

  constructor(private readonly opts: AdoClientOptions) {
    const token = Buffer.from(`:${opts.pat}`).toString('base64');

    this.http = axios.create({
      baseURL: `https://dev.azure.com/${opts.org}/${opts.project}/_apis`,
      headers: {
        Authorization: `Basic ${token}`,
        'Content-Type': 'application/json',
      },
    });

    this.http.interceptors.response.use(
      (res) => {
        const remaining = res.headers['x-ratelimit-remaining'];
        if (remaining !== undefined && Number(remaining) < 20) {
          logger.warn({ remaining }, 'ADO rate limit running low');
        }
        return res;
      },
      (err) => Promise.reject(err),
    );
  }

  async runWiql(query: string): Promise<number[]> {
    return withRetry(async () => {
      const res = await this.http.post<WiqlResult>(
        '/wit/wiql',
        { query },
        { params: { 'api-version': ADO_API_VERSION } },
      );
      return res.data.workItems.map((w) => w.id);
    });
  }

  async getWorkItemsBatch(ids: number[], includeRelations = false): Promise<RawWorkItem[]> {
    const results: RawWorkItem[] = [];
    const expand = includeRelations ? 'relations' : 'none';

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const chunk = ids.slice(i, i + BATCH_SIZE);
      logger.debug({ from: i, to: i + chunk.length, total: ids.length }, 'Fetching batch');

      const batch = await withRetry(async () => {
        const res = await this.http.get<{ value: RawWorkItem[] }>('/wit/workitems', {
          params: {
            ids: chunk.join(','),
            $expand: expand,
            'api-version': ADO_API_VERSION,
          },
        });
        return res.data.value;
      });

      results.push(...batch);
    }

    return results;
  }
}
