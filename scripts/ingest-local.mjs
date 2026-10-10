import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { request } from 'node:https';
import { setTimeout as sleep } from 'node:timers/promises';
import { prepareIngest, migrateIngest, root } from './ingest-infra.mjs';
import { command } from './process.mjs';
const directory = resolve(root, '.local/ldv-ingest-dev');
const file = resolve(directory, 'config.json');
async function localRequest(path, body, headers = {}) {
  const pki = resolve(directory, 'pki');
  const tls = {
    ca: await readFile(resolve(pki, 'ca.crt')),
    cert: await readFile(resolve(pki, 'source.crt')),
    key: await readFile(resolve(pki, 'source.key')),
  };
  return new Promise((done, reject) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port: 18082,
        path,
        method: body === undefined ? 'GET' : 'POST',
        ...tls,
        headers: { 'content-type': 'application/json', ...headers },
        timeout: 25000,
      },
      (res) => {
        let text = '';
        res.on('data', (b) => (text += b));
        res.on('end', () =>
          done({ status: res.statusCode, body: JSON.parse(text) }),
        );
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Local request timeout')));
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
try {
  const action = process.argv[2];
  if (action === 'up') {
    try {
      const health = await localRequest('/ready');
      if (health.status === 200) {
        console.log('Ingest is already available on https://127.0.0.1:18082');
        process.exit(0);
      }
    } catch {
      /* First start. */
    }
    const ctx = await prepareIngest();
    const config = await migrateIngest(ctx);
    await ctx.owner.end();
    config.controlToken = randomBytes(32).toString('hex');
    await writeFile(file, JSON.stringify(config), { mode: 0o600 });
    const child = spawn(
      process.execPath,
      [resolve(root, 'apps/ingest/dist/server.js'), file],
      { cwd: root, detached: true, stdio: 'ignore', windowsHide: true },
    );
    child.unref();
    let ready = false;
    for (let i = 0; i < 40; i++) {
      try {
        if ((await localRequest('/ready')).status === 200) {
          ready = true;
          break;
        }
      } catch {
        /* Await readiness. */
      }
      await sleep(500);
    }
    if (!ready) throw new Error('Ingest did not become ready');
    console.log(
      'Ingest gestart: https://127.0.0.1:18082 (mTLS). Gebruik npm run demo:ingest.',
    );
  } else if (action === 'demo') {
    const body = JSON.parse(
      await readFile(
        resolve(root, 'contracts/examples/valid-ldv-log-record.json'),
        'utf8',
      ),
    );
    const key = randomUUID();
    const first = await localRequest('/v1/log-records', body, {
      'idempotency-key': key,
    });
    const retry = await localRequest('/v1/log-records', body, {
      'idempotency-key': key,
    });
    if (first.status !== 202 || JSON.stringify(first) !== JSON.stringify(retry))
      throw new Error('Demo acceptance/retry failed');
    console.log(
      JSON.stringify(
        {
          status: first.status,
          event_id: first.body.event_id,
          accepted_at: first.body.accepted_at,
          retry_same_receipt: true,
        },
        null,
        2,
      ),
    );
  } else if (action === 'down') {
    const config = JSON.parse(await readFile(file, 'utf8'));
    try {
      const result = await localRequest(
        '/local/stop',
        {},
        { 'x-local-control': config.controlToken },
      );
      if (result.status !== 200) throw new Error('Stop refused');
    } catch (e) {
      if (e.code !== 'ECONNREFUSED') throw e;
    }
    command(
      'docker',
      [
        'compose',
        '--project-name',
        'ldv-ingest-dev',
        '--file',
        resolve(root, 'infra/compose.ingest.yaml'),
        'down',
      ],
      {
        env: {
          ...process.env,
          INGEST_PKI: resolve(directory, 'pki').replaceAll('\\', '/'),
          INGEST_PASSWORD_FILE: resolve(directory, 'password').replaceAll(
            '\\',
            '/',
          ),
          INGEST_DB_PORT: '15434',
          INGEST_KAFKA_PORT: '19094',
        },
      },
    );
    console.log('Ingest gestopt; volumes en ontvangstidentiteiten behouden.');
  } else throw new Error('Use up, demo or down');
} catch {
  console.error(
    'Ingest command failed; check local services/configuration. No credentials are printed.',
  );
  process.exitCode = 1;
}
