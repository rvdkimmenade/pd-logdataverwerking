import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { Producer, stringSerializers } from '@platformatic/kafka';
import { prepareIngest, root } from './ingest-infra.mjs';
import { prepareLogbook } from './logbook-infra.mjs';
import { prepareQuery } from './query-infra.mjs';
import { prepareDatabase, migrate, runtimePool } from './register-db.mjs';
import { createApp as registerApp } from '../apps/register/dist/app.js';
import { Store } from '../apps/register/dist/store.js';
import { Archive } from '../apps/logbook/dist/store.js';
import { LogConsumer } from '../apps/logbook/dist/consumer.js';
import { SearchClient } from '../apps/query/dist/search-client.js';
import { Projector, alias } from '../apps/query/dist/projector.js';
import { QueryService } from '../apps/query/dist/service.js';
import { RegisterClient } from '../apps/query/dist/register-client.js';
import { createApp } from '../apps/query/dist/app.js';
import { validatePage, validateItem } from '../apps/query/dist/validation.js';
import { queryRequest } from './query-local.mjs';

const results = [],
  audit = [],
  performance = {};
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
async function until(check, ms = 30000) {
  const end = Date.now() + ms;
  do {
    if (await check()) return;
    await sleep(250);
  } while (Date.now() < end);
  throw new Error('Condition timeout');
}
let ctx,
  archive,
  infra,
  regctx,
  runtime,
  reg,
  app,
  reader,
  writer,
  projectorPool,
  consumer,
  running,
  producer;
const fixture = JSON.parse(
  await readFile(
    resolve(root, 'contracts/examples/valid-log-event.json'),
    'utf8',
  ),
);
const draft = JSON.parse(
  await readFile(
    resolve(root, 'contracts/examples/valid-register-draft.json'),
    'utf8',
  ),
);
const events = [];
try {
  await gate('Geïsoleerde mTLS-zoekomgeving en register starten', async () => {
    ctx = await prepareIngest(true);
    archive = await prepareLogbook(ctx);
    infra = await prepareQuery(ctx, archive, true);
    regctx = await prepareDatabase(true);
    await migrate(regctx.owner);
    runtime = await runtimePool(regctx);
    const socket = createServer();
    await new Promise((r) => socket.listen(0, '127.0.0.1', r));
    const port = socket.address().port;
    await new Promise((r) => socket.close(r));
    const accounts = ['editor', 'reviewer', 'reader'].map((role) => ({
      code: randomBytes(32).toString('hex'),
      actor: { id: `test-${role}`, role, party: fixture.responsible_party },
    }));
    accounts.push({
      code: randomBytes(32).toString('hex'),
      actor: { id: 'test-other-reader', role: 'reader', party: 'other-party' },
    });
    reg = registerApp({
      pool: runtime.pool,
      origin: `http://127.0.0.1:${port}`,
      accounts,
    });
    await reg.listen({ host: '127.0.0.1', port });
    const store = new Store(runtime.pool);
    const first = await store.create(accounts[0].actor, {
      ...draft,
      valid_from: '2026-01-01T00:00:00Z',
      valid_until: '2026-07-01T00:00:00Z',
    });
    await store.change(accounts[1].actor, first.id, 1, 1);
    await store.next(accounts[0].actor, first.id, {
      ...draft,
      content: { ...draft.content, name: 'Synthetische opvolger' },
      valid_from: '2026-07-01T00:00:00Z',
      valid_until: '2027-01-01T00:00:00Z',
    });
    await store.change(accounts[1].actor, first.id, 2, 1);
    fixture.payload.attributes['dpl.core.processing_activity_id'] =
      first.processing_activity_id;
    writer = new pg.Pool(archive.config.database);
    writer.on('error', () => {});
    reader = new pg.Pool(infra.query.database);
    reader.on('error', () => {});
    projectorPool = new pg.Pool(infra.projector.database);
    projectorPool.on('error', () => {});
    const service = new QueryService(
      reader,
      new SearchClient(infra.query.search),
      new RegisterClient({
        origin: `http://127.0.0.1:${port}`,
        readers: {
          [fixture.responsible_party]: accounts[2].code,
          'other-party': accounts[3].code,
        },
      }),
      randomBytes(32).toString('hex'),
    );
    const scope = {
      id: 'synthetic-auditor',
      party: fixture.responsible_party,
      applications: [fixture.source_application],
      read: true,
    };
    app = createApp({
      tls: infra.query.tls,
      service,
      scopes: {
        [await ctx.fingerprint('auditor')]: scope,
        [await ctx.fingerprint('auditor-other')]: {
          ...scope,
          id: 'other-party',
          party: 'other-party',
        },
        [await ctx.fingerprint('auditor-app')]: {
          ...scope,
          id: 'other-app',
          applications: ['other-app'],
        },
        [await ctx.fingerprint('denied')]: { ...scope, read: false },
      },
      audit: async (e) => {
        audit.push(e);
      },
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
  });
  const tls = await ctx.tls('auditor'),
    port = app.server.address().port;
  const request = (path, body, cert = tls) =>
    queryRequest(cert, path, body, port);
  const projector = new Projector(
    projectorPool,
    new SearchClient(infra.projector.search),
  );
  const archiveStore = new Archive(writer);
  async function save(event) {
    await archiveStore.save(event, Buffer.from(JSON.stringify(event)), {
      topic: 'ldv.accepted.v1',
      partition: 0,
      offset: '0',
    });
  }
  await gate(
    '1000 synthetische archiefrecords projecteren zonder payloadkopie',
    async () => {
      for (let i = 0; i < 1000; i++) {
        const event = structuredClone(fixture);
        event.event_id = randomUUID();
        event.payload.start_time =
          Date.parse(
            i === 0 ? '2026-06-30T23:59:59Z' : '2026-07-01T00:00:00Z',
          ) + i;
        event.payload.end_time = event.payload.start_time + 1;
        event.payload.span_id = (i + 1).toString(16).padStart(16, '0');
        if (i === 998) event.responsible_party = 'other-party';
        if (i === 999) event.source_application = 'other-app';
        events.push(event);
        await save(event);
      }
      await projector.sync();
      assert.equal(projector.metrics.projected, 1000);
      const projected = await infra.admin.call(
        'GET',
        `/${alias}/_search?size=1`,
      );
      assert.equal(projected.hits.hits[0]._source.envelope, undefined);
      assert.equal(projected.hits.hits[0]._source.original, undefined);
    },
  );
  await gate(
    'Querycontract, filters, origineel en historische grensversies',
    async () => {
      const page = await request('/v1/log-records/search', { limit: 2 });
      assert.equal(page.status, 200);
      assert.ok(validatePage(page.body));
      assert.equal(page.body.items[0].processing_activity.version, 1);
      assert.equal(page.body.items[1].processing_activity.version, 2);
      for (const item of page.body.items) {
        assert.deepEqual(
          JSON.parse(Buffer.from(item.original_base64, 'base64')),
          item.envelope,
        );
      }
      for (const filter of [
        { event_id: events[5].event_id },
        { span_id: events[5].payload.span_id },
        {
          from: events[5].payload.start_time,
          until: events[5].payload.start_time + 1,
        },
      ]) {
        const result = await request('/v1/log-records/search', filter);
        assert.equal(result.status, 200);
        assert.equal(result.body.items.length, 1);
        assert.equal(result.body.items[0].event_id, events[5].event_id);
      }
      const result = await request('/v1/log-records/search', {
        processing_activity_id:
          fixture.payload.attributes['dpl.core.processing_activity_id'],
        source_application: fixture.source_application,
        subject_id: fixture.payload.attributes['dpl.core.data_subject_id'],
        limit: 3,
      });
      assert.equal(result.body.items.length, 3);
      const missing = await request('/v1/log-records/search', {
        subject_id: 'synthetic-not-present',
      });
      assert.deepEqual(missing.body.items, []);
      const detail = await request(`/v1/log-records/${events[0].event_id}`);
      assert.equal(detail.status, 200);
      assert.ok(validateItem(detail.body));
    },
  );
  await gate(
    'mTLS, rollen en partij/applicatie-isolatie vóór resultaten',
    async () => {
      await assert.rejects(
        request('/v1/log-records/search', {}, { ca: tls.ca }),
      );
      await assert.rejects(
        request('/v1/log-records/search', {}, await ctx.tls('rogue')),
      );
      for (const cert of ['unknown', 'denied'])
        assert.equal(
          (await request('/v1/log-records/search', {}, await ctx.tls(cert)))
            .status,
          403,
        );
      for (const cert of ['auditor-other', 'auditor-app']) {
        const result = await request(
          '/v1/log-records/search',
          {},
          await ctx.tls(cert),
        );
        assert.equal(result.status, 200);
        assert.equal(result.body.items.length, 1);
        assert.equal(
          (
            await request(
              `/v1/log-records/${events[0].event_id}`,
              undefined,
              await ctx.tls(cert),
            )
          ).status,
          404,
        );
      }
      assert.equal(
        (
          await request('/v1/log-records/search', {
            source_application: 'other-app',
          })
        ).status,
        403,
      );
      assert.equal(
        (await request(`/v1/log-records/${events[998].event_id}`)).status,
        404,
      );
      assert.equal(
        (
          await request('/v1/log-records/search', {
            responsible_party: 'other-party',
          })
        ).status,
        400,
      );
    },
  );
  await gate(
    'Stabiele keysetpagina, gebonden cursor en ongeldige invoer',
    async () => {
      const first = (await request('/v1/log-records/search', { limit: 2 }))
        .body;
      const second = await request('/v1/log-records/search', {
        limit: 2,
        cursor: first.next_cursor,
      });
      assert.equal(second.status, 200);
      assert.equal(
        new Set([...first.items, ...second.body.items].map((x) => x.event_id))
          .size,
        4,
      );
      for (const filters of [
        { limit: 3, cursor: first.next_cursor },
        { limit: 2, cursor: first.next_cursor + 'x' },
        { limit: 2, cursor: first.next_cursor, subject_id: 'changed' },
        { from: 10, until: 1 },
        { limit: 101 },
        { unknown: true },
      ])
        assert.equal(
          (await request('/v1/log-records/search', filters)).status,
          400,
        );
      assert.equal(
        (
          await request(
            '/v1/log-records/search',
            { limit: 2, cursor: first.next_cursor },
            await ctx.tls('auditor-other'),
          )
        ).status,
        400,
      );
      assert.equal((await request('/v1/traces/invalid', {})).status, 400);
    },
  );
  await gate('Indexverlies en volledige deterministische rebuild', async () => {
    const original = await infra.admin.call('POST', `/${alias}/_search`, {
      size: 1100,
      sort: [{ event_id: 'asc' }],
    });
    const indices = Object.keys(
      await infra.admin.call('GET', `/_alias/${alias}`),
    );
    for (const index of indices) await infra.admin.call('DELETE', `/${index}`);
    assert.equal((await request('/v1/log-records/search', {})).status, 503);
    assert.equal(
      (await request(`/v1/log-records/${events[0].event_id}`)).status,
      200,
    );
    await projector.sync(true);
    const rebuilt = await infra.admin.call('POST', `/${alias}/_search`, {
      size: 1100,
      sort: [{ event_id: 'asc' }],
    });
    assert.deepEqual(
      rebuilt.hits.hits.map((h) => h._source),
      original.hits.hits.map((h) => h._source),
    );
    assert.equal(rebuilt.hits.hits.length, 1000);
    const names = Object.keys(
      await infra.admin.call('GET', `/_alias/${alias}`),
    );
    await projector.sync(true);
    assert.notDeepEqual(
      Object.keys(await infra.admin.call('GET', `/_alias/${alias}`)),
      names,
    );
  });
  await gate(
    'Mislukte rebuild behoudt alias en advisory lock sluit concurrentie uit',
    async () => {
      const before = await infra.admin.call('GET', `/_alias/${alias}`);
      const client = new SearchClient(infra.projector.search);
      const call = client.call.bind(client);
      client.call = (method, path, ...args) =>
        path === '/_bulk'
          ? Promise.resolve({ errors: true })
          : call(method, path, ...args);
      const failed = new Projector(projectorPool, client);
      await assert.rejects(failed.sync(true));
      assert.deepEqual(
        await infra.admin.call('GET', `/_alias/${alias}`),
        before,
      );
      assert.equal(
        (await request('/v1/log-records/search', { limit: 1 })).status,
        200,
      );
      const lock = await reader.connect();
      try {
        await lock.query('SELECT pg_advisory_lock(20261011)');
        assert.equal(await projector.sync(true), false);
      } finally {
        await lock.query('SELECT pg_advisory_unlock(20261011)');
        lock.release();
      }
    },
  );
  await gate(
    'OpenSearch-uitval blokkeert Kafka→archief niet; herstel haalt in',
    async () => {
      consumer = new LogConsumer(archive.config.kafka, archiveStore);
      running = consumer.run();
      producer = new Producer({
        ...ctx.kafka,
        tls: await ctx.tls('admin'),
        serializers: stringSerializers,
        acks: -1,
        idempotent: true,
      });
      infra.compose(['stop', 'opensearch']);
      await assert.rejects(projector.sync());
      assert.equal((await request('/v1/log-records/search', {})).status, 503);
      const event = structuredClone(events[5]);
      event.event_id = '00000000-0000-0000-0000-000000000000';
      await producer.send({
        messages: [
          {
            topic: 'ldv.accepted.v1',
            key: 'synthetic',
            value: JSON.stringify(event),
          },
        ],
      });
      await until(
        async () =>
          !!(
            await reader.query(
              'SELECT 1 FROM logbook.records WHERE event_id=$1',
              [event.event_id],
            )
          ).rowCount,
      );
      assert.equal(
        (await request(`/v1/log-records/${event.event_id}`)).status,
        200,
      );
      infra.compose(['up', '--detach']);
      await until(async () => {
        try {
          const health = await infra.admin.call(
            'GET',
            '/_cluster/health?wait_for_status=yellow&timeout=2s',
          );
          return (
            !health.timed_out && ['yellow', 'green'].includes(health.status)
          );
        } catch {
          return false;
        }
      }, 90000);
      const started = Date.now();
      await projector.sync();
      performance.recoveryMs = Date.now() - started;
      assert.ok(performance.recoveryMs < 30000);
      assert.equal(
        (await request('/v1/log-records/search', { event_id: event.event_id }))
          .body.items.length,
        1,
      );
    },
  );
  await gate(
    'Leesrollen weigeren writes en onbekende OpenSearch-identiteit',
    async () => {
      for (const pool of [reader, projectorPool])
        await assert.rejects(pool.query('DELETE FROM logbook.records'));
      await assert.rejects(
        new SearchClient(infra.query.search).call('DELETE', `/${alias}`),
        (e) => e.status === 403,
      );
      await assert.rejects(
        new SearchClient({
          port: infra.port,
          tls: await ctx.tls('unknown'),
        }).call('POST', `/${alias}/_search`, {}),
      );
    },
  );
  await gate(
    'POC p95 ≤ 2000ms voor 30 zoek-/tracequeries over 1000 records',
    async () => {
      const samples = [];
      for (let i = 0; i < 33; i++) {
        const started = Date.now();
        const response = await request(
          i % 2
            ? `/v1/traces/${fixture.payload.trace_id}`
            : '/v1/log-records/search',
          { limit: 25 },
        );
        assert.equal(response.status, 200);
        assert.ok(validatePage(response.body));
        if (i >= 3) samples.push(Date.now() - started);
      }
      samples.sort((a, b) => a - b);
      performance.samples = 30;
      performance.p95Ms = samples[Math.ceil(samples.length * 0.95) - 1];
      assert.ok(performance.p95Ms <= 2000);
    },
  );
  await gate(
    'Registeruitval geeft 503, metrics en audit bevatten geen zoekwaarden',
    async () => {
      const technical = JSON.stringify({
        audit,
        metrics: projector.snapshot(),
      });
      for (const marker of [
        'example-subject',
        'PRIVATE KEY',
        infra.query.database.password,
      ])
        assert.ok(!technical.includes(marker));
      assert.ok(audit.some((e) => e.operation === 'trace'));
      assert.ok(projector.metrics.rebuilds >= 2);
      assert.ok(projector.metrics.failures >= 1);
      await reg.close();
      assert.equal(
        (await request(`/v1/log-records/${events[0].event_id}`)).status,
        503,
      );
    },
  );
} finally {
  await consumer?.stop();
  await running;
  await producer?.close();
  await app?.close();
  await reg?.close();
  await reader?.end();
  await writer?.end();
  await projectorPool?.end();
  await runtime?.pool.end();
  await regctx?.owner.end();
  await archive?.owner.end();
  await ctx?.owner.end();
  infra?.compose(['down', '--volumes', '--remove-orphans']);
  regctx?.compose(['down', '--volumes', '--remove-orphans']);
  ctx?.compose(['down', '--volumes', '--remove-orphans']);
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  await writeFile(
    resolve(root, 'artifacts/query.json'),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), results, performance },
      null,
      2,
    ),
  );
}
