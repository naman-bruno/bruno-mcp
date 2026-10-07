import path from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

import { cleanupSessionTmpDir } from '../../src/core/execute.js';
import {
  FIXTURES_DIR,
  callTool,
  connectClient,
  makeTempDir,
  removeTempDirs,
  startHttpServer,
  writeFiles,
  type TestHttpServer
} from '../helpers.js';

const BRU_COLLECTION = path.join(FIXTURES_DIR, 'run-collection', 'bru');
const YML_COLLECTION = path.join(FIXTURES_DIR, 'run-collection', 'yml');

// Each run spawns the real `bru` CLI.
jest.setTimeout(60_000);

let client: Client;
let server: TestHttpServer;

beforeAll(async () => {
  [client, server] = await Promise.all([connectClient(), startHttpServer()]);
});

afterAll(async () => {
  await Promise.all([client.close(), server.close()]);
  cleanupSessionTmpDir();
});

beforeEach(() => {
  server.reset();
});

afterEach(removeTempDirs);

const run = ({ variables, ...args }: Record<string, any> = {}) =>
  callTool(client, 'run_collection', {
    collectionPath: BRU_COLLECTION,
    variables: { baseUrl: server.baseUrl, ...variables },
    ...args
  });

describe('run_collection', () => {
  it('runs the whole collection and reports failures per request', async () => {
    const { isError, body } = await run({ variables: { userId: 9 } });

    expect(isError).toBe(true);
    expect(body.ok).toBe(false);
    expect(body.summary).toMatchObject({
      iterations: 1,
      total: 3,
      passed: 2,
      failed: 1,
      errored: 0,
      skipped: 0,
      assertions: { passed: 1, failed: 1 },
      tests: { passed: 1, failed: 0 }
    });
    expect(body.requests.map((r: any) => [r.path, r.outcome, r.status])).toEqual([
      ['users/get-user.bru', 'passed', 200],
      ['users/missing-user.bru', 'failed', 404],
      ['health.bru', 'passed', 200]
    ]);
    expect(body.requests[1].failedChecks).toEqual([{ name: 'res.status: eq 200', error: 'expected 404 to equal 200' }]);
    expect(server.hits).toEqual(['/users/9', '/missing', '/health']);
  });

  it('applies the selected environment', async () => {
    const { isError } = await run({ requests: ['users/get-user.bru'], environment: 'local' });

    expect(isError).toBe(false);
    expect(server.hits).toEqual(['/users/42']);
  });

  it('runs only the selected requests and folders, in the given order', async () => {
    const { body } = await run({ requests: ['health.bru', 'users'], variables: { userId: 5 } });

    expect(body.requests.map((r: any) => r.path)).toEqual(['health.bru', 'users/get-user.bru', 'users/missing-user.bru']);
    expect(server.hits).toEqual(['/health', '/users/5', '/missing']);
  });

  it('stops at the first failure when bail is set', async () => {
    const { body } = await run({ requests: ['users/missing-user.bru', 'health.bru'], bail: true });

    expect(body.requests.map((r: any) => [r.path, r.outcome, r.status])).toEqual([
      ['users/missing-user.bru', 'failed', 404],
      ['health.bru', 'skipped', null]
    ]);
    expect(body.summary).toMatchObject({ total: 2, failed: 1, skipped: 1 });
    expect(server.hits).toEqual(['/missing']);
  });

  it('runs one iteration per row of a data file relative to the collection', async () => {
    const { isError, body } = await run({ requests: ['users/get-user.bru'], dataFile: 'users.csv' });

    expect(isError).toBe(false);
    expect(body.summary).toMatchObject({ iterations: 2, total: 2, passed: 2 });
    expect(body.requests.map((r: any) => r.iteration)).toEqual([0, 1]);
    expect(server.hits).toEqual(['/users/1', '/users/2']);
  });

  it('accepts an absolute data file path', async () => {
    const { isError } = await run({ requests: ['users/get-user.bru'], dataFile: path.join(BRU_COLLECTION, 'users.csv') });

    expect(isError).toBe(false);
    expect(server.hits).toEqual(['/users/1', '/users/2']);
  });

  it('takes the iteration count from the data file over iterations', async () => {
    const { body } = await run({ requests: ['users/get-user.bru'], dataFile: 'users.csv', iterations: 5 });

    expect(body.summary).toMatchObject({ iterations: 2, total: 2 });
  });

  it('runs iterations concurrently when parallel is set', async () => {
    server.holdUntilInFlight = 2;

    const { isError } = await run({ requests: ['users/get-user.bru'], dataFile: 'users.csv', parallel: true });

    expect(isError).toBe(false);
    expect(server.maxInFlight).toBe(2);
  });

  it('repeats the selection for the requested number of iterations', async () => {
    const { isError, body } = await run({ requests: ['health.bru'], iterations: 3 });

    expect(isError).toBe(false);
    expect(body.summary).toMatchObject({ iterations: 3, total: 3, passed: 3 });
    expect(server.hits).toEqual(['/health', '/health', '/health']);
  });

  it('stops the run after timeoutSeconds', async () => {
    server.holdUntilInFlight = 2;

    const { isError, body } = await run({ requests: ['health.bru'], timeoutSeconds: 1 });

    expect(isError).toBe(true);
    expect(body.error).toMatch(/bru run timed out after 1000ms$/);
  });

  it('runs .yml collections and keeps their request paths', async () => {
    const { isError, body } = await run({ collectionPath: YML_COLLECTION, environment: 'dev' });

    expect(isError).toBe(false);
    expect(body.requests).toEqual([
      { path: 'users/get-user.yml', name: 'Get user', outcome: 'passed', status: 200, responseTimeMs: expect.any(Number) }
    ]);
    expect(server.hits).toEqual(['/users/7']);
  });

  it.each([
    ['a JSON object instead of an array', () => 'bruno.json'],
    ['a CSV with only a header', () => path.join(writeFiles(makeTempDir(), { 'empty.csv': 'userId\n' }), 'empty.csv')]
  ])('explains that nothing ran for %s', async (_label, dataFile) => {
    const { isError, body } = await run({ dataFile: dataFile() });

    expect(isError).toBe(true);
    expect(body.summary).toMatchObject({ iterations: 0, total: 0 });
    expect(body.error).toMatch(/^Nothing ran: the data file has no rows/);
    expect(server.hits).toEqual([]);
  });

  describe('input validation', () => {
    // Rejected input must never reach the CLI.
    afterEach(() => {
      expect(server.hits).toEqual([]);
    });

    it('lists every request or folder path that does not exist in the collection', async () => {
      const { isError, body } = await run({ requests: ['nope.bru', '../yml', 'environments', 'Users', 'users'] });

      expect(isError).toBe(true);
      expect(body.error).toBe('Not a request or folder in collection "Run Fixture": nope.bru, ../yml, environments, Users');
      expect(body.availableRequests).toEqual(['users/get-user.bru', 'users/missing-user.bru', 'health.bru']);
    });

    it('rejects an unknown environment', async () => {
      const { isError, body } = await run({ environment: 'production' });

      expect(isError).toBe(true);
      expect(body.error).toBe('The environment "production" doesn\'t exist in the "Run Fixture" collection.');
      expect([...body.availableEnvironments].sort()).toEqual(['local', 'staging']);
    });

    it.each(['missing.csv', 'health.bru', 'users'])('rejects data file "%s"', async (dataFile) => {
      const { isError, body } = await run({ dataFile });

      expect(isError).toBe(true);
      expect(body.error).toBe(`Data file not found or not a .csv/.json file: ${dataFile}`);
    });

    it.each(['iterations', 'timeoutSeconds'])('rejects %s below one', async (field) => {
      const { isError, text } = await run({ [field]: 0 });

      expect(isError).toBe(true);
      expect(text).toMatch(new RegExp(`Input validation error: .*at ${field}`));
    });

    it('errors for a path that is not a collection', async () => {
      const { isError, body } = await run({ collectionPath: makeTempDir() });

      expect(isError).toBe(true);
      expect(body.error).toMatch(/^No Bruno collection at/);
    });
  });
});
