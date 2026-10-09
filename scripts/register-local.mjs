import { readFile, writeFile, open } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { prepareDatabase, migrate, runtimePool, root } from './register-db.mjs';
import { Store } from '../apps/register/dist/store.js';

const origin = 'http://127.0.0.1:18081';
const directory = resolve(root, '.local/ldv-register-dev');
const configFile = resolve(directory, 'config.json');
const ready = async () => {
  try {
    return (
      await fetch(`${origin}/ready`, { signal: AbortSignal.timeout(1500) })
    ).ok;
  } catch {
    return false;
  }
};
async function main() {
  const mode = process.argv[2];
  if (mode === 'check') {
    if (!(await ready())) throw new Error('Register unavailable');
    console.log(`Register ready: ${origin}`);
    return;
  }
  if (!['up', 'down'].includes(mode)) throw new Error('Unknown mode');
  if (mode === 'up' && (await ready())) {
    console.log(`Register already ready: ${origin}`);
    return;
  }
  if (mode === 'down') {
    const config = JSON.parse(await readFile(configFile, 'utf8'));
    try {
      const r = await fetch(`${origin}/internal/shutdown`, {
        method: 'POST',
        headers: { Origin: origin, 'x-control': config.control },
        signal: AbortSignal.timeout(3000),
      });
      if (!r.ok) throw new Error('Shutdown refused');
    } catch (e) {
      if (await ready()) throw e;
    }
    const ctx = await prepareDatabase();
    await ctx.owner.end();
    ctx.compose(['down']);
    console.log('Register stopped; data retained.');
    return;
  }
  const ctx = await prepareDatabase();
  let runtime;
  try {
    await migrate(ctx.owner);
    runtime = await runtimePool(ctx);
    let config;
    try {
      config = JSON.parse(await readFile(configFile, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      config = {
        mode: 'local-demo',
        origin,
        database: runtime.database,
        control: randomBytes(32).toString('hex'),
        accounts: ['editor', 'reviewer', 'reader'].map((role) => ({
          code: randomBytes(32).toString('hex'),
          actor: { id: `demo-${role}`, role, party: 'example-municipality' },
        })),
      };
      await writeFile(configFile, JSON.stringify(config, null, 2), {
        mode: 0o600,
      });
      await writeFile(
        resolve(directory, 'toegangscodes.txt'),
        config.accounts.map((a) => `${a.actor.role}: ${a.code}`).join('\n'),
        { mode: 0o600 },
      );
    }
    const store = new Store(runtime.pool);
    if (!(await store.list(config.accounts[0].actor)).length) {
      const fixture = JSON.parse(
        await readFile(
          resolve(root, 'contracts/examples/valid-register-draft.json'),
          'utf8',
        ),
      );
      await store.create(config.accounts[0].actor, fixture);
    }
    const out = await open(resolve(directory, 'server.log'), 'a');
    const child = spawn(
      process.execPath,
      [resolve(root, 'apps/register/dist/server.js'), configFile],
      {
        detached: true,
        windowsHide: true,
        stdio: ['ignore', out.fd, out.fd],
        cwd: root,
      },
    );
    child.unref();
    await out.close();
    for (let i = 0; i < 60; i++) {
      if (await ready()) {
        console.log(
          `Register ready: ${origin}\nDemo access codes: ${resolve(directory, 'toegangscodes.txt')}`,
        );
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('Register startup timed out');
  } finally {
    await runtime?.pool.end();
    await ctx.owner.end();
  }
}
main().catch(() => {
  console.error(
    'Local register command failed. Check Docker, configuration and the register runbook.',
  );
  process.exitCode = 1;
});
