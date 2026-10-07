import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import { listEnvironmentFiles, readEnvironmentVariables, REDACTED } from '../../src/core/environments.js';
import { BRU_COLLECTION, YML_COLLECTION, makeTempDir, removeTempDirs, writeFiles } from '../helpers.js';

afterEach(removeTempDirs);

const ENVIRONMENT_FILES = {
  'environments/local.bru': 'vars {\n  a: 1\n}\n',
  'environments/dev.yml': 'name: dev\nvariables: []\n',
  'environments/notes.txt': 'not an environment',
  'environments/.DS_Store': ''
};

describe('listEnvironmentFiles', () => {
  it('lists only .bru environments in a .bru collection', () => {
    const dir = writeFiles(makeTempDir(), { 'bruno.json': '{"version":"1","name":"Bru"}', ...ENVIRONMENT_FILES });

    expect(listEnvironmentFiles(dir)).toEqual([
      { name: 'local', path: path.join(dir, 'environments', 'local.bru'), format: 'bru' }
    ]);
  });

  it('lists only .yml environments in a .yml collection', () => {
    const dir = writeFiles(makeTempDir(), { 'opencollection.yml': 'info:\n  name: Yml\n', ...ENVIRONMENT_FILES });

    expect(listEnvironmentFiles(dir)).toEqual([
      { name: 'dev', path: path.join(dir, 'environments', 'dev.yml'), format: 'yml' }
    ]);
  });

  it('returns an empty list when the collection has no environments folder', () => {
    expect(listEnvironmentFiles(writeFiles(makeTempDir(), { 'bruno.json': '{}' }))).toEqual([]);
  });

  it('returns an empty list for a directory that is not a collection', () => {
    expect(listEnvironmentFiles(writeFiles(makeTempDir(), ENVIRONMENT_FILES))).toEqual([]);
  });
});

describe('readEnvironmentVariables', () => {
  const envFile = (collectionPath: string, name: string) =>
    listEnvironmentFiles(collectionPath).find((env) => env.name === name)!;

  it('reads .bru variables, including disabled ones, and redacts secrets', async () => {
    expect(await readEnvironmentVariables(envFile(BRU_COLLECTION, 'local'))).toEqual([
      { name: 'baseUrl', value: 'http://127.0.0.1:1', enabled: true, secret: false },
      { name: 'legacyUrl', value: 'http://legacy.local', enabled: false, secret: false },
      { name: 'userId', value: '42', enabled: true, secret: false },
      { name: 'apiKey', value: REDACTED, enabled: true, secret: true }
    ]);
  });

  it('redacts a .yml secret even when its value is stored on disk', async () => {
    const env = envFile(YML_COLLECTION, 'dev');
    expect(fs.readFileSync(env.path, 'utf8')).toContain('do-not-leak');

    const variables = await readEnvironmentVariables(env);

    expect(variables).toEqual([
      { name: 'baseUrl', value: 'http://127.0.0.1:1', enabled: true, secret: false },
      { name: 'token', value: REDACTED, enabled: true, secret: true },
      { name: 'debug', value: 'true', enabled: false, secret: false }
    ]);
    expect(JSON.stringify(variables)).not.toContain('do-not-leak');
  });

  it('rejects on a malformed .bru environment instead of leaving an unhandled rejection', async () => {
    const dir = writeFiles(makeTempDir(), {
      'bruno.json': '{"version":"1","name":"Broken"}',
      'environments/broken.bru': 'vars {\n  baseUrl: x\n'
    });

    await expect(readEnvironmentVariables(envFile(dir, 'broken'))).rejects.toThrow();
  });
});
