import { readFileSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { default as formats } from 'ajv-formats';
import { validateLogRecord, type LdvLogRecord } from '@ldv/domain';
import {
  context,
  type Event,
  type Queue,
  type Receipt,
  type FailureCode,
} from '@ldv/publisher';
export interface CaseInput {
  case_id: string;
  subjects: string[];
  processing_activity_id: string;
  traceparent?: string;
}
const ajv = new Ajv2020({ strict: true, ownProperties: true });
formats.default(ajv);
const valid = ajv.compile<CaseInput>(
  JSON.parse(
    readFileSync(
      new URL(
        '../../../contracts/schemas/example-case.schema.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ),
);
export function records(input: unknown, template: LdvLogRecord) {
  if (!valid(input)) throw new Error('INVALID_CASE');
  const ctx = context(input.traceparent);
  const now = Date.now();
  const subjects =
    input.subjects.length === 1
      ? input.subjects
      : [input.subjects[0]!, ...input.subjects];
  const events = subjects.map((subject, index) => {
    const payload = structuredClone(template);
    payload.trace_id = ctx.traceId;
    payload.span_id = index === 0 ? ctx.spanId : randomBytes(8).toString('hex');
    if (index > 0) payload.parent_span_id = ctx.spanId;
    else if (ctx.parentSpanId) payload.parent_span_id = ctx.parentSpanId;
    else delete payload.parent_span_id;
    payload.name =
      index === 0 ? 'Demo: zaak registreren' : 'Demo: betrokkene verwerken';
    payload.start_time = now;
    payload.end_time = now;
    payload.attributes['dpl.core.processing_activity_id'] =
      input.processing_activity_id;
    payload.attributes['dpl.core.data_subject_id'] = subject;
    payload.attributes['dpl.pd.case_id'] = input.case_id;
    if (!validateLogRecord(payload, { policy: 'synthetic-demo' }).valid)
      throw new Error('INVALID_LOG_RECORD');
    return {
      id: randomUUID(),
      payload,
      traceparent: `00-${ctx.traceId}-${payload.span_id}-${ctx.flags}`,
    };
  });
  return { input, ctx, events };
}
export class SourceStore implements Queue {
  constructor(private pool: Pool) {}
  async create(
    input: unknown,
    template: LdvLogRecord,
    beforeCommit?: () => Promise<void>,
  ) {
    const value = records(input, template);
    const id = randomUUID();
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        'INSERT INTO example.cases(id,case_id,trace_id) VALUES($1,$2,$3)',
        [id, value.input.case_id, value.ctx.traceId],
      );
      for (const event of value.events)
        await db.query(
          'INSERT INTO example.outbox(id,case_id,payload,traceparent) VALUES($1,$2,$3,$4)',
          [event.id, id, JSON.stringify(event.payload), event.traceparent],
        );
      await beforeCommit?.();
      await db.query('COMMIT');
      return {
        id,
        trace_id: value.ctx.traceId,
        events: value.events.map((e) => e.id),
      };
    } catch (error) {
      await db.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }
  async claim(leaseMs: number): Promise<Event | null> {
    const token = randomUUID();
    const { rows } = await this.pool.query(
      `WITH candidate AS (
      SELECT id FROM example.outbox WHERE state IN ('pending','retry') AND next_attempt <= now()
      AND (lease_until IS NULL OR lease_until <= now()) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE example.outbox o SET lease_token=$1,lease_until=now()+($2::integer * interval '1 millisecond'),attempts=attempts+1
    FROM candidate c WHERE o.id=c.id RETURNING o.*`,
      [token, leaseMs],
    );
    const row = rows[0];
    return row
      ? {
          id: row.id,
          token,
          attempts: row.attempts,
          payload: row.payload,
          traceparent: row.traceparent,
        }
      : null;
  }
  async delivered(event: Event, receipt: Receipt) {
    return !!(
      await this.pool.query(
        `UPDATE example.outbox SET state='delivered',receipt_event_id=$3,delivered_at=$4,
      lease_token=NULL,lease_until=NULL,error_code=NULL WHERE id=$1 AND lease_token=$2 AND lease_until > now()`,
        [event.id, event.token, receipt.event_id, receipt.accepted_at],
      )
    ).rowCount;
  }
  async failed(event: Event, code: FailureCode, delayMs: number | null) {
    return !!(
      await this.pool.query(
        `UPDATE example.outbox SET state=$3,error_code=$4,
      next_attempt=now()+($5::integer * interval '1 millisecond'),lease_token=NULL,lease_until=NULL
      WHERE id=$1 AND lease_token=$2 AND lease_until > now()`,
        [
          event.id,
          event.token,
          delayMs === null ? 'blocked' : 'retry',
          code,
          delayMs ?? 0,
        ],
      )
    ).rowCount;
  }
  async requeue(id: string) {
    return !!(
      await this.pool.query(
        `UPDATE example.outbox SET state='retry',next_attempt=now(),error_code=NULL
      WHERE id=$1 AND state='blocked' AND lease_token IS NULL`,
        [id],
      )
    ).rowCount;
  }
  async status() {
    const { rows } = await this.pool.query(`SELECT count(*)::int total,
      count(*) FILTER(WHERE state='delivered')::int delivered,
      count(*) FILTER(WHERE state IN ('pending','retry'))::int pending,
      count(*) FILTER(WHERE state='blocked')::int blocked,
      count(*) FILTER(WHERE lease_until > now())::int leased,
      coalesce(sum(attempts),0)::int attempts,
      coalesce(extract(epoch FROM now()-min(created_at) FILTER(WHERE state != 'delivered')),0)::float8 oldest_pending_seconds
      FROM example.outbox`);
    return rows[0] as {
      total: number;
      delivered: number;
      pending: number;
      blocked: number;
      leased: number;
      attempts: number;
      oldest_pending_seconds: number;
    };
  }
}
