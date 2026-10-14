import { readFileSync } from 'node:fs';
import pg from 'pg';
import { IngestClient, Publisher } from '@ldv/publisher';
import { SourceStore } from './store.js';
export function worker(config: {
  database: pg.PoolConfig;
  ingest: { url: string; tls: import('node:tls').ConnectionOptions };
}) {
  if (
    process.env.NODE_ENV === 'production' ||
    !config.database.ssl ||
    !['127.0.0.1', 'localhost'].includes(config.database.host ?? '') ||
    config.database.database !== 'source' ||
    !(config.database.ssl as import('node:tls').ConnectionOptions).ca ||
    !(config.database.ssl as import('node:tls').ConnectionOptions).cert ||
    !(config.database.ssl as import('node:tls').ConnectionOptions).key ||
    (config.database.ssl as { rejectUnauthorized?: boolean })
      .rejectUnauthorized === false ||
    !['127.0.0.1', 'localhost'].includes(new URL(config.ingest.url).hostname)
  )
    throw new Error('LOCAL_DEMO_REQUIRED');
  const pool = new pg.Pool(config.database);
  pool.on('error', () => {});
  const store = new SourceStore(pool);
  return {
    pool,
    store,
    publisher: new Publisher(
      store,
      new IngestClient(config.ingest.url, config.ingest.tls),
    ),
  };
}
if (process.argv[1]?.endsWith('worker.js')) {
  try {
    const config = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
    const { pool, publisher, store } = worker(config);
    const abort = new AbortController();
    process.once('SIGTERM', () => abort.abort());
    process.once('SIGINT', () => abort.abort());
    await pool.query('SELECT 1');
    process.send?.({ ready: true });
    process.on('message', (message) => {
      if (message === 'stop') abort.abort();
    });
    const timer = setInterval(async () => {
      try {
        process.send?.({
          metrics: publisher.metrics,
          status: await store.status(),
        });
      } catch {
        process.send?.({ health: 'unavailable' });
      }
    }, 1000);
    timer.unref();
    await publisher.run(abort.signal);
    clearInterval(timer);
    await pool.end();
    if (process.connected) process.disconnect();
  } catch {
    console.error('SOURCE_WORKER_UNAVAILABLE');
    process.exitCode = 1;
  }
}
