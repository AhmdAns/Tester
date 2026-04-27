import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

export class FileCache {
  constructor(
    private readonly dir: string,
    private readonly ttlMs: number,
  ) {
    fs.mkdirSync(dir, { recursive: true });
  }

  get<T>(key: string): T | null {
    const file = this.keyToPath(key);
    if (!fs.existsSync(file)) return null;

    try {
      const entry = JSON.parse(fs.readFileSync(file, 'utf-8')) as CacheEntry<T>;
      if (Date.now() > entry.expiresAt) {
        fs.unlinkSync(file);
        return null;
      }
      return entry.data;
    } catch {
      return null;
    }
  }

  set<T>(key: string, data: T): void {
    const entry: CacheEntry<T> = { data, expiresAt: Date.now() + this.ttlMs };
    try {
      fs.writeFileSync(this.keyToPath(key), JSON.stringify(entry));
    } catch (err) {
      logger.warn({ err }, 'Cache write failed');
    }
  }

  private keyToPath(key: string): string {
    const safe = key.replace(/[^a-z0-9_-]/gi, '_').slice(0, 200);
    return path.join(this.dir, `${safe}.json`);
  }
}
