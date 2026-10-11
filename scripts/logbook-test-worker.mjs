import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { LogConsumer } from '../apps/logbook/dist/consumer.js';
import { Archive } from '../apps/logbook/dist/store.js';
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const pool = new pg.Pool(config.database);
pool.on('error', () => {});
const archive = new Archive(pool);
const scenario = process.argv[3];
if (scenario === 'technical')
  archive.save = async () => {
    throw Object.assign(new Error('Synthetic storage failure'), {
      code: 'XX000',
    });
  };
const consumer = new LogConsumer(config.kafka, archive, {
  beforeCommit: async () => {
    if (scenario === 'before') process.exit(71);
  },
  afterCommit: async () => {
    if (scenario === 'after') process.exit(72);
  },
});
const running = consumer.run();
const timer = setInterval(
  () => process.send?.({ metrics: consumer.metrics }),
  200,
);
timer.unref();
process.send({ ready: true });
process.on('message', async (msg) => {
  if (msg === 'stop') {
    await consumer.stop();
    await running;
    await pool.end();
    process.exit(0);
  }
});
