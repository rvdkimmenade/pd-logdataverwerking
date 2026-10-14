import { randomBytes } from 'node:crypto';
import { request } from 'node:https';
import type { ConnectionOptions } from 'node:tls';
import { setTimeout as sleep } from 'node:timers/promises';
import type { LdvLogRecord } from '@ldv/domain';

export function context(header?: string) {
  if (
    header !== undefined &&
    (!/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(header) ||
      /^00-0{32}-/.test(header) ||
      /^00-[0-9a-f]{32}-0{16}-/.test(header))
  )
    throw new Error('INVALID_TRACE_CONTEXT');
  const parts = header?.split('-');
  return {
    traceId: parts?.[1] ?? randomBytes(16).toString('hex'),
    spanId: randomBytes(8).toString('hex'),
    parentSpanId: parts?.[2],
    flags: parts?.[3] ?? '01',
  };
}
export interface Event {
  id: string;
  token: string;
  attempts: number;
  payload: LdvLogRecord;
  traceparent: string;
}
export interface Receipt {
  event_id: string;
  accepted_at: string;
}
export type FailureCode =
  'TRANSPORT' | 'RETRYABLE_HTTP' | 'PERMANENT_HTTP' | 'INVALID_RECEIPT';
export class DeliveryError extends Error {
  constructor(
    readonly code: FailureCode,
    readonly retryable: boolean,
  ) {
    super(code);
  }
}
export interface Queue {
  claim(leaseMs: number): Promise<Event | null>;
  delivered(event: Event, receipt: Receipt): Promise<boolean>;
  failed(
    event: Event,
    code: FailureCode,
    delayMs: number | null,
  ): Promise<boolean>;
}
export interface Transport {
  send(event: Event): Promise<Receipt>;
}
export class IngestClient implements Transport {
  private url: URL;
  constructor(
    url: string,
    private tls: ConnectionOptions,
    private timeoutMs = 5000,
  ) {
    this.url = new URL(url);
    if (
      this.url.protocol !== 'https:' ||
      this.url.username ||
      this.url.password ||
      this.url.pathname !== '/v1/log-records' ||
      this.url.search ||
      this.url.hash ||
      !tls.ca ||
      !tls.cert ||
      !tls.key ||
      tls.rejectUnauthorized === false ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 100 ||
      timeoutMs > 15000
    )
      throw new Error('VERIFIED_INGEST_REQUIRED');
  }
  async send(event: Event): Promise<Receipt> {
    return new Promise((done, reject) => {
      const req = request(
        this.url,
        {
          ...this.tls,
          rejectUnauthorized: true,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': event.id,
            traceparent: event.traceparent,
          },
        },
        (res) => {
          let text = '';
          res.on('data', (part) => {
            text += part;
            if (text.length > 16384)
              req.destroy(new DeliveryError('INVALID_RECEIPT', true));
          });
          res.on('error', () => reject(new DeliveryError('TRANSPORT', true)));
          res.on('end', () => {
            if (res.statusCode !== 202) {
              const retry =
                (res.statusCode ?? 500) >= 500 ||
                [408, 429].includes(res.statusCode ?? 0);
              return reject(
                new DeliveryError(
                  retry ? 'RETRYABLE_HTTP' : 'PERMANENT_HTTP',
                  retry,
                ),
              );
            }
            try {
              const value = JSON.parse(text) as Receipt;
              if (
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                  value.event_id,
                ) ||
                typeof value.accepted_at !== 'string' ||
                !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
                  value.accepted_at,
                ) ||
                !Number.isFinite(Date.parse(value.accepted_at))
              )
                throw new Error();
              done({
                event_id: value.event_id,
                accepted_at: value.accepted_at,
              });
            } catch {
              reject(new DeliveryError('INVALID_RECEIPT', true));
            }
          });
        },
      );
      const timer = setTimeout(
        () => req.destroy(new DeliveryError('TRANSPORT', true)),
        this.timeoutMs,
      );
      req.on('close', () => clearTimeout(timer));
      req.on('error', (error) =>
        reject(
          error instanceof DeliveryError
            ? error
            : new DeliveryError('TRANSPORT', true),
        ),
      );
      req.end(JSON.stringify(event.payload));
    });
  }
}
export function backoff(
  attempt: number,
  baseMs = 250,
  capMs = 30000,
  random = Math.random,
) {
  if (
    !Number.isSafeInteger(attempt) ||
    attempt < 1 ||
    baseMs < 1 ||
    capMs < baseMs
  )
    throw new Error('INVALID_BACKOFF');
  const maximum = Math.min(capMs, baseMs * 2 ** Math.min(attempt - 1, 30));
  return Math.round(maximum * (0.5 + Math.max(0, Math.min(1, random())) * 0.5));
}
export class Publisher {
  readonly metrics = {
    attempts: 0,
    accepted: 0,
    retries: 0,
    blocked: 0,
    staleLeases: 0,
    databaseUnavailable: 0,
  };
  constructor(
    private queue: Queue,
    private transport: Transport,
    private options: {
      leaseMs?: number;
      baseMs?: number;
      capMs?: number;
      afterAccept?: (event: Event, receipt: Receipt) => Promise<void>;
    } = {},
  ) {
    if ((options.leaseMs ?? 30000) < 1000) throw new Error('INVALID_LEASE');
    backoff(1, options.baseMs, options.capMs, () => 0);
  }
  async tick() {
    const event = await this.queue.claim(this.options.leaseMs ?? 30000);
    if (!event) return false;
    this.metrics.attempts++;
    let receipt: Receipt;
    try {
      receipt = await this.transport.send(event);
    } catch (error) {
      const failure =
        error instanceof DeliveryError
          ? error
          : new DeliveryError('TRANSPORT', true);
      const delay = failure.retryable
        ? backoff(event.attempts, this.options.baseMs, this.options.capMs)
        : null;
      if (!(await this.queue.failed(event, failure.code, delay)))
        this.metrics.staleLeases++;
      else if (failure.retryable) this.metrics.retries++;
      else this.metrics.blocked++;
      return true;
    }
    await this.options.afterAccept?.(event, receipt);
    if (await this.queue.delivered(event, receipt)) this.metrics.accepted++;
    else this.metrics.staleLeases++;
    return true;
  }
  async run(signal: AbortSignal) {
    while (!signal.aborted) {
      try {
        if (await this.tick()) continue;
      } catch {
        this.metrics.databaseUnavailable++;
      }
      try {
        await sleep(250, undefined, { signal });
      } catch {
        if (!signal.aborted) throw new Error('PUBLISHER_INTERRUPTED');
      }
    }
  }
}
