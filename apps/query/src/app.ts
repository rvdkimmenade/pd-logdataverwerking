import Fastify from 'fastify';
import type { TLSSocket, SecureContextOptions } from 'node:tls';
import { QueryService, type Scope } from './service.js';
import { QueryError } from './cursor.js';
export function createApp(config: {
  tls: SecureContextOptions;
  scopes: Record<string, Scope>;
  service: QueryService;
  audit: (event: {
    actor: string;
    operation: string;
    outcome: number;
  }) => Promise<void>;
}) {
  if (
    !config.tls.ca ||
    !config.tls.cert ||
    !config.tls.key ||
    !Object.keys(config.scopes).length
  )
    throw new Error('mTLS mapping required');
  const app = Fastify({
    logger: false,
    https: { ...config.tls, requestCert: true, rejectUnauthorized: true },
    bodyLimit: 16384,
    requestTimeout: 15000,
  });
  const metrics = { requests: 0, denied: 0, unavailable: 0 };
  const scope = (req: { raw: { socket: unknown } }) =>
    config.scopes[
      (req.raw.socket as TLSSocket).getPeerCertificate().fingerprint256
    ]!;
  app.addHook('onRequest', async (req, reply) => {
    metrics.requests++;
    const socket = req.raw.socket as TLSSocket;
    const who = scope(req);
    if (
      !socket.authorized ||
      !who?.read ||
      !who.party ||
      !who.applications.length
    ) {
      metrics.denied++;
      await config.audit({
        actor: who?.id ?? 'unmapped',
        operation: 'access',
        outcome: 403,
      });
      return reply.code(403).send({ code: 'FORBIDDEN' });
    }
  });
  app.setErrorHandler(async (error, _req, reply) => {
    const status =
      error instanceof QueryError
        ? error.status
        : [400, 413, 415].includes(
              (error as { statusCode?: number }).statusCode ?? 0,
            )
          ? 400
          : 503;
    if (status === 503) metrics.unavailable++;
    return reply.code(status).send({
      code:
        error instanceof QueryError
          ? error.code
          : status === 400
            ? 'INVALID_REQUEST'
            : 'UNAVAILABLE',
    });
  });
  app.setNotFoundHandler(async (_req, reply) =>
    reply.code(404).send({ code: 'NOT_FOUND' }),
  );
  app.get('/health', async () => ({ status: 'running' }));
  app.get('/metrics', async () => ({ ...metrics }));
  app.post('/v1/log-records/search', async (req) => {
    await config.audit({
      actor: scope(req).id,
      operation: 'search',
      outcome: 0,
    });
    return config.service.search(scope(req), req.body);
  });
  app.post('/v1/traces/:trace_id', async (req) => {
    await config.audit({
      actor: scope(req).id,
      operation: 'trace',
      outcome: 0,
    });
    const { trace_id } = req.params as { trace_id: string };
    const body = req.body as Record<string, unknown>;
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      (body.trace_id !== undefined && body.trace_id !== trace_id)
    )
      throw new QueryError(400, 'INVALID_REQUEST');
    return config.service.search(scope(req), { ...body, trace_id });
  });
  app.get('/v1/log-records/:event_id', async (req) => {
    await config.audit({
      actor: scope(req).id,
      operation: 'detail',
      outcome: 0,
    });
    const { event_id } = req.params as { event_id: string };
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        event_id,
      )
    )
      throw new QueryError(400, 'INVALID_REQUEST');
    return config.service.record(scope(req), event_id);
  });
  return app;
}
