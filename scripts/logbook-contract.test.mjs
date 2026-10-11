import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { validateEnvelope } from '@ldv/domain';
import {
  failure,
  dependencyFailure,
  secureKafka,
} from '../apps/logbook/dist/consumer.js';
import { validateFailure } from '../apps/logbook/dist/failure-validation.js';
describe('Logbook failure contracts', () => {
  it('validates reject/DLQ examples and verifies the original DLQ envelope', async () => {
    for (const name of ['reject', 'dead-letter']) {
      const example = JSON.parse(
        await readFile(
          `contracts/examples/valid-consumer-${name}.json`,
          'utf8',
        ),
      );
      expect(validateFailure(example)).toBe(true);
      if (example.original_base64) {
        const bytes = Buffer.from(example.original_base64, 'base64');
        expect(validateEnvelope(JSON.parse(bytes)).valid).toBe(true);
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(
          example.payload_sha256,
        );
      }
    }
  });
  it('reject never contains the untrusted body and keeps a stable failure ID', () => {
    const bytes = Buffer.from('synthetic-private-marker'),
      origin = { topic: 'ldv.accepted.v1', partition: 0, offset: '9' };
    for (const reason of [
      'INVALID_JSON',
      'INVALID_ENVELOPE',
      'EVENT_ID_CONFLICT',
    ]) {
      const value = failure(bytes, origin, 'reject', reason);
      expect(validateFailure(value)).toBe(true);
      expect(JSON.stringify(value)).not.toContain('synthetic-private-marker');
      expect(value.failure_id).toBe(
        failure(bytes, origin, 'reject', reason).failure_id,
      );
      expect(
        validateFailure({
          ...value,
          original_base64: bytes.toString('base64'),
        }),
      ).toBe(false);
    }
  });
  it('does not treat dependency failure as a permanent invalid event', () => {
    for (const code of ['ECONNREFUSED', '57P01', '08006', '40001', '53300'])
      expect(dependencyFailure({ code })).toBe(true);
    expect(
      dependencyFailure(new Error('Connection terminated unexpectedly')),
    ).toBe(true);
    expect(
      dependencyFailure({
        code: '42703',
        message: 'column connection does not exist',
      }),
    ).toBe(false);
    expect(dependencyFailure({ code: 'XX000' })).toBe(false);
  });
  it('refuses insecure Kafka configuration', () => {
    expect(() =>
      secureKafka({ bootstrapBrokers: ['localhost:9092'], tls: {} }),
    ).toThrow();
    expect(() =>
      secureKafka({
        bootstrapBrokers: ['localhost:9092'],
        tls: {
          ca: 'demo',
          cert: 'demo',
          key: 'demo',
          rejectUnauthorized: false,
        },
      }),
    ).toThrow();
  });
});
