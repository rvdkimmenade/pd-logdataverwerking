import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import pg from 'pg';
import { root } from './ingest-infra.mjs';
import { command } from './process.mjs';

export async function prepareLogbook(ctx) {
  const pki = resolve(ctx.directory, 'pki');
  command('docker', [
    'run',
    '--rm',
    ...(process.getuid
      ? ['--user', `${process.getuid()}:${process.getgid()}`]
      : []),
    '--entrypoint',
    'bash',
    '--mount',
    `type=bind,source=${pki},target=/pki`,
    '--mount',
    `type=bind,source=${resolve(root, 'scripts/logbook-pki.sh')},target=/generate.sh,readonly`,
    'postgres:18.6@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336',
    '/generate.sh',
  ]);
  const passwords = {};
  for (const role of ['logbook_owner', 'logbook_writer', 'logbook_reader']) {
    const file = resolve(ctx.directory, `${role}-password`);
    try {
      await writeFile(file, randomBytes(32).toString('hex'), {
        flag: 'wx',
        mode: 0o600,
      });
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const secret = await readFile(file, 'utf8');
    if (!/^[a-f0-9]{64}$/.test(secret)) throw new Error('Invalid local secret');
    passwords[role] = secret;
    if (
      !(
        await ctx.owner.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])
      ).rowCount
    )
      await ctx.owner.query(`CREATE ROLE ${role} LOGIN PASSWORD '${secret}'`);
  }
  if (
    !(
      await ctx.owner.query("SELECT 1 FROM pg_database WHERE datname='logbook'")
    ).rowCount
  )
    await ctx.owner.query('CREATE DATABASE logbook OWNER logbook_owner');
  await ctx.owner.query(
    'REVOKE CONNECT ON DATABASE logbook FROM PUBLIC; GRANT CONNECT ON DATABASE logbook TO logbook_owner,logbook_writer,logbook_reader;',
  );
  const database = {
    ...ctx.database,
    database: 'logbook',
    user: 'logbook_owner',
    password: passwords.logbook_owner,
  };
  const owner = new pg.Pool(database);
  owner.on('error', () => {});
  await owner.query(
    await readFile(
      resolve(root, 'apps/logbook/migrations/001-archive.sql'),
      'utf8',
    ),
  );
  await owner.query(
    'GRANT USAGE ON SCHEMA logbook TO logbook_writer,logbook_reader; GRANT EXECUTE ON FUNCTION logbook.store_record(jsonb,bytea,text,text,integer,bigint) TO logbook_writer; GRANT SELECT ON logbook.records TO logbook_reader;',
  );
  for (const topic of ['ldv.rejected.v1', 'ldv.dead-letter.v1'])
    ctx.cli('topics', [
      '--create',
      '--if-not-exists',
      '--topic',
      topic,
      '--partitions',
      '1',
      '--replication-factor',
      '1',
      '--config',
      'min.insync.replicas=1',
    ]);
  const acl = (principal, operations, scope) =>
    ctx.cli('acls', [
      '--add',
      '--allow-principal',
      `User:CN=${principal}`,
      ...operations.flatMap((o) => ['--operation', o]),
      ...scope,
    ]);
  acl('consumer', ['Read', 'Describe'], ['--topic', 'ldv.accepted.v1']);
  acl('consumer', ['Read'], ['--group', 'ldv-logbook-v1']);
  for (const topic of ['ldv.rejected.v1', 'ldv.dead-letter.v1'])
    acl('consumer', ['Write', 'Describe'], ['--topic', topic]);
  acl('consumer', ['IdempotentWrite'], ['--cluster']);
  acl('replay', ['Read', 'Describe'], ['--topic', 'ldv.dead-letter.v1']);
  acl('replay', ['Read'], ['--group', 'ldv-logbook-replay-v1']);
  acl('replay', ['Write', 'Describe'], ['--topic', 'ldv.accepted.v1']);
  acl('replay', ['IdempotentWrite'], ['--cluster']);
  const runtime = {
    ...database,
    user: 'logbook_writer',
    password: passwords.logbook_writer,
    ssl: await ctx.tls('consumer'),
    max: 5,
  };
  const reader = {
    ...database,
    user: 'logbook_reader',
    password: passwords.logbook_reader,
    ssl: await ctx.tls('reader'),
    max: 3,
  };
  return {
    owner,
    reader,
    replay: {
      bootstrapBrokers: ctx.kafka.bootstrapBrokers,
      tls: await ctx.tls('replay'),
    },
    config: {
      database: runtime,
      kafka: {
        bootstrapBrokers: ctx.kafka.bootstrapBrokers,
        tls: await ctx.tls('consumer'),
      },
      local: true,
    },
  };
}
