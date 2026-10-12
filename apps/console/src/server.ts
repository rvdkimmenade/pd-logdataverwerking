import { readFile } from 'node:fs/promises';
import { request } from 'node:https';
import type { ConnectionOptions } from 'node:tls';
import pg from 'pg';
import { createApp } from './app.js';
import { Sessions, type Identity } from './auth.js';
import { Operations } from './operations.js';
import type { ConsumerOptions } from '@platformatic/kafka';

async function main() {
  const config = JSON.parse(await readFile(process.argv[2]!, 'utf8')) as {
    mode: string;
    origin: string;
    tls: ConnectionOptions;
    oidc: { issuer: string; clientId: string; secret: string; ca: string };
    identities: Record<string, Identity>;
    database: pg.PoolConfig;
    operations: {
      kafka: ConsumerOptions<Buffer, Buffer, Buffer, Buffer>;
      projectorControl: string;
    };
    backends: Record<
      string,
      {
        port: number;
        tls: ConnectionOptions;
        party: string;
        applications: string[];
      }
    >;
  };
  if (
    config.mode !== 'local-demo' ||
    process.env.NODE_ENV === 'production' ||
    (process.env.LDV_ENV && process.env.LDV_ENV !== 'local') ||
    config.database.host !== '127.0.0.1' ||
    config.database.user !== 'register_app' ||
    !config.tls.cert ||
    !config.tls.key ||
    config.tls.rejectUnauthorized === false
  )
    throw new Error('LOCAL_CONFIGURATION_REQUIRED');
  for (const actor of Object.values(config.identities)) {
    const backend = config.backends[actor.backend];
    if (
      !backend ||
      backend.party !== actor.party ||
      actor.applications.length !== backend.applications.length ||
      actor.applications.some((a) => !backend.applications.includes(a)) ||
      !backend.tls.ca ||
      !backend.tls.cert ||
      !backend.tls.key ||
      backend.tls.rejectUnauthorized === false
    )
      throw new Error('SCOPE_MAPPING_REQUIRED');
  }
  const sessions = await Sessions.create(
    config.oidc.issuer,
    config.oidc.clientId,
    config.oidc.secret,
    config.origin,
    config.identities,
    config.oidc.ca,
  );
  const pool = new pg.Pool({
    ...config.database,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
  });
  pool.on('error', () => console.error('Console database unavailable'));
  const operations = new Operations(config.operations.kafka, async () => {
    const response = await fetch('http://127.0.0.1:18085/metrics', {
      headers: { 'x-local-control': config.operations.projectorControl },
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error('Projector unavailable');
    return response.json();
  });
  const observing = operations.run();
  const app = await createApp({
    pool,
    origin: config.origin,
    tls: config.tls,
    sessions,
    operations: () => operations.snapshot(),
    audit: async (actor, action) => {
      await pool.query(
        'INSERT INTO register.audit(party,actor,action) VALUES($1,$2,$3)',
        [actor.party, actor.id, 'console.' + action],
      );
    },
    query: async (actor, path, body) => {
      const backend = config.backends[actor.backend]!;
      return new Promise((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port: backend.port,
            path,
            method: body === undefined ? 'GET' : 'POST',
            ...backend.tls,
            rejectUnauthorized: true,
            headers: { 'content-type': 'application/json' },
          },
          (res) => {
            let text = '';
            res.on('data', (chunk) => {
              text += chunk;
              if (text.length > 16000000)
                req.destroy(new Error('Backend response too large'));
            });
            res.on('error', () => reject(new Error('Backend unavailable')));
            res.on('end', () => {
              try {
                resolve({
                  status: res.statusCode ?? 503,
                  body: JSON.parse(text),
                });
              } catch {
                reject(new Error('Invalid backend response'));
              }
            });
          },
        );
        const timer = setTimeout(
          () => req.destroy(new Error('Backend timed out')),
          15000,
        );
        req.on('close', () => clearTimeout(timer));
        req.on('error', () => reject(new Error('Backend unavailable')));
        req.end(body === undefined ? undefined : JSON.stringify(body));
      });
    },
  });
  await pool.query('SELECT 1');
  await app.listen({
    host: '127.0.0.1',
    port: Number(new URL(config.origin).port),
  });
  const stop = () => {
    void app.close().then(async () => {
      await operations.close();
      await observing;
      await pool.end();
    });
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  console.log(`Local console ready: ${config.origin}`);
}
main().catch(() => {
  console.error(
    'Console startup failed; check local configuration and dependencies.',
  );
  process.exitCode = 1;
});
