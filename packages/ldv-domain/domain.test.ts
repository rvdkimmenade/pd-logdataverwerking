import { readFileSync } from 'node:fs';
import { describe, it, expect, vi } from 'vitest';
import {
  validateLogRecord,
  validateEnvelope,
  splitAttributes,
} from './src/index.js';
import type { ValidationOptions } from './src/index.js';

const load = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../contracts/examples/${name}`, import.meta.url),
      'utf8',
    ),
  );
const record = load('valid-ldv-log-record.json');
const envelope = load('valid-log-event.json');

describe('LDV domain fixture contracts', () => {
  it.each([
    'dpl.core.processing_activity_id',
    'dpl.core.data_subject_id_type',
    'dpl.core.foreign_operation.processor',
  ])('rejects invalid URI in %s', (key) => {
    const input = structuredClone(record);
    input.attributes[key] = 'not a URI';
    expect(validateLogRecord(input).valid).toBe(false);
  });
  it.each([
    'event_id',
    'schema_version',
    'source_application',
    'responsible_party',
    'created_at',
    'payload',
  ])('requires envelope field %s', (key) => {
    const input = structuredClone(envelope);
    delete input[key];
    expect(validateEnvelope(input).valid).toBe(false);
  });
  it.each([
    { created_at: '2026-02-30T00:00:00Z' },
    { schema_version: '2.0' },
    { source_application: '' },
  ])('checks transport metadata %j', (patch) => {
    expect(validateEnvelope({ ...envelope, ...patch }).valid).toBe(false);
  });
  it('validates optional resource and candidate field types', () => {
    expect(validateLogRecord({ ...record, resource: {} }).valid).toBe(false);
    expect(
      validateLogRecord({
        ...record,
        attributes: {
          ...record.attributes,
          'dpl.pd.channel': 'unknown-channel',
        },
      }).valid,
    ).toBe(false);
    expect(
      validateLogRecord({
        ...record,
        attributes: { ...record.attributes, 'dpl.pd.case_id': 123 },
      }).valid,
    ).toBe(false);
  });
  for (const fixture of load('validation-cases.json').cases) {
    it(fixture.name, () => {
      const before = structuredClone(fixture.input);
      const validate =
        fixture.kind === 'envelope' ? validateEnvelope : validateLogRecord;
      const options: ValidationOptions = fixture.policy
        ? { policy: fixture.policy }
        : {};
      const result = validate(fixture.input, options);
      expect(result.valid).toBe(fixture.valid);
      if (!result.valid)
        expect(result.issues.map((issue) => issue.code)).toContain(
          fixture.code,
        );
      expect(fixture.input).toEqual(before);
    });
  }
  it('validates both published complete examples', () => {
    expect(validateLogRecord(record, { policy: 'synthetic-demo' }).valid).toBe(
      true,
    );
    expect(validateEnvelope(envelope, { policy: 'synthetic-demo' }).valid).toBe(
      true,
    );
  });
  it.each(load('data-subject-id-examples.json').examples)(
    'validates each subject example as a full record',
    (example) => {
      const attributes = {
        ...record.attributes,
        'dpl.core.data_subject_id': example['dpl.core.data_subject_id'],
        'dpl.core.data_subject_id_type':
          example['dpl.core.data_subject_id_type'],
      };
      expect(
        validateLogRecord(
          { ...record, attributes },
          { policy: 'synthetic-demo' },
        ).valid,
      ).toBe(true);
    },
  );
  it('keeps optional demo policy separate from schema validity', () => {
    const input = structuredClone(record);
    input.attributes['dpl.core.data_subject_id'] = '000000000';
    expect(validateLogRecord(input).valid).toBe(true);
    expect(validateLogRecord(input, { policy: 'synthetic-demo' }).valid).toBe(
      false,
    );
  });
  it('separates core, candidate and unknown attributes without mutating input', () => {
    const input = { ...record.attributes, 'dpl.custom.example': 'synthetic' };
    const before = structuredClone(input);
    const parts = splitAttributes(input);
    expect(parts.core['dpl.core.data_subject_id']).toBe(
      'example-subject-not-real-001',
    );
    expect(parts.candidates['dpl.pd.channel']).toBe('web');
    expect(parts.other).toEqual({ 'dpl.custom.example': 'synthetic' });
    expect(parts.core).not.toHaveProperty('dpl.pd.channel');
    expect(input).toEqual(before);
    expect(validateLogRecord({ ...record, attributes: input }).valid).toBe(
      true,
    );
  });
  it('redacts input values and unknown keys, including nested payload errors', () => {
    const input = structuredClone(envelope);
    input.payload.status = 'PRIVATE_TEST_SENTINEL';
    input.payload['PRIVATE_KEY_SENTINEL'] = 'PRIVATE_TEST_SENTINEL';
    const result = validateEnvelope(input);
    expect(result.valid).toBe(false);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    if (!result.valid)
      expect(
        result.issues.some((issue) => issue.path === '/payload/status'),
      ).toBe(true);
  });
  it.each([null, false, 42, 'synthetic', [], {}])(
    'rejects malformed input without throwing: %j',
    (input) => {
      expect(validateLogRecord(input).valid).toBe(false);
      expect(validateEnvelope(input).valid).toBe(false);
    },
  );
  it('has no network access or logging during validation', () => {
    const fetch = vi.fn(() => {
      throw new Error('Network forbidden');
    });
    vi.stubGlobal('fetch', fetch);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      expect(validateLogRecord(record).valid).toBe(true);
      expect(validateEnvelope(envelope).valid).toBe(true);
      expect(fetch).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      log.mockRestore();
    }
  });
});
