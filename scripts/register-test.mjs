import assert from 'node:assert/strict';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { chromium, expect } from '@playwright/test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { prepareDatabase, migrate, runtimePool, root } from './register-db.mjs';
import { createApp } from '../apps/register/dist/app.js';
import { Store } from '../apps/register/dist/store.js';
import { report } from './report.mjs';
import { recorder } from './infra.mjs';

const checks = [];
const check = recorder(checks);
let ctx, runtime, app, browser;
const fixture = JSON.parse(
  await readFile(
    resolve(root, 'contracts/examples/valid-register-draft.json'),
    'utf8',
  ),
);
const schema = JSON.parse(
  await readFile(
    resolve(root, 'contracts/schemas/register.schema.json'),
    'utf8',
  ),
);
const ajv = new Ajv2020({ strict: true });
addFormats(ajv);
ajv.addSchema(schema);
const validate = (name, value) =>
  assert.equal(
    ajv.validate(`${schema.$id}#/$defs/${name}`, value),
    true,
    `Response violates ${name}`,
  );
const accounts = ['editor', 'reviewer', 'reader', 'other'].map((role) => ({
  code: randomBytes(32).toString('hex'),
  actor: {
    id: `test-${role}`,
    role: role === 'other' ? 'editor' : role,
    party: role === 'other' ? 'other-municipality' : fixture.party,
  },
}));
const sockets = createServer();
await new Promise((r) => sockets.listen(0, '127.0.0.1', r));
const port = sockets.address().port;
await new Promise((r) => sockets.close(r));
const origin = `http://127.0.0.1:${port}`;
const cookies = {};
async function request(role, method, url, body, headers = {}) {
  return app.inject({
    method,
    url,
    headers: {
      host: `127.0.0.1:${port}`,
      origin,
      ...(cookies[role] ? { cookie: cookies[role] } : {}),
      ...headers,
    },
    ...(body ? { payload: body } : {}),
  });
}
async function good(role, method, url, body, status = 200, contract) {
  const r = await request(role, method, url, body);
  assert.equal(
    r.statusCode,
    status,
    `${method} ${url} expected ${status}, got ${r.statusCode}`,
  );
  const value = r.json();
  if (contract) validate(contract, value);
  return value;
}
let id, version1;
try {
  await check('Register: geïsoleerde PostgreSQL starten', async () => {
    ctx = await prepareDatabase(true);
  });
  await check(
    'Register: lege migratie en upgrade met behoud van data',
    async () => {
      await migrate(ctx.owner, 1);
      const seed = randomUUID();
      await ctx.owner.query(
        'INSERT INTO register.activities(id,party) VALUES($1,$2)',
        [seed, 'migration-fixture'],
      );
      await migrate(ctx.owner);
      await migrate(ctx.owner);
      assert.equal(
        (
          await ctx.owner.query(
            'SELECT count(*)::int AS n FROM public.register_migrations',
          )
        ).rows[0].n,
        2,
      );
      assert.equal(
        (
          await ctx.owner.query(
            'SELECT 1 FROM register.activities WHERE id=$1',
            [seed],
          )
        ).rowCount,
        1,
      );
      runtime = await runtimePool(ctx);
      runtime.pool.on('error', () => {});
      ctx.owner.on('error', () => {});
      app = createApp({ pool: runtime.pool, accounts, origin });
      await app.listen({ host: '127.0.0.1', port });
    },
  );
  await check('Register: authenticatie, scopes en Origin', async () => {
    assert.equal(
      (await request('none', 'GET', '/api/activities')).statusCode,
      401,
    );
    assert.equal(
      (await request('none', 'POST', '/api/session', { code: 'invalid' }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await request(
          'none',
          'POST',
          '/api/session',
          { code: accounts[0].code },
          { origin: 'http://evil.invalid' },
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await request('none', 'GET', '/health', undefined, {
          host: 'evil.invalid',
        })
      ).statusCode,
      403,
    );
    for (const a of accounts) {
      const r = await request('none', 'POST', '/api/session', { code: a.code });
      assert.equal(r.statusCode, 200);
      const cookie = r.headers['set-cookie'];
      assert.match(cookie, /HttpOnly/);
      assert.match(cookie, /SameSite=Strict/);
      cookies[a.actor.id.slice(5)] = cookie.split(';')[0];
    }
    assert.equal(
      (await request('reader', 'POST', '/api/activities', fixture)).statusCode,
      403,
    );
    assert.equal(
      (await request('other', 'POST', '/api/activities', fixture)).statusCode,
      403,
    );
  });
  await check(
    'Register: aanmaken, bewerken en responsecontracten',
    async () => {
      const result = await good(
        'editor',
        'POST',
        '/api/activities',
        fixture,
        201,
        'detail',
      );
      id = result.id;
      version1 = result.versions[0];
      const list = await good('reader', 'GET', '/api/activities');
      validate('summary', list[0]);
      await good(
        'reader',
        'GET',
        `/api/activities/${id}`,
        undefined,
        200,
        'detail',
      );
      assert.equal(
        (await request('other', 'GET', `/api/activities/${id}`)).statusCode,
        404,
      );
      assert.equal((await good('other', 'GET', '/api/activities')).length, 0);
      const draft = {
        content: fixture.content,
        valid_from: fixture.valid_from,
        valid_until: fixture.valid_until,
      };
      version1 = await good(
        'editor',
        'PUT',
        `/api/activities/${id}/versions/1`,
        {
          ...draft,
          revision: 1,
          content: { ...draft.content, purpose: 'Synthetisch aangepast doel' },
        },
        200,
        'version',
      );
      assert.equal(version1.revision, 2);
      assert.equal(
        (
          await request('editor', 'PUT', `/api/activities/${id}/versions/1`, {
            ...draft,
            revision: 1,
          })
        ).statusCode,
        409,
      );
    },
  );
  await check(
    'Register: publicatie door tweede persoon en immutable inhoud',
    async () => {
      assert.equal(
        (
          await request(
            'editor',
            'POST',
            `/api/activities/${id}/versions/1/publish`,
            { revision: 2 },
          )
        ).statusCode,
        403,
      );
      const store = new Store(runtime.pool);
      await assert.rejects(
        () =>
          store.change({ ...accounts[0].actor, role: 'reviewer' }, id, 1, 2),
        (e) => e.code === 'SECOND_PERSON_REQUIRED',
      );
      version1 = await good(
        'reviewer',
        'POST',
        `/api/activities/${id}/versions/1/publish`,
        { revision: 2 },
        200,
        'version',
      );
      const draft = {
        content: fixture.content,
        valid_from: fixture.valid_from,
        valid_until: fixture.valid_until,
      };
      assert.equal(
        (
          await request('editor', 'PUT', `/api/activities/${id}/versions/1`, {
            ...draft,
            revision: 3,
          })
        ).statusCode,
        409,
      );
      await assert.rejects(
        () =>
          ctx.owner.query(
            'UPDATE register.versions SET valid_until=$2 WHERE activity_id=$1 AND version=1',
            [id, '2028-01-01'],
          ),
        (e) => e.code === '55000',
      );
      await assert.rejects(
        () =>
          ctx.owner.query(
            'DELETE FROM register.versions WHERE activity_id=$1 AND version=1',
            [id],
          ),
        (e) => e.code === '55000',
      );
    },
  );
  await check('Register: opvolger, overlap, grenzen en historie', async () => {
    const draft = {
      content: fixture.content,
      valid_from: fixture.valid_from,
      valid_until: fixture.valid_until,
    };
    await good(
      'editor',
      'POST',
      `/api/activities/${id}/versions`,
      {
        ...draft,
        valid_from: '2027-01-01T00:00:00Z',
        valid_until: '2028-01-01T00:00:00Z',
        content: { ...draft.content, purpose: 'Nieuw synthetisch doel' },
      },
      201,
      'version',
    );
    await good(
      'reviewer',
      'POST',
      `/api/activities/${id}/versions/2/publish`,
      { revision: 1 },
      200,
      'version',
    );
    const first = await good(
      'reader',
      'GET',
      `/api/activities/${id}/resolve?at=2026-06-01T00:00:00Z`,
      undefined,
      200,
      'version',
    );
    assert.equal(first.version, 1);
    const second = await good(
      'reader',
      'GET',
      `/api/activities/${id}/resolve?at=2027-01-01T00:00:00Z`,
    );
    assert.equal(second.version, 2);
    assert.equal(
      (
        await request(
          'reader',
          'GET',
          `/api/activities/${id}/resolve?at=2028-01-01T00:00:00Z`,
        )
      ).statusCode,
      404,
    );
    const overlap = await good(
      'editor',
      'POST',
      `/api/activities/${id}/versions`,
      draft,
      201,
    );
    const rejected = await request(
      'reviewer',
      'POST',
      `/api/activities/${id}/versions/${overlap.version}/publish`,
      { revision: 1 },
    );
    assert.equal(rejected.statusCode, 409);
    assert.equal(rejected.json().code, 'OVERLAPPING_INTERVAL');
    assert.deepEqual(
      (await good('reader', 'GET', `/api/activities/${id}`)).versions.find(
        (v) => v.version === 1,
      ),
      version1,
    );
    assert.equal(
      (
        await request(
          'other',
          'GET',
          `/api/activities/${id}/resolve?at=2026-06-01T00:00:00Z`,
        )
      ).statusCode,
      404,
    );
  });
  await check('Register: gelijktijdige concepten en publicaties', async () => {
    const fresh = await good('editor', 'POST', '/api/activities', fixture, 201);
    const draft = {
      content: fixture.content,
      valid_from: fixture.valid_from,
      valid_until: fixture.valid_until,
    };
    const updates = await Promise.all(
      [1, 2].map(() =>
        request('editor', 'PUT', `/api/activities/${fresh.id}/versions/1`, {
          ...draft,
          revision: 1,
        }),
      ),
    );
    assert.deepEqual(updates.map((r) => r.statusCode).sort(), [200, 409]);
    await good(
      'editor',
      'POST',
      `/api/activities/${fresh.id}/versions`,
      draft,
      201,
    );
    const publications = await Promise.all([
      request(
        'reviewer',
        'POST',
        `/api/activities/${fresh.id}/versions/1/publish`,
        { revision: 2 },
      ),
      request(
        'reviewer',
        'POST',
        `/api/activities/${fresh.id}/versions/2/publish`,
        { revision: 1 },
      ),
    ]);
    assert.deepEqual(publications.map((r) => r.statusCode).sort(), [200, 409]);
  });
  await check(
    'Register: beperkte DB-rechten en audit atomair/append-only',
    async () => {
      await assert.rejects(
        () => runtime.pool.query('DELETE FROM register.activities'),
        (e) => e.code === '42501',
      );
      await assert.rejects(
        () => runtime.pool.query('CREATE TABLE register.forbidden(id int)'),
        (e) => e.code === '42501',
      );
      await assert.rejects(
        () => ctx.owner.query("UPDATE register.audit SET action='changed'"),
        (e) => e.code === '55000',
      );
      const audit = (
        await ctx.owner.query(
          "SELECT * FROM register.audit WHERE activity_id=$1 AND action='version.published'",
          [id],
        )
      ).rows;
      assert.equal(audit.length, 2);
      assert.equal(audit[0].actor, 'test-reviewer');
      const before = (
        await ctx.owner.query(
          'SELECT count(*)::int AS n FROM register.activities',
        )
      ).rows[0].n;
      await ctx.owner.query(
        'REVOKE INSERT ON register.audit FROM register_app',
      );
      try {
        assert.equal(
          (await request('editor', 'POST', '/api/activities', fixture))
            .statusCode,
          503,
        );
        assert.equal(
          (
            await ctx.owner.query(
              'SELECT count(*)::int AS n FROM register.activities',
            )
          ).rows[0].n,
          before,
        );
      } finally {
        await ctx.owner.query('GRANT INSERT ON register.audit TO register_app');
      }
    },
  );
  await check('Register: ongeldige invoer en veilige fouten', async () => {
    for (const input of [
      { ...fixture, valid_until: '2025-01-01T00:00:00Z' },
      { ...fixture, content: { ...fixture.content, name: '' } },
      { ...fixture, content: { ...fixture.content, name: 'x'.repeat(121) } },
    ]) {
      const r = await request('editor', 'POST', '/api/activities', input);
      assert.equal(r.statusCode, 400);
      assert.deepEqual(r.json(), { code: r.json().code });
    }
    assert.equal(
      (
        await request(
          'reader',
          'GET',
          `/api/activities/${id}/resolve?at=invalid`,
        )
      ).statusCode,
      400,
    );
    assert.equal(
      (await request('reader', 'GET', '/api/activities/not-uuid')).statusCode,
      400,
    );
    const result = await good('reader', 'GET', '/api/metrics');
    assert.ok(result.denied > 0);
    assert.ok(result.mutations > 0);
  });
  await check(
    'Register: browserflow beheer, publicatie, versies en historie',
    async () => {
      browser = await chromium.launch({ headless: true });
      const editor = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
      });
      const errors = [];
      editor.on('pageerror', (e) => errors.push(e.message));
      await editor.goto(origin);
      await editor.getByLabel('Demo-toegangscode').fill(accounts[0].code);
      await editor
        .getByRole('button', { name: 'Inloggen', exact: true })
        .click();
      await editor
        .getByRole('button', { name: 'Nieuwe activiteit', exact: true })
        .click();
      async function fill(page, name) {
        await page.getByLabel('Naam', { exact: true }).fill(name);
        await page
          .getByLabel('Omschrijving', { exact: true })
          .fill('Synthetische browserdemo');
        await page.getByLabel('Doel', { exact: true }).fill('Synthetisch doel');
        await page
          .getByLabel('Grondslag', { exact: true })
          .fill('Demo-grondslag');
        await page
          .getByRole('button', { name: 'Volgende', exact: true })
          .click();
        await page
          .getByLabel('Categorieën betrokkenen (één per regel)', {
            exact: true,
          })
          .fill('Synthetische inwoners');
        await page
          .getByLabel('Categorieën gegevens (één per regel)', { exact: true })
          .fill('Synthetische gegevens');
        await page
          .getByLabel('Bronsystemen (één per regel)', { exact: true })
          .fill('demo-portaal');
        await page
          .getByLabel('Bewaartermijn', { exact: true })
          .fill('1 demojaar');
        await page
          .getByRole('button', { name: 'Volgende', exact: true })
          .click();
      }
      await fill(editor, 'Browserdemonstratie');
      await editor
        .getByLabel('Geldig vanaf', { exact: true })
        .fill('2026-01-01T00:00');
      await editor
        .getByLabel('Geldig tot (optioneel)', { exact: true })
        .fill('2027-01-01T00:00');
      await editor
        .getByRole('button', { name: 'Concept opslaan', exact: true })
        .click();
      await expect(
        editor.getByRole('heading', {
          name: 'Browserdemonstratie',
          exact: true,
        }),
      ).toBeVisible();
      await editor
        .getByRole('button', { name: 'Concept bewerken', exact: true })
        .click();
      await editor
        .getByLabel('Doel', { exact: true })
        .fill('Aangepast browserdoel');
      await editor
        .getByRole('button', { name: 'Volgende', exact: true })
        .click();
      await editor
        .getByRole('button', { name: 'Volgende', exact: true })
        .click();
      await editor
        .getByRole('button', { name: 'Concept opslaan', exact: true })
        .click();
      await expect(editor.locator('#detail')).toContainText(
        'Aangepast browserdoel',
      );
      const reviewer = await browser.newPage();
      await reviewer.goto(origin);
      await reviewer.getByLabel('Demo-toegangscode').fill(accounts[1].code);
      await reviewer
        .getByRole('button', { name: 'Inloggen', exact: true })
        .click();
      await reviewer
        .getByRole('button', { name: /Browserdemonstratie/ })
        .click();
      await expect(
        reviewer.getByRole('button', {
          name: 'Nieuwe activiteit',
          exact: true,
        }),
      ).toHaveCount(0);
      reviewer.on('dialog', (d) => d.accept());
      await reviewer
        .getByRole('button', { name: 'Publiceren', exact: true })
        .click();
      await expect(reviewer.locator('#message')).toContainText(
        'Versie gepubliceerd',
      );
      await editor.getByRole('button', { name: /Browserdemonstratie/ }).click();
      await expect(
        editor.getByRole('button', { name: 'Concept bewerken', exact: true }),
      ).toHaveCount(0);
      await editor
        .getByRole('button', { name: 'Nieuwe versie', exact: true })
        .click();
      await editor
        .getByLabel('Doel', { exact: true })
        .fill('Opvolgend browserdoel');
      await editor
        .getByRole('button', { name: 'Volgende', exact: true })
        .click();
      await editor
        .getByRole('button', { name: 'Volgende', exact: true })
        .click();
      await editor
        .getByLabel('Geldig vanaf', { exact: true })
        .fill('2027-01-01T00:00');
      await editor
        .getByLabel('Geldig tot (optioneel)', { exact: true })
        .fill('2028-01-01T00:00');
      await editor
        .getByRole('button', { name: 'Concept opslaan', exact: true })
        .click();
      await expect(editor.locator('#difference')).toContainText(
        'Opvolgend browserdoel',
      );
      const activityId = await editor
        .locator('#detail .code')
        .first()
        .textContent();
      const activityButtons = editor.locator('#activities button');
      await editor
        .getByLabel('Zoektekst', { exact: true })
        .fill('  BROWSERDEMONSTRATIE  ');
      await expect(activityButtons).toHaveCount(1);
      await editor.getByLabel('Status van versies').selectOption('draft');
      await editor.getByLabel('Aantal versies').selectOption('multiple');
      await expect(activityButtons).toHaveCount(1);
      await editor.getByLabel('Status van versies').selectOption('published');
      await expect(activityButtons).toHaveCount(1);
      await editor.getByLabel('Status van versies').selectOption('draft-only');
      await expect(activityButtons).toHaveCount(0);
      await expect(editor.locator('#selection-note')).toBeVisible();
      await expect(editor.locator('#detail')).toContainText(
        'Opvolgend browserdoel',
      );
      await editor.getByLabel('Status van versies').selectOption('all');
      await editor.getByLabel('Aantal versies').selectOption('single');
      await expect(activityButtons).toHaveCount(0);
      await editor.getByLabel('Aantal versies').selectOption('multiple');
      await editor.getByLabel('Zoeken in', { exact: true }).selectOption('id');
      await editor
        .getByLabel('Zoektekst', { exact: true })
        .fill(activityId.toUpperCase());
      await expect(activityButtons).toHaveCount(1);
      await expect(editor.locator('#selection-note')).toBeHidden();
      await editor
        .getByLabel('Zoeken in', { exact: true })
        .selectOption('name');
      await expect(activityButtons).toHaveCount(0);
      await editor
        .getByRole('button', { name: 'Filters wissen', exact: true })
        .click();
      await expect(activityButtons).not.toHaveCount(0);
      await expect(editor.getByLabel('Zoektekst', { exact: true })).toHaveValue(
        '',
      );
      await expect(editor.getByLabel('Aantal versies')).toHaveValue('all');
      await expect(editor.getByLabel('Status van versies')).toHaveValue('all');
      const names = () =>
        activityButtons.evaluateAll((buttons) =>
          buttons.map((button) => button.firstChild.textContent),
        );
      const ascending = await names();
      assert.deepEqual(
        ascending,
        [...ascending].sort((a, b) => a.localeCompare(b, 'nl')),
      );
      await editor
        .getByLabel('Sorteren', { exact: true })
        .selectOption('name-desc');
      assert.deepEqual(await names(), [...ascending].reverse());
      await editor
        .getByLabel('Sorteren', { exact: true })
        .selectOption('versions');
      const counts = await activityButtons.locator('small').allTextContents();
      const versionCounts = counts.map((text) => Number.parseInt(text, 10));
      assert.deepEqual(
        versionCounts,
        [...versionCounts].sort((a, b) => b - a),
      );
      await editor
        .getByRole('button', { name: 'Filters wissen', exact: true })
        .click();
      await reviewer
        .getByRole('button', { name: /Browserdemonstratie/ })
        .click();
      await reviewer
        .getByRole('button', { name: 'Publiceren', exact: true })
        .click();
      await expect(reviewer.locator('#message')).toContainText(
        'Versie gepubliceerd',
      );
      await reviewer
        .getByLabel('Tijdstip', { exact: true })
        .fill('2026-06-01T12:00');
      await reviewer
        .getByRole('button', { name: 'Zoek geldige versie', exact: true })
        .click();
      await expect(reviewer.locator('#history-result')).toContainText(
        'Versie 1',
      );
      const reader = await browser.newPage();
      await reader.goto(origin);
      await reader.getByLabel('Demo-toegangscode').fill(accounts[2].code);
      await reader
        .getByRole('button', { name: 'Inloggen', exact: true })
        .click();
      await reader.getByRole('button', { name: /Browserdemonstratie/ }).click();
      await expect(
        reader.getByRole('button', { name: 'Publiceren', exact: true }),
      ).toHaveCount(0);
      await expect(
        reader.getByRole('button', { name: 'Nieuwe versie', exact: true }),
      ).toHaveCount(0);
      await reader.getByLabel('Tijdstip', { exact: true }).focus();
      const historyButton = reader.getByRole('button', {
        name: 'Zoek geldige versie',
        exact: true,
      });
      for (
        let step = 0;
        step < 10 &&
        !(await historyButton.evaluate(
          (element) => element === document.activeElement,
        ));
        step++
      )
        await reader.keyboard.press('Tab');
      await expect(
        reader.getByRole('button', {
          name: 'Zoek geldige versie',
          exact: true,
        }),
      ).toBeFocused();
      await mkdir(resolve(root, 'artifacts'), { recursive: true });
      await reviewer.setViewportSize({ width: 1440, height: 1100 });
      await reviewer.screenshot({
        path: resolve(root, 'artifacts/register-desktop.png'),
        fullPage: true,
      });
      await reader.setViewportSize({ width: 390, height: 844 });
      await reader.screenshot({
        path: resolve(root, 'artifacts/register-mobile.png'),
        fullPage: true,
      });
      assert.equal(
        await reader.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        ),
        false,
      );
      assert.equal(errors.length, 0);
      await browser.close();
      browser = null;
    },
  );
  await check(
    'Register: database-uitval geeft geen succes; herstel',
    async () => {
      ctx.compose(['stop', 'postgres']);
      assert.equal((await request('reader', 'GET', '/ready')).statusCode, 503);
      assert.equal(
        (await request('editor', 'POST', '/api/activities', fixture))
          .statusCode,
        503,
      );
      ctx.compose(['up', '--detach', '--wait', '--wait-timeout', '120'], {
        timeout: 180_000,
      });
      let recovered = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        if ((await request('reader', 'GET', '/ready')).statusCode === 200) {
          recovered = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      assert.equal(
        recovered,
        true,
        'Register must recover after database restart',
      );
      const restored = await good(
        'reader',
        'GET',
        `/api/activities/${id}`,
        undefined,
        200,
        'detail',
      );
      assert.deepEqual(
        restored.versions.find((version) => version.version === 1),
        version1,
      );
    },
  );
} catch (error) {
  console.error(
    error.stack
      ?.split('\n')
      .filter((line) => line.includes('register-test.mjs:'))
      .slice(0, 3)
      .join('\n'),
  );
  console.error(
    `Register gate failed: ${error.name}; inspect the last failing check.`,
  );
  if (browser) {
    await mkdir(resolve(root, 'artifacts'), { recursive: true });
    const pages = browser.contexts().flatMap((context) => context.pages());
    for (const [index, page] of pages.entries())
      await page.screenshot({
        path: resolve(root, `artifacts/register-failure-${index}.png`),
        fullPage: true,
      });
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  await app?.close();
  await runtime?.pool.end();
  await ctx?.owner.end();
  if (ctx) {
    await check('Register: eigen testomgeving opruimen', async () => {
      assert.match(ctx.project, /^ldv-register-test-[0-9a-f-]{36}$/);
      assert.equal(dirname(ctx.directory), resolve(root, '.local'));
      assert.equal(ctx.directory, resolve(root, '.local', ctx.project));
      ctx.compose(['down', '--volumes']);
      await rm(ctx.directory, { recursive: true });
    });
  }
  console.log(await report('register', checks));
}
