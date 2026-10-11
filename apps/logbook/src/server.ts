import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import pg from 'pg';
import { Archive } from './store.js';
import { LogConsumer } from './consumer.js';
async function main() {
  if (
    process.env.NODE_ENV === 'production' ||
    (process.env.LDV_ENV && process.env.LDV_ENV !== 'local')
  )
    throw new Error('Local mode required');
  const config = JSON.parse(await readFile(process.argv[2]!, 'utf8'));
  if (config.local !== true || !/^[a-f0-9]{64}$/.test(config.controlToken))
    throw new Error('Explicit local configuration required');
  const pool = new pg.Pool(config.database);
  pool.on('error', () => {});
  await pool.query('SELECT 1');
  const consumer = new LogConsumer(config.kafka, new Archive(pool));
  const running = consumer.run();
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    server.close();
    await consumer.stop();
    await running;
    await pool.end();
  };
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url === '/health') {
      res.end(JSON.stringify({ status: closing ? 'stopping' : 'running' }));
      return;
    }
    const token = req.headers['x-local-control'];
    if (
      typeof token !== 'string' ||
      !/^[a-f0-9]{64}$/.test(token) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(config.controlToken))
    ) {
      res.statusCode = 403;
      res.end('{"code":"FORBIDDEN"}');
      return;
    }
    if (req.method === 'GET' && req.url === '/metrics') {
      res.end(JSON.stringify(consumer.metrics));
      return;
    }
    if (req.method === 'POST' && req.url === '/stop') {
      res.end('{"status":"stopping"}');
      void shutdown();
      return;
    }
    res.statusCode = 404;
    res.end('{"code":"NOT_FOUND"}');
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(18083, '127.0.0.1', done);
  });
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}
main().catch(() => {
  console.error(
    'Logbook startup failed; check local dependencies and configuration',
  );
  process.exitCode = 1;
});
