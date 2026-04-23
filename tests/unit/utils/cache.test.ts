import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { FileCache } from '../../../src/utils/cache.js';

describe('FileCache', () => {
  let tmpDir: string;
  let cache: FileCache;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'testhelper-cache-test-'));
    cache = new FileCache(tmpDir, 1_000);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null for a missing key', () => {
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('stores and retrieves a value', () => {
    cache.set('key1', { foo: 'bar' });
    expect(cache.get('key1')).toEqual({ foo: 'bar' });
  });

  it('returns null after TTL expires', async () => {
    const shortCache = new FileCache(tmpDir, 50);
    shortCache.set('expiring', 'value');
    expect(shortCache.get('expiring')).toBe('value');

    await new Promise((r) => setTimeout(r, 100));
    expect(shortCache.get('expiring')).toBeNull();
  });

  it('handles numeric values', () => {
    cache.set('num', 42);
    expect(cache.get<number>('num')).toBe(42);
  });

  it('handles array values', () => {
    cache.set('arr', [1, 2, 3]);
    expect(cache.get<number[]>('arr')).toEqual([1, 2, 3]);
  });

  it('sanitizes special characters in the cache key', () => {
    cache.set('org/project:key?with!special', 'value');
    expect(cache.get('org/project:key?with!special')).toBe('value');
  });

  it('independent keys do not overwrite each other', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get<number>('a')).toBe(1);
    expect(cache.get<number>('b')).toBe(2);
  });

  it('overwrites existing cached value', () => {
    cache.set('key', 'original');
    cache.set('key', 'updated');
    expect(cache.get('key')).toBe('updated');
  });
});
