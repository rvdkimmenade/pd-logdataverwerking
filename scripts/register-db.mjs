import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';
import { command } from './process.mjs';

export const root = resolve(import.meta.dirname, '..');
export async function migrate(pool, limit = 2) {
  const db = await pool.connect();
  try {
    await db.query('SELECT pg_advisory_lock(20261008)');
    await db.query(
      'CREATE TABLE IF NOT EXISTS public.register_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const [index, file] of [
      '001-register.sql',
      '002-audit-protection.sql',
    ].entries()) {
      const number = index + 1;
      if (number > limit) break;
      if (
        (
          await db.query(
            'SELECT 1 FROM public.register_migrations WHERE version=$1',
            [number],
          )
        ).rowCount
      )
        continue;
      await db.query('BEGIN');
      try {
        await db.query(
          await readFile(
            resolve(root, 'apps/register/migrations', file),
            'utf8',
          ),
        );
        await db.query(
          'INSERT INTO public.register_migrations(version) VALUES($1)',
          [number],
        );
        await db.query('COMMIT');
      } catch (error) {
        await db.query('ROLLBACK');
        throw error;
      }
    }
  } finally {
    await db.query('SELECT pg_advisory_unlock(20261008)');
    db.release();
  }
}
export async function prepareDatabase(test = false) {
  if (
    process.env.NODE_ENV === 'production' ||
    (process.env.LDV_ENV && !['local', 'test'].includes(process.env.LDV_ENV))
  )
    throw new Error('Local mode required');
  const project = test
    ? `ldv-register-test-${randomUUID()}`
    : 'ldv-register-dev';
  const directory = resolve(root, '.local', project);
  await mkdir(directory, { recursive: true });
  const secret = resolve(directory, 'owner-password');
  try {
    await writeFile(secret, randomBytes(32).toString('hex'), {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  const password = await readFile(secret, 'utf8');
  if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('Invalid local secret');
  const env = {
    ...process.env,
    REGISTER_DB_PORT: test ? '0' : '15433',
    REGISTER_OWNER_PASSWORD_FILE: secret.replaceAll('\\', '/'),
  };
  const compose = (args, options = {}) =>
    command(
      'docker',
      [
        'compose',
        '--project-name',
        project,
        '--file',
        resolve(root, 'infra/compose.register.yaml'),
        ...args,
      ],
      { env, cwd: root, ...options },
    );
  compose(['up', '--detach', '--wait', '--wait-timeout', '120'], {
    timeout: 180_000,
  });
  const port = Number(
    compose(['port', 'postgres', '5432']).trim().split(':').at(-1),
  );
  // Preserve the allocated port when Compose recreates the stopped test service.
  env.REGISTER_DB_PORT = String(port);
  const owner = new pg.Pool({
    host: '127.0.0.1',
    port,
    user: 'register_owner',
    password,
    database: 'register',
    connectionTimeoutMillis: 5000,
  });
  return { project, directory, compose, owner, port };
}
export async function runtimePool(ctx) {
  const secret = resolve(ctx.directory, 'app-password');
  try {
    await writeFile(secret, randomBytes(32).toString('hex'), {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  const password = await readFile(secret, 'utf8');
  if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('Invalid local secret');
  if (
    !(
      await ctx.owner.query(
        "SELECT 1 FROM pg_roles WHERE rolname='register_app'",
      )
    ).rowCount
  )
    await ctx.owner.query(
      `CREATE ROLE register_app LOGIN PASSWORD '${password}'`,
    );
  await ctx.owner.query(`GRANT USAGE ON SCHEMA register TO register_app;
    GRANT SELECT,INSERT ON register.activities,register.audit TO register_app;
    GRANT SELECT,INSERT,UPDATE ON register.versions TO register_app;
    GRANT USAGE ON ALL SEQUENCES IN SCHEMA register TO register_app;`);
  const database = {
    host: '127.0.0.1',
    port: ctx.port,
    user: 'register_app',
    password,
    database: 'register',
  };
  return {
    database,
    pool: new pg.Pool({
      ...database,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
    }),
  };
}
