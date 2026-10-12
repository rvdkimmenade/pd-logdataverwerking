import { Consumer, type ConsumerOptions } from '@platformatic/kafka';
import { setTimeout as sleep } from 'node:timers/promises';

interface FailureMetadata {
  failure_id: string;
  kind: 'reject' | 'dead_letter';
  reason: string;
  source_partition: number;
  source_offset: string;
  observed_at: string;
}
export class Operations {
  private failures = new Map<string, FailureMetadata>();
  private observed = new Map<string, bigint>();
  private feed: Consumer;
  private observer: Consumer;
  private stopped = false;
  private active = false;
  private invalid = 0;
  constructor(
    config: ConsumerOptions<Buffer, Buffer, Buffer, Buffer>,
    private projectorMetrics: () => Promise<unknown>,
  ) {
    if (
      !config.tls?.ca ||
      !config.tls.cert ||
      !config.tls.key ||
      config.tls.rejectUnauthorized === false
    )
      throw new Error('OPERATIONS_MTLS_REQUIRED');
    this.feed = new Consumer({
      ...config,
      clientId: 'ldv-console-ops',
      groupId: 'ldv-console-ops-v1',
      autocommit: false,
    });
    this.observer = new Consumer({
      ...config,
      clientId: 'ldv-console-lag',
      groupId: 'ldv-logbook-v1',
      autocommit: false,
    });
  }
  async run() {
    while (!this.stopped) {
      try {
        const stream = await this.feed.consume({
          topics: ['ldv.rejected.v1', 'ldv.dead-letter.v1'],
          mode: 'earliest',
          maxWaitTime: 1000,
        });
        this.active = true;
        for await (const message of stream) {
          this.observed.set(message.topic, message.offset);
          try {
            const value = JSON.parse(
              (message.value ?? Buffer.alloc(0)).toString('utf8'),
            );
            if (
              !/^[a-f0-9]{64}$/.test(value.failure_id) ||
              !['reject', 'dead_letter'].includes(value.kind) ||
              ![
                'INVALID_JSON',
                'INVALID_ENVELOPE',
                'EVENT_ID_CONFLICT',
                'PROCESSING_FAILED',
              ].includes(value.reason) ||
              !Number.isInteger(value.source_partition) ||
              value.source_partition < 0 ||
              !/^(0|[1-9][0-9]*)$/.test(value.source_offset) ||
              !Number.isFinite(Date.parse(value.observed_at)) ||
              message.topic !==
                (value.kind === 'reject'
                  ? 'ldv.rejected.v1'
                  : 'ldv.dead-letter.v1')
            )
              throw new Error('Invalid failure');
            this.failures.set(value.failure_id, {
              failure_id: value.failure_id,
              kind: value.kind,
              reason: value.reason,
              source_partition: value.source_partition,
              source_offset: value.source_offset,
              observed_at: value.observed_at,
            });
            if (this.failures.size > 100)
              this.failures.delete(this.failures.keys().next().value!);
          } catch {
            this.invalid++;
          }
          if (this.stopped) break;
        }
        this.active = false;
      } catch {
        this.active = false;
      }
      if (!this.stopped) await sleep(2000);
    }
  }
  async snapshot() {
    const topics = ['ldv.accepted.v1', 'ldv.rejected.v1', 'ldv.dead-letter.v1'];
    const end = await this.observer.listOffsets({ topics, timestamp: -1n });
    const beginning = await this.observer.listOffsets({
      topics,
      timestamp: -2n,
    });
    const commits = await this.observer.listCommittedOffsets({
      topics: [{ topic: 'ldv.accepted.v1', partitions: [0] }],
    });
    const high = end.get(topics[0]!)?.[0] ?? 0n,
      low = beginning.get(topics[0]!)?.[0] ?? 0n,
      committed = commits.get(topics[0]!)?.[0] ?? -1n;
    const effective = committed < low ? low : committed;
    const lag = high > effective ? high - effective : 0n;
    const caughtUp = ['ldv.rejected.v1', 'ldv.dead-letter.v1'].every(
      (topic) => {
        const last = end.get(topic)?.[0] ?? 0n;
        const first = beginning.get(topic)?.[0] ?? 0n;
        return last === first || (this.observed.get(topic) ?? -1n) >= last - 1n;
      },
    );
    return {
      scope: 'shared-local-pipeline',
      observed_at: new Date().toISOString(),
      archive_consumer_lag: lag.toString(),
      consumer_offset: committed.toString(),
      end_offset: high.toString(),
      earliest_offset: low.toString(),
      expired_unprocessed: committed >= 0n && committed < low,
      feed_status: this.active
        ? caughtUp
          ? 'caught_up'
          : 'catching_up'
        : 'unavailable',
      invalid_failure_messages: this.invalid,
      window: 'last-100-observed-metadata',
      failures: [...this.failures.values()].sort((a, b) =>
        b.observed_at.localeCompare(a.observed_at),
      ),
      projector: await this.projectorMetrics(),
    };
  }
  async close() {
    this.stopped = true;
    await Promise.all([this.feed.close(true), this.observer.close(true)]);
  }
}
