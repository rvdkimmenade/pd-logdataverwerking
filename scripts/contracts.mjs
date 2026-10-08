import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import SwaggerParser from '@apidevtools/swagger-parser';

const root = resolve(import.meta.dirname, '..');
const contracts = resolve(root, 'contracts');

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? files(path) : [path];
    }),
  );
  return nested.flat().sort();
}

export async function validateOpenApi(path) {
  return SwaggerParser.validate(path, { resolve: { http: false } });
}

export async function checkContracts() {
  const documents = new Map();
  for (const path of await files(contracts)) {
    if (!/\.(json|ya?ml)$/.test(path)) continue;
    const text = await readFile(path, 'utf8');
    documents.set(
      path,
      path.endsWith('.json')
        ? JSON.parse(text)
        : parse(text, { uniqueKeys: true }),
    );
  }
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const schemas = [...documents].filter(([path]) =>
    path.endsWith('.schema.json'),
  );
  for (const [, schema] of schemas) ajv.addSchema(schema);
  for (const [, schema] of schemas) {
    if (!ajv.getSchema(schema.$id))
      throw new Error('Schema could not be compiled');
  }
  const examples = [
    ['valid-ldv-log-record.json', 'ldv-log-record.schema.json'],
    ['valid-log-event.json', 'ldv-envelope.schema.json'],
  ];
  for (const [example, schema] of examples) {
    const validator = ajv.getSchema(
      `https://schemas.example.invalid/${schema}`,
    );
    if (!validator(documents.get(resolve(contracts, 'examples', example)))) {
      throw new Error(`Contract fixture rejected: ${example}`);
    }
  }
  const attributeProperties = documents.get(
    resolve(contracts, 'schemas/ldv-log-record.schema.json'),
  ).properties.attributes.properties;
  const subjectValidator = ajv.compile({
    type: 'object',
    required: ['dpl.core.data_subject_id', 'dpl.core.data_subject_id_type'],
    properties: attributeProperties,
  });
  for (const example of documents.get(
    resolve(contracts, 'examples/data-subject-id-examples.json'),
  ).examples) {
    if (!subjectValidator(example))
      throw new Error('Subject documentation example rejected');
  }
  let apiCount = 0;
  for (const [path, document] of documents) {
    if (!document.openapi) continue;
    await validateOpenApi(path);
    const media =
      document.paths['/v1/log-records'].post.requestBody.content[
        'application/json'
      ];
    const externalPath = resolve(
      dirname(path),
      media.examples.demo.externalValue,
    );
    if (relative(contracts, externalPath).startsWith('..'))
      throw new Error('Example outside contracts');
    const validator = ajv.getSchema(
      'https://schemas.example.invalid/ldv-log-record.schema.json',
    );
    if (!validator(JSON.parse(await readFile(externalPath, 'utf8')))) {
      throw new Error('OpenAPI external example rejected');
    }
    apiCount++;
  }
  if (apiCount === 0 || schemas.length === 0)
    throw new Error('Missing contract inputs');
  return {
    documents: documents.size,
    schemas: schemas.length,
    openapi: apiCount,
    fixtures: 5,
  };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    console.log('Contract checks:', await checkContracts());
  } catch {
    console.error(
      'Contract validation failed. Check syntax, local references, schemas and examples.',
    );
    process.exitCode = 1;
  }
}
