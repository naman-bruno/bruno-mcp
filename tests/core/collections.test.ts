import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import { CollectionRegistry } from '../../src/core/collections.js';
import { BRU_COLLECTION, ISOLATED_CONFIG, makeTempDir, removeTempDirs, writeFiles } from '../helpers.js';

const registry = new CollectionRegistry(ISOLATED_CONFIG);

const REQUEST = 'meta {\n  name: Ping\n  type: http\n  seq: 1\n}\n\nget {\n  url: http://localhost/ping\n}\n';

afterEach(removeTempDirs);

describe('CollectionRegistry.resolveFolderPath', () => {
  it('resolves a folder that contains requests', () => {
    expect(registry.resolveFolderPath(BRU_COLLECTION, 'users')).toBe(path.join(BRU_COLLECTION, 'users'));
    expect(registry.resolveFolderPath(BRU_COLLECTION, 'users/')).toBe(path.join(BRU_COLLECTION, 'users'));
  });

  it('resolves a nested folder', () => {
    const collection = writeFiles(makeTempDir(), { 'bruno.json': '{}', 'api/v1/ping.bru': REQUEST });

    expect(registry.resolveFolderPath(collection, 'api')).toBe(path.join(collection, 'api'));
    expect(registry.resolveFolderPath(collection, 'api/v1')).toBe(path.join(collection, 'api', 'v1'));
  });

  it.each([
    ['a request file', 'health.bru'],
    ['the collection root', '.'],
    ['the environments folder', 'environments'],
    ['a path outside the collection', '../yml-collection'],
    ['a folder that does not exist', 'nope'],
    ['a folder name in the wrong case', 'Users']
  ])('rejects %s', (_label, relativePath) => {
    expect(registry.resolveFolderPath(BRU_COLLECTION, relativePath)).toBeNull();
  });

  it.each(['empty', 'node_modules', '.git'])('rejects the "%s" folder, which list_requests and bru run skip', (folder) => {
    const collection = writeFiles(makeTempDir(), {
      'bruno.json': '{}',
      'ping.bru': REQUEST,
      'node_modules/dep/ping.bru': REQUEST,
      '.git/ping.bru': REQUEST
    });
    fs.mkdirSync(path.join(collection, 'empty'));

    expect(registry.resolveFolderPath(collection, folder)).toBeNull();
  });

  it('rejects a symlinked folder, even one pointing inside the collection', () => {
    const collection = writeFiles(makeTempDir(), { 'bruno.json': '{}', 'real/ping.bru': REQUEST });
    fs.symlinkSync(path.join(collection, 'real'), path.join(collection, 'linked'), 'dir');

    expect(registry.resolveFolderPath(collection, 'real')).toBe(path.join(collection, 'real'));
    expect(registry.resolveFolderPath(collection, 'linked')).toBeNull();
  });

  it('keeps resolving folders when a folder.bru is malformed', () => {
    const collection = writeFiles(makeTempDir(), {
      'bruno.json': '{}',
      'users/folder.bru': 'meta {\n  name: Users\n',
      'users/ping.bru': REQUEST
    });

    expect(registry.resolveFolderPath(collection, 'users')).toBe(path.join(collection, 'users'));
  });

  it('returns null for a directory that is not a collection', () => {
    expect(registry.resolveFolderPath(makeTempDir(), 'users')).toBeNull();
  });
});

describe('CollectionRegistry.environmentFiles', () => {
  it('lists the collection environments', () => {
    const names = registry.environmentFiles(BRU_COLLECTION).map((env) => env.name).sort();
    expect(names).toEqual(['local', 'staging']);
  });

  it('returns an empty list for an unknown collection', () => {
    expect(registry.environmentFiles(makeTempDir())).toEqual([]);
  });
});
