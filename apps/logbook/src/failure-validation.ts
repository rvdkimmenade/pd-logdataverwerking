import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import formats from 'ajv-formats';
import type { Failure } from './consumer.js';
const ajv = new Ajv2020({ strict: true });
formats.default(ajv);
export const validateFailure = ajv.compile<Failure>(
  JSON.parse(
    readFileSync(
      new URL(
        '../../../contracts/schemas/consumer-failure.schema.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ),
);
