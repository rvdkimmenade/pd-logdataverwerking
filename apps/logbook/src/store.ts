import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { canonical, type LdvEnvelope } from '@ldv/domain';
export interface Origin {
  topic: string;
  partition: number;
  offset: string;
}
export class Archive {
  constructor(private pool: Pool) {}
  async save(
    envelope: LdvEnvelope,
    raw: Buffer,
    origin: Origin,
    beforeCommit?: () => Promise<void>,
  ) {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      const hash = createHash('sha256')
        .update(canonical(envelope))
        .digest('hex');
      const { rows } = await db.query(
        'SELECT logbook.store_record($1::jsonb,$2,$3,$4,$5,$6) AS result',
        [
          JSON.stringify(envelope),
          raw,
          hash,
          origin.topic,
          origin.partition,
          origin.offset,
        ],
      );
      await beforeCommit?.();
      await db.query('COMMIT');
      return rows[0].result as 'stored' | 'duplicate' | 'conflict';
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }
}
export const queryFields = [
  'event_id',
  'trace_id',
  'span_id',
  'processing_activity_id',
] as const;
export async function findRecords(
  pool: Pool,
  party: string,
  field: (typeof queryFields)[number],
  value: string,
) {
  if (!party || !value || !queryFields.includes(field))
    throw new Error('Explicit query and scope required');
  const { rows } = await pool.query(
    `SELECT event_id,envelope,original,original_sha256,stored_at,source_topic,source_partition,source_offset FROM logbook.records WHERE responsible_party=$1 AND ${field}=$2 ORDER BY stored_at,event_id LIMIT 200`,
    [party, value],
  );
  return rows;
}
