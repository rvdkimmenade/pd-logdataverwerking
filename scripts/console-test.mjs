import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import pg from 'pg';
import { Producer, stringSerializers } from '@platformatic/kafka';
import { prepareIngest, root } from './ingest-infra.mjs';
import { prepareLogbook } from './logbook-infra.mjs';
import { prepareQuery } from './query-infra.mjs';
import { prepareDatabase, migrate, runtimePool } from './register-db.mjs';
import { prepareProvider, freePort } from './console-provider.mjs';
import { createApp as registerApp } from '../apps/register/dist/app.js';
import { Store } from '../apps/register/dist/store.js';
import { createApp as queryApp } from '../apps/query/dist/app.js';
import { QueryService } from '../apps/query/dist/service.js';
import { RegisterClient } from '../apps/query/dist/register-client.js';
import { SearchClient } from '../apps/query/dist/search-client.js';
import { Projector } from '../apps/query/dist/projector.js';
import { createApp as consoleApp } from '../apps/console/dist/app.js';
import { Sessions } from '../apps/console/dist/auth.js';
import { Operations } from '../apps/console/dist/operations.js';
import { queryRequest } from './query-local.mjs';
import { validatePage, validateItem } from '../apps/query/dist/validation.js';
const results = [];
async function gate(name, run) {
  try {
    await run();
    results.push({ name, passed: true });
    console.log('PASS Console: ' + name);
  } catch (error) {
    results.push({ name, passed: false });
    throw new Error('Console gate failed: ' + name, { cause: error });
  }
}
async function until(check, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Condition timeout');
}
let ctx,
  archive,
  infra,
  regctx,
  runtime,
  reg,
  provider,
  query,
  app,
  browser,
  writer,
  reader,
  projectorPool,
  operations,
  observing,
  producer;
const contexts = [];
const fixture = JSON.parse(
  await readFile(
    resolve(root, 'contracts/examples/valid-log-event.json'),
    'utf8',
  ),
);
const draft = JSON.parse(
  await readFile(
    resolve(root, 'contracts/examples/valid-register-draft.json'),
    'utf8',
  ),
);
const traceId = randomBytes(16).toString('hex'),
  parent = randomBytes(8).toString('hex');
const events = [];
const versionDraft = structuredClone(draft);
delete versionDraft.party;
let activity, origin, projector, queryPort;
const definitions = [
  ['editor', ['register']],
  ['reviewer', ['register']],
  ['reader', ['register']],
  ['auditor', ['log.read', 'log.export']],
  ['investigator', ['log.read']],
  ['technical', ['operations']],
  ['admin', ['register', 'log.read', 'log.export', 'operations']],
  ['foreign', ['log.read']],
];
const users = definitions.map(([name, permissions]) => ({
  id: randomUUID(),
  username: 'synthetic-' + name,
  password: randomBytes(24).toString('hex'),
  actor: {
    id: randomUUID(),
    party: name === 'foreign' ? 'other-party' : fixture.responsible_party,
    role:
      name === 'admin'
        ? 'editor'
        : ['editor', 'reviewer'].includes(name)
          ? name
          : 'reader',
    ...(name === 'admin' ? { roles: ['editor', 'reviewer', 'reader'] } : {}),
    permissions,
    applications: [fixture.source_application],
    backend: name === 'foreign' ? 'other' : 'auditor',
  },
}));
const pages = {};
let auditFails = false;
async function login(name) {
  const user = users.find((u) => u.username === 'synthetic-' + name);
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
  });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto(origin);
  await page
    .getByRole('link', { name: 'Inloggen via identityprovider' })
    .click();
  await page.locator('#username').fill(user.username);
  await page.locator('#password').fill(user.password);
  await page.locator('#kc-login').click();
  await page.waitForURL(origin + '/');
  pages[name] = page;
  return page;
}
async function request(
  page,
  path,
  body,
  method = body === undefined ? 'GET' : 'POST',
) {
  return page.request.fetch(origin + path, {
    method,
    headers: { Origin: origin },
    ...(body === undefined ? {} : { data: body }),
  });
}
try {
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  await gate(
    'Isolated TLS provider, register, query and console start',
    async () => {
      ctx = await prepareIngest(true);
      archive = await prepareLogbook(ctx);
      infra = await prepareQuery(ctx, archive, true);
      regctx = await prepareDatabase(true);
      await migrate(regctx.owner);
      runtime = await runtimePool(regctx);
      const accounts = ['editor', 'reviewer', 'reader'].map((role) => ({
        code: randomBytes(32).toString('hex'),
        actor: {
          id: 'register-' + role,
          role,
          party: fixture.responsible_party,
        },
      }));
      accounts.push({
        code: randomBytes(32).toString('hex'),
        actor: {
          id: 'other-register-reader',
          role: 'reader',
          party: 'other-party',
        },
      });
      const port = await freePort();
      reg = registerApp({
        pool: runtime.pool,
        accounts,
        origin: `http://127.0.0.1:${port}`,
      });
      await reg.listen({ host: '127.0.0.1', port });
      const store = new Store(runtime.pool);
      activity = await store.create(accounts[0].actor, {
        ...draft,
        valid_from: '2026-01-01T00:00:00Z',
        valid_until: '2026-07-01T00:00:00Z',
      });
      await store.change(accounts[1].actor, activity.id, 1, 1);
      await store.next(accounts[0].actor, activity.id, {
        ...draft,
        content: { ...draft.content, name: 'Synthetic successor' },
        valid_from: '2026-07-01T00:00:00Z',
        valid_until: '2027-01-01T00:00:00Z',
      });
      await store.change(accounts[1].actor, activity.id, 2, 1);
      writer = new pg.Pool(archive.config.database);
      reader = new pg.Pool(infra.query.database);
      projectorPool = new pg.Pool(infra.projector.database);
      for (const pool of [writer, reader, projectorPool])
        pool.on('error', () => {});
      for (let i = 0; i < 4; i++) {
        const event = structuredClone(fixture);
        event.event_id = randomUUID();
        event.payload.trace_id = traceId;
        event.payload.span_id =
          i === 0 ? parent : randomBytes(8).toString('hex');
        if (i === 0) delete event.payload.parent_span_id;
        else event.payload.parent_span_id = parent;
        event.payload.start_time =
          Date.parse(
            i === 0 ? '2026-06-30T23:59:59Z' : '2026-07-01T00:00:01Z',
          ) + i;
        event.payload.end_time = event.payload.start_time + 1000;
        event.payload.attributes['dpl.core.processing_activity_id'] =
          activity.processing_activity_id;
        event.payload.attributes['dpl.core.data_subject_id'] =
          `example-subject-not-real-${String(i + 1).padStart(3, '0')}`;
        if (i === 3) event.responsible_party = 'other-party';
        const raw = Buffer.from(JSON.stringify(event));
        await writer.query(
          'SELECT logbook.store_record($1::jsonb,$2,$3,$4,$5,$6)',
          [
            event,
            raw,
            createHash('sha256').update(raw).digest('hex'),
            'ldv.accepted.v1',
            0,
            String(i),
          ],
        );
        events.push(event);
      }
      projector = new Projector(
        projectorPool,
        new SearchClient(infra.projector.search),
      );
      await projector.sync();
      const service = new QueryService(
        reader,
        new SearchClient(infra.query.search),
        new RegisterClient({
          origin: `http://127.0.0.1:${port}`,
          readers: {
            [fixture.responsible_party]: accounts[2].code,
            'other-party': accounts[3].code,
          },
        }),
        randomBytes(32).toString('hex'),
      );
      const scope = {
        id: 'console-workload',
        party: fixture.responsible_party,
        applications: [fixture.source_application],
        read: true,
      };
      const initial = await service.search(scope, { limit: 25 });
      assert.equal(initial.items.length, 3);
      assert.ok(validatePage(initial));
      query = queryApp({
        tls: infra.query.tls,
        service,
        scopes: {
          [await ctx.fingerprint('auditor')]: scope,
          [await ctx.fingerprint('auditor-other')]: {
            ...scope,
            id: 'other-workload',
            party: 'other-party',
          },
        },
        audit: async () => {},
      });
      await query.listen({ host: '127.0.0.1', port: 0 });
      queryPort = query.server.address().port;
      origin = `https://127.0.0.1:${await freePort()}`;
      provider = await prepareProvider(ctx, origin, users);
      const acl = (operations, scope) =>
        ctx.cli('acls', [
          '--add',
          '--allow-principal',
          'User:CN=console-ops',
          ...operations.flatMap((o) => ['--operation', o]),
          ...scope,
        ]);
      for (const topic of ['ldv.rejected.v1', 'ldv.dead-letter.v1'])
        acl(['Read', 'Describe'], ['--topic', topic]);
      acl(['Describe'], ['--topic', 'ldv.accepted.v1']);
      acl(['Read', 'Describe'], ['--group', 'ldv-console-ops-v1']);
      acl(['Describe'], ['--group', 'ldv-logbook-v1']);
      operations = new Operations(
        { ...ctx.kafka, tls: await ctx.tls('console-ops') },
        async () => projector.snapshot(),
      );
      observing = operations.run();
      const sessions = await Sessions.create(
        provider.issuer,
        provider.clientId,
        provider.secret,
        origin,
        Object.fromEntries(users.map((user) => [user.id, user.actor])),
        provider.ca,
      );
      const backend = {
        auditor: await ctx.tls('auditor'),
        other: await ctx.tls('auditor-other'),
      };
      app = await consoleApp({
        pool: runtime.pool,
        origin,
        tls: provider.tls,
        sessions,
        query: (actor, path, body) =>
          queryRequest(backend[actor.backend], path, body, queryPort),
        audit: async (actor, action) => {
          if (auditFails) throw new Error('Synthetic audit unavailable');
          await runtime.pool.query(
            'INSERT INTO register.audit(party,actor,action) VALUES($1,$2,$3)',
            [actor.party, actor.id, 'console.' + action],
          );
        },
        operations: () => operations.snapshot(),
      });
      await app.listen({
        host: '127.0.0.1',
        port: Number(new URL(origin).port),
      });
      browser = await chromium.launch({ headless: true });
    },
  );
  await gate(
    'OIDC browser flow, role navigation and direct API denial for eight identities',
    async () => {
      for (const [name, permissions] of definitions) {
        const page = await login(name);
        const me = await (await request(page, '/api/me')).json();
        assert.equal(
          me.id,
          users.find((u) => u.username === 'synthetic-' + name).actor.id,
        );
        const search = await request(page, '/api/logs/search', { limit: 25 });
        assert.equal(
          search.status(),
          permissions.includes('log.read') ? 200 : 403,
        );
        const records = await request(page, '/api/activities');
        assert.equal(
          records.status(),
          permissions.includes('register') ? 200 : 403,
        );
        const op = await request(page, '/api/operations');
        assert.equal(
          op.status(),
          permissions.includes('operations') ? 200 : 403,
        );
        const exp = await request(page, '/api/logs/export', {});
        assert.equal(
          exp.status(),
          permissions.includes('log.export') ? 200 : 403,
        );
        assert.equal(
          await page.locator('#workspace').isVisible(),
          permissions.includes('log.read'),
        );
        assert.equal(
          await page.locator('#register-link').isVisible(),
          permissions.includes('register'),
        );
      }
    },
  );
  await gate(
    'Real mTLS search scope, original integrity, pagination and historical boundary',
    async () => {
      const page = pages.auditor;
      const response = await request(page, '/api/logs/search', { limit: 2 });
      assert.equal(response.status(), 200);
      const first = await response.json();
      assert.ok(validatePage(first));
      assert.equal(first.items.length, 2);
      assert.equal(first.items[0].processing_activity.version, 1);
      assert.equal(first.items[1].processing_activity.version, 2);
      const second = await (
        await request(page, '/api/logs/search', {
          limit: 2,
          cursor: first.next_cursor,
        })
      ).json();
      assert.equal(second.items.length, 1);
      const foreign = await (
        await request(pages.foreign, '/api/logs/search', {})
      ).json();
      assert.equal(foreign.items.length, 1);
      assert.equal(foreign.items[0].envelope.responsible_party, 'other-party');
      assert.equal(
        (await request(page, '/api/logs/' + events[3].event_id)).status(),
        404,
      );
      assert.equal(
        (
          await request(pages.foreign, '/api/logs/' + events[0].event_id)
        ).status(),
        404,
      );
      const detail = await (
        await request(page, '/api/logs/' + events[1].event_id)
      ).json();
      assert.ok(validateItem(detail));
      assert.equal(
        createHash('sha256')
          .update(Buffer.from(detail.original_base64, 'base64'))
          .digest('hex'),
        detail.sha256,
      );
      assert.equal(
        (
          await request(page, '/api/logs/search', {
            source_application: 'forbidden-app',
          })
        ).status(),
        403,
      );
    },
  );
  await gate(
    'Browser search, detail, three related spans and two separate subjects',
    async () => {
      const page = pages.auditor;
      await page.locator('[name="trace_id"]').fill(traceId);
      await page.getByRole('button', { name: 'Zoeken', exact: true }).click();
      await page.locator('#results').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#rows tr').count(), 3);
      await page
        .getByRole('button', { name: 'Details', exact: true })
        .first()
        .click();
      await page.locator('#detail pre').first().waitFor();
      assert.ok(
        (await page.locator('#detail').innerText()).includes('versie 1'),
      );
      await page
        .getByRole('button', { name: 'Trace', exact: true })
        .first()
        .click();
      await page.locator('#trace').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#spans li').count(), 3);
      assert.equal(
        await page
          .locator('#spans')
          .getByText(/example-subject-not-real-002/)
          .count(),
        1,
      );
      assert.equal(
        await page
          .locator('#spans')
          .getByText(/example-subject-not-real-003/)
          .count(),
        1,
      );
      assert.ok((await page.locator('#spans').innerText()).includes(parent));
      await page.screenshot({
        path: resolve(root, 'artifacts/console-test-desktop.png'),
        fullPage: true,
      });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      );
      await page.screenshot({
        path: resolve(root, 'artifacts/console-test-mobile.png'),
        fullPage: true,
      });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.keyboard.press('Tab');
      assert.ok(
        await page.evaluate(() => document.activeElement !== document.body),
      );
      assert.ok((await page.locator('label input,label select').count()) >= 6);
      assert.equal(
        await page.locator('#message').getAttribute('aria-live'),
        'polite',
      );
    },
  );
  await gate(
    'OIDC register creation, editing, second-person publication, successor, diff and history',
    async () => {
      const page = pages.editor,
        reviewer = pages.reviewer;
      const first = await request(page, '/api/activities', {
        ...draft,
        valid_from: '2025-01-01T00:00:00Z',
        valid_until: '2025-07-01T00:00:00Z',
      });
      assert.equal(first.status(), 201);
      const created = await first.json();
      assert.equal(
        (
          await request(
            page,
            `/api/activities/${created.id}/versions/1`,
            {
              ...versionDraft,
              content: { ...draft.content, name: 'OIDC edited' },
              valid_from: '2025-01-01T00:00:00Z',
              valid_until: '2025-07-01T00:00:00Z',
              revision: 1,
            },
            'PUT',
          )
        ).status(),
        200,
      );
      assert.equal(
        (
          await request(
            page,
            `/api/activities/${created.id}/versions/1/publish`,
            { revision: 2 },
          )
        ).status(),
        403,
      );
      assert.equal(
        (
          await request(
            reviewer,
            `/api/activities/${created.id}/versions/1/publish`,
            { revision: 2 },
          )
        ).status(),
        200,
      );
      assert.equal(
        (
          await request(page, `/api/activities/${created.id}/versions`, {
            ...versionDraft,
            content: { ...draft.content, name: 'OIDC successor' },
            valid_from: '2025-07-01T00:00:00Z',
            valid_until: '2026-01-01T00:00:00Z',
          })
        ).status(),
        201,
      );
      assert.equal(
        (
          await request(
            reviewer,
            `/api/activities/${created.id}/versions/2/publish`,
            { revision: 1 },
          )
        ).status(),
        200,
      );
      const historical = await (
        await request(
          pages.reader,
          `/api/activities/${created.id}/resolve?at=2025-06-01T00%3A00%3A00Z`,
        )
      ).json();
      assert.equal(historical.version, 1);
      await page.goto(origin + '/register');
      await page.locator('#workspace').waitFor({ state: 'visible' });
      await page.getByRole('button', { name: /OIDC/ }).first().click();
      await page.locator('#compare-a').waitFor();
      assert.ok(
        (await page.locator('#difference').innerText()).includes('OIDC edited'),
      );
      assert.ok(
        (await page.locator('#difference').innerText()).includes(
          'OIDC successor',
        ),
      );
    },
  );
  await gate(
    'Export marking and durable human audit; audit outage denies disclosure',
    async () => {
      const page = pages.auditor;
      const response = await request(page, '/api/logs/export', {
        trace_id: traceId,
        limit: 2,
      });
      assert.equal(response.status(), 200);
      const output = await response.json();
      assert.equal(output.scope, 'one-page');
      assert.ok(output.page.next_cursor);
      assert.equal(output.page.items.length, 2);
      assert.ok(output.exported_by);
      assert.equal(response.headers()['cache-control'], 'no-store');
      const audit = (
        await runtime.pool.query(
          "SELECT actor,action FROM register.audit WHERE action LIKE 'console.%' ORDER BY id",
        )
      ).rows;
      assert.ok(
        audit.some(
          (row) =>
            row.action === 'console.export' &&
            row.actor ===
              users.find((u) => u.username === 'synthetic-auditor').actor.id,
        ),
      );
      assert.ok(!JSON.stringify(audit).includes('example-subject'));
      assert.ok(!JSON.stringify(audit).includes(traceId));
      auditFails = true;
      try {
        assert.equal(
          (await request(page, '/api/logs/search', {})).status(),
          503,
        );
        assert.equal(
          (await request(page, '/api/logs/export', {})).status(),
          503,
        );
      } finally {
        auditFails = false;
      }
    },
  );
  await gate(
    'Reject/DLQ metadata, bounded pipeline snapshot and read-only Kafka ACLs',
    async () => {
      producer = new Producer({
        ...ctx.kafka,
        tls: await ctx.tls('admin'),
        serializers: stringSerializers,
        acks: -1,
        idempotent: true,
      });
      for (const [file, topic] of [
        ['valid-consumer-reject.json', 'ldv.rejected.v1'],
        ['valid-consumer-dead-letter.json', 'ldv.dead-letter.v1'],
      ]) {
        const event = JSON.parse(
          await readFile(resolve(root, 'contracts/examples', file), 'utf8'),
        );
        event.failure_id = randomBytes(32).toString('hex');
        await producer.send({
          messages: [
            { topic, key: event.failure_id, value: JSON.stringify(event) },
          ],
        });
      }
      await until(async () => {
        const snapshot = await operations.snapshot();
        return (
          snapshot.failures.length === 2 && snapshot.feed_status === 'caught_up'
        );
      });
      const snapshot = await (
        await request(pages.technical, '/api/operations')
      ).json();
      assert.equal(snapshot.failures.length, 2);
      assert.equal(snapshot.scope, 'shared-local-pipeline');
      assert.ok(!JSON.stringify(snapshot).includes('original_base64'));
      assert.ok(!JSON.stringify(snapshot).includes('example-subject'));
      assert.equal(typeof snapshot.archive_consumer_lag, 'string');
      const denied = new Producer({
        ...ctx.kafka,
        tls: await ctx.tls('console-ops'),
        serializers: stringSerializers,
      });
      try {
        await assert.rejects(
          denied.send({
            messages: [
              {
                topic: 'ldv.accepted.v1',
                key: 'synthetic',
                value: 'synthetic',
              },
            ],
          }),
        );
      } finally {
        await denied.close();
      }
      await pages.technical
        .getByRole('button', { name: 'Pipeline', exact: true })
        .click();
      await pages.technical.locator('#pipeline').waitFor({ state: 'visible' });
      assert.equal(await pages.technical.locator('#failures tr').count(), 2);
    },
  );
  await gate(
    'Combined admin roles retain scope and second-person publication',
    async () => {
      const admin = pages.admin;
      const make = async (page, name) => {
        const response = await request(page, '/api/activities', {
          ...draft,
          content: { ...draft.content, name },
        });
        assert.equal(response.status(), 201);
        return response.json();
      };
      const own = await make(admin, 'Synthetic admin concept');
      assert.equal(
        (
          await request(admin, `/api/activities/${own.id}/versions/1/publish`, {
            revision: 1,
          })
        ).status(),
        403,
      );
      assert.equal(
        (
          await request(
            pages.reviewer,
            `/api/activities/${own.id}/versions/1/publish`,
            { revision: 1 },
          )
        ).status(),
        200,
      );
      const other = await make(pages.editor, 'Synthetic other-author concept');
      assert.equal(
        (
          await request(
            admin,
            `/api/activities/${other.id}/versions/1/publish`,
            { revision: 1 },
          )
        ).status(),
        200,
      );
      const editable = await make(admin, 'Synthetic editable admin concept');
      await admin.goto(origin + '/register');
      await admin
        .getByRole('button', { name: 'Nieuwe activiteit', exact: true })
        .waitFor();
      await admin.locator(`[data-id="${editable.id}"]`).click();
      await admin
        .getByRole('button', { name: 'Concept bewerken', exact: true })
        .waitFor();
      await admin
        .getByRole('button', { name: 'Publiceren', exact: true })
        .waitFor();
    },
  );
  await gate(
    'Provider trust, spoofed origins, backend outage, logout and no login fallback',
    async () => {
      await assert.rejects(
        Sessions.create(
          provider.issuer,
          provider.clientId,
          provider.secret,
          origin,
          Object.fromEntries(users.map((u) => [u.id, u.actor])),
          await readFile(resolve(ctx.directory, 'pki/rogue.crt'), 'utf8'),
        ),
      );
      const page = pages.auditor;
      assert.equal(
        (
          await page.request.post(origin + '/api/logs/search', {
            headers: { Origin: 'https://foreign.invalid' },
            data: {},
          })
        ).status(),
        403,
      );
      assert.equal(
        (await request(page, '/api/session', { code: 'fake' })).status(),
        403,
      );
      await query.close();
      query = undefined;
      assert.equal((await request(page, '/api/logs/search', {})).status(), 503);
      await page.goto(origin);
      await page.getByRole('button', { name: 'Uitloggen' }).click();
      await page
        .getByRole('link', { name: 'Inloggen via identityprovider' })
        .waitFor();
      assert.equal((await request(page, '/api/me')).status(), 401);
      await page
        .getByRole('link', { name: 'Inloggen via identityprovider' })
        .click();
      await page.locator('#password').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#password').inputValue(), '');
      const nextUser = users.find(
        (u) => u.username === 'synthetic-investigator',
      );
      if (!(await page.locator('#username').count()))
        await page.locator('#reset-login').click();
      await page.locator('#username').fill(nextUser.username);
      await page.locator('#password').fill(nextUser.password);
      await page.locator('#kc-login').click();
      await page.waitForURL(origin + '/');
      assert.equal(
        (await (await request(page, '/api/me')).json()).id,
        nextUser.actor.id,
      );
    },
  );
} finally {
  await browser?.close();
  await app?.close();
  await query?.close();
  await reg?.close();
  await operations?.close();
  await observing;
  await producer?.close();
  for (const pool of [
    writer,
    reader,
    projectorPool,
    runtime?.pool,
    regctx?.owner,
    archive?.owner,
    ctx?.owner,
  ])
    await pool?.end();
  provider?.cleanup();
  if (infra) infra.compose(['down', '--volumes']);
  if (ctx) ctx.compose(['down', '--volumes']);
  if (regctx) regctx.compose(['down', '--volumes']);
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  await writeFile(
    resolve(root, 'artifacts/console.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2),
  );
}
