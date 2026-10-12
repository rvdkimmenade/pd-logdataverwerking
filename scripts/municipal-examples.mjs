import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { request } from 'node:https';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { validateLogRecord } from '@ldv/domain';

const root = resolve(import.meta.dirname, '..');
const load = async (path) =>
  JSON.parse(await readFile(resolve(root, path), 'utf8'));
const { scenarios } = await load('contracts/examples/municipal-scenarios.json');
const template = await load('contracts/examples/valid-ldv-log-record.json');
const digest = (text, length) =>
  createHash('sha256').update(text).digest('hex').slice(0, length);
const at = Date.parse('2026-10-12T08:00:00Z');
let stage = 'configuration';
function draft(scenario) {
  return {
    party: 'example-municipality',
    content: {
      name: 'Demo gemeente: ' + scenario.title,
      description:
        'Uitsluitend synthetisch gemeentelijk voorbeeld; geen echte personen of dossiers.',
      purpose: scenario.purpose,
      legal_basis:
        'Synthetische demo: grondslag en onderbouwing voor werkelijk gebruik nog vast te stellen.',
      retention:
        'Synthetische demo: bewaartermijn en startmoment voor werkelijk gebruik nog vast te stellen.',
      data_subject_categories: scenario.data_subject_categories,
      data_categories: scenario.data_categories,
      processors: ['Synthetische applicatieleverancier'],
      recipients: ['Bevoegde gemeentelijke rollen in de demo'],
      source_systems: ['demo-gemeente-portaal'],
      destination_systems: ['demo-' + scenario.slug + '-zaakdienst'],
    },
    valid_from: '2026-01-01T00:00:00Z',
    valid_until: '2027-01-01T00:00:00Z',
  };
}
function records(scenario, activityId) {
  const trace = digest('municipal-demo-v1:' + activityId, 32);
  const parent = digest(trace + ':0', 16);
  return scenario.steps.map((step, index) => {
    const record = structuredClone(template);
    record.trace_id = trace;
    record.span_id = digest(trace + ':' + index, 16);
    if (index) record.parent_span_id = parent;
    else delete record.parent_span_id;
    record.name = step.name;
    record.start_time = at + index * 60000;
    record.end_time = record.start_time + 1000;
    record.attributes['dpl.core.processing_activity_id'] = activityId;
    record.attributes['dpl.core.data_subject_id'] =
      `example-subject-not-real-${301 + scenarios.indexOf(scenario) * 100 + (step.subject === 'aanvrager' ? 0 : 1)}`;
    record.attributes['dpl.pd.case_id'] =
      `example-case-not-real-${301 + scenarios.indexOf(scenario) * 100}`;
    record.attributes['dpl.pd.case_type'] =
      'https://catalog.example.invalid/case-types/' + scenario.slug;
    record.attributes['dpl.pd.service_id'] =
      'https://catalog.example.invalid/services/' + scenario.slug;
    record.attributes['dpl.pd.data_destination'] =
      'demo-' + scenario.slug + '-zaakdienst';
    return record;
  });
}
const ajv = new Ajv2020({ strict: true });
addFormats(ajv);
ajv.addSchema(await load('contracts/schemas/register.schema.json'));
const validateDraft = ajv.getSchema(
  'https://schemas.example.invalid/register.schema.json#/$defs/create',
);
for (const scenario of scenarios) {
  assert.ok(
    validateDraft(draft(scenario)),
    'Municipal register fixture must validate',
  );
  const sample = records(
    scenario,
    'urn:uuid:00000000-0000-4000-8000-000000000001',
  );
  assert.equal(new Set(sample.map((r) => r.span_id)).size, sample.length);
  assert.equal(
    new Set(sample.map((r) => r.attributes['dpl.core.data_subject_id'])).size,
    2,
  );
  for (const record of sample)
    assert.ok(
      validateLogRecord(record, { policy: 'synthetic-demo' }).valid,
      'Municipal LDV fixture must validate',
    );
}

async function main() {
  if (process.argv.includes('--check')) {
    console.log(
      '3 municipal register examples and 12 synthetic parent/child records validated',
    );
    return;
  }
  const config = await load('.local/ldv-console-dev/config.json');
  const realm = await load('.local/ldv-console-dev/import/realm.json');
  assert.equal(config.mode, 'local-demo');
  assert.equal(config.origin, 'https://127.0.0.1:18087');
  const browser = await chromium.launch({ headless: true });
  const report = [];
  try {
    async function login(role) {
      const user = realm.users.find((u) => u.username === 'demo-' + role);
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await context.newPage();
      await page.goto(config.origin + '/auth/login');
      await page.locator('#username').fill(user.username);
      await page.locator('#password').fill(user.credentials[0].value);
      await page.locator('#kc-login').click();
      await page.waitForURL(config.origin + '/');
      return page;
    }
    stage = 'OIDC demo-role login';
    const editor = await login('editor'),
      reviewer = await login('reviewer'),
      auditor = await login('auditor');
    async function api(page, path, body) {
      const response =
        body === undefined
          ? await page.request.get(config.origin + path)
          : await page.request.post(config.origin + path, {
              headers: { Origin: config.origin },
              data: body,
            });
      assert.ok(response.ok(), 'Console request failed: ' + response.status());
      return response.json();
    }
    const existing = await api(editor, '/api/activities');
    assert.ok(existing.length < 197, 'Register listing limit reached');
    for (const scenario of scenarios) {
      stage = 'register activity: ' + scenario.slug;
      const found = existing.find(
        (a) => a.name === draft(scenario).content.name,
      );
      const activity = found
        ? await api(editor, '/api/activities/' + found.id)
        : await api(editor, '/api/activities', draft(scenario));
      const version = activity.versions.find((v) => v.version === 1);
      assert.deepEqual(
        version.content,
        draft(scenario).content,
        'Existing demo activity was edited; retain it without publishing or changing it',
      );
      if (version.status === 'draft')
        await api(
          reviewer,
          `/api/activities/${activity.id}/versions/1/publish`,
          { revision: version.revision },
        );
      const resolved = await api(auditor, '/api/me');
      assert.equal(resolved.party, 'example-municipality');
      report.push({
        scenario: scenario.slug,
        name: draft(scenario).content.name,
        activity_id: activity.processing_activity_id,
        records: records(scenario, activity.processing_activity_id),
      });
    }
    const directory = resolve(root, '.local/ldv-ingest-dev');
    stage = 'local ingest provisioning';
    const ingestFile = resolve(directory, 'config.json');
    const ingest = await load('.local/ldv-ingest-dev/config.json');
    assert.equal(ingest.syntheticOnly, true);
    const source = Object.values(ingest.sources).find(
      (s) =>
        s.source_application === 'demo-service' &&
        s.responsible_party === 'example-municipality',
    );
    assert.ok(source, 'Existing scoped demo source required');
    const tls = {
      ca: await readFile(resolve(directory, 'pki/ca.crt')),
      cert: await readFile(resolve(directory, 'pki/source.crt')),
      key: await readFile(resolve(directory, 'pki/source.key')),
    };
    async function ingestRequest(path, payload, headers = {}) {
      return new Promise((done, reject) => {
        const req = request(
          {
            ...tls,
            hostname: '127.0.0.1',
            port: 18082,
            path,
            method: payload === undefined ? 'GET' : 'POST',
            headers: { 'content-type': 'application/json', ...headers },
          },
          (res) => {
            let text = '';
            res.on('data', (b) => (text += b));
            res.on('end', () => {
              try {
                done({ status: res.statusCode, body: JSON.parse(text) });
              } catch {
                reject(new Error('Invalid ingest response'));
              }
            });
          },
        );
        req.setTimeout(15000, () => req.destroy(new Error('Ingest timeout')));
        req.on('error', reject);
        req.end(payload === undefined ? undefined : JSON.stringify(payload));
      });
    }
    const missing = report
      .map((r) => r.activity_id)
      .filter((id) => !source.activities.includes(id));
    if (missing.length) {
      source.activities.push(...missing);
      await writeFile(ingestFile, JSON.stringify(ingest), { mode: 0o600 });
      assert.equal(
        (
          await ingestRequest(
            '/local/stop',
            {},
            { 'x-local-control': ingest.controlToken },
          )
        ).status,
        200,
      );
      for (let n = 0; n < 40; n++) {
        try {
          await ingestRequest('/ready');
        } catch {
          break;
        }
        await sleep(250);
        assert.ok(n < 39, 'Ingest did not stop');
      }
      const child = spawn(
        process.execPath,
        [resolve(root, 'apps/ingest/dist/server.js'), ingestFile],
        { cwd: root, detached: true, windowsHide: true, stdio: 'ignore' },
      );
      child.unref();
      let ready = false;
      for (let n = 0; n < 60; n++) {
        try {
          ready = (await ingestRequest('/ready')).status === 200;
        } catch {
          /* Await local readiness. */
        }
        if (ready) break;
        await sleep(500);
      }
      assert.ok(ready, 'Ingest did not restart');
    }
    for (const example of report) {
      stage = 'ingest publication: ' + example.scenario;
      example.events = [];
      for (const record of example.records) {
        const response = await ingestRequest('/v1/log-records', record, {
          'idempotency-key': digest(
            'municipal-demo-v1:' + example.activity_id + ':' + record.span_id,
            32,
          ).replace(
            /^(........)(....)(....)(....)(............)$/,
            '$1-$2-$3-$4-$5',
          ),
        });
        if (response.status !== 202)
          console.error(
            'Ingest status: ' +
              response.status +
              '; code: ' +
              (response.body.code ?? 'unknown'),
          );
        assert.equal(response.status, 202);
        example.events.push(response.body.event_id);
      }
      let result;
      stage = 'console search: ' + example.scenario;
      for (let n = 0; n < 120; n++) {
        result = await api(auditor, '/api/logs/search', {
          processing_activity_id: example.activity_id,
          limit: 25,
        });
        if (result.items.length === example.records.length) break;
        await sleep(500);
      }
      assert.equal(result.items.length, example.records.length);
      stage = 'historical detail: ' + example.scenario;
      const detail = await api(auditor, '/api/logs/' + example.events[0]);
      assert.equal(detail.processing_activity.status, 'resolved');
      assert.equal(detail.processing_activity.content.name, example.name);
      example.trace_id = example.records[0].trace_id;
      delete example.records;
      console.log(
        'PASS municipal demo: ' +
          example.name +
          ' (4 records, register context resolved)',
      );
    }
    await auditor.goto(config.origin);
    await auditor.locator('#search').waitFor();
    await mkdir(resolve(root, 'artifacts'), { recursive: true });
    for (const example of report) {
      stage = 'browser trace and register: ' + example.scenario;
      await auditor
        .locator('[name="processing_activity_id"]')
        .fill(example.activity_id);
      await auditor
        .getByRole('button', { name: 'Zoeken', exact: true })
        .click();
      await expect(auditor.locator('#rows')).toContainText(example.name);
      await auditor.locator('#rows tr').nth(3).waitFor();
      assert.equal(await auditor.locator('#rows tr').count(), 4);
      assert.ok(
        (await auditor.locator('#rows').innerText()).includes(
          example.name.replace('Demo gemeente: ', ''),
        ),
      );
      await auditor
        .getByRole('button', { name: 'Details', exact: true })
        .first()
        .click();
      await auditor.locator('#detail pre').first().waitFor();
      await expect(auditor.locator('#detail')).toContainText(example.name);
      assert.ok(
        (await auditor.locator('#detail').innerText()).includes('resolved'),
      );
      await auditor
        .getByRole('button', { name: 'Trace', exact: true })
        .first()
        .click();
      await auditor.locator('#spans li').nth(3).waitFor();
      await expect(auditor.locator('#trace-note')).toContainText(
        example.trace_id,
      );
      assert.equal(await auditor.locator('#spans li').count(), 4);
      await auditor.screenshot({
        path: resolve(root, 'artifacts/municipal-' + example.scenario + '.png'),
        fullPage: true,
      });
    }
    await editor.goto(config.origin + '/register');
    stage = 'register browser listing';
    for (const example of report)
      await expect(editor.locator('body')).toContainText(example.name);
    await editor.screenshot({
      path: resolve(root, 'artifacts/municipal-register.png'),
      fullPage: true,
    });
    await writeFile(
      resolve(root, 'artifacts/municipal-demo.json'),
      JSON.stringify({ examples: report }, null, 2),
    );
    console.log(
      'Examples available in the console and register; repeating the command preserves activities and receipt identities.',
    );
  } finally {
    await browser.close();
  }
}
main().catch(() => {
  console.error(
    'Municipal demo failed at ' +
      stage +
      '. Check local services and fixture compatibility; credentials are never printed.',
  );
  process.exitCode = 1;
});
