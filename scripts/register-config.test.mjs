import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { readSettings } from '../apps/register/dist/server.js';

const settings = {
  mode: 'local-demo',
  origin: 'http://127.0.0.1:18081',
  database: {
    host: '127.0.0.1',
    port: 15433,
    database: 'register',
    user: 'register_app',
    password: 'synthetic-test-only',
  },
  control: '0'.repeat(64),
  accounts: [
    {
      code: '1'.repeat(64),
      actor: {
        id: 'synthetic-test',
        role: 'reader',
        party: 'example-municipality',
      },
    },
  ],
};
async function file(config, run) {
  const dir = await mkdtemp(join(tmpdir(), 'ldv-register-config-'));
  const path = join(dir, 'config.json');
  try {
    await writeFile(path, JSON.stringify(config));
    return await run(path);
  } finally {
    await unlink(path);
    await rmdir(dir);
  }
}
describe('local register configuration boundary', () => {
  it('accepts explicit loopback demo configuration', async () => {
    await file(settings, (path) =>
      expect(readSettings(path).mode).toBe('local-demo'),
    );
  });
  it.each([
    { mode: 'production' },
    { origin: 'http://0.0.0.0:18081' },
    { origin: 'http://example.invalid:18081' },
    { database: { ...settings.database, host: 'remote.invalid' } },
    { database: { ...settings.database, user: 'register_owner' } },
    { accounts: [] },
    { control: 'short' },
  ])('rejects unsafe configuration %j', async (patch) => {
    await file({ ...settings, ...patch }, (path) =>
      expect(() => readSettings(path)).toThrow(
        'LOCAL_DEMO_CONFIGURATION_REQUIRED',
      ),
    );
  });
  it('refuses a production process even with local configuration', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      await file(settings, (path) =>
        expect(() => readSettings(path)).toThrow(),
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
