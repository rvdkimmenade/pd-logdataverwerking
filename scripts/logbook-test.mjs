import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:https';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { Consumer, Producer, stringSerializers } from '@platformatic/kafka';
import { prepareIngest, migrateIngest, root } from './ingest-infra.mjs';
import { prepareLogbook } from './logbook-infra.mjs';
import { createApp } from '../apps/ingest/dist/app.js';
import { ReceiptStore } from '../apps/ingest/dist/store.js';
import { KafkaPublisher } from '../apps/ingest/dist/producer.js';
import { findRecords } from '../apps/logbook/dist/store.js';
import { replayOne } from '../apps/logbook/dist/replay.js';
import { validateFailure } from '../apps/logbook/dist/failure-validation.js';

const results = [];
async function gate(name, run) {
  const start = Date.now();
  try {
    await run();
    results.push({ name, passed: true, durationMs: Date.now() - start });
    console.log(`PASS ${name}`);
  } catch (e) {
    results.push({ name, passed: false });
    throw new Error(`Gate failed: ${name}`, { cause: e });
  }
}
async function until(check, timeout = 45000) {
  const deadline = Date.now() + timeout;
  do {
    try {
      const value = await check();
      if (value) return value;
    } catch {
      /* Reconnecting pools may initially be stale. */
    }
    await sleep(250);
  } while (Date.now() < deadline);
  throw new Error('Condition timeout');
}
const ctx = await prepareIngest(true);
const archive = await prepareLogbook(ctx);
const ingest = await migrateIngest(ctx);
const file = resolve(ctx.directory, 'logbook-config.json');
await writeFile(file, JSON.stringify(archive.config), { mode: 0o600 });
const reader = new pg.Pool(archive.reader);
reader.on('error', () => {});
const ipool = new pg.Pool(ingest.database);
ipool.on('error', () => {});
const publisher = new KafkaPublisher(ctx.kafka);
const app = createApp({ ...ingest, store: new ReceiptStore(ipool, publisher) });
const adminOptions = {
  bootstrapBrokers: ctx.kafka.bootstrapBrokers,
  tls: await ctx.tls('admin'),
  clientId: 'logbook-test',
  timeout: 3000,
  requestTimeout: 3000,
  connectTimeout: 2000,
  retries: 0,
};
const producer = new Producer({
  ...adminOptions,
  serializers: stringSerializers,
  acks: -1,
  idempotent: true,
});
const observer = new Consumer({ ...adminOptions, groupId: 'ldv-logbook-v1' });
let child,
  metrics = {};
const output = [];
const fixture = JSON.parse(
  await readFile(
    resolve(root, 'contracts/examples/valid-log-event.json'),
    'utf8',
  ),
);
const fresh = () => ({ ...structuredClone(fixture), event_id: randomUUID() });
async function start(scenario = 'normal') {
  metrics = {};
  child = fork(
    resolve(root, 'scripts/logbook-test-worker.mjs'),
    [file, scenario],
    { silent: true, windowsHide: true },
  );
  child.stdout.on('data', (b) => output.push(b.toString()));
  child.stderr.on('data', (b) => output.push(b.toString()));
  child.on('message', (m) => {
    if (m.metrics) metrics = m.metrics;
  });
  await Promise.race([
    once(child, 'message'),
    once(child, 'exit').then(() => {
      throw new Error('Worker startup failed');
    }),
  ]);
}
async function stop() {
  if (child && child.exitCode === null) {
    const done = once(child, 'exit');
    child.send('stop');
    await done;
  }
}
async function send(value) {
  await producer.send({
    messages: [
      {
        topic: 'ldv.accepted.v1',
        key: 'synthetic-test',
        value: typeof value === 'string' ? value : JSON.stringify(value),
      },
    ],
  });
}
async function rows(id) {
  return (
    await reader.query('SELECT * FROM logbook.records WHERE event_id=$1', [id])
  ).rows;
}
async function committed() {
  const offsets = await observer.listCommittedOffsets({
    topics: [{ topic: 'ldv.accepted.v1', partitions: [0] }],
  });
  return offsets.get('ldv.accepted.v1')?.[0] ?? -1n;
}
async function endOffset(topic = 'ldv.accepted.v1') {
  return (
    (await observer.listOffsets({ topics: [topic], timestamp: -1n })).get(
      topic,
    )?.[0] ?? 0n
  );
}
async function caughtUp() {
  const end = await endOffset();
  await until(async () => (await committed()) === end);
}
function faults(topic, count) {
  return ctx
    .compose([
      'exec',
      '-T',
      'kafka',
      '/opt/kafka/bin/kafka-console-consumer.sh',
      '--bootstrap-server',
      'kafka:9092',
      '--command-config',
      '/pki/admin.properties',
      '--topic',
      topic,
      '--from-beginning',
      '--max-messages',
      String(count),
      '--timeout-ms',
      '10000',
    ])
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(JSON.parse);
}
try {
  await app.listen({ host: '127.0.0.1', port: 0 });
  await start();
  let first;
  await gate('POST via echte mTLS-ingest en Kafka naar archief', async () => {
    const tls = await ctx.tls('source');
    const response = await new Promise((done, reject) => {
      const req = request(
        {
          ...tls,
          host: '127.0.0.1',
          port: app.server.address().port,
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
            done({ status: res.statusCode, body: JSON.parse(text) }),
          );
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify(fixture.payload));
    });
    assert.equal(response.status, 202);
    first = await until(async () => (await rows(response.body.event_id))[0]);
    assert.deepEqual(first.envelope.payload, fixture.payload);
    assert.deepEqual(JSON.parse(first.original), first.envelope);
    assert.equal(
      createHash('sha256').update(first.original).digest('hex'),
      first.original_sha256,
    );
    await caughtUp();
  });
  await gate(
    'Vier queries met expliciete scope en ongewijzigde payload',
    async () => {
      for (const [field, value] of Object.entries({
        event_id: first.event_id,
        trace_id: first.trace_id,
        span_id: first.span_id,
        processing_activity_id: first.processing_activity_id,
      }))
        assert.equal(
          (await findRecords(reader, first.responsible_party, field, value))
            .length,
          1,
        );
      assert.equal(
        (
          await findRecords(
            reader,
            'other-example-municipality',
            'event_id',
            first.event_id,
          )
        ).length,
        0,
      );
      await assert.rejects(findRecords(reader, '', 'event_id', first.event_id));
      await assert.rejects(
        findRecords(
          reader,
          first.responsible_party,
          'untrusted-field',
          first.event_id,
        ),
      );
    },
  );
  await gate(
    'Dubbele en anders geformatteerde envelop behoudt één origineel',
    async () => {
      for (let i = 0; i < 3; i++) await send(first.envelope);
      await send(
        JSON.stringify(
          Object.fromEntries(Object.entries(first.envelope).reverse()),
          null,
          2,
        ),
      );
      await caughtUp();
      const stored = await rows(first.event_id);
      assert.equal(stored.length, 1);
      assert.deepEqual(stored[0].original, first.original);
    },
  );
  await gate('Crash vóór DB-commit rolt terug en levert opnieuw', async () => {
    await stop();
    const before = await committed();
    await start('before');
    const event = fresh();
    const exited = once(child, 'exit');
    await send(event);
    assert.equal((await exited)[0], 71);
    assert.equal((await rows(event.event_id)).length, 0);
    assert.equal(await committed(), before);
    await start();
    await until(async () => (await rows(event.event_id)).length === 1);
    await caughtUp();
  });
  await gate(
    'Crash na DB-commit vóór Kafka-commit dedupliceert bij herlevering',
    async () => {
      await stop();
      const before = await committed();
      await start('after');
      const event = fresh();
      const exited = once(child, 'exit');
      await send(event);
      assert.equal((await exited)[0], 72);
      assert.equal((await rows(event.event_id)).length, 1);
      assert.equal(await committed(), before);
      await start();
      await caughtUp();
      assert.equal((await rows(event.event_id)).length, 1);
      await until(() => metrics.duplicates >= 1);
    },
  );
  await gate(
    'Botsend event_id en ongeldige events gaan veilig naar rejectstroom',
    async () => {
      await send({
        ...first.envelope,
        payload: {
          ...first.envelope.payload,
          name: 'Conflicting synthetic event',
        },
      });
      await send('{"synthetic-private-marker":');
      await send({ secret: 'synthetic-private-marker' });
      await caughtUp();
      assert.equal(await endOffset('ldv.rejected.v1'), 3n);
      const rejected = faults('ldv.rejected.v1', 3);
      for (const r of rejected) {
        assert.ok(validateFailure(r));
        assert.ok(!JSON.stringify(r).includes('synthetic-private-marker'));
        assert.ok(!r.original_base64);
      }
      assert.deepEqual(
        rejected.map((r) => r.reason),
        ['EVENT_ID_CONFLICT', 'INVALID_JSON', 'INVALID_ENVELOPE'],
      );
      assert.deepEqual(
        (await rows(first.event_id))[0].original,
        first.original,
      );
    },
  );
  await gate(
    'DB-uitval bewaart offset, geeft retry en herstelt zonder reject',
    async () => {
      const before = await committed(),
        attempts = metrics.retries ?? 0;
      ctx.compose(['stop', 'postgres']);
      const event = fresh();
      await send(event);
      await until(() => metrics.retries > attempts);
      assert.equal(await committed(), before);
      assert.equal(await endOffset('ldv.rejected.v1'), 3n);
      assert.equal(await endOffset('ldv.dead-letter.v1'), 0n);
      ctx.compose(
        ['up', '--detach', '--wait', '--wait-timeout', '90', 'postgres'],
        { timeout: 120000 },
      );
      await until(async () => (await rows(event.event_id)).length === 1);
      await caughtUp();
    },
  );
  await gate(
    'Geen offsetcommit als rejectpublicatie niet is bevestigd',
    async () => {
      const before = await committed();
      ctx.cli('acls', [
        '--remove',
        '--force',
        '--allow-principal',
        'User:CN=consumer',
        '--operation',
        'Write',
        '--topic',
        'ldv.rejected.v1',
      ]);
      try {
        await send('invalid-synthetic-json');
        await sleep(2000);
        assert.equal(await committed(), before);
      } finally {
        ctx.cli('acls', [
          '--add',
          '--allow-principal',
          'User:CN=consumer',
          '--operation',
          'Write',
          '--topic',
          'ldv.rejected.v1',
        ]);
      }
      await caughtUp();
      assert.equal(await endOffset('ldv.rejected.v1'), 4n);
    },
  );
  await gate(
    'Blijvende technische fout → dead letter → expliciete replay',
    async () => {
      await stop();
      await start('technical');
      const event = fresh();
      await send(event);
      await caughtUp();
      assert.equal((await rows(event.event_id)).length, 0);
      const [dlq] = faults('ldv.dead-letter.v1', 1);
      assert.ok(validateFailure(dlq));
      assert.deepEqual(
        JSON.parse(Buffer.from(dlq.original_base64, 'base64')),
        event,
      );
      await stop();
      await start();
      const replay = await replayOne(archive.replay, 30000);
      assert.equal(replay.event_id, event.event_id);
      await until(async () => (await rows(event.event_id)).length === 1);
      await caughtUp();
    },
  );
  await gate(
    'Append-only, writer zonder algemeen leesrecht en migratiebehoud',
    async () => {
      const writer = new pg.Pool(archive.config.database);
      try {
        for (const sql of [
          'SELECT * FROM logbook.records',
          'DELETE FROM logbook.records',
          'UPDATE logbook.records SET envelope=envelope',
          'TRUNCATE logbook.records',
        ])
          await assert.rejects(writer.query(sql));
      } finally {
        await writer.end();
      }
      for (const sql of [
        'DELETE FROM logbook.records',
        'UPDATE logbook.records SET envelope=envelope',
        'TRUNCATE logbook.records',
      ])
        await assert.rejects(archive.owner.query(sql));
      await archive.owner.query(
        await readFile(
          resolve(root, 'apps/logbook/migrations/001-archive.sql'),
          'utf8',
        ),
      );
      assert.deepEqual(
        (await rows(first.event_id))[0].original,
        first.original,
      );
    },
  );
  await gate(
    'Technische output en metrics bevatten geen payloads of secrets',
    async () => {
      const technical = output.join('') + JSON.stringify(metrics);
      for (const marker of [
        'synthetic-private-marker',
        'example-subject',
        'PRIVATE KEY',
        archive.config.database.password,
      ])
        assert.ok(!technical.includes(marker));
    },
  );
} finally {
  await stop();
  await app.close();
  await publisher.close();
  await producer.close();
  await observer.close();
  await ipool.end();
  await reader.end();
  await archive.owner.end();
  await ctx.owner.end();
  ctx.compose(['down', '--volumes', '--remove-orphans']);
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  await writeFile(
    resolve(root, 'artifacts/logbook.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
  );
}
