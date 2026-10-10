import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createApp } from '../apps/ingest/dist/app.js';
import { ReceiptStore } from '../apps/ingest/dist/store.js';
import { KafkaPublisher } from '../apps/ingest/dist/producer.js';
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const pool = new pg.Pool(config.database);
pool.on('error', () => {});
const publisher = new KafkaPublisher(config.kafka);
if (process.argv.includes('--crash-after-ack')) {
  const publish = publisher.publish.bind(publisher);
  publisher.publish = async (event) => {
    await publish(event);
    process.exit(73);
  };
}
const app = createApp({ ...config, store: new ReceiptStore(pool, publisher) });
await app.listen({ host: '127.0.0.1', port: 0 });
process.send({ port: app.server.address().port });
process.on('message', async (message) => {
  if (message === 'stop') {
    await app.close();
    await publisher.close();
    await pool.end();
    process.exit(0);
  }
});
