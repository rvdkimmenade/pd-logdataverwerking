import { mkdir, readFile, writeFile, access, copyFile } from 'node:fs/promises';
import { randomBytes, randomUUID, X509Certificate } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import pg from 'pg';
import { command } from './process.mjs';

export const root = resolve(import.meta.dirname, '..');
const image =
  'postgres:18.6@sha256:74935e72241653ca55e0414067e6d8763aceb8a810eb51b452253ec3dcfc4336';
async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const port = server.address().port;
  await new Promise((done) => server.close(done));
  return port;
}
export async function prepareIngest(test = false) {
  if (
    process.env.NODE_ENV === 'production' ||
    (process.env.LDV_ENV && !['local', 'test'].includes(process.env.LDV_ENV))
  )
    throw new Error('Local mode required');
  const project = test ? `ldv-ingest-test-${randomUUID()}` : 'ldv-ingest-dev';
  const directory = resolve(root, '.local', project);
  const pki = resolve(directory, 'pki');
  await mkdir(pki, { recursive: true });
  try {
    await access(resolve(pki, 'admin.properties'));
  } catch {
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
      `type=bind,source=${resolve(root, 'scripts/ingest-pki.sh')},target=/generate.sh,readonly`,
      image,
      '/generate.sh',
    ]);
  }
  const passwordFile = resolve(directory, 'password');
  await writeFile(
    resolve(pki, 'pg_hba.conf'),
    'local all all trust\nhostssl all all all scram-sha-256 clientcert=verify-ca\nhostnossl all all all reject\n',
  );
  for (const [folder, files] of Object.entries({
    database: ['server.key', 'server.crt', 'ca.crt', 'pg_hba.conf'],
    kafka: ['broker.pem', 'ca.crt', 'admin.pem', 'admin.properties'],
  })) {
    await mkdir(resolve(pki, folder), { recursive: true });
    for (const file of files)
      await copyFile(resolve(pki, file), resolve(pki, folder, file));
  }
  try {
    await writeFile(passwordFile, randomBytes(32).toString('hex'), {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  const password = await readFile(passwordFile, 'utf8');
  const port = test ? await freePort() : 15434;
  const kafkaPort = test ? await freePort() : 19094;
  const env = {
    ...process.env,
    INGEST_PKI: pki.replaceAll('\\', '/'),
    INGEST_PASSWORD_FILE: passwordFile.replaceAll('\\', '/'),
    INGEST_DB_PORT: String(port),
    INGEST_KAFKA_PORT: String(kafkaPort),
  };
  const compose = (args, options = {}) =>
    command(
      'docker',
      [
        'compose',
        '--project-name',
        project,
        '--file',
        resolve(root, 'infra/compose.ingest.yaml'),
        ...args,
      ],
      { cwd: root, env, ...options },
    );
  compose(['up', '--detach', '--wait', '--wait-timeout', '180'], {
    timeout: 240000,
  });
  const ca = await readFile(resolve(pki, 'ca.crt'), 'utf8');
  const database = {
    host: '127.0.0.1',
    port,
    database: 'ingest',
    user: 'ingest_owner',
    password,
    ssl: {
      ca,
      cert: await readFile(resolve(pki, 'admin.crt'), 'utf8'),
      key: await readFile(resolve(pki, 'admin.key'), 'utf8'),
      rejectUnauthorized: true,
    },
    connectionTimeoutMillis: 3000,
    statement_timeout: 10000,
  };
  const owner = new pg.Pool(database);
  owner.on('error', () => {});
  const tls = async (name) => ({
    ca,
    cert: await readFile(resolve(pki, `${name}.crt`), 'utf8'),
    key: await readFile(resolve(pki, `${name}.key`), 'utf8'),
    rejectUnauthorized: true,
  });
  const fingerprint = async (name) =>
    new X509Certificate(await readFile(resolve(pki, `${name}.crt`)))
      .fingerprint256;
  const kafka = {
    bootstrapBrokers: [`127.0.0.1:${kafkaPort}`],
    tls: await tls('producer'),
  };
  const cli = (tool, args) =>
    compose([
      'exec',
      '-T',
      'kafka',
      `/opt/kafka/bin/kafka-${tool}.sh`,
      '--bootstrap-server',
      'kafka:9092',
      '--command-config',
      '/pki/admin.properties',
      ...args,
    ]);
  cli('topics', [
    '--create',
    '--if-not-exists',
    '--topic',
    'ldv.accepted.v1',
    '--partitions',
    '1',
    '--replication-factor',
    '1',
    '--config',
    'min.insync.replicas=1',
  ]);
  cli('acls', [
    '--add',
    '--allow-principal',
    'User:CN=producer',
    '--operation',
    'Write',
    '--operation',
    'Describe',
    '--topic',
    'ldv.accepted.v1',
  ]);
  cli('acls', [
    '--add',
    '--allow-principal',
    'User:CN=producer',
    '--operation',
    'IdempotentWrite',
    '--cluster',
  ]);
  return {
    project,
    directory,
    compose,
    owner,
    database,
    tls,
    fingerprint,
    kafka,
    cli,
  };
}
export async function migrateIngest(ctx) {
  await ctx.owner.query(
    await readFile(
      resolve(root, 'apps/ingest/migrations/001-receipts.sql'),
      'utf8',
    ),
  );
  const file = resolve(ctx.directory, 'runtime-password');
  try {
    await writeFile(file, randomBytes(32).toString('hex'), {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  const password = await readFile(file, 'utf8');
  if (!/^[a-f0-9]{64}$/.test(password)) throw new Error('Invalid secret');
  if (
    !(
      await ctx.owner.query("SELECT 1 FROM pg_roles WHERE rolname='ingest_app'")
    ).rowCount
  )
    await ctx.owner.query(
      `CREATE ROLE ingest_app LOGIN PASSWORD '${password}'`,
    );
  await ctx.owner.query(
    'GRANT USAGE ON SCHEMA ingest TO ingest_app; GRANT SELECT,INSERT ON ingest.receipts TO ingest_app; GRANT UPDATE(accepted_at) ON ingest.receipts TO ingest_app;',
  );
  const database = {
    ...ctx.database,
    ssl: await ctx.tls('producer'),
    user: 'ingest_app',
    password,
    statement_timeout: 10000,
    lock_timeout: 8000,
    max: 10,
  };
  const activity =
    'https://register.example.invalid/processing-activities/DEMO-001';
  const source = {
    source_application: 'demo-service',
    responsible_party: 'example-municipality',
    activities: [activity],
  };
  const sources = {
    [await ctx.fingerprint('source')]: source,
    [await ctx.fingerprint('other')]: {
      ...source,
      source_application: 'other-demo-service',
      responsible_party: 'other-example-municipality',
    },
  };
  return {
    database,
    kafka: ctx.kafka,
    tls: await ctx.tls('server'),
    sources,
    syntheticOnly: true,
  };
}
