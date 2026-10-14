import { readFile } from 'node:fs/promises';
import pg from 'pg';
import {
  Publisher,
  IngestClient,
} from '../packages/ldv-publisher/dist/index.js';
import { SourceStore } from '../apps/example/dist/store.js';
const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const pool = new pg.Pool(config.database);
pool.on('error', () => {});
const publisher = new Publisher(
  new SourceStore(pool),
  new IngestClient(config.ingest.url, config.ingest.tls),
  {
    leaseMs: 10000,
    afterAccept: async () => {
      if (process.argv[3] === 'crash') process.exit(73);
    },
  },
);
await publisher.tick();
await pool.end();
process.exit(0);
