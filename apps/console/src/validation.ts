import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import formats from 'ajv-formats';
const ajv = new Ajv2020({ strict: true, allErrors: true });
formats.default(ajv);
for (const name of [
  'ldv-log-record',
  'ldv-envelope',
  'register',
  'query',
  'console',
])
  ajv.addSchema(
    JSON.parse(
      readFileSync(
        new URL(
          `../../../contracts/schemas/${name}.schema.json`,
          import.meta.url,
        ),
        'utf8',
      ),
    ),
  );
export const identity = ajv.getSchema(
  'https://schemas.example.invalid/console.schema.json#/$defs/identity',
)!;
export const exportResult = ajv.getSchema(
  'https://schemas.example.invalid/console.schema.json#/$defs/export',
)!;
export const operationsResult = ajv.getSchema(
  'https://schemas.example.invalid/console.schema.json#/$defs/operations',
)!;
export const queryPage = ajv.getSchema(
  'https://schemas.example.invalid/query.schema.json#/$defs/page',
)!;
export const queryItem = ajv.getSchema(
  'https://schemas.example.invalid/query.schema.json#/$defs/item',
)!;
