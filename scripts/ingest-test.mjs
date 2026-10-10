import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { request } from 'node:https';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { parse } from 'yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { validateEnvelope } from '@ldv/domain';
import { Consumer } from '@platformatic/kafka';
import { prepareIngest, migrateIngest, root } from './ingest-infra.mjs';

const results = [];
const gate = async (name, fn) => {
  try {
    await fn();
  } catch (error) {
    throw new Error(`Gate failed: ${name}`, { cause: error });
  }
  results.push({ name, status: 'passed' });
  console.log(`PASS ${name}`);
};
const ctx = await prepareIngest(true);
let child;
const output = [];
const config = await migrateIngest(ctx);
const file = resolve(ctx.directory, 'config.json');
await writeFile(file, JSON.stringify(config), { mode: 0o600 });
const fixture = JSON.parse(
  await readFile(
    resolve(root, 'contracts/examples/valid-ldv-log-record.json'),
    'utf8',
  ),
);
const contract = parse(
  await readFile(resolve(root, 'contracts/openapi/ingest-api.yaml'), 'utf8'),
);
const ajv = new Ajv2020();
addFormats(ajv);
const accepted = ajv.compile(
  contract.paths['/v1/log-records'].post.responses['202'].content[
    'application/json'
  ].schema,
);
const errorResponse = ajv.compile(contract.components.schemas.Error);
let port;
async function start(crash = false) {
  child = fork(
    resolve(root, 'scripts/ingest-test-server.mjs'),
    [file, ...(crash ? ['--crash-after-ack'] : [])],
    { silent: true, windowsHide: true },
  );
  child.stdout.on('data', (b) => output.push(b.toString()));
  child.stderr.on('data', (b) => output.push(b.toString()));
  const result = await Promise.race([
    once(child, 'message'),
    once(child, 'exit').then(() => {
      throw new Error('Server exited before ready');
    }),
    sleep(15000).then(() => {
      throw new Error('Server startup timeout');
    }),
  ]);
  port = result[0].port;
}
async function stop() {
  if (child && child.exitCode === null) {
    const done = once(child, 'exit');
    child.send('stop');
    await done;
  }
}
async function call(
  body = fixture,
  key = randomUUID(),
  identity = 'source',
  path = '/v1/log-records',
  extra = {},
) {
  const tls = identity
    ? await ctx.tls(identity)
    : { ca: (await ctx.tls('source')).ca };
  const payload =
    path === '/v1/log-records'
      ? typeof body === 'string'
        ? body
        : JSON.stringify(body)
      : undefined;
  return new Promise((done, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        agent: false,
        port,
        path,
        method: path === '/v1/log-records' ? 'POST' : 'GET',
        ...tls,
        headers: {
          'content-type': 'application/json',
          ...(payload === undefined
            ? {}
            : { 'content-length': Buffer.byteLength(payload) }),
          ...(key ? { 'idempotency-key': key } : {}),
          ...extra,
        },
        timeout: 25000,
      },
      (res) => {
        let data = '';
        res.on('data', (b) => (data += b));
        res.on('end', () => {
          try {
            const body = JSON.parse(data);
            if (path === '/v1/log-records') {
              assert.ok(
                contract.paths[path].post.responses[String(res.statusCode)],
              );
              assert.ok(
                (res.statusCode === 202 ? accepted : errorResponse)(body),
              );
            }
            done({ status: res.statusCode, body });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Request timeout')));
    req.end(payload);
  });
}
function count() {
  return Number(
    ctx
      .cli('get-offsets', ['--topic', 'ldv.accepted.v1'])
      .trim()
      .split(':')
      .at(-1),
  );
}
function events(n) {
  const value = ctx.compose([
    'exec',
    '-T',
    'kafka',
    '/opt/kafka/bin/kafka-console-consumer.sh',
    '--bootstrap-server',
    'kafka:9092',
    '--command-config',
    '/pki/admin.properties',
    '--topic',
    'ldv.accepted.v1',
    '--from-beginning',
    '--max-messages',
    String(n),
    '--timeout-ms',
    '15000',
  ]);
  return value.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
}
try {
  await start();
  const key = randomUUID();
  let first;
  await gate('mTLS, OpenAPI 202 en exact één geldig Kafka-event', async () => {
    first = await call(fixture, key);
    assert.equal(first.status, 202);
    assert.ok(accepted(first.body));
    assert.equal(count(), 1);
    const [event] = events(1);
    assert.ok(validateEnvelope(event).valid);
    assert.equal(event.event_id, first.body.event_id);
    assert.deepEqual(event.payload, fixture);
    assert.equal(event.source_application, 'demo-service');
  });
  await gate(
    'Retry, canonieke veldvolgorde en concurrerende aanvragen publiceren niet opnieuw',
    async () => {
      const reordered = Object.fromEntries(Object.entries(fixture).reverse());
      for (const r of await Promise.all(
        Array.from({ length: 5 }, () => call(reordered, key)),
      ))
        assert.deepEqual(r, first);
      assert.equal(count(), 1);
    },
  );
  await gate('Herstart behoudt ontvangstidentiteit en response', async () => {
    await stop();
    await start();
    assert.deepEqual(await call(fixture, key), first);
    assert.equal(count(), 1);
  });
  await gate(
    '409 bij conflicterende inhoud; 400/422/403 bereiken Kafka niet',
    async () => {
      assert.equal(
        (
          await call(
            { ...fixture, name: 'Andere synthetische verwerking' },
            key,
          )
        ).status,
        409,
      );
      assert.equal((await call(fixture, 'geen-uuid')).status, 400);
      assert.equal(
        (await call({ ...fixture, trace_id: 'invalid-example' })).status,
        422,
      );
      assert.equal(
        (
          await call({
            ...fixture,
            attributes: {
              ...fixture.attributes,
              'dpl.core.processing_activity_id':
                'https://example.invalid/not-authorized',
            },
          })
        ).status,
        403,
      );
      assert.equal((await call(fixture, randomUUID(), 'unknown')).status, 403);
      assert.equal(count(), 1);
    },
  );
  await gate(
    'TLS weigert ontbrekend certificaat en onvertrouwde keten',
    async () => {
      await assert.rejects(call(fixture, randomUUID(), null));
      await assert.rejects(call(fixture, randomUUID(), 'rogue'));
      const tls = await ctx.tls('source');
      await assert.rejects(
        new Promise((done, reject) => {
          const req = request(
            { host: '127.0.0.1', port, cert: tls.cert, key: tls.key },
            done,
          );
          req.on('error', reject);
          req.end();
        }),
      );
    },
  );
  await gate(
    'Bronheaders kunnen identiteit niet vervangen; sleutel is scoped',
    async () => {
      const r = await call(fixture, key, 'other', '/v1/log-records', {
        source_application: 'demo-service',
        responsible_party: 'example-municipality',
      });
      assert.equal(r.status, 202);
      assert.notEqual(r.body.event_id, first.body.event_id);
      assert.equal(events(2)[1].source_application, 'other-demo-service');
    },
  );
  await gate(
    'Zonder sleutel blijft iedere aanvraag een nieuw event',
    async () => {
      const a = await call(fixture, null),
        b = await call(fixture, null);
      assert.equal(a.status, 202);
      assert.equal(b.status, 202);
      assert.notEqual(a.body.event_id, b.body.event_id);
      assert.equal(count(), 4);
    },
  );
  await gate(
    'Crash na Kafka-ack: retry behoudt event_id en received_at',
    async () => {
      await stop();
      await start(true);
      const retry = randomUUID();
      await assert.rejects(call(fixture, retry));
      if (child.exitCode === null) await once(child, 'exit');
      assert.equal(count(), 5);
      await start();
      const r = await call(fixture, retry);
      assert.equal(r.status, 202);
      assert.equal(count(), 6);
      const all = events(6);
      assert.deepEqual(all[4], all[5]);
      assert.equal(all[5].event_id, r.body.event_id);
    },
  );
  await gate(
    'Kafka-uitval geeft 503; herstel verwerkt dezelfde pending ontvangst',
    async () => {
      ctx.compose(['stop', 'kafka']);
      const retry = randomUUID();
      assert.equal((await call(fixture, retry)).status, 503);
      const pending = (
        await ctx.owner.query(
          'SELECT event_id FROM ingest.receipts WHERE idempotency_key=$1',
          [retry],
        )
      ).rows[0];
      ctx.compose(
        ['up', '--detach', '--wait', '--wait-timeout', '120', 'kafka'],
        { timeout: 180000 },
      );
      let r;
      for (let i = 0; i < 5; i++) {
        r = await call(fixture, retry);
        if (r.status === 202) break;
        await sleep(500);
      }
      assert.equal(r.status, 202);
      assert.equal(r.body.event_id, pending.event_id);
    },
  );
  await gate(
    'Database-uitval geeft 503 zonder publicatie; herstel werkt',
    async () => {
      const before = count();
      ctx.compose(['stop', 'postgres']);
      assert.equal((await call()).status, 503);
      ctx.compose(
        ['up', '--detach', '--wait', '--wait-timeout', '90', 'postgres'],
        { timeout: 120000 },
      );
      assert.equal(count(), before);
      let r;
      for (let i = 0; i < 5; i++) {
        r = await call();
        if (r.status === 202) break;
        await sleep(500);
      }
      assert.equal(r.status, 202);
    },
  );
  await gate(
    'Metadata bevat geen payload; runtime mag geen historie wissen of wijzigen',
    async () => {
      const { default: pg } = await import('pg');
      const pool = new pg.Pool(config.database);
      try {
        await assert.rejects(pool.query('DELETE FROM ingest.receipts'));
        await assert.rejects(
          pool.query('UPDATE ingest.receipts SET event_id=gen_random_uuid()'),
        );
        await assert.rejects(
          pool.query('CREATE TABLE ingest.forbidden(id int)'),
        );
      } finally {
        await pool.end();
      }
      const cols = (
        await ctx.owner.query(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='ingest' AND table_name='receipts'",
        )
      ).rows.map((r) => r.column_name);
      assert.deepEqual(
        cols.sort(),
        [
          'source_application',
          'responsible_party',
          'idempotency_key',
          'payload_hash',
          'event_id',
          'received_at',
          'accepted_at',
        ].sort(),
      );
    },
  );
  await gate(
    'Kafka-producer heeft geen leesrecht; PostgreSQL vereist mTLS',
    async () => {
      const consumer = new Consumer({
        ...ctx.kafka,
        clientId: 'acl-probe',
        groupId: 'acl-probe',
        retries: 0,
        timeout: 3000,
      });
      try {
        const metadata = await consumer.metadata({
          topics: ['ldv.accepted.v1'],
        });
        await assert.rejects(
          consumer.fetch({
            node: 1,
            maxWaitTime: 1000,
            topics: [
              {
                topicId: metadata.topics.get('ldv.accepted.v1').id,
                partitions: [
                  {
                    partition: 0,
                    currentLeaderEpoch: -1,
                    fetchOffset: 0n,
                    lastFetchedEpoch: -1,
                    partitionMaxBytes: 1024,
                  },
                ],
              },
            ],
          }),
          (error) => error.errors?.some((e) => e.apiCode === 29),
        );
      } finally {
        await consumer.close();
      }
      const { default: pg } = await import('pg');
      for (const ssl of [
        false,
        { ca: config.database.ssl.ca, rejectUnauthorized: true },
      ]) {
        const db = new pg.Pool({ ...config.database, ssl });
        try {
          await assert.rejects(db.query('SELECT 1'));
        } finally {
          await db.end();
        }
      }
    },
  );
  await gate(
    'Health, readiness en metrics zonder payloads/geheimen',
    async () => {
      assert.equal((await call(null, null, 'source', '/health')).status, 200);
      assert.equal((await call(null, null, 'source', '/ready')).status, 200);
      const metrics = await call(null, null, 'source', '/metrics');
      assert.ok(metrics.body.received > 0);
      const technical = JSON.stringify(metrics) + output.join('');
      assert.ok(!technical.includes('example-subject'));
      assert.ok(!technical.includes('PRIVATE KEY'));
      assert.ok(!technical.includes(config.database.password));
    },
  );
  await gate(
    'Gelijktijdige eerste aanvragen delen één Kafka-publicatie',
    async () => {
      const before = count(),
        key = randomUUID();
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => call(fixture, key)),
      );
      assert.equal(responses[0].status, 202);
      for (const r of responses) assert.deepEqual(r, responses[0]);
      assert.equal(count(), before + 1);
    },
  );
  await gate(
    'Ongeldige JSON, mediatype en te grote body lekken geen inhoud',
    async () => {
      const before = count();
      assert.equal((await call('{"sensitive-example":')).status, 400);
      assert.equal(
        (
          await call(fixture, randomUUID(), 'source', '/v1/log-records', {
            'content-type': 'text/plain',
          })
        ).status,
        415,
      );
      assert.equal(
        (
          await call('x'.repeat(1048577)).catch((error) => {
            throw new Error('Oversize request failed', { cause: error });
          })
        ).status,
        413,
      );
      const invalid = await call({
        ...fixture,
        attributes: {
          ...fixture.attributes,
          'dpl.core.data_subject_id': 'synthetic-private-marker',
        },
      });
      assert.equal(invalid.status, 422);
      assert.ok(!JSON.stringify(invalid).includes('synthetic-private-marker'));
      assert.equal(count(), before);
    },
  );
  await gate(
    'Stille broker begrenst wachttijd en herstelt met dezelfde event-identiteit',
    async () => {
      const key = randomUUID();
      ctx.compose(['pause', 'kafka']);
      try {
        const start = Date.now();
        assert.equal((await call(fixture, key)).status, 503);
        assert.ok(Date.now() - start < 24000);
      } finally {
        ctx.compose(['unpause', 'kafka']);
      }
      const pending = (
        await ctx.owner.query(
          'SELECT event_id FROM ingest.receipts WHERE idempotency_key=$1',
          [key],
        )
      ).rows[0];
      let response;
      for (let i = 0; i < 5; i++) {
        response = await call(fixture, key);
        if (response.status === 202) break;
        await sleep(500);
      }
      assert.equal(response.status, 202);
      assert.equal(response.body.event_id, pending.event_id);
    },
  );
} finally {
  await stop();
  await ctx.owner.end();
  ctx.compose(['down', '--volumes', '--remove-orphans']);
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  await writeFile(
    resolve(root, 'artifacts/ingest.json'),
    JSON.stringify({ date: new Date().toISOString(), results }, null, 2),
  );
}
