import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { prepareIngest, root } from './ingest-infra.mjs';
import { prepareSource } from './outbox-infra.mjs';
import { SourceStore } from '../apps/example/dist/store.js';
import {
  Publisher,
  IngestClient,
} from '../packages/ldv-publisher/dist/index.js';
import { worker } from '../apps/example/dist/worker.js';
import { npm } from './process.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
const runtimeFile = resolve(root, '.local/ldv-ingest-dev/source-runtime.json');
let stage = 'CONFIG';
async function main() {
  const mode = process.argv[2];
  if (
    process.env.NODE_ENV === 'production' ||
    (process.env.LDV_ENV && !['local', 'test'].includes(process.env.LDV_ENV))
  )
    throw new Error('LOCAL_DEMO_REQUIRED');
  if (mode === 'worker') {
    const config = JSON.parse(await readFile(runtimeFile, 'utf8'));
    const { pool, store, publisher } = worker(config);
    const abort = new AbortController();
    process.once('SIGINT', () => abort.abort());
    process.once('SIGTERM', () => abort.abort());
    await pool.query('SELECT 1');
    console.log('Source worker ready; metrics contain counters only.');
    const timer = setInterval(async () => {
      try {
        console.log(
          JSON.stringify({
            health: 'ready',
            metrics: publisher.metrics,
            status: await store.status(),
          }),
        );
      } catch {
        console.log(JSON.stringify({ health: 'unavailable' }));
      }
    }, 5000);
    timer.unref();
    try {
      await publisher.run(abort.signal);
    } finally {
      clearInterval(timer);
      await pool.end();
    }
    return;
  }
  if (mode === 'status' || mode === 'requeue') {
    const config = JSON.parse(await readFile(runtimeFile, 'utf8'));
    const pool = new pg.Pool(config.database);
    pool.on('error', () => {});
    try {
      const store = new SourceStore(pool);
      if (mode === 'requeue') {
        const id = process.argv[3];
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            id ?? '',
          )
        )
          throw new Error('UUID_REQUIRED');
        console.log(JSON.stringify({ requeued: await store.requeue(id) }));
      }
      console.log(
        JSON.stringify({ health: 'ready', status: await store.status() }),
      );
    } finally {
      await pool.end();
    }
    return;
  }
  if (mode !== 'demo') throw new Error('UNKNOWN_COMMAND');
  npm(['run', 'logbook:up'], { stdio: 'inherit', timeout: 300000 });
  stage = 'SOURCE_INFRA';
  const ctx = await prepareIngest();
  let source, pool;
  try {
    source = await prepareSource(ctx);
    pool = new pg.Pool(source.database);
    pool.on('error', () => {});
    const store = new SourceStore(pool);
    const config = {
      database: {
        ...source.database,
        ssl: { ...source.database.ssl, key: source.database.ssl.key },
      },
      ingest: {
        url: 'https://127.0.0.1:18082/v1/log-records',
        tls: await ctx.tls('source'),
      },
    };
    await writeFile(runtimeFile, JSON.stringify(config), { mode: 0o600 });
    const template = JSON.parse(
      await readFile(
        resolve(root, 'contracts/examples/valid-ldv-log-record.json'),
        'utf8',
      ),
    );
    const fixture = JSON.parse(
      await readFile(
        resolve(root, 'contracts/examples/valid-example-case.json'),
        'utf8',
      ),
    );
    const one = {
      ...fixture,
      case_id: 'example-case-not-real-009',
      subjects: fixture.subjects.slice(0, 1),
    };
    delete one.traceparent;
    const inputs = [one, { ...fixture, case_id: 'example-case-not-real-010' }];
    const demonstrations = [];
    stage = 'CREATE_CASES';
    for (const input of inputs) {
      const existing = (
        await pool.query(
          'SELECT id,trace_id FROM example.cases WHERE case_id=$1',
          [input.case_id],
        )
      ).rows[0];
      const created = existing ?? (await store.create(input, template));
      demonstrations.push({
        case_id: input.case_id,
        trace_id: created.trace_id,
        subjectCount: input.subjects.length,
      });
    }
    const publisher = new Publisher(
      store,
      new IngestClient(config.ingest.url, config.ingest.tls),
    );
    const deadline = Date.now() + 45000;
    stage = 'DELIVERY';
    while ((await store.status()).pending > 0 && Date.now() < deadline) {
      await publisher.tick();
      await sleep(100);
    }
    const status = await store.status();
    if (status.pending || status.blocked)
      throw new Error('BACKLOG_NOT_DRAINED');
    const readerConfig = JSON.parse(
      await readFile(resolve(ctx.directory, 'logbook-operations.json'), 'utf8'),
    );
    const reader = new pg.Pool(readerConfig.reader);
    stage = 'ARCHIVE_PROOF';
    reader.on('error', () => {});
    try {
      for (const demo of demonstrations) {
        const expected = demo.subjectCount === 1 ? 1 : demo.subjectCount + 1;
        let count = 0;
        for (let attempt = 0; attempt < 100; attempt++) {
          count = (
            await reader.query(
              "SELECT count(*)::int n FROM logbook.records WHERE envelope->'payload'->>'trace_id'=$1 AND envelope->'payload'->'attributes'->>'dpl.pd.case_id'=$2",
              [demo.trace_id, demo.case_id],
            )
          ).rows[0].n;
          if (count === expected) break;
          await sleep(200);
        }
        if (count !== expected) throw new Error('ARCHIVE_NOT_CAUGHT_UP');
        demo.archived = count;
      }
    } finally {
      await reader.end();
    }
    await mkdir(resolve(root, 'artifacts'), { recursive: true });
    const evidence = { status, metrics: publisher.metrics, demonstrations };
    await writeFile(
      resolve(root, 'artifacts/outbox-demo.json'),
      JSON.stringify(evidence, null, 2),
    );
    console.log(JSON.stringify(evidence));
  } finally {
    if (pool) await pool.end();
    if (source) await source.owner.end();
    await ctx.owner.end();
  }
}
main().catch((error) => {
  const candidate = error.code ?? error.message ?? '';
  const code = /^[A-Z0-9_]+$/.test(candidate) ? candidate : 'UNCLASSIFIED';
  console.error(
    `SOURCE_COMMAND_UNAVAILABLE (${stage}/${code}): inspect local readiness and outbox status; no payloads or credentials are printed.`,
  );
  process.exitCode = 1;
});
