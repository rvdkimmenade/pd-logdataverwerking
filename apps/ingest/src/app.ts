import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import type { TLSSocket, SecureContextOptions } from 'node:tls';
import { validateLogRecord } from '@ldv/domain';
import { Conflict, ReceiptStore, type Source } from './store.js';

export function createApp(config: {
  tls: SecureContextOptions;
  sources: Record<string, Source>;
  store: ReceiptStore;
  syntheticOnly?: boolean;
}) {
  if (
    !config.tls.ca ||
    !config.tls.cert ||
    !config.tls.key ||
    !Object.keys(config.sources).length
  )
    throw new Error('mTLS and source mapping required');
  const app = Fastify({
    logger: false,
    bodyLimit: 1048576,
    https: { ...config.tls, requestCert: true, rejectUnauthorized: true },
    requestTimeout: 30000,
  });
  const counters = { received: 0, accepted: 0, rejected: 0, unavailable: 0 };
  app.addHook('onRequest', async (req, reply) => {
    const socket = req.raw.socket as TLSSocket;
    const source =
      socket.authorized &&
      config.sources[socket.getPeerCertificate().fingerprint256];
    if (req.url === '/v1/log-records') counters.received++;
    if (!source) {
      counters.rejected++;
      console.log(
        JSON.stringify({ stream: 'security', event: 'ingest_forbidden' }),
      );
      return reply.code(403).send({ code: 'FORBIDDEN' });
    }
    if (
      req.method === 'POST' &&
      req.url === '/v1/log-records' &&
      req.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !==
        'application/json'
    ) {
      counters.rejected++;
      return reply.code(415).send({ code: 'INVALID_REQUEST' });
    }
  });
  app.setErrorHandler(async (error, req, reply) => {
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 413 && !req.raw.readableEnded) {
      // Allow a bounded drain so a TLS close does not discard the error response.
      await new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          req.raw.off('end', finish);
          req.raw.off('error', finish);
          resolve();
        };
        const timer = setTimeout(finish, 1000);
        req.raw.once('end', finish);
        req.raw.once('error', finish);
        req.raw.resume();
      });
    }
    if (status && [400, 413, 415].includes(status)) {
      counters.rejected++;
      return reply.code(status).send({ code: 'INVALID_REQUEST' });
    }
    counters.unavailable++;
    return reply.code(503).send({ code: 'UNAVAILABLE' });
  });
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/ready', async (_req, reply) => {
    try {
      await config.store.ready();
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ code: 'UNAVAILABLE' });
    }
  });
  app.get('/metrics', async () => ({ ...counters }));
  app.post('/v1/log-records', async (req, reply) => {
    const source =
      config.sources[
        (req.raw.socket as TLSSocket).getPeerCertificate().fingerprint256
      ]!;
    const key = req.headers['idempotency-key'];
    if (
      key !== undefined &&
      (typeof key !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          key,
        ))
    ) {
      counters.rejected++;
      return reply.code(400).send({ code: 'INVALID_KEY' });
    }
    const validated = validateLogRecord(
      req.body,
      config.syntheticOnly ? { policy: 'synthetic-demo' } : {},
    );
    if (!validated.valid) {
      counters.rejected++;
      return reply
        .code(422)
        .send({ code: 'INVALID_LOG_RECORD', issues: validated.issues });
    }
    if (
      !source.activities.includes(
        validated.value.attributes['dpl.core.processing_activity_id'],
      )
    ) {
      counters.rejected++;
      console.log(
        JSON.stringify({ stream: 'security', event: 'ingest_forbidden' }),
      );
      return reply.code(403).send({ code: 'FORBIDDEN' });
    }
    try {
      const result = await config.store.accept(
        source,
        key?.toLowerCase() ?? randomUUID(),
        validated.value,
      );
      counters.accepted++;
      return reply.code(202).send(result);
    } catch (error) {
      if (error instanceof Conflict) {
        counters.rejected++;
        return reply.code(409).send({ code: 'IDEMPOTENCY_CONFLICT' });
      }
      counters.unavailable++;
      return reply.code(503).send({ code: 'UNAVAILABLE' });
    }
  });
  return app;
}
