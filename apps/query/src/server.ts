import { readFile, appendFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import { SearchClient } from './search-client.js';
import { Projector } from './projector.js';
import { QueryService } from './service.js';
import { RegisterClient } from './register-client.js';
import { createApp } from './app.js';
async function main() {
  if (
    process.env.NODE_ENV === 'production' ||
    (process.env.LDV_ENV && process.env.LDV_ENV !== 'local')
  )
    throw new Error('Local mode required');
  const config = JSON.parse(await readFile(process.argv[2]!, 'utf8'));
  if (config.local !== true || !/^[a-f0-9]{64}$/.test(config.controlToken))
    throw new Error('Local configuration required');
  const queryPool = new pg.Pool(config.query.database),
    projectorPool = new pg.Pool(config.projector.database);
  queryPool.on('error', () => {});
  projectorPool.on('error', () => {});
  const projector = new Projector(
    projectorPool,
    new SearchClient(config.projector.search),
  );
  const service = new QueryService(
    queryPool,
    new SearchClient(config.query.search),
    new RegisterClient(config.register),
    config.cursorKey,
  );
  const app = createApp({
    tls: config.query.tls,
    scopes: config.scopes,
    service,
    audit: async (event) => {
      await appendFile(
        config.auditFile,
        JSON.stringify({
          at: new Date().toISOString(),
          stream: 'query-audit',
          ...event,
        }) + '\n',
        { mode: 0o600 },
      );
    },
  });
  await app.listen({ host: '127.0.0.1', port: 18084 });
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      try {
        await projector.sync();
      } catch {
        /* Counted by projector; originals remain durable. */
      }
      if (!stopped) await sleep(2000);
    }
  })();
  const control = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
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
      res.end(JSON.stringify(projector.snapshot()));
      return;
    }
    if (req.method === 'POST' && req.url === '/rebuild') {
      try {
        const done = await projector.sync(true);
        res.statusCode = done ? 200 : 409;
        res.end(JSON.stringify({ rebuilt: done }));
      } catch {
        res.statusCode = 503;
        res.end('{"code":"UNAVAILABLE"}');
      }
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
    control.once('error', reject);
    control.listen(18085, '127.0.0.1', done);
  });
  async function shutdown() {
    if (stopped) return;
    stopped = true;
    control.close();
    await app.close();
    await loop;
    await queryPool.end();
    await projectorPool.end();
  }
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}
main().catch(() => {
  console.error(
    'Query startup failed; check local configuration and dependencies',
  );
  process.exitCode = 1;
});
