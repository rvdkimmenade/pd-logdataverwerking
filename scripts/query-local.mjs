import { readFile, writeFile, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { request } from 'node:https';
import { prepareIngest, root } from './ingest-infra.mjs';
import { prepareLogbook } from './logbook-infra.mjs';
import { prepareQuery } from './query-infra.mjs';
import { command } from './process.mjs';
const file = resolve(root, '.local/ldv-ingest-dev/query/runtime.json');
const accessFile = resolve(root, '.local/ldv-ingest-dev/query/auditor.json');
async function control(action, method = 'GET') {
  const config = JSON.parse(await readFile(file, 'utf8'));
  return fetch(`http://127.0.0.1:18085/${action}`, {
    method,
    headers: { 'x-local-control': config.controlToken },
    signal: AbortSignal.timeout(action === 'rebuild' ? 120000 : 3000),
  });
}
export async function queryRequest(tls, path, body, port = 18084) {
  return new Promise((done, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: body === undefined ? 'GET' : 'POST',
        ...tls,
        headers: { 'content-type': 'application/json' },
      },
      (res) => {
        let text = '';
        res.on('data', (b) => (text += b));
        res.on('end', () => {
          try {
            done({ status: res.statusCode, body: JSON.parse(text) });
          } catch {
            reject(new Error('Invalid response'));
          }
        });
      },
    );
    const timer = setTimeout(
      () => req.destroy(new Error('Query timed out')),
      15000,
    );
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
async function main() {
  const mode = process.argv[2];
  if (mode === 'up') {
    try {
      if ((await control('metrics')).ok) {
        console.log('Query already running at https://127.0.0.1:18084');
        return;
      }
    } catch {
      /* First start. */
    }
    command(
      process.execPath,
      [resolve(root, 'scripts/logbook-local.mjs'), 'up'],
      { timeout: 240000 },
    );
    const ctx = await prepareIngest(),
      archive = await prepareLogbook(ctx);
    try {
      const infra = await prepareQuery(ctx, archive);
      const register = JSON.parse(
        await readFile(
          resolve(root, '.local/ldv-register-dev/config.json'),
          'utf8',
        ),
      );
      const reader = register.accounts.find(
        (a) =>
          a.actor.role === 'reader' && a.actor.party === 'example-municipality',
      );
      if (!reader) throw new Error('Register reader required');
      const config = {
        local: true,
        query: infra.query,
        projector: infra.projector,
        register: {
          origin: register.origin,
          readers: { 'example-municipality': reader.code },
        },
        scopes: {
          [await ctx.fingerprint('auditor')]: {
            id: 'demo-auditor',
            party: 'example-municipality',
            applications: ['demo-source'],
            read: true,
          },
        },
        controlToken: randomBytes(32).toString('hex'),
        cursorKey: randomBytes(32).toString('hex'),
        auditFile: resolve(infra.directory, 'audit.jsonl'),
      };
      const envelope = JSON.parse(
        await readFile(
          resolve(root, 'contracts/examples/valid-log-event.json'),
          'utf8',
        ),
      );
      config.scopes[await ctx.fingerprint('auditor')].applications = [
        envelope.source_application,
      ];
      await writeFile(file, JSON.stringify(config), { mode: 0o600 });
      await writeFile(accessFile, JSON.stringify(await ctx.tls('auditor')), {
        mode: 0o600,
      });
      const log = await open(resolve(infra.directory, 'server.log'), 'a');
      const child = spawn(
        process.execPath,
        [resolve(root, 'apps/query/dist/server.js'), file],
        {
          cwd: root,
          windowsHide: true,
          detached: true,
          stdio: ['ignore', log.fd, log.fd],
        },
      );
      child.unref();
      await log.close();
      for (let i = 0; i < 40; i++) {
        try {
          if ((await control('metrics')).ok) {
            console.log(
              'Query API started at https://127.0.0.1:18084; use npm run demo:query',
            );
            return;
          }
        } catch {
          /* Starting. */
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error('Query start timed out');
    } finally {
      await archive.owner.end();
      await ctx.owner.end();
    }
  } else if (mode === 'demo') {
    const tls = JSON.parse(await readFile(accessFile, 'utf8'));
    const response = await queryRequest(tls, '/v1/log-records/search', {
      limit: 10,
    });
    if (response.status !== 200) throw new Error('Query failed');
    console.log(JSON.stringify(response.body, null, 2));
  } else if (['down', 'metrics', 'rebuild'].includes(mode)) {
    let response;
    for (let i = 0; i < 10; i++) {
      response = await control(
        mode === 'down' ? 'stop' : mode,
        mode === 'metrics' ? 'GET' : 'POST',
      );
      if (response.status !== 409) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!response.ok) throw new Error('Control failed');
    console.log(await response.text());
  } else throw new Error('Unknown command');
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
)
  main().catch(() => {
    console.error(
      'Local query command failed; check dependencies and the query runbook.',
    );
    process.exitCode = 1;
  });
