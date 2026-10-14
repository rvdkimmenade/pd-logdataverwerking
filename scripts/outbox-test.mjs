import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:https';
import pg from 'pg';
import { prepareIngest, migrateIngest, root } from './ingest-infra.mjs';
import { prepareLogbook } from './logbook-infra.mjs';
import { prepareSource } from './outbox-infra.mjs';
import { createApp } from '../apps/ingest/dist/app.js';
import { ReceiptStore } from '../apps/ingest/dist/store.js';
import { KafkaPublisher } from '../apps/ingest/dist/producer.js';
import { LogConsumer } from '../apps/logbook/dist/consumer.js';
import { Archive } from '../apps/logbook/dist/store.js';
import { SourceStore } from '../apps/example/dist/store.js';
import {
  Publisher,
  IngestClient,
} from '../packages/ldv-publisher/dist/index.js';
const results = [];
let ctx,
  source,
  archive,
  app,
  kafka,
  consumer,
  running,
  pool,
  ipool,
  writer,
  reader,
  child,
  mock;
const output = [];
async function gate(name, fn) {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, passed: true, durationMs: Date.now() - start });
    console.log('PASS Outbox: ' + name);
  } catch (error) {
    results.push({ name, passed: false });
    throw new Error('Outbox gate failed: ' + name, { cause: error });
  }
}
async function until(check) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(100);
  }
  throw new Error('Condition timeout');
}
const template = JSON.parse(
  await readFile(
    resolve(root, 'contracts/examples/valid-ldv-log-record.json'),
    'utf8',
  ),
);
const input = JSON.parse(
  await readFile(
    resolve(root, 'contracts/examples/valid-example-case.json'),
    'utf8',
  ),
);
let store, transport, worker, configFile, endpoint, tls;
try {
  await gate(
    'Isolated source DB, mTLS ingest, Kafka and append-only consumer start',
    async () => {
      ctx = await prepareIngest(true);
      archive = await prepareLogbook(ctx);
      source = await prepareSource(ctx);
      const ingest = await migrateIngest(ctx);
      ipool = new pg.Pool(ingest.database);
      ipool.on('error', () => {});
      pool = new pg.Pool(source.database);
      pool.on('error', () => {});
      store = new SourceStore(pool);
      writer = new pg.Pool(archive.config.database);
      writer.on('error', () => {});
      reader = new pg.Pool(archive.reader);
      reader.on('error', () => {});
      kafka = new KafkaPublisher(ctx.kafka);
      app = createApp({ ...ingest, store: new ReceiptStore(ipool, kafka) });
      await app.listen({ host: '127.0.0.1', port: 0 });
      endpoint = `https://127.0.0.1:${app.server.address().port}/v1/log-records`;
      tls = await ctx.tls('source');
      transport = new IngestClient(endpoint, tls);
      worker = new Publisher(store, transport, {
        leaseMs: 10000,
        baseMs: 100,
        capMs: 1000,
      });
      consumer = new LogConsumer(archive.config.kafka, new Archive(writer));
      running = consumer.run();
      configFile = resolve(ctx.directory, 'outbox-worker.json');
      await writeFile(
        configFile,
        JSON.stringify({
          database: {
            ...source.database,
            ssl: { ...source.database.ssl, key: source.database.ssl.key },
          },
          ingest: { url: endpoint, tls },
        }),
        { mode: 0o600 },
      );
    },
  );
  await gate(
    'Empty migration and repeated upgrade preserve business/outbox; local transaction rollback',
    async () => {
      await assert.rejects(() =>
        store.create(
          { ...input, case_id: 'example-case-not-real-001' },
          template,
          async () => {
            throw new Error('Synthetic rollback');
          },
        ),
      );
      assert.equal(
        (await pool.query('SELECT count(*)::int n FROM example.cases')).rows[0]
          .n,
        0,
      );
      assert.equal((await store.status()).total, 0);
      const created = await store.create(
        {
          ...input,
          case_id: 'example-case-not-real-002',
          subjects: [input.subjects[0]],
        },
        template,
      );
      assert.equal(created.events.length, 1);
      assert.equal((await store.status()).pending, 1);
      await source.owner.query(
        await readFile(
          resolve(root, 'apps/example/migrations/001-outbox.sql'),
          'utf8',
        ),
      );
      assert.equal((await store.status()).total, 1);
      await until(async () => {
        await worker.tick();
        return (await store.status()).delivered === 1;
      });
    },
  );
  await gate(
    'Application cannot mutate payloads/delete data or access central archive',
    async () => {
      await assert.rejects(
        () => pool.query("UPDATE example.outbox SET payload='{}'"),
        (e) => e.code === '42501',
      );
      await assert.rejects(
        () => pool.query('DELETE FROM example.outbox'),
        (e) => e.code === '42501',
      );
      await assert.rejects(
        () => pool.query('DELETE FROM example.cases'),
        (e) => e.code === '42501',
      );
      const other = new pg.Pool({ ...source.database, database: 'logbook' });
      try {
        await assert.rejects(
          () => other.query('SELECT * FROM logbook.records'),
          (e) => ['42501', '28000'].includes(e.code),
        );
      } finally {
        await other.end();
      }
      await assert.rejects(
        () => source.owner.query("UPDATE example.outbox SET payload='{}'"),
        (e) => e.code === '55000',
      );
    },
  );
  await gate(
    'Commit contains all parent/child events and concurrent publishers claim once',
    async () => {
      const created = await store.create(
        { ...input, case_id: 'example-case-not-real-003' },
        template,
      );
      assert.equal(created.events.length, 3);
      const jobs = await Promise.all(
        Array.from({ length: 6 }, () => store.claim(10000)),
      );
      const claimed = jobs.filter(Boolean);
      assert.equal(claimed.length, 3);
      assert.equal(new Set(claimed.map((e) => e.id)).size, 3);
      for (const event of claimed) {
        const receipt = await transport.send(event);
        assert.ok(await store.delivered(event, receipt));
      }
      await until(
        async () =>
          (
            await reader.query(
              "SELECT count(*)::int n FROM logbook.records WHERE envelope->'payload'->>'trace_id'=$1 AND envelope->'payload'->'attributes'->>'dpl.pd.case_id'=$2",
              [created.trace_id, 'example-case-not-real-003'],
            )
          ).rows[0].n === 3,
      );
      const records = (
        await reader.query(
          "SELECT envelope FROM logbook.records WHERE envelope->'payload'->>'trace_id'=$1 AND envelope->'payload'->'attributes'->>'dpl.pd.case_id'=$2",
          [created.trace_id, 'example-case-not-real-003'],
        )
      ).rows.map((r) => r.envelope.payload);
      const parent = records.find(
        (r) => r.parent_span_id === input.traceparent.split('-')[2],
      );
      assert.ok(parent);
      const children = records.filter(
        (r) => r.parent_span_id === parent.span_id,
      );
      assert.equal(children.length, 2);
      assert.deepEqual(
        children.map((r) => r.attributes['dpl.core.data_subject_id']).sort(),
        [...input.subjects].sort(),
      );
      assert.equal(new Set(records.map((r) => r.span_id)).size, 3);
    },
  );
  await gate(
    'Unavailable ingest preserves business and events; restart drains full backlog',
    async () => {
      await store.create(
        { ...input, case_id: 'example-case-not-real-004' },
        template,
      );
      const unavailable = new Publisher(
        store,
        new IngestClient('https://127.0.0.1:1/v1/log-records', tls, 100),
        { baseMs: 100, capMs: 200 },
      );
      await unavailable.tick();
      const status = await store.status();
      assert.equal(status.pending, 3);
      assert.equal(status.blocked, 0);
      assert.equal(unavailable.metrics.retries, 1);
      child = fork(resolve(root, 'apps/example/dist/worker.js'), [configFile], {
        silent: true,
        windowsHide: true,
      });
      child.stdout.on('data', (part) => output.push(part.toString()));
      child.stderr.on('data', (part) => output.push(part.toString()));
      await Promise.race([
        once(child, 'message'),
        once(child, 'exit').then(() => {
          throw new Error('Source worker startup failed');
        }),
      ]);
      await until(async () => (await store.status()).pending === 0);
      const stopped = once(child, 'exit');
      child.send('stop');
      assert.equal((await stopped)[0], 0);
      assert.equal((await store.status()).delivered, 7);
    },
  );
  await gate(
    'Real publisher crash after HTTP acceptance recovers same key and one archive record',
    async () => {
      const created = await store.create(
        {
          ...input,
          case_id: 'example-case-not-real-005',
          subjects: [input.subjects[0]],
        },
        template,
      );
      async function run(scenario) {
        child = fork(
          resolve(root, 'scripts/outbox-test-worker.mjs'),
          [configFile, scenario],
          { silent: true, windowsHide: true },
        );
        child.stdout.on('data', (b) => output.push(b.toString()));
        child.stderr.on('data', (b) => output.push(b.toString()));
        const code = (await once(child, 'exit'))[0];
        if (code === 1) {
          const diagnostics =
            output
              .join('')
              .match(
                /\b(?:ERR_[A-Z_]+|[A-Z0-9]{5}|TypeError|SyntaxError)\b/g,
              ) ?? [];
          throw new Error(
            'Publisher worker failed: ' + [...new Set(diagnostics)].join(','),
          );
        }
        return code;
      }
      assert.equal(await run('crash'), 73);
      assert.equal((await store.status()).pending, 1);
      await until(
        async () =>
          (
            await reader.query(
              "SELECT count(*)::int n FROM logbook.records WHERE envelope->'payload'->>'trace_id'=$1 AND envelope->'payload'->'attributes'->>'dpl.pd.case_id'=$2",
              [created.trace_id, 'example-case-not-real-005'],
            )
          ).rows[0].n === 1,
      );
      await sleep(10100);
      assert.equal(await run('normal'), 0);
      const row = (
        await pool.query('SELECT * FROM example.outbox WHERE id=$1', [
          created.events[0],
        ])
      ).rows[0];
      assert.equal(row.state, 'delivered');
      assert.equal(row.attempts, 2);
      assert.equal(
        (
          await reader.query(
            'SELECT count(*)::int n FROM logbook.records WHERE event_id=$1',
            [row.receipt_event_id],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await ipool.query(
            'SELECT count(*)::int n FROM ingest.receipts WHERE idempotency_key=$1',
            [created.events[0]],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await gate(
    'Expired lease fences old owner and retry preserves identity',
    async () => {
      const created = await store.create(
        {
          ...input,
          case_id: 'example-case-not-real-006',
          subjects: [input.subjects[0]],
        },
        template,
      );
      const old = await store.claim(1000);
      await sleep(1100);
      const fresh = await store.claim(10000);
      assert.equal(fresh.id, created.events[0]);
      assert.notEqual(old.token, fresh.token);
      const receipt = await transport.send(fresh);
      assert.equal(await store.delivered(old, receipt), false);
      assert.equal(await store.delivered(fresh, receipt), true);
    },
  );
  await gate(
    'Permanent refusal stays blocked; explicit retry and invalid receipt never lose event',
    async () => {
      const created = await store.create(
        {
          ...input,
          case_id: 'example-case-not-real-008',
          subjects: [input.subjects[0]],
        },
        template,
      );
      let responseStatus = 403;
      const headers = [];
      mock = createServer(await ctx.tls('server'), (req, res) => {
        headers.push({
          key: req.headers['idempotency-key'],
          traceparent: req.headers.traceparent,
        });
        req.resume();
        res.writeHead(responseStatus, { 'content-type': 'application/json' });
        res.end('{}');
      });
      await new Promise((done) => mock.listen(0, '127.0.0.1', done));
      const mockClient = new IngestClient(
        `https://127.0.0.1:${mock.address().port}/v1/log-records`,
        tls,
      );
      const permanent = new Publisher(store, mockClient);
      await permanent.tick();
      assert.equal((await store.status()).blocked, 1);
      assert.ok(await store.requeue(created.events[0]));
      assert.equal(await store.requeue(created.events[0]), false);
      responseStatus = 202;
      const invalid = new Publisher(
        store,
        new IngestClient(
          `https://127.0.0.1:${mock.address().port}/v1/log-records`,
          tls,
        ),
        { baseMs: 100, capMs: 200 },
      );
      await invalid.tick();
      assert.equal(headers.length, 2);
      assert.equal(headers[0].key, created.events[0]);
      assert.deepEqual(headers[1], headers[0]);
      assert.equal(invalid.metrics.retries, 1);
      assert.equal((await store.status()).pending, 1);
      await until(async () => {
        await worker.tick();
        return (await store.status()).pending === 0;
      });
      assert.equal((await store.status()).blocked, 0);
    },
  );
  await gate(
    'All committed events archived once; metrics and errors contain no payload or credentials',
    async () => {
      const status = await store.status();
      assert.equal(status.total, status.delivered);
      assert.equal(status.leased, 0);
      await until(
        async () =>
          (await reader.query('SELECT count(*)::int n FROM logbook.records'))
            .rows[0].n === status.total,
      );
      const delivered = (
        await pool.query('SELECT receipt_event_id FROM example.outbox')
      ).rows.map((r) => r.receipt_event_id);
      assert.equal(new Set(delivered).size, status.total);
      const publicOutput =
        JSON.stringify({ metrics: worker.metrics, status }) + output.join('');
      for (const sensitive of [
        'example-subject',
        'BEGIN PRIVATE KEY',
        source.database.password,
        JSON.stringify(template),
      ])
        assert.ok(!publicOutput.includes(sensitive));
      const disconnected = new IngestClient(endpoint, {
        ...tls,
        ca: 'invalid',
      });
      await assert.rejects(
        () =>
          disconnected.send({
            id: randomUUID(),
            payload: template,
            traceparent: input.traceparent,
          }),
        (e) => e.code === 'TRANSPORT',
      );
    },
  );
} finally {
  if (child && child.exitCode === null) child.kill();
  if (mock) await new Promise((done) => mock.close(done));
  if (consumer) {
    await consumer.stop();
    await running;
  }
  if (app) await app.close();
  if (kafka) await kafka.close();
  for (const value of [pool, ipool, writer, reader, source?.owner, ctx?.owner])
    if (value) await value.end();
  if (ctx) ctx.compose(['down', '--volumes', '--remove-orphans']);
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  await writeFile(
    resolve(root, 'artifacts/outbox.json'),
    JSON.stringify({ results }, null, 2),
  );
}
