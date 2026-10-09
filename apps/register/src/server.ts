import { readFileSync } from 'node:fs';
import pg from 'pg';
import { createApp, type DemoAccount } from './app.js';

export function readSettings(path: string) {
  const config = JSON.parse(readFileSync(path, 'utf8')) as {
    mode: string;
    origin: string;
    database: {
      host: string;
      port: number;
      database: string;
      user: string;
      password: string;
    };
    accounts: DemoAccount[];
    control: string;
  };
  if (
    config.mode !== 'local-demo' ||
    process.env.NODE_ENV === 'production' ||
    (process.env.LDV_ENV && process.env.LDV_ENV !== 'local') ||
    !/^http:\/\/127\.0\.0\.1:\d+$/.test(config.origin) ||
    config.database.host !== '127.0.0.1' ||
    config.database.user !== 'register_app' ||
    !/^[0-9a-f]{64}$/.test(config.control) ||
    !config.accounts.length ||
    config.accounts.some(
      (a) =>
        !['editor', 'reviewer', 'reader'].includes(a.actor.role) ||
        !/^[0-9a-f]{64}$/.test(a.code),
    )
  )
    throw new Error('LOCAL_DEMO_CONFIGURATION_REQUIRED');
  return config;
}
async function start() {
  const config = readSettings(process.argv[2]!);
  const pool = new pg.Pool({
    ...config.database,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
  });
  pool.on('error', () => {
    console.error('Register database connection unavailable');
  });
  const app = createApp({
    pool,
    accounts: config.accounts,
    origin: config.origin,
  });
  app.post('/internal/shutdown', async (request, reply) => {
    if (request.headers['x-control'] !== config.control)
      return reply.code(403).send({ code: 'FORBIDDEN' });
    setTimeout(() => {
      void app.close().then(() => pool.end());
    }, 100);
    return { ok: true };
  });
  await pool.query('SELECT 1');
  await app.listen({
    host: '127.0.0.1',
    port: Number(new URL(config.origin).port),
  });
  const stop = () => {
    void app.close().then(() => pool.end());
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  console.log(`Local register ready: ${config.origin}`);
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/server.js'))
  start().catch(() => {
    console.error(
      'Register startup failed; check local configuration and database readiness.',
    );
    process.exitCode = 1;
  });
