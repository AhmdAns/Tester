import fs from 'fs';
import path from 'path';
import { configSchema, type Config } from './schema.js';
import { logger } from '../utils/logger.js';

function findConfigFile(): string | null {
  const names = ['.testhelper.json', '.testhelperrc', '.testhelperrc.json'];
  let dir = process.cwd();
  while (true) {
    for (const name of names) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function interpolateEnvVars(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([^}]+)\}/g, (_, name: string) => process.env[name] ?? '');
  }
  if (Array.isArray(obj)) return obj.map(interpolateEnvVars);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        k,
        interpolateEnvVars(v),
      ]),
    );
  }
  return obj;
}

export async function loadConfig(configPath?: string): Promise<Config> {
  const filePath = configPath ?? findConfigFile();

  let raw: Record<string, unknown> = {};
  if (filePath) {
    try {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
      logger.debug({ filePath }, 'Loaded config file');
    } catch (err) {
      logger.warn({ filePath, err }, 'Failed to parse config file, using defaults');
    }
  }

  const interpolated = interpolateEnvVars(raw) as Record<string, unknown>;

  // Inject env vars for ADO credentials if not already set
  if (!interpolated.ado || typeof interpolated.ado !== 'object') {
    interpolated.ado = {};
  }
  const ado = interpolated.ado as Record<string, unknown>;
  if (!ado.org && process.env.TESTHELPER_ADO_ORG) ado.org = process.env.TESTHELPER_ADO_ORG;
  if (!ado.project && process.env.TESTHELPER_ADO_PROJECT)
    ado.project = process.env.TESTHELPER_ADO_PROJECT;
  if (!ado.pat && process.env.TESTHELPER_ADO_PAT) ado.pat = process.env.TESTHELPER_ADO_PAT;

  return configSchema.parse(interpolated);
}
