import { Kafka, Producer, EachMessagePayload } from 'kafkajs';
import { DomainEvent, Subject } from '../events/index.js';

export interface KafkaDLQConfig {
  kafka: Kafka;
  maxRetries: number;
  serviceName: string;
}

export class KafkaDLQHandler {
  private producer: Producer;
  private retryAttempts: Map<string, number> = new Map();

  constructor(private config: KafkaDLQConfig) {
    this.producer = config.kafka.producer({
      idempotent: true,
      maxInFlightRequests: 5,
      transactionalId: `dlq-producer-${config.serviceName}`,
    });
  }

  async connect(): Promise<void> {
    await this.producer.connect();
    console.log(`[Kafka DLQ] Producer connected for ${this.config.serviceName}`);
  }

  async disconnect(): Promise<void> {
    await this.producer.disconnect();
  }

  wrap<S extends Subject>(
    handler: (event: DomainEvent<S>) => Promise<void>,
    originalTopic: string
  ): (payload: EachMessagePayload) => Promise<void> {
    return async (payload: EachMessagePayload) => {
      const { message } = payload;

      const event: DomainEvent<S> = JSON.parse(message.value?.toString() || '{}');
      const eventId = event.id;

      const retryHeader = message.headers?.['retry-count'];
      const currentRetries = retryHeader
        ? parseInt(retryHeader.toString())
        : 0;

      try {

        await handler(event);

        this.retryAttempts.delete(eventId);

      } catch (error: any) {
        const newRetries = currentRetries + 1;

        console.error(
          `[Kafka DLQ] Event ${eventId} failed (attempt ${newRetries}/${this.config.maxRetries}):`,
          error.message
        );

        if (newRetries >= this.config.maxRetries) {

          await this.sendToDLQ(event, originalTopic, error, newRetries);

          console.error(
            `[Kafka DLQ] Event ${eventId} moved to DLQ topic: ${originalTopic}.dlq`
          );

        } else {

          throw error;
        }
      }
    };
  }

  private async sendToDLQ<S extends Subject>(
    event: DomainEvent<S>,
    originalTopic: string,
    error: Error,
    retryCount: number
  ): Promise<void> {
    const dlqTopic = `${originalTopic}.dlq`;

    try {
      await this.producer.send({
        topic: dlqTopic,
        messages: [
          {
            key: event.id,
            value: JSON.stringify(event),
            headers: {
              'original-topic': originalTopic,
              'failure-reason': error.message,
              'failure-timestamp': new Date().toISOString(),
              'retry-count': retryCount.toString(),
              'correlation-id': event.correlationId || '',
              'service-name': this.config.serviceName,
              'error-stack': error.stack || '',
            },
          },
        ],
      });

      console.log(`[Kafka DLQ] Event ${event.id} sent to ${dlqTopic}`);

    } catch (dlqError: any) {
      console.error('[Kafka DLQ] Failed to send to DLQ topic:', dlqError.message);

      console.error('[Kafka DLQ] CRITICAL - Event lost:', {
        eventId: event.id,
        originalTopic,
        error: error.message,
      });
    }
  }

  async retryFromDLQ(
    dlqTopic: string,
    handler: (event: any) => Promise<void>,
    limit: number = 10
  ): Promise<{ succeeded: number; failed: number }> {
    const consumer = this.config.kafka.consumer({
      groupId: `${this.config.serviceName}-dlq-retry`,
    });

    await consumer.connect();
    await consumer.subscribe({ topic: dlqTopic, fromBeginning: false });

    let succeeded = 0;
    let failed = 0;
    let processed = 0;

    await consumer.run({
      eachMessage: async ({ message }) => {
        if (processed >= limit) {
          await consumer.pause([{ topic: dlqTopic }]);
          return;
        }

        try {
          const event = JSON.parse(message.value?.toString() || '{}');
          await handler(event);

          succeeded++;
          console.log(`[Kafka DLQ] Successfully retried event from DLQ`);

        } catch (error: any) {
          failed++;
          console.error(`[Kafka DLQ] Retry failed:`, error.message);
        }

        processed++;
      },
    });

    await new Promise(resolve => setTimeout(resolve, 5000));

    await consumer.disconnect();

    console.log(
      `[Kafka DLQ] Retry completed: ${succeeded} succeeded, ${failed} failed`
    );

    return { succeeded, failed };
  }

  async getStats(dlqTopic: string): Promise<{
    totalMessages: number;
    oldestMessage: Date | null;
    newestMessage: Date | null;
  }> {
    const admin = this.config.kafka.admin();
    await admin.connect();

    try {
      const offsets = await admin.fetchOffsets({
        groupId: `${this.config.serviceName}-dlq-stats`,
        topics: [dlqTopic]
      });

      let totalMessages = 0;

      for (const topic of offsets) {
        for (const partition of topic.partitions) {
          const high = parseInt((partition as any).high || '0');
          const offset = parseInt(partition.offset);
          totalMessages += (high - offset);
        }
      }

      await admin.disconnect();

      return {
        totalMessages,
        oldestMessage: null,
        newestMessage: null,
      };

    } catch (error) {
      await admin.disconnect();
      throw error;
    }
  }
}

export async function createDLQTopics(
  kafka: Kafka,
  topics: string[]
): Promise<void> {
  const admin = kafka.admin();
  await admin.connect();

  const dlqTopics = topics.map(topic => ({
    topic: `${topic}.dlq`,
    numPartitions: 3,
    replicationFactor: 1,
    configEntries: [
      { name: 'retention.ms', value: '604800000' },
      { name: 'cleanup.policy', value: 'delete' },
    ],
  }));

  try {
    await admin.createTopics({
      topics: dlqTopics,
      waitForLeaders: true,
    });

    console.log(`[Kafka DLQ] Created DLQ topics:`, dlqTopics.map(t => t.topic));
  } catch (error: any) {
    if (error.message.includes('already exists')) {
      console.log('[Kafka DLQ] Topics already exist');
    } else {
      throw error;
    }
  } finally {
    await admin.disconnect();
  }
}
