import { mkdtemp, writeFile, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { checkContracts, validateOpenApi } from './contracts.mjs';

describe('foundation contract tooling', () => {
  it('compiles all schemas and resolves the existing API example', async () => {
    expect(await checkContracts()).toMatchObject({
      schemas: 2,
      openapi: 1,
      fixtures: 5,
    });
  });
  it('fails on an unresolved local API reference', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ldv-contract-test-'));
    try {
      const path = join(dir, 'api.json');
      await writeFile(
        path,
        JSON.stringify({
          openapi: '3.1.0',
          info: { title: 'synthetic', version: '0.0.0' },
          paths: {
            '/demo': {
              get: { responses: { 200: { $ref: './missing.json' } } },
            },
          },
        }),
      );
      await expect(validateOpenApi(path)).rejects.toThrow();
    } finally {
      // mkdtemp returned this uniquely owned fixture directory; no user paths are accepted.
      await rm(join(dir, 'api.json'));
      await rmdir(dir);
    }
  });
});
