import { Producer, stringSerializers } from '@platformatic/kafka';
import type { ConnectionOptions } from 'node:tls';
import type { LdvEnvelope } from '@ldv/domain';
import type { Publisher } from './store.js';
export class KafkaPublisher implements Publisher {
  private producer;
  constructor(config: { bootstrapBrokers: string[]; tls: ConnectionOptions }) {
    if (
      !config.tls.ca ||
      !config.tls.cert ||
      !config.tls.key ||
      config.tls.rejectUnauthorized === false
    )
      throw new Error('Verified mTLS required');
    this.producer = new Producer({
      clientId: 'ldv-ingest',
      ...config,
      tls: { ...config.tls, rejectUnauthorized: true },
      serializers: stringSerializers,
      acks: -1,
      idempotent: true,
      maxInflights: 1,
      retries: 2,
      retryDelay: 250,
      timeout: 3000,
      requestTimeout: 3000,
      connectTimeout: 2000,
      autocreateTopics: false,
    });
    this.producer.on('error', () => {});
  }
  async publish(envelope: LdvEnvelope) {
    const result = await this.producer.send({
      messages: [
        {
          topic: 'ldv.accepted.v1',
          key: JSON.stringify([
            envelope.responsible_party,
            envelope.payload.trace_id,
          ]),
          value: JSON.stringify(envelope),
        },
      ],
    });
    if (!result.offsets?.length || result.unwritableNodes?.length)
      throw new Error('Publication not confirmed');
  }
  async ready() {
    await this.producer.metadata({
      topics: ['ldv.accepted.v1'],
      forceUpdate: true,
    });
  }
  async close() {
    await this.producer.close();
  }
}
