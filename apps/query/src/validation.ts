import { readFile } from 'node:fs/promises';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
export const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats.default(ajv);
for (const name of ['ldv-log-record', 'ldv-envelope', 'register', 'query'])
  ajv.addSchema(
    JSON.parse(
      await readFile(
        new URL(
          `../../../contracts/schemas/${name}.schema.json`,
          import.meta.url,
        ),
        'utf8',
      ),
    ),
  );
export const validateSearch = ajv.getSchema(
  'https://schemas.example.invalid/query.schema.json#/$defs/search',
)!;
export const validatePage = ajv.getSchema(
  'https://schemas.example.invalid/query.schema.json#/$defs/page',
)!;
export const validateItem = ajv.getSchema(
  'https://schemas.example.invalid/query.schema.json#/$defs/item',
)!;
