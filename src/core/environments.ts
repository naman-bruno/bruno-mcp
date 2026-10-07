import path from 'node:path';
import fs from 'node:fs';
import { parseEnvironment } from '@usebruno/filestore';

import type { EnvironmentVariable } from '../types.js';
import { detectFormat, FORMAT_FILES, type CollectionFormat } from './readCollection.js';

export const REDACTED = '<redacted>';

export interface EnvironmentFile {
  name: string;
  path: string;
  format: CollectionFormat;
}

export const listEnvironmentFiles = (collectionPath: string): EnvironmentFile[] => {
  const format = detectFormat(collectionPath);
  const envDir = path.join(collectionPath, 'environments');
  if (!format || !fs.existsSync(envDir)) return [];
  const { ext } = FORMAT_FILES[format];
  return fs
    .readdirSync(envDir)
    .filter((file) => path.extname(file) === ext)
    .map((file) => ({ name: path.basename(file, ext), path: path.join(envDir, file), format }));
};

// Secret values never leave the server, only their names.
export const readEnvironmentVariables = async (env: EnvironmentFile): Promise<EnvironmentVariable[]> => {
  // Awaited because the .bru parser returns a rejected promise on malformed files instead of throwing.
  const parsed = await parseEnvironment(fs.readFileSync(env.path, 'utf8'), { format: env.format });
  const variables: any[] = Array.isArray(parsed?.variables) ? parsed.variables : [];
  return variables.map((v) => ({
    name: String(v.name),
    value: v.secret ? REDACTED : v.value ?? null,
    enabled: v.enabled !== false,
    secret: Boolean(v.secret)
  }));
};
