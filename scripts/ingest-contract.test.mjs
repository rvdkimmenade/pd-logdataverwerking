import { readFile } from 'node:fs/promises';
import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { canonical } from '../apps/ingest/dist/store.js';
describe('Ingest public contracts', () => {
  it('keeps UUID retries optional and declares mTLS and conflict', async () => {
    const c = parse(
      await readFile('contracts/openapi/ingest-api.yaml', 'utf8'),
    );
    const route = c.paths['/v1/log-records'].post;
    expect(route.parameters[0]).toMatchObject({
      name: 'Idempotency-Key',
      required: false,
      schema: { format: 'uuid' },
    });
    expect(route.security).toEqual([{ sourceCertificate: [] }]);
    expect(route.responses['409']).toBeDefined();
    for (const status of ['400', '403', '409', '413', '415', '422', '503'])
      expect(
        route.responses[status].content['application/json'].schema.$ref,
      ).toBe('#/components/schemas/Error');
  });
  it('reuses the existing envelope contract in the accepted topic', async () => {
    const c = parse(
      await readFile('contracts/asyncapi/ingest-events.yaml', 'utf8'),
    );
    expect(c.asyncapi).toBe('3.0.0');
    expect(c.channels.accepted.address).toBe('ldv.accepted.v1');
    expect(c.channels.accepted.messages.logEvent.payload.$ref).toBe(
      '../schemas/ldv-envelope.schema.json',
    );
    expect(c.operations.publishAccepted.channel.$ref).toBe(
      '#/channels/accepted',
    );
  });
  it('canonicalizes nested objects without collapsing arrays or values', () => {
    expect(canonical({ b: { z: 1, a: 2 }, a: [2, 1] })).toBe(
      canonical({ a: [2, 1], b: { a: 2, z: 1 } }),
    );
    expect(canonical({ a: [1, 2] })).not.toBe(canonical({ a: [2, 1] }));
    expect(canonical({ a: '1' })).not.toBe(canonical({ a: 1 }));
    expect(canonical(JSON.parse('{"__proto__":{"a":1},"z":0}'))).toContain(
      '"__proto__"',
    );
  });
});
