import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import { readFileSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';
import formats from 'ajv-formats';
import type { Pool } from 'pg';
import type { SecureContextOptions } from 'node:tls';
import { Store, RegisterError, type Actor, type Draft } from './store.js';

const schema = JSON.parse(
  readFileSync(
    new URL('../../../contracts/schemas/register.schema.json', import.meta.url),
    'utf8',
  ),
);
const ajv = new Ajv2020({ strict: true, allErrors: true });
formats.default(ajv);
ajv.addSchema(schema);
const validators = Object.fromEntries(
  ['create', 'draft', 'update', 'publish'].map((key) => [
    key,
    ajv.compile({ $ref: `${schema.$id}#/$defs/${key}` }),
  ]),
);
const validAt = ajv.compile({ type: 'string', format: 'date-time' });
const hash = (value: string) => createHash('sha256').update(value).digest();
export interface DemoAccount {
  code: string;
  actor: Actor;
}
export interface AppOptions {
  pool: Pool;
  accounts: DemoAccount[];
  origin: string;
  tls?: SecureContextOptions;
  authenticate?: (request: FastifyRequest) => Actor;
  logout?: (request: FastifyRequest) => void;
  rootRoute?: string;
  errorHandler?: (
    error: unknown,
    request: FastifyRequest,
    reply: FastifyReply,
  ) => unknown;
}
export function createApp(options: AppOptions) {
  if (!/^https?:\/\/127\.0\.0\.1:\d+$/.test(options.origin))
    throw new Error('LOCAL_ORIGIN_REQUIRED');
  if (
    options.authenticate &&
    (!options.tls || !options.origin.startsWith('https:'))
  )
    throw new Error('OIDC_TLS_REQUIRED');
  const app = Fastify({
    logger: false,
    bodyLimit: 32768,
    ...(options.tls ? { https: options.tls } : {}),
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ code: 'NOT_FOUND' }),
  );
  const store = new Store(options.pool);
  const sessions = new Map<string, { actor: Actor; expires: number }>();
  const attempts = new Map<string, { count: number; until: number }>();
  const metrics = { requests: 0, denied: 0, mutations: 0 };
  const actor = (request: FastifyRequest) => {
    if (options.authenticate) return options.authenticate(request);
    const token = request.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('ldv_register='))
      ?.slice(13);
    const session = token ? sessions.get(token) : undefined;
    if (!session || session.expires < Date.now()) {
      if (token) sessions.delete(token);
      throw new RegisterError(401, 'AUTH_REQUIRED');
    }
    return session.actor;
  };
  const allow = (request: FastifyRequest, role?: Actor['role']) => {
    const who = actor(request);
    if (
      role &&
      who.role !== role &&
      !(options.authenticate && who.roles?.includes(role))
    )
      throw new RegisterError(403, 'FORBIDDEN');
    return who;
  };
  const body = (request: FastifyRequest, key: string) => {
    if (!validators[key]!(request.body))
      throw new RegisterError(400, 'INVALID_REQUEST');
    const data = request.body as Draft & { party: string; revision: number };
    if (
      data.valid_until &&
      Date.parse(data.valid_until) <= Date.parse(data.valid_from)
    )
      throw new RegisterError(400, 'INVALID_INTERVAL');
    return data;
  };
  const params = (request: FastifyRequest) => {
    const p = request.params as { id: string; version?: string };
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        p.id,
      ) ||
      (p.version !== undefined && !/^[1-9][0-9]{0,8}$/.test(p.version))
    )
      throw new RegisterError(400, 'INVALID_REQUEST');
    return { id: p.id, version: Number(p.version) };
  };
  app.addHook('onRequest', async (request, reply) => {
    metrics.requests++;
    reply
      .header('Cache-Control', 'no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
    if (request.headers.host !== new URL(options.origin).host)
      throw new RegisterError(403, 'INVALID_HOST');
    if (
      !['GET', 'HEAD'].includes(request.method) &&
      request.headers.origin !== options.origin
    )
      throw new RegisterError(403, 'INVALID_ORIGIN');
    if (request.url.startsWith('/api/') && request.url !== '/api/session')
      actor(request);
  });
  app.setErrorHandler(async (error, request, reply) => {
    if (options.errorHandler)
      return options.errorHandler(error, request, reply);
    const code = (error as { code?: string }).code;
    const status =
      error instanceof RegisterError
        ? error.status
        : ['23P01', '23505', '55000'].includes(code ?? '')
          ? 409
          : (error as { statusCode?: number }).statusCode === 400
            ? 400
            : 503;
    const safeCode =
      error instanceof RegisterError
        ? error.code
        : code === '23P01'
          ? 'OVERLAPPING_INTERVAL'
          : status === 409
            ? 'CONFLICT'
            : status === 400
              ? 'INVALID_REQUEST'
              : 'UNAVAILABLE';
    if (status === 401 || status === 403) {
      metrics.denied++;
      let who: Actor = { id: 'anonymous', party: 'local-demo', role: 'reader' };
      try {
        who = actor(request);
      } catch {
        /* No request data is included in audit. */
      }
      try {
        await store.audit(who, 'authorization.denied');
      } catch {
        return reply.code(503).send({ code: 'UNAVAILABLE' });
      }
    }
    return reply.code(status).send({ code: safeCode });
  });
  app.post('/api/session', async (request, reply) => {
    if (options.authenticate) throw new RegisterError(403, 'OIDC_REQUIRED');
    const key = request.ip;
    const now = Date.now();
    const previous = attempts.get(key);
    const attempt =
      previous && previous.until > now
        ? previous
        : { count: 0, until: now + 60_000 };
    attempts.set(key, attempt);
    if (++attempt.count > 20) throw new RegisterError(429, 'TRY_LATER');
    const input = request.body as { code?: unknown };
    if (!input || typeof input.code !== 'string' || input.code.length > 256)
      throw new RegisterError(401, 'AUTH_REQUIRED');
    const account = options.accounts.find((a) =>
      timingSafeEqual(hash(a.code), hash(input.code as string)),
    );
    if (!account) throw new RegisterError(401, 'AUTH_REQUIRED');
    for (const [id, s] of sessions) if (s.expires < now) sessions.delete(id);
    if (sessions.size >= 1000) throw new RegisterError(503, 'UNAVAILABLE');
    const token = randomBytes(32).toString('hex');
    sessions.set(token, { actor: account.actor, expires: now + 30 * 60_000 });
    reply.header(
      'Set-Cookie',
      `ldv_register=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800`,
    );
    return account.actor;
  });
  app.delete('/api/session', async (request, reply) => {
    if (options.logout) {
      options.logout(request);
      reply.header(
        'Set-Cookie',
        '__Host-ldv-console=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
      );
      return { ok: true };
    }
    const token = request.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('ldv_register='))
      ?.slice(13);
    if (token) sessions.delete(token);
    reply.header(
      'Set-Cookie',
      'ldv_register=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
    );
    return { ok: true };
  });
  app.get('/api/me', async (request) => allow(request));
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async () => {
    await options.pool.query('SELECT 1');
    return { status: 'ready' };
  });
  app.get('/api/metrics', async (request) => {
    allow(request);
    return metrics;
  });
  app.get('/api/activities', async (request) => store.list(allow(request)));
  app.post('/api/activities', async (request, reply) => {
    const who = allow(request, 'editor');
    const data = body(request, 'create');
    if (data.party !== who.party) throw new RegisterError(403, 'FORBIDDEN');
    const result = await store.create(who, data);
    metrics.mutations++;
    return reply.code(201).send(result);
  });
  app.get('/api/activities/:id', async (request) =>
    store.detail(allow(request), params(request).id),
  );
  app.post('/api/activities/:id/versions', async (request, reply) => {
    const result = await store.next(
      allow(request, 'editor'),
      params(request).id,
      body(request, 'draft'),
    );
    metrics.mutations++;
    return reply.code(201).send(result);
  });
  app.put('/api/activities/:id/versions/:version', async (request) => {
    const who = allow(request, 'editor');
    const p = params(request);
    const data = body(request, 'update');
    const result = await store.change(
      who,
      p.id,
      p.version,
      data.revision,
      data,
    );
    metrics.mutations++;
    return result;
  });
  app.post('/api/activities/:id/versions/:version/publish', async (request) => {
    const who = allow(request, 'reviewer');
    const p = params(request);
    const data = body(request, 'publish');
    const result = await store.change(who, p.id, p.version, data.revision);
    metrics.mutations++;
    return result;
  });
  app.get('/api/activities/:id/resolve', async (request) => {
    const who = allow(request);
    const p = params(request);
    const { at } = request.query as { at?: string };
    if (!validAt(at)) throw new RegisterError(400, 'INVALID_REQUEST');
    return store.resolve(who, p.id, at as string);
  });
  for (const [route, file, type] of [
    [options.rootRoute ?? '/', 'index.html', 'text/html'],
    ['/app.js', 'app.js', 'text/javascript'],
    ['/style.css', 'style.css', 'text/css'],
  ]) {
    let data = readFileSync(
      new URL(`../public/${file}`, import.meta.url),
      'utf8',
    );
    if (options.authenticate && file === 'index.html') {
      data = data
        .replace('OIDC volgt in fase 6', 'OIDC-login')
        .replace(
          '<form id="login-form">',
          '<a href="/auth/login">Inloggen via de lokale identityprovider</a><form id="login-form" hidden>',
        )
        .replace('Open het lokale register', 'Open het register')
        .replace(
          /Gebruik de toegangscode[\s\S]*?eigen code\./,
          'Log in via de lokale identityprovider. Je toegewezen rol bepaalt welke acties beschikbaar zijn.',
        );
    }
    app.get(route!, async (_request, reply) => reply.type(type!).send(data));
  }
  return app;
}
