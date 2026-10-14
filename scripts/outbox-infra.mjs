import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { root } from './ingest-infra.mjs';

export async function prepareSource(ctx) {
  const passwords = {};
  for (const role of ['source_owner', 'source_app']) {
    const file = resolve(ctx.directory, `${role}-password`);
    try {
      await writeFile(file, randomBytes(32).toString('hex'), {
        flag: 'wx',
        mode: 0o600,
      });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    passwords[role] = await readFile(file, 'utf8');
    if (!/^[a-f0-9]{64}$/.test(passwords[role]))
      throw new Error('Invalid source secret');
    if (
      !(
        await ctx.owner.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])
      ).rowCount
    )
      await ctx.owner.query(
        `CREATE ROLE ${role} LOGIN PASSWORD '${passwords[role]}'`,
      );
  }
  if (
    !(await ctx.owner.query("SELECT 1 FROM pg_database WHERE datname='source'"))
      .rowCount
  )
    await ctx.owner.query('CREATE DATABASE source OWNER source_owner');
  await ctx.owner.query(
    'REVOKE CONNECT ON DATABASE source FROM PUBLIC; GRANT CONNECT ON DATABASE source TO source_owner,source_app;',
  );
  // Runtime certificates prove CA trust; PostgreSQL roles define data access.
  const database = {
    ...ctx.database,
    database: 'source',
    user: 'source_owner',
    password: passwords.source_owner,
    ssl: await ctx.tls('source'),
  };
  const owner = new pg.Pool(database);
  owner.on('error', () => {});
  try {
    await owner.query(
      await readFile(
        resolve(root, 'apps/example/migrations/001-outbox.sql'),
        'utf8',
      ),
    );
    await owner.query(`GRANT USAGE ON SCHEMA example TO source_app;
      GRANT SELECT,INSERT ON example.cases,example.outbox TO source_app;
      GRANT UPDATE(state,attempts,next_attempt,lease_token,lease_until,error_code,receipt_event_id,delivered_at) ON example.outbox TO source_app;`);
  } catch (error) {
    await owner.end();
    throw error;
  }
  return {
    owner,
    database: {
      ...database,
      user: 'source_app',
      password: passwords.source_app,
      ssl: { ...database.ssl, key: database.ssl.key },
    },
  };
}
