import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
const root = resolve(import.meta.dirname, '..');
const config = JSON.parse(
  await readFile(resolve(root, '.local/ldv-console-dev/config.json'), 'utf8'),
);
const users = JSON.parse(
  await readFile(
    resolve(root, '.local/ldv-console-dev/import/realm.json'),
    'utf8',
  ),
).users;
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const name of [
    'auditor',
    'investigator',
    'editor',
    'reviewer',
    'reader',
    'technical',
    ...(users.some((user) => user.username === 'admin') ? ['admin'] : []),
  ]) {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 1000 },
    });
    const page = await context.newPage();
    const user = users.find(
      (u) => u.username === (name === 'admin' ? 'admin' : `demo-${name}`),
    );
    await page.goto(config.origin);
    await page
      .getByRole('link', { name: 'Inloggen via identityprovider' })
      .click();
    await page.locator('#username').fill(user.username);
    await page.locator('#password').fill(user.credentials[0].value);
    await page.locator('#kc-login').click();
    await page.waitForURL(
      (url) =>
        url.origin === config.origin ||
        url.pathname.includes('/required-action'),
    );
    if (new URL(page.url()).pathname.includes('/required-action')) {
      for (const [field, value] of [
        ['email', `demo-${name}@example.invalid`],
        ['firstName', 'Demo'],
        ['lastName', name],
      ])
        if (await page.locator(`[name="${field}"]`).count())
          await page.locator(`[name="${field}"]`).fill(value);
      await page
        .locator('input[type="submit"],button[type="submit"]')
        .first()
        .click();
    }
    await page.waitForURL(config.origin + '/').catch(async () => {
      console.log('Login failure path:', new URL(page.url()).pathname);
      if (new URL(page.url()).origin === config.origin)
        console.log(
          'Login failure response:',
          await page.locator('body').innerText(),
        );
      throw new Error('OIDC browser login failed');
    });
    const me = await (await page.request.get(config.origin + '/api/me')).json();
    assert.equal(me.id, user.id);
    const search = await page.request.post(config.origin + '/api/logs/search', {
      headers: { Origin: config.origin },
      data: { limit: 25 },
    });
    assert.equal(
      search.status(),
      ['auditor', 'investigator', 'admin'].includes(name) ? 200 : 403,
    );
    const exported = await page.request.post(
      config.origin + '/api/logs/export',
      { headers: { Origin: config.origin }, data: { limit: 25 } },
    );
    assert.equal(
      exported.status(),
      ['auditor', 'admin'].includes(name) ? 200 : 403,
    );
    const register = await page.request.get(config.origin + '/api/activities');
    assert.equal(
      register.status(),
      ['editor', 'reviewer', 'reader', 'admin'].includes(name) ? 200 : 403,
    );
    if (name === 'auditor') {
      await page.getByRole('button', { name: 'Zoeken', exact: true }).click();
      await page.locator('#results').waitFor({ state: 'visible' });
      assert.ok((await page.locator('#rows tr').count()) > 0);
      await page
        .getByRole('button', { name: 'Details', exact: true })
        .first()
        .click();
      await page.locator('#detail pre').first().waitFor();
      await page
        .getByRole('button', { name: 'Trace', exact: true })
        .first()
        .click();
      await page.locator('#trace').waitFor({ state: 'visible' });
      await mkdir(resolve(root, 'artifacts'), { recursive: true });
      await page.screenshot({
        path: resolve(root, 'artifacts/console-desktop.png'),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({
        path: resolve(root, 'artifacts/console-mobile.png'),
        fullPage: true,
      });
    }
    const operation = await page.request.get(config.origin + '/api/operations');
    assert.equal(
      operation.status(),
      ['technical', 'admin'].includes(name) ? 200 : 403,
    );
    if (name === 'technical' || name === 'admin') {
      await page.getByRole('button', { name: 'Pipeline', exact: true }).click();
      await page.locator('#pipeline').waitFor({ state: 'visible' });
    }
    if (name === 'admin') {
      assert.deepEqual(me.roles, ['editor', 'reviewer', 'reader']);
      await page.goto(config.origin + '/register');
      await page
        .getByRole('button', { name: 'Nieuwe activiteit', exact: true })
        .waitFor();
      await page.screenshot({
        path: resolve(root, 'artifacts/console-admin.png'),
        fullPage: true,
      });
      await page.goto(config.origin);
    }
    await page.getByRole('button', { name: 'Uitloggen', exact: true }).click();
    await page
      .getByRole('link', { name: 'Inloggen via identityprovider' })
      .waitFor();
    assert.equal(
      (await page.request.get(config.origin + '/api/me')).status(),
      401,
    );
    await page
      .getByRole('link', { name: 'Inloggen via identityprovider' })
      .click();
    await page.locator('#password').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#password').inputValue(), '');
    results.push({ name, passed: true });
    console.log(`PASS console OIDC, API and navigation: ${name}`);
    await context.close();
  }
} finally {
  await browser.close();
  await writeFile(
    resolve(root, 'artifacts/console-demo.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
  );
}
