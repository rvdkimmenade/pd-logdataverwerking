import { createHash } from 'node:crypto';
import { Consumer, Producer, stringSerializers } from '@platformatic/kafka';
import { validateEnvelope } from '@ldv/domain';
import { secureKafka, type KafkaConfig, type Failure } from './consumer.js';
import { validateFailure } from './failure-validation.js';

export async function replayOne(config: KafkaConfig, timeoutMs = 15000) {
  const options = secureKafka(config);
  const consumer = new Consumer({
    ...options,
    clientId: 'ldv-replay',
    groupId: 'ldv-logbook-replay-v1',
    autocommit: false,
  });
  const producer = new Producer({
    ...options,
    clientId: 'ldv-replay-writer',
    serializers: stringSerializers,
    acks: -1,
    idempotent: true,
    maxInflights: 1,
  });
  let stream: Awaited<ReturnType<typeof consumer.consume>> | undefined;
  const timer = setTimeout(() => {
    void consumer.close(true);
  }, timeoutMs);
  try {
    stream = await consumer.consume({
      topics: ['ldv.dead-letter.v1'],
      mode: 'committed',
      fallbackMode: 'earliest',
      autocommit: false,
      highWaterMark: 1,
      maxWaitTime: 500,
      sessionTimeout: 10000,
      heartbeatInterval: 1000,
    });
    for await (const message of stream) {
      const fault = JSON.parse(message.value.toString('utf8')) as Failure;
      if (
        !validateFailure(fault) ||
        fault.kind !== 'dead_letter' ||
        !fault.original_base64
      )
        throw new Error('Invalid dead letter');
      const raw = Buffer.from(fault.original_base64, 'base64');
      if (
        createHash('sha256').update(raw).digest('hex') !== fault.payload_sha256
      )
        throw new Error('Dead letter integrity failed');
      const event = validateEnvelope(JSON.parse(raw.toString('utf8')));
      if (!event.valid) throw new Error('Invalid dead letter envelope');
      const result = await producer.send({
        messages: [
          {
            topic: 'ldv.accepted.v1',
            key: JSON.stringify([
              event.value.responsible_party,
              event.value.payload.trace_id,
            ]),
            value: raw.toString('utf8'),
          },
        ],
      });
      if (!result.offsets?.length || result.unwritableNodes?.length)
        throw new Error('Replay unconfirmed');
      await message.commit();
      return { event_id: event.value.event_id };
    }
    throw new Error('No dead letter received');
  } finally {
    clearTimeout(timer);
    await stream?.close().catch(() => {});
    await consumer.close();
    await producer.close();
  }
}
