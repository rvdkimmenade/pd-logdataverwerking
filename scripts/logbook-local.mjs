import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { request } from 'node:https';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { prepareIngest, root } from './ingest-infra.mjs';
import { prepareLogbook } from './logbook-infra.mjs';
import { command } from './process.mjs';
import { findRecords } from '../apps/logbook/dist/store.js';
import { replayOne } from '../apps/logbook/dist/replay.js';
const directory = resolve(root, '.local/ldv-ingest-dev');
const runtimeFile = resolve(directory, 'logbook-config.json');
const opsFile = resolve(directory, 'logbook-operations.json');
async function healthy() {
  try {
    return (
      await fetch('http://127.0.0.1:18083/health', {
        signal: AbortSignal.timeout(2000),
      })
    ).ok;
  } catch {
    return false;
  }
}
try {
  const action = process.argv[2];
  if (action === 'up') {
    if (await healthy()) {
      console.log('Logbook consumer is already running');
      process.exit(0);
    }
    command(
      process.execPath,
      [resolve(root, 'scripts/ingest-local.mjs'), 'up'],
      { timeout: 240000 },
    );
    const ctx = await prepareIngest();
    const archive = await prepareLogbook(ctx);
    await archive.owner.end();
    await ctx.owner.end();
    archive.config.controlToken = randomBytes(32).toString('hex');
    await writeFile(runtimeFile, JSON.stringify(archive.config), {
      mode: 0o600,
    });
    await writeFile(
      opsFile,
      JSON.stringify({ reader: archive.reader, replay: archive.replay }),
      { mode: 0o600 },
    );
    const child = spawn(
      process.execPath,
      [resolve(root, 'apps/logbook/dist/server.js'), runtimeFile],
      { cwd: root, windowsHide: true, detached: true, stdio: 'ignore' },
    );
    child.unref();
    let ready = false;
    for (let i = 0; i < 40; i++) {
      if (await healthy()) {
        ready = true;
        break;
      }
      await sleep(500);
    }
    if (!ready) throw new Error('Consumer did not start');
    console.log('Logbook consumer gestart. Gebruik npm run demo:logbook.');
  } else if (action === 'down') {
    if (await healthy()) {
      const config = JSON.parse(await readFile(runtimeFile, 'utf8'));
      const response = await fetch('http://127.0.0.1:18083/stop', {
        method: 'POST',
        headers: { 'x-local-control': config.controlToken },
      });
      if (!response.ok) throw new Error('Stop refused');
    }
    console.log(
      'Logbook consumer gestopt; archief, offsets, register en ingest blijven behouden.',
    );
  } else if (action === 'query' || action === 'demo') {
    const ops = JSON.parse(await readFile(opsFile, 'utf8'));
    const pool = new pg.Pool(ops.reader);
    try {
      let field = process.argv[3],
        value = process.argv[4],
        party = process.argv[5];
      if (action === 'demo') {
        const pki = resolve(directory, 'pki');
        const tls = {
          ca: await readFile(resolve(pki, 'ca.crt')),
          cert: await readFile(resolve(pki, 'source.crt')),
          key: await readFile(resolve(pki, 'source.key')),
        };
        const payload = JSON.parse(
          await readFile(
            resolve(root, 'contracts/examples/valid-ldv-log-record.json'),
            'utf8',
          ),
        );
        const accepted = await new Promise((done, reject) => {
          const req = request(
            {
              ...tls,
              hostname: '127.0.0.1',
              port: 18082,
              path: '/v1/log-records',
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'idempotency-key': randomUUID(),
              },
            },
            (res) => {
              let text = '';
              res.on('data', (b) => (text += b));
              res.on('end', () =>
                res.statusCode === 202
                  ? done(JSON.parse(text))
                  : reject(new Error('Ingest not accepted')),
              );
            },
          );
          req.on('error', reject);
          req.end(JSON.stringify(payload));
        });
        field = 'event_id';
        value = accepted.event_id;
        party = 'example-municipality';
      }
      let records = [];
      for (let i = 0; i < (action === 'demo' ? 90 : 1); i++) {
        records = await findRecords(pool, party, field, value);
        if (records.length) break;
        await sleep(500);
      }
      if (action === 'demo' && records.length !== 1)
        throw new Error('Event not archived');
      console.log(
        JSON.stringify(
          records.map((r) => ({
            event_id: r.event_id,
            trace_id: r.envelope.payload.trace_id,
            span_id: r.envelope.payload.span_id,
            processing_activity_id:
              r.envelope.payload.attributes['dpl.core.processing_activity_id'],
            stored_at: r.stored_at,
            sha256: r.original_sha256,
          })),
          null,
          2,
        ),
      );
    } finally {
      await pool.end();
    }
  } else if (action === 'replay') {
    const ops = JSON.parse(await readFile(opsFile, 'utf8'));
    console.log(JSON.stringify(await replayOne(ops.replay)));
  } else throw new Error('Use up/down/demo/query/replay');
} catch {
  console.error(
    'Logbook command failed; check local services/configuration and query arguments.',
  );
  process.exitCode = 1;
}
