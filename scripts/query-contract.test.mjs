import { readFile } from 'node:fs/promises';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Cursor } from '../apps/query/src/cursor.ts';
import { project, Projector } from '../apps/query/src/projector.ts';
import { QueryService } from '../apps/query/src/service.ts';
import { RegisterClient } from '../apps/query/src/register-client.ts';
import { validateSearch, validateItem } from '../apps/query/src/validation.ts';

const envelope = JSON.parse(
  await readFile(
    new URL('../contracts/examples/valid-log-event.json', import.meta.url),
    'utf8',
  ),
);
const scope = {
  id: 'synthetic',
  party: envelope.responsible_party,
  applications: [envelope.source_application],
  read: true,
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('query contracts and failure boundaries', () => {
  it('accepts bounded filters and rejects unknown scope fields', () => {
    expect(
      validateSearch({ limit: 100, trace_id: envelope.payload.trace_id }),
    ).toBe(true);
    for (const value of [
      { limit: 0 },
      { limit: 101 },
      { responsible_party: 'other' },
      { from: 1.5 },
      { trace_id: 'invalid' },
      { cursor: 'x'.repeat(4097) },
    ])
      expect(validateSearch(value)).toBe(false);
    expect(validateItem({ event_id: envelope.event_id })).toBe(false);
  });
  it('expires and binds cursors to the exact scope', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const cursor = new Cursor('a'.repeat(64));
    const binding = cursor.binding(scope);
    const after = [envelope.payload.start_time, envelope.event_id];
    const token = cursor.issue(after, binding);
    expect(cursor.read(token, binding)).toEqual(after);
    expect(() =>
      cursor.read(token, cursor.binding({ ...scope, party: 'other' })),
    ).toThrow('INVALID_CURSOR');
    expect(() => cursor.read(token + 'x', binding)).toThrow('INVALID_CURSOR');
    now.mockReturnValue(901001);
    expect(() => cursor.read(token, binding)).toThrow('INVALID_CURSOR');
  });
  it('projects only search fields', () => {
    expect(Object.keys(project({ envelope })).sort()).toEqual([
      'event_id',
      'event_time',
      'processing_activity_id',
      'responsible_party',
      'source_application',
      'span_id',
      'subject_id',
      'trace_id',
    ]);
  });
  it('refuses invalid intervals before calling dependencies', async () => {
    const call = vi.fn();
    const service = new QueryService({}, { call }, {}, 'a'.repeat(64));
    await expect(service.search(scope, { from: 2, until: 1 })).rejects.toThrow(
      'INVALID_INTERVAL',
    );
    await expect(
      service.search(scope, { source_application: 'other' }),
    ).rejects.toThrow('FORBIDDEN');
    expect(call).not.toHaveBeenCalled();
  });
  it('rechecks index hits against the archive scope', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new QueryService(
      { query },
      {
        call: async () => ({
          hits: {
            hits: [{ _id: envelope.event_id, sort: [1, envelope.event_id] }],
          },
        }),
      },
      {},
      'a'.repeat(64),
    );
    await expect(service.search(scope, {})).rejects.toThrow(
      'PROJECTION_MISMATCH',
    );
    expect(query.mock.calls[0][1]).toEqual([
      envelope.event_id,
      scope.party,
      scope.applications,
    ]);
  });
  it('fails closed on an index ordering mismatch', async () => {
    const service = new QueryService(
      {},
      {
        call: async () => ({
          hits: {
            hits: [{ _id: envelope.event_id, sort: [1, envelope.event_id] }],
          },
        }),
      },
      {},
      'a'.repeat(64),
    );
    vi.spyOn(service, 'record').mockResolvedValue({ envelope });
    await expect(service.search(scope, {})).rejects.toThrow(
      'PROJECTION_MISMATCH',
    );
  });
  it('counts database connection failures in projector metrics', async () => {
    const projector = new Projector(
      {
        connect: async () => {
          throw new Error('offline');
        },
      },
      {},
    );
    await expect(projector.sync()).rejects.toThrow('offline');
    expect(projector.snapshot()).toMatchObject({
      failures: 1,
      scan_lag_ms: null,
    });
  });
  it('does not follow activity URLs supplied by records', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const register = new RegisterClient({
      origin: 'http://127.0.0.1:18081',
      readers: {},
    });
    expect(
      await register.resolve(
        scope.party,
        'https://example.invalid/untrusted',
        0,
      ),
    ).toEqual({ status: 'unsupported_id' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects register credentials for a different party or role', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ party: scope.party, role: 'editor' }), {
          headers: { 'set-cookie': 'session=synthetic' },
        }),
      ),
    );
    const register = new RegisterClient({
      origin: 'http://127.0.0.1:18081',
      readers: { [scope.party]: 'synthetic' },
    });
    await expect(
      register.resolve(scope.party, `urn:uuid:${envelope.event_id}`, 0),
    ).rejects.toThrow('REGISTER_UNAVAILABLE');
  });
});
