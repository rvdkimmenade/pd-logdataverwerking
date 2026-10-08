import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ErrorObject } from 'ajv';
import { default as formats } from 'ajv-formats';
import type {
  LdvAttributes,
  LdvCoreAttributes,
  PdCandidateAttributes,
  LdvLogRecord,
  LdvEnvelope,
  ValidationIssue,
  ValidationResult,
  ValidationOptions,
} from './types.js';
export type * from './types.js';

const recordSchema = JSON.parse(
  readFileSync(
    new URL(
      '../../../contracts/schemas/ldv-log-record.schema.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const envelopeSchema = JSON.parse(
  readFileSync(
    new URL(
      '../../../contracts/schemas/ldv-envelope.schema.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const ajv = new Ajv2020({ allErrors: true, strict: true, ownProperties: true });
formats.default(ajv);
const recordValidator = ajv.compile<LdvLogRecord>(recordSchema);
const envelopeValidator = ajv.compile<LdvEnvelope>(envelopeSchema);
const coreKeys = Object.keys(
  recordSchema.properties.attributes.properties,
).filter((key) => key.startsWith('dpl.core.'));
const candidateKeys = Object.keys(
  recordSchema.properties.attributes.properties,
).filter((key) => key.startsWith('dpl.pd.'));
const safePaths = new Set([
  '',
  ...Object.keys(recordSchema.properties).map((key) => `/${key}`),
  ...Object.keys(envelopeSchema.properties).map((key) => `/${key}`),
  '/resource/attributes',
  ...[...coreKeys, ...candidateKeys].map((key) => `/attributes/${key}`),
]);

function schemaIssues(
  errors: ErrorObject[] | null | undefined,
): ValidationIssue[] {
  return (errors ?? []).map((error) => {
    let path = error.instancePath;
    if (error.keyword === 'required')
      path += `/${error.params.missingProperty}`;
    const prefix = path.startsWith('/payload/') ? '/payload' : '';
    let local = prefix ? path.slice(prefix.length) : path;
    while (!safePaths.has(local))
      local = local.slice(0, local.lastIndexOf('/'));
    return { layer: 'schema', code: 'SCHEMA_INVALID', path: prefix + local };
  });
}

function semanticIssues(
  record: LdvLogRecord,
  options: ValidationOptions,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const key of ['start_time', 'end_time'] as const) {
    if (!Number.isSafeInteger(record[key]))
      issues.push({
        layer: 'semantic',
        code: 'TIME_PRECISION',
        path: `/${key}`,
      });
  }
  if (record.end_time < record.start_time)
    issues.push({ layer: 'semantic', code: 'TIME_ORDER', path: '/end_time' });
  for (const key of ['trace_id', 'span_id', 'parent_span_id'] as const) {
    if (record[key] !== undefined && /^0+$/.test(record[key]))
      issues.push({ layer: 'semantic', code: 'ZERO_ID', path: `/${key}` });
  }
  if (options.policy === 'synthetic-demo') {
    if (
      !/^example-(subject|employee|organisation)-not-real-[0-9]{3}$/.test(
        record.attributes['dpl.core.data_subject_id'],
      )
    ) {
      issues.push({
        layer: 'policy',
        code: 'DEMO_SUBJECT_REQUIRED',
        path: '/attributes/dpl.core.data_subject_id',
      });
    }
    const caseId = record.attributes['dpl.pd.case_id'];
    if (
      caseId !== undefined &&
      !/^example-case-not-real-[0-9]{3}$/.test(caseId)
    ) {
      issues.push({
        layer: 'policy',
        code: 'DEMO_CASE_REQUIRED',
        path: '/attributes/dpl.pd.case_id',
      });
    }
  }
  return issues;
}

export function validateLogRecord(
  input: unknown,
  options: ValidationOptions = {},
): ValidationResult<LdvLogRecord> {
  if (!recordValidator(input))
    return { valid: false, issues: schemaIssues(recordValidator.errors) };
  const issues = semanticIssues(input, options);
  return issues.length
    ? { valid: false, issues }
    : { valid: true, value: input };
}

export function validateEnvelope(
  input: unknown,
  options: ValidationOptions = {},
): ValidationResult<LdvEnvelope> {
  if (!envelopeValidator(input))
    return { valid: false, issues: schemaIssues(envelopeValidator.errors) };
  const issues = semanticIssues(input.payload, options).map((issue) => ({
    ...issue,
    path: `/payload${issue.path}`,
  }));
  return issues.length
    ? { valid: false, issues }
    : { valid: true, value: input };
}

export function splitAttributes(attributes: LdvAttributes): {
  core: LdvCoreAttributes;
  candidates: PdCandidateAttributes;
  other: Record<string, unknown>;
} {
  const core = Object.fromEntries(
    Object.entries(attributes).filter(([key]) => coreKeys.includes(key)),
  ) as unknown as LdvCoreAttributes;
  const candidates = Object.fromEntries(
    Object.entries(attributes).filter(([key]) => candidateKeys.includes(key)),
  ) as PdCandidateAttributes;
  const other = Object.fromEntries(
    Object.entries(attributes).filter(
      ([key]) => !coreKeys.includes(key) && !candidateKeys.includes(key),
    ),
  );
  return { core, candidates, other };
}
