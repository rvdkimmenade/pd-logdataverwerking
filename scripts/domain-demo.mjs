import { readFile } from 'node:fs/promises';
import { validateLogRecord, validateEnvelope } from '@ldv/domain';

const examples = new URL('../contracts/examples/', import.meta.url);
const load = async (name) =>
  JSON.parse(await readFile(new URL(name, examples), 'utf8'));
try {
  let accepted = 0;
  let rejected = 0;
  for (const fixture of (await load('validation-cases.json')).cases) {
    const validate =
      fixture.kind === 'envelope' ? validateEnvelope : validateLogRecord;
    const result = validate(
      fixture.input,
      fixture.policy ? { policy: fixture.policy } : {},
    );
    if (
      result.valid !== fixture.valid ||
      (!result.valid &&
        !result.issues.some((issue) => issue.code === fixture.code))
    )
      throw new Error('Unexpected validation result');
    if (result.valid) accepted++;
    else rejected++;
  }
  const record = await load('valid-ldv-log-record.json');
  if (
    !validateLogRecord(record, { policy: 'synthetic-demo' }).valid ||
    !validateEnvelope(await load('valid-log-event.json'), {
      policy: 'synthetic-demo',
    }).valid
  )
    throw new Error('Existing examples failed');
  for (const example of (await load('data-subject-id-examples.json'))
    .examples) {
    const attributes = {
      ...record.attributes,
      'dpl.core.data_subject_id': example['dpl.core.data_subject_id'],
      'dpl.core.data_subject_id_type': example['dpl.core.data_subject_id_type'],
    };
    if (
      !validateLogRecord(
        { ...record, attributes },
        { policy: 'synthetic-demo' },
      ).valid
    )
      throw new Error('Subject example failed');
    accepted++;
  }
  console.log(
    `LDV domain demo: ${accepted + 2} accepted, ${rejected} correctly rejected; no network or database used.`,
  );
} catch {
  console.error(
    'LDV domain validation failed. Run the domain contract tests for details.',
  );
  process.exitCode = 1;
}
