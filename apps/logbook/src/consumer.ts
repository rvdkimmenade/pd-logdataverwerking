import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { ConnectionOptions } from 'node:tls';
import {
  Consumer,
  Producer,
  stringSerializers,
  type Message,
} from '@platformatic/kafka';
import { validateEnvelope } from '@ldv/domain';
import { Archive, type Origin } from './store.js';

export interface KafkaConfig {
  bootstrapBrokers: string[];
  tls: ConnectionOptions;
}
export interface Failure {
  schema_version: '1.0';
  failure_id: string;
  kind: 'reject' | 'dead_letter';
  reason: string;
  source_topic: 'ldv.accepted.v1';
  source_partition: number;
  source_offset: string;
  payload_sha256: string;
  observed_at: string;
  original_base64?: string;
}
export function dependencyFailure(error: unknown): boolean {
  const e = error as { code?: string; message?: string; cause?: unknown };
  return (
    /^(08|53|57|58|40)/.test(e.code ?? '') ||
    [
      'ECONNREFUSED',
      'ECONNRESET',
      'ETIMEDOUT',
      'EPIPE',
      'ENOTFOUND',
      'EAI_AGAIN',
    ].includes(e.code ?? '') ||
    (!e.code &&
      /timeout|connection terminated|server closed/i.test(e.message ?? '')) ||
    !!(e.cause && dependencyFailure(e.cause))
  );
}
export function failure(
  raw: Buffer,
  origin: Origin,
  kind: Failure['kind'],
  reason: string,
): Failure {
  return {
    schema_version: '1.0',
    failure_id: createHash('sha256')
      .update(
        JSON.stringify([origin.topic, origin.partition, origin.offset, kind]),
      )
      .digest('hex'),
    kind,
    reason,
    source_topic: 'ldv.accepted.v1',
    source_partition: origin.partition,
    source_offset: origin.offset,
    payload_sha256: createHash('sha256').update(raw).digest('hex'),
    observed_at: new Date().toISOString(),
    ...(kind === 'dead_letter'
      ? { original_base64: raw.toString('base64') }
      : {}),
  };
}
export function secureKafka(config: KafkaConfig) {
  if (
    !config.tls.ca ||
    !config.tls.cert ||
    !config.tls.key ||
    config.tls.rejectUnauthorized === false
  )
    throw new Error('Verified mTLS required');
  return {
    ...config,
    tls: { ...config.tls, rejectUnauthorized: true },
    timeout: 3000,
    requestTimeout: 3000,
    connectTimeout: 2000,
    retries: 2,
    retryDelay: 250,
    autocreateTopics: false,
  };
}
export class LogConsumer {
  private consumer;
  private producer;
  private stream: Awaited<ReturnType<Consumer['consume']>> | undefined;
  private stopped = false;
  readonly metrics = {
    stored: 0,
    duplicates: 0,
    rejected: 0,
    deadLetters: 0,
    retries: 0,
    committed: 0,
  };
  constructor(
    config: KafkaConfig,
    private archive: Archive,
    private hooks: {
      beforeCommit?: () => Promise<void>;
      afterCommit?: () => Promise<void>;
      afterOffset?: () => Promise<void>;
    } = {},
  ) {
    const options = secureKafka(config);
    this.consumer = new Consumer({
      ...options,
      clientId: 'ldv-logbook',
      groupId: 'ldv-logbook-v1',
      autocommit: false,
    });
    this.producer = new Producer({
      ...options,
      clientId: 'ldv-logbook-failures',
      serializers: stringSerializers,
      idempotent: true,
      acks: -1,
      maxInflights: 1,
    });
  }
  private async publishFailure(value: Failure) {
    const result = await this.producer.send({
      messages: [
        {
          topic:
            value.kind === 'reject' ? 'ldv.rejected.v1' : 'ldv.dead-letter.v1',
          key: value.failure_id,
          value: JSON.stringify(value),
        },
      ],
    });
    if (!result.offsets?.length || result.unwritableNodes?.length)
      throw new Error('Failure publication unconfirmed');
  }
  private async handle(message: Message) {
    const raw = message.value ?? Buffer.alloc(0),
      origin = {
        topic: message.topic,
        partition: message.partition,
        offset: message.offset.toString(),
      };
    let input: unknown;
    try {
      input = JSON.parse(raw.toString('utf8'));
    } catch {
      await this.publishFailure(failure(raw, origin, 'reject', 'INVALID_JSON'));
      this.metrics.rejected++;
      return;
    }
    const validated = validateEnvelope(input);
    if (!validated.valid) {
      await this.publishFailure(
        failure(raw, origin, 'reject', 'INVALID_ENVELOPE'),
      );
      this.metrics.rejected++;
      return;
    }
    let attempts = 0,
      transient = 0;
    while (!this.stopped) {
      let result: 'stored' | 'duplicate' | 'conflict';
      try {
        result = await this.archive.save(
          validated.value,
          raw,
          origin,
          this.hooks.beforeCommit,
        );
      } catch (error) {
        this.metrics.retries++;
        if (!dependencyFailure(error) && ++attempts >= 3) {
          await this.publishFailure(
            failure(raw, origin, 'dead_letter', 'PROCESSING_FAILED'),
          );
          this.metrics.deadLetters++;
          return;
        }
        await sleep(Math.min(500 * 2 ** Math.min(transient++, 6), 30000));
        continue;
      }
      if (result === 'conflict') {
        await this.publishFailure(
          failure(raw, origin, 'reject', 'EVENT_ID_CONFLICT'),
        );
        this.metrics.rejected++;
      } else {
        if (result === 'stored') this.metrics.stored++;
        else this.metrics.duplicates++;
        await this.hooks.afterCommit?.();
      }
      return;
    }
    throw new Error('Consumer stopped');
  }
  async run() {
    while (!this.stopped) {
      try {
        this.stream = await this.consumer.consume({
          topics: ['ldv.accepted.v1'],
          autocommit: false,
          mode: 'committed',
          fallbackMode: 'earliest',
          highWaterMark: 1,
          maxWaitTime: 500,
          sessionTimeout: 10000,
          heartbeatInterval: 1000,
        });
        for await (const message of this.stream) {
          if (this.stopped) break;
          await this.handle(message);
          if (this.stopped) break;
          await message.commit();
          this.metrics.committed++;
          await this.hooks.afterOffset?.();
        }
      } catch {
        if (!this.stopped) {
          this.metrics.retries++;
          await sleep(1000);
        }
      } finally {
        await this.stream?.close().catch(() => {});
        this.stream = undefined;
      }
    }
  }
  async stop() {
    this.stopped = true;
    await this.stream?.close().catch(() => {});
    await this.consumer.close();
    await this.producer.close();
  }
}
