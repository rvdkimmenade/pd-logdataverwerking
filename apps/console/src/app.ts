import { createApp as registerApp } from '@ldv/register';
import type { Pool } from 'pg';
import type { SecureContextOptions } from 'node:tls';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { readFile } from 'node:fs/promises';
import { Sessions, AuthError, type Identity } from './auth.js';
import {
  identity,
  exportResult,
  operationsResult,
  queryPage,
  queryItem,
} from './validation.js';

export interface ConsoleOptions {
  pool: Pool;
  origin: string;
  tls: SecureContextOptions;
  sessions: Sessions;
  query: (
    actor: Identity,
    path: string,
    body?: unknown,
  ) => Promise<{ status: number; body: unknown }>;
  audit: (actor: Identity, action: string) => Promise<void>;
  operations?: () => Promise<unknown>;
}
export async function createApp(options: ConsoleOptions) {
  const actor = (req: FastifyRequest) => options.sessions.actor(req);
  const permit = (
    req: FastifyRequest,
    permission: Identity['permissions'][number],
  ) => {
    const who = actor(req);
    if (!who.permissions.includes(permission))
      throw new AuthError(403, 'FORBIDDEN');
    return who;
  };
  const app = registerApp({
    pool: options.pool,
    accounts: [],
    origin: options.origin,
    tls: options.tls,
    rootRoute: '/register',
    errorHandler: (error, req, reply) => errorHandler(error, req, reply),
    authenticate: (req) => {
      const who = actor(req);
      if (!identity(who)) throw new AuthError(503, 'UNAVAILABLE');
      if (
        req.url.startsWith('/api/activities') &&
        !who.permissions.includes('register')
      )
        throw new AuthError(403, 'FORBIDDEN');
      if (
        req.url.startsWith('/api/metrics') &&
        !who.permissions.includes('operations')
      )
        throw new AuthError(403, 'FORBIDDEN');
      return who;
    },
    logout: (req) => options.sessions.logout(req),
  });
  app.get('/api/operations', async (req) => {
    const who = permit(req, 'operations');
    await options.audit(who, 'operations');
    if (!options.operations) throw new AuthError(503, 'UNAVAILABLE');
    const result = await options.operations();
    if (!operationsResult(result)) throw new AuthError(503, 'UNAVAILABLE');
    return result;
  });
  const errorHandler = async (
    error: unknown,
    req: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const dbCode = (error as { code?: string }).code;
    const status =
      (error as { status?: number }).status ??
      (['23P01', '23505', '55000'].includes(dbCode ?? '')
        ? 409
        : (error as { statusCode?: number }).statusCode === 400
          ? 400
          : 503);
    if (status === 401 || status === 403) {
      try {
        let deniedActor: Identity = {
          id: 'anonymous',
          party: 'local-demo',
          role: 'reader',
          permissions: [],
          applications: [],
          backend: '',
        };
        try {
          deniedActor = actor(req);
        } catch {
          /* Session can be absent. */
        }
        await options.audit(deniedActor, 'authorization.denied');
      } catch {
        return reply.code(503).send({ code: 'UNAVAILABLE' });
      }
    }
    const code =
      dbCode === '23P01'
        ? 'OVERLAPPING_INTERVAL'
        : status === 409
          ? 'CONFLICT'
          : dbCode;
    return reply.code(status).send({
      code:
        typeof code === 'string' && /^[A-Z_]+$/.test(code)
          ? code
          : status === 400
            ? 'INVALID_REQUEST'
            : 'UNAVAILABLE',
    });
  };
  app.get('/auth/login', async (_req, reply) => {
    const flow = await options.sessions.begin();
    return reply.header('Set-Cookie', flow.cookie).redirect(flow.url);
  });
  app.get('/auth/callback', async (req, reply) => {
    const session = await options.sessions.finish(req);
    await options.audit(session.actor, 'login');
    return reply
      .header('Set-Cookie', [
        session.cookie,
        '__Host-ldv-login=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
      ])
      .redirect('/');
  });
  const query = async (
    req: FastifyRequest,
    path: string,
    body?: unknown,
    permission: 'log.read' | 'log.export' = 'log.read',
  ) => {
    const who = permit(req, permission);
    await options.audit(
      who,
      permission === 'log.export'
        ? 'export'
        : path.includes('traces')
          ? 'trace'
          : body
            ? 'search'
            : 'detail',
    );
    const response = await options.query(who, path, body);
    if (response.status !== 200)
      throw new AuthError(
        [400, 403, 404].includes(response.status) ? response.status : 503,
        response.status === 404
          ? 'NOT_FOUND'
          : response.status === 400
            ? 'INVALID_REQUEST'
            : response.status === 403
              ? 'FORBIDDEN'
              : 'UNAVAILABLE',
      );
    const result = response.body;
    const paged = body !== undefined;
    if (!(paged ? queryPage(result) : queryItem(result)))
      throw new AuthError(503, 'UNAVAILABLE');
    const items = paged
      ? (
          result as {
            items: {
              envelope: {
                responsible_party: string;
                source_application: string;
              };
            }[];
          }
        ).items
      : [
          result as {
            envelope: { responsible_party: string; source_application: string };
          },
        ];
    if (
      items.some(
        (item) =>
          item.envelope.responsible_party !== who.party ||
          !who.applications.includes(item.envelope.source_application),
      )
    )
      throw new AuthError(503, 'UNAVAILABLE');
    return result;
  };
  app.post('/api/logs/search', (req) =>
    query(req, '/v1/log-records/search', req.body),
  );
  app.get('/api/logs/:event_id', (req) => {
    const { event_id } = req.params as { event_id: string };
    if (!/^[a-f0-9-]{36}$/.test(event_id))
      throw new AuthError(400, 'INVALID_REQUEST');
    return query(req, `/v1/log-records/${event_id}`);
  });
  app.post('/api/traces/:trace_id', (req) => {
    const { trace_id } = req.params as { trace_id: string };
    if (!/^[a-f0-9]{32}$/.test(trace_id))
      throw new AuthError(400, 'INVALID_REQUEST');
    return query(req, `/v1/traces/${trace_id}`, req.body);
  });
  app.post('/api/logs/export', async (req, reply) => {
    const who = permit(req, 'log.read');
    const page = await query(
      req,
      '/v1/log-records/search',
      req.body,
      'log.export',
    );
    const output = {
      exported_at: new Date().toISOString(),
      exported_by: who.id,
      responsible_party: who.party,
      applications: who.applications,
      scope: 'one-page',
      page,
    };
    if (!exportResult(output)) throw new AuthError(503, 'UNAVAILABLE');
    return reply
      .header('Content-Disposition', 'attachment; filename="ldv-export.json"')
      .send(output);
  });
  for (const [path, file, type] of [
    ['/', 'index.html', 'text/html'],
    ['/console.js', 'console.js', 'text/javascript'],
    ['/console.css', 'console.css', 'text/css'],
  ]) {
    const data = await readFile(
      new URL(`../public/${file}`, import.meta.url),
      'utf8',
    );
    app.get(path!, (_req, reply) => reply.type(type!).send(data));
  }
  return app;
}
