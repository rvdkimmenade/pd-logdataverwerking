import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvFile } from 'node:process';
import { readConfig } from '@ldv/foundation';
import { command } from './process.mjs';
import { report } from './report.mjs';

const root = resolve(import.meta.dirname, '..');
const localRoot = resolve(root, '.local');
const developmentProject = 'ldv-foundation-dev';

export function assertHealthy(output) {
  const trimmed = output.trim();
  const services = trimmed.startsWith('[')
    ? JSON.parse(trimmed)
    : trimmed
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
  for (const name of ['postgres', 'kafka']) {
    const service = services.find((item) => item.Service === name);
    if (service?.State !== 'running' || service?.Health !== 'healthy') {
      throw new Error(`${name} is not running and healthy`);
    }
  }
}

async function context(isTest) {
  try {
    loadEnvFile(resolve(root, '.env'));
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new Error('Could not load local environment file', {
        cause: error,
      });
  }
  readConfig({
    ...process.env,
    POSTGRES_PASSWORD_FILE: 'pending-local-secret',
  });
  const project = isTest ? `ldv-verify-${randomUUID()}` : developmentProject;
  const directory = resolve(localRoot, project);
  const passwordFile = resolve(directory, 'postgres-password');
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(passwordFile, randomBytes(32).toString('hex'), {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const password = await readFile(passwordFile, 'utf8');
  if (!/^[0-9a-f]{64}$/.test(password))
    throw new Error('Local secret file is invalid; see runbook');
  const config = readConfig({
    ...process.env,
    POSTGRES_PASSWORD_FILE: passwordFile,
    ...(isTest ? { LDV_ENV: 'test' } : {}),
  });
  const args = [
    'compose',
    '--project-name',
    project,
    '--file',
    resolve(root, 'infra/compose.yaml'),
  ];
  if (!isTest) args.push('--file', resolve(root, 'infra/compose.dev.yaml'));
  const env = {
    ...process.env,
    POSTGRES_PASSWORD_FILE: passwordFile.replaceAll('\\', '/'),
    POSTGRES_PORT: String(config.postgresPort),
    KAFKA_PORT: String(config.kafkaPort),
  };
  return {
    project,
    directory,
    passwordFile,
    compose: (commandArgs, options = {}) =>
      command('docker', [...args, ...commandArgs], {
        env,
        cwd: root,
        ...options,
      }),
  };
}

export async function infrastructure(mode, check) {
  const isTest = mode === 'verify';
  const ctx = await context(isTest);
  if (
    isTest &&
    (!/^ldv-verify-[0-9a-f-]{36}$/.test(ctx.project) ||
      resolve(localRoot, ctx.project) !== ctx.directory)
  ) {
    throw new Error('Unexpected cleanup scope');
  }
  let started = false;
  try {
    await check('Docker Engine en Compose', () => {
      command('docker', ['info', '--format', '{{.ServerVersion}}'], {
        timeout: 20_000,
      });
      command('docker', ['compose', 'version'], { timeout: 20_000 });
      ctx.compose(['config', '--quiet']);
    });
    if (mode === 'down') {
      ctx.compose(['down', '--timeout', '15']);
      return;
    }
    if (mode !== 'check') {
      started = true;
      await check('PostgreSQL en Kafka starten gezond', () =>
        ctx.compose(['up', '--detach', '--wait', '--wait-timeout', '180'], {
          timeout: 300_000,
        }),
      );
    }
    const health = () =>
      assertHealthy(ctx.compose(['ps', '--all', '--format', 'json']));
    await check('Healthchecks van beide services', health);
    await check('PostgreSQL: SELECT 1', () => {
      const value = ctx.compose([
        'exec',
        '-T',
        'postgres',
        'psql',
        '-U',
        'ldv_foundation',
        '-d',
        'ldv_foundation',
        '-tAc',
        'SELECT 1',
      ]);
      if (value.trim() !== '1')
        throw new Error('PostgreSQL query returned unexpected result');
    });
    await check('Kafka: broker bereikbaar', () => {
      ctx.compose([
        'exec',
        '-T',
        'kafka',
        '/opt/kafka/bin/kafka-broker-api-versions.sh',
        '--bootstrap-server',
        'kafka:9092',
      ]);
    });
    if (mode === 'up' || mode === 'check') return;
    await check('Kafka: synthetisch bericht heen en terug', () => {
      const topic = `foundation-${randomUUID()}`;
      const message = JSON.stringify({
        type: 'foundation-smoke',
        id: topic,
        synthetic: true,
      });
      const kafka = (args, options) =>
        ctx.compose(['exec', '-T', 'kafka', ...args], options);
      kafka([
        '/opt/kafka/bin/kafka-topics.sh',
        '--bootstrap-server',
        'kafka:9092',
        '--create',
        '--topic',
        topic,
        '--partitions',
        '1',
        '--replication-factor',
        '1',
      ]);
      try {
        kafka(
          [
            '/opt/kafka/bin/kafka-console-producer.sh',
            '--bootstrap-server',
            'kafka:9092',
            '--topic',
            topic,
            '--producer-property',
            'acks=all',
            '--producer-property',
            'enable.idempotence=true',
          ],
          { input: message + '\n', timeout: 45_000 },
        );
        const received = kafka(
          [
            '/opt/kafka/bin/kafka-console-consumer.sh',
            '--bootstrap-server',
            'kafka:9092',
            '--topic',
            topic,
            '--from-beginning',
            '--max-messages',
            '1',
            '--timeout-ms',
            '30000',
          ],
          { timeout: 45_000 },
        );
        if (received.trim() !== message)
          throw new Error('Kafka message mismatch');
      } finally {
        kafka([
          '/opt/kafka/bin/kafka-topics.sh',
          '--bootstrap-server',
          'kafka:9092',
          '--delete',
          '--topic',
          topic,
        ]);
      }
    });
    if (isTest) {
      await check('Negatieve proef: gestopte Kafka wordt afgekeurd', () => {
        ctx.compose(['stop', '--timeout', '15', 'kafka']);
        let failed = false;
        try {
          health();
        } catch (error) {
          if (error.message === 'kafka is not running and healthy')
            failed = true;
          else throw error;
        }
        if (!failed) throw new Error('Health gate accepted a stopped broker');
      });
      await check('Kafka herstart weer gezond', () => {
        ctx.compose(
          ['up', '--detach', '--wait', '--wait-timeout', '180', 'kafka'],
          { timeout: 240_000 },
        );
        health();
      });
    }
  } finally {
    if (isTest) {
      if (started)
        await check('Geïsoleerde testomgeving opruimen', () =>
          ctx.compose(['down', '--volumes', '--timeout', '15']),
        );
      await unlink(ctx.passwordFile);
      await rmdir(ctx.directory);
    }
  }
}

export function recorder(checks) {
  return async (name, action) => {
    const start = Date.now();
    console.log(`START ${name}`);
    try {
      await action();
      checks.push({ name, passed: true, durationMs: Date.now() - start });
      console.log(`PASS  ${name}`);
    } catch (error) {
      checks.push({ name, passed: false, durationMs: Date.now() - start });
      console.error(`FAIL  ${name}`);
      throw error;
    }
  };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const mode = process.argv[2];
  const checks = [];
  try {
    if (!['up', 'down', 'check', 'demo'].includes(mode))
      throw new Error('Unknown infrastructure command');
    await infrastructure(mode, recorder(checks));
    if (mode === 'demo') console.log(await report('demo', checks));
  } catch (error) {
    console.error(error.message);
    if (checks.length === 0)
      checks.push({ name: 'Configuratie en voorbereiding', passed: false });
    await report(mode === 'demo' ? 'demo' : 'infrastructure', checks);
    process.exitCode = 1;
  }
}
