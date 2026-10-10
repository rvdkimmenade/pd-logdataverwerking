import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { LdvEnvelope, LdvLogRecord } from '@ldv/domain';

export interface Source {
  source_application: string;
  responsible_party: string;
  activities: string[];
}
export interface Publisher {
  publish(envelope: LdvEnvelope): Promise<void>;
  ready(): Promise<void>;
  close(): Promise<void>;
}
export class Conflict extends Error {}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export class ReceiptStore {
  constructor(
    private pool: Pool,
    private publisher: Publisher,
  ) {}
  async ready() {
    await this.pool.query('SELECT 1');
    await this.publisher.ready();
  }
  async accept(source: Source, key: string, payload: LdvLogRecord) {
    const hash = createHash('sha256').update(canonical(payload)).digest('hex');
    const scope = [source.source_application, source.responsible_party, key];
    await this.pool.query(
      `INSERT INTO ingest.receipts(source_application,responsible_party,idempotency_key,payload_hash,event_id,received_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source_application,responsible_party,idempotency_key) DO NOTHING`,
      [...scope, hash, randomUUID(), new Date()],
    );
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const { rows } = await db.query(
        'SELECT * FROM ingest.receipts WHERE source_application=$1 AND responsible_party=$2 AND idempotency_key=$3 FOR UPDATE',
        scope,
      );
      const receipt = rows[0];
      if (!receipt || receipt.payload_hash !== hash) throw new Conflict();
      let accepted: Date | null = receipt.accepted_at;
      if (!accepted) {
        await this.publisher.publish({
          event_id: receipt.event_id,
          schema_version: '1.0',
          source_application: source.source_application,
          responsible_party: source.responsible_party,
          created_at: receipt.received_at.toISOString(),
          payload,
        });
        accepted = new Date();
        await db.query(
          'UPDATE ingest.receipts SET accepted_at=$4 WHERE source_application=$1 AND responsible_party=$2 AND idempotency_key=$3',
          [...scope, accepted],
        );
      }
      await db.query('COMMIT');
      return {
        event_id: receipt.event_id as string,
        accepted_at: accepted.toISOString(),
      };
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }
}
