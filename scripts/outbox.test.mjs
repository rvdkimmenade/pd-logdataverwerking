import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  context,
  backoff,
  Publisher,
  DeliveryError,
  IngestClient,
} from '../packages/ldv-publisher/dist/index.js';
import { records, SourceStore } from '../apps/example/dist/store.js';
const input = JSON.parse(
  readFileSync(
    new URL('../contracts/examples/valid-example-case.json', import.meta.url),
  ),
);
const template = JSON.parse(
  readFileSync(
    new URL('../contracts/examples/valid-ldv-log-record.json', import.meta.url),
  ),
);
describe('Source trace and publisher boundary', () => {
  it('preserves remote trace/flags and creates distinct parent and subject spans', () => {
    const value = records(input, template);
    expect(value.events).toHaveLength(3);
    expect(new Set(value.events.map((e) => e.payload.span_id)).size).toBe(3);
    expect(
      value.events.every(
        (e) => e.payload.trace_id === input.traceparent.split('-')[1],
      ),
    ).toBe(true);
    expect(value.events[0].payload.parent_span_id).toBe('2222222222222222');
    for (const e of value.events.slice(1))
      expect(e.payload.parent_span_id).toBe(value.events[0].payload.span_id);
    expect(
      value.events
        .slice(1)
        .map((e) => e.payload.attributes['dpl.core.data_subject_id']),
    ).toEqual(input.subjects);
    expect(value.events.every((e) => e.traceparent.endsWith('-01'))).toBe(true);
  });
  it('makes a single subject one span and a new trace when no context is supplied', () => {
    const value = records(
      {
        ...input,
        traceparent: undefined,
        subjects: input.subjects.slice(0, 1),
      },
      template,
    );
    expect(value.events).toHaveLength(1);
    expect(value.events[0].payload.parent_span_id).toBeUndefined();
    expect(value.ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
  });
  for (const value of [
    'ff-' + input.traceparent.slice(3),
    '00-' + '0'.repeat(32) + '-2222222222222222-01',
    '00-' + '1'.repeat(32) + '-' + '0'.repeat(16) + '-01',
    'bad',
  ])
    it('rejects malformed or zero trace context ' + value.slice(0, 2), () =>
      expect(() => context(value)).toThrow('INVALID_TRACE_CONTEXT'),
    );
  it('rejects raw identities before acquiring a business connection', async () => {
    let connected = false;
    const store = new SourceStore({
      connect() {
        connected = true;
        throw new Error();
      },
    });
    await expect(
      store.create({ ...input, subjects: ['123456789'] }, template),
    ).rejects.toThrow('INVALID_CASE');
    expect(connected).toBe(false);
  });
  it('keeps jitter within the capped interval', () => {
    expect(backoff(1, 100, 1000, () => 0)).toBe(50);
    expect(backoff(30, 100, 1000, () => 1)).toBe(1000);
    expect(backoff(3, 100, 1000, () => 0.5)).toBe(300);
  });
  it('keeps permanent failures visible and retries transport failures', async () => {
    const states = [];
    const queue = {
      claim: async () => ({ id: 'synthetic', attempts: 1 }),
      failed: async (_e, code, delay) => {
        states.push([code, delay]);
        return true;
      },
      delivered: async () => true,
    };
    const permanent = new Publisher(queue, {
      send: async () => {
        throw new DeliveryError('PERMANENT_HTTP', false);
      },
    });
    await permanent.tick();
    expect(states[0]).toEqual(['PERMANENT_HTTP', null]);
    const retry = new Publisher(queue, {
      send: async () => {
        throw new DeliveryError('TRANSPORT', true);
      },
    });
    await retry.tick();
    expect(states[1][0]).toBe('TRANSPORT');
    expect(states[1][1]).toBeGreaterThan(0);
  });
  it('does not acknowledge a lost lease', async () => {
    const publisher = new Publisher(
      { claim: async () => ({ attempts: 1 }), delivered: async () => false },
      {
        send: async () => ({ event_id: 'synthetic', accepted_at: 'synthetic' }),
      },
    );
    await publisher.tick();
    expect(publisher.metrics.accepted).toBe(0);
    expect(publisher.metrics.staleLeases).toBe(1);
  });
  it('refuses plaintext or disabled certificate validation', () => {
    expect(
      () => new IngestClient('http://127.0.0.1/v1/log-records', {}),
    ).toThrow('VERIFIED_INGEST_REQUIRED');
    expect(
      () =>
        new IngestClient('https://127.0.0.1/v1/log-records', {
          ca: 'x',
          cert: 'x',
          key: 'x',
          rejectUnauthorized: false,
        }),
    ).toThrow('VERIFIED_INGEST_REQUIRED');
  });
});
