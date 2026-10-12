import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { LdvEnvelope } from '@ldv/domain';
import { SearchClient, SearchError } from './search-client.js';

export const alias = 'ldv-search-read';
export const mapping = {
  settings: { number_of_shards: 1, number_of_replicas: 0 },
  mappings: {
    dynamic: 'strict',
    properties: {
      event_id: { type: 'keyword' },
      responsible_party: { type: 'keyword' },
      source_application: { type: 'keyword' },
      trace_id: { type: 'keyword' },
      span_id: { type: 'keyword' },
      processing_activity_id: { type: 'keyword' },
      subject_id: { type: 'keyword' },
      event_time: { type: 'long' },
    },
  },
};
export function project(row: { envelope: LdvEnvelope }) {
  const event = row.envelope;
  return {
    event_id: event.event_id,
    responsible_party: event.responsible_party,
    source_application: event.source_application,
    trace_id: event.payload.trace_id,
    span_id: event.payload.span_id,
    event_time: event.payload.start_time,
    processing_activity_id:
      event.payload.attributes['dpl.core.processing_activity_id'],
    subject_id: event.payload.attributes['dpl.core.data_subject_id'],
  };
}
export class Projector {
  readonly metrics = {
    cycles: 0,
    failures: 0,
    rebuilds: 0,
    projected: 0,
    last_success_at: 0,
    scan_started_at: 0,
    rebuild_duration_ms: 0,
  };
  constructor(
    private pool: Pool,
    private client: SearchClient,
  ) {}
  async sync(rebuild = false) {
    const db = await this.pool.connect().catch((error) => {
      this.metrics.failures++;
      throw error;
    });
    let locked = false;
    const started = Date.now();
    try {
      locked = (
        await db.query('SELECT pg_try_advisory_lock(20261011) AS locked')
      ).rows[0].locked;
      if (!locked) return false;
      let old: string[] = [];
      try {
        old = Object.keys(
          await this.client.call('GET', `/ldv-search-*/_alias/${alias}`),
        );
      } catch (e) {
        if (!(e instanceof SearchError) || e.status !== 404) throw e;
      }
      const fresh = rebuild || !old.length;
      const target = fresh ? `ldv-search-${randomUUID()}` : old[0]!;
      if (fresh) await this.client.call('PUT', `/${target}`, mapping);
      await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      this.metrics.scan_started_at = started;
      let after: string | null = null;
      let count = 0;
      for (;;) {
        const {
          rows,
        }: { rows: { event_id: string; envelope: LdvEnvelope }[] } =
          await db.query<{
            event_id: string;
            envelope: LdvEnvelope;
          }>(
            'SELECT event_id,envelope FROM logbook.records WHERE ($1::uuid IS NULL OR event_id>$1::uuid) ORDER BY event_id LIMIT 200',
            [after],
          );
        if (!rows.length) break;
        const body = rows
          .map(
            (row) =>
              JSON.stringify({ index: { _index: target, _id: row.event_id } }) +
              '\n' +
              JSON.stringify(project(row)) +
              '\n',
          )
          .join('');
        const response = await this.client.call('POST', '/_bulk', body, true);
        if (response.errors) throw new Error('Projection batch failed');
        count += rows.length;
        after = rows.at(-1)!.event_id;
      }
      await db.query('COMMIT');
      await this.client.call('POST', `/${target}/_refresh`);
      if (fresh) {
        await this.client.call('POST', '/_aliases', {
          actions: [
            ...old.map((index) => ({ remove: { index, alias } })),
            { add: { index: target, alias } },
          ],
        });
        this.metrics.rebuilds++;
        this.metrics.rebuild_duration_ms = Date.now() - started;
      }
      this.metrics.projected = count;
      this.metrics.cycles++;
      this.metrics.last_success_at = started;
      return true;
    } catch (e) {
      this.metrics.failures++;
      await db.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      let discard = false;
      if (locked)
        await db.query('SELECT pg_advisory_unlock(20261011)').catch(() => {
          discard = true;
        });
      db.release(discard);
    }
  }
  snapshot() {
    return {
      ...this.metrics,
      scan_lag_ms: this.metrics.last_success_at
        ? Date.now() - this.metrics.last_success_at
        : null,
    };
  }
}
