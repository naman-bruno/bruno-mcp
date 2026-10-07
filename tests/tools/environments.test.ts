import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

import {
  BRU_COLLECTION,
  YML_COLLECTION,
  callTool,
  connectClient,
  makeTempDir,
  removeTempDirs,
  writeFiles
} from '../helpers.js';

let client: Client;

beforeAll(async () => {
  client = await connectClient();
});

afterAll(async () => {
  await client.close();
});

afterEach(removeTempDirs);

describe('list_environments', () => {
  it('lists each environment with its variable count and whether it has secrets', async () => {
    const { isError, body } = await callTool(client, 'list_environments', { collectionPath: BRU_COLLECTION });

    expect(isError).toBe(false);
    expect([...body.environments].sort((a: any, b: any) => a.name.localeCompare(b.name))).toEqual([
      { name: 'local', variableCount: 4, hasSecrets: true },
      { name: 'staging', variableCount: 1, hasSecrets: false }
    ]);
  });

  it('works for .yml collections', async () => {
    const { body } = await callTool(client, 'list_environments', { collectionPath: YML_COLLECTION });

    expect(body.environments).toEqual([{ name: 'dev', variableCount: 3, hasSecrets: true }]);
  });

  it('lists only environments in the collection format, the ones bru run can load', async () => {
    const collectionPath = writeFiles(makeTempDir(), {
      'bruno.json': '{"version":"1","name":"Mixed"}',
      'environments/local.bru': 'vars {\n  baseUrl: http://localhost\n}\n',
      'environments/local.yml': 'name: local\nvariables: []\n',
      'environments/ci.yml': 'name: ci\nvariables: []\n'
    });

    const { body } = await callTool(client, 'list_environments', { collectionPath });

    expect(body.environments).toEqual([{ name: 'local', variableCount: 1, hasSecrets: false }]);
  });

  it('adds a hint when the collection has no environments', async () => {
    const collectionPath = writeFiles(makeTempDir(), { 'bruno.json': '{"version":"1","name":"Empty"}' });

    const { isError, body } = await callTool(client, 'list_environments', { collectionPath });

    expect(isError).toBe(false);
    expect(body.environments).toEqual([]);
    expect(body.hint).toMatch(/no environments/);
  });

  it('reports a malformed environment without failing the others or crashing the server', async () => {
    const collectionPath = writeFiles(makeTempDir(), {
      'bruno.json': '{"version":"1","name":"Broken"}',
      'environments/good.bru': 'vars {\n  baseUrl: http://localhost\n}\n',
      'environments/broken.bru': 'vars {\n  baseUrl: x\n'
    });

    const { isError, body } = await callTool(client, 'list_environments', { collectionPath });

    expect(isError).toBe(false);
    const byName = Object.fromEntries(body.environments.map((env: any) => [env.name, env]));
    expect(byName.good).toEqual({ name: 'good', variableCount: 1, hasSecrets: false });
    expect(byName.broken.error).toMatch(/^Could not parse environment/);
  });

  it('errors for a path that is not a collection', async () => {
    const { isError, body } = await callTool(client, 'list_environments', { collectionPath: makeTempDir() });

    expect(isError).toBe(true);
    expect(body.error).toMatch(/^No Bruno collection at/);
  });
});

describe('get_environment', () => {
  it('returns variables with secret values redacted', async () => {
    const { isError, body } = await callTool(client, 'get_environment', { collectionPath: BRU_COLLECTION, name: 'local' });

    expect(isError).toBe(false);
    expect(body).toEqual({
      name: 'local',
      variables: [
        { name: 'baseUrl', value: 'http://127.0.0.1:1', enabled: true, secret: false },
        { name: 'legacyUrl', value: 'http://legacy.local', enabled: false, secret: false },
        { name: 'userId', value: '42', enabled: true, secret: false },
        { name: 'apiKey', value: '<redacted>', enabled: true, secret: true }
      ]
    });
  });

  it('never returns a secret value stored on disk', async () => {
    const { isError, text } = await callTool(client, 'get_environment', { collectionPath: YML_COLLECTION, name: 'dev' });

    expect(isError).toBe(false);
    expect(text).not.toContain('do-not-leak');
    expect(text).toContain('<redacted>');
  });

  it.each(['production', 'Local', '../health', 'environments/local'])('errors for unknown environment "%s"', async (name) => {
    const { isError, body } = await callTool(client, 'get_environment', { collectionPath: BRU_COLLECTION, name });

    expect(isError).toBe(true);
    expect(body.error).toContain(`"${name}" doesn't exist`);
    expect([...body.availableEnvironments].sort()).toEqual(['local', 'staging']);
  });

  it('errors for a malformed environment file', async () => {
    const collectionPath = writeFiles(makeTempDir(), {
      'bruno.json': '{"version":"1","name":"Broken"}',
      'environments/broken.bru': 'vars {\n  baseUrl: x\n'
    });

    const { isError, body } = await callTool(client, 'get_environment', { collectionPath, name: 'broken' });

    expect(isError).toBe(true);
    expect(body.error).toMatch(/^Could not parse environment "broken"/);
  });
});
