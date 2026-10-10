import { readFile } from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import pg from 'pg';
import { createApp } from './app.js';
import { ReceiptStore } from './store.js';
import { KafkaPublisher } from './producer.js';

async function main() {
  if (
    process.env.NODE_ENV === 'production' ||
    (process.env.LDV_ENV && process.env.LDV_ENV !== 'local')
  )
    throw new Error('Local mode required');
  const config = JSON.parse(await readFile(process.argv[2]!, 'utf8'));
  if (
    config.syntheticOnly !== true ||
    !/^[a-f0-9]{64}$/.test(config.controlToken)
  )
    throw new Error('Explicit local configuration required');
  const pool = new pg.Pool(config.database);
  pool.on('error', () => {});
  const publisher = new KafkaPublisher(config.kafka);
  const store = new ReceiptStore(pool, publisher);
  const app = createApp({ ...config, store });
  const close = async () => {
    await app.close();
    await publisher.close();
    await pool.end();
  };
  app.post('/local/stop', async (req, reply) => {
    const token = req.headers['x-local-control'];
    if (
      typeof token !== 'string' ||
      token.length !== config.controlToken.length ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(config.controlToken))
    )
      return reply.code(403).send({ code: 'FORBIDDEN' });
    reply.send({ status: 'stopping' });
    setImmediate(() => void close());
  });
  await store.ready();
  await app.listen({ host: '127.0.0.1', port: 18082 });
  process.on('SIGTERM', () => void close());
  process.on('SIGINT', () => void close());
  console.log('Local ingest ready on https://127.0.0.1:18082');
}
main().catch(() => {
  console.error(
    'Ingest startup failed; check local configuration and dependencies',
  );
  process.exitCode = 1;
});
