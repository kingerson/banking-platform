import { Kafka, Producer, Consumer, EachMessagePayload, Admin } from 'kafkajs';
import { v4 as uuid } from 'uuid';
import { DomainEvent, Subject } from '../events/index';
import { IEventBus } from '../types/event-bus.interface';

export interface KafkaEventBusConfig {
  brokers: string[];
  clientId: string;
}

export class KafkaEventBus implements IEventBus {
  private kafka: Kafka;
  private producer: Producer;
  private admin: Admin;
  private consumers: Map<string, Consumer>;
  private config: KafkaEventBusConfig;

  constructor(config: KafkaEventBusConfig) {
    this.config = config;
    this.kafka = new Kafka({
      clientId: config.clientId,
      brokers: config.brokers,
      retry: {
        initialRetryTime: 300,
        retries: 8,
      },
      connectionTimeout: 10000,
      requestTimeout: 30000,
    });

    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
      transactionalId: `${config.clientId}-producer`,
      maxInFlightRequests: 5,
      idempotent: true,
    });

    this.admin = this.kafka.admin();
    this.consumers = new Map();
  }

  async connect(): Promise<void> {
    await this.producer.connect();
    await this.admin.connect();

    const topics = [
      'banking.clients.created',
      'banking.accounts.created',
      'banking.accounts.balance-updated',
      'banking.transactions.requested',
      'banking.transactions.completed',
      'banking.transactions.rejected',
    ];

    const existingTopics = await this.admin.listTopics();
    const topicsToCreate = topics.filter(t => !existingTopics.includes(t));

    if (topicsToCreate.length > 0) {
      await this.admin.createTopics({
        topics: topicsToCreate.map(topic => ({
          topic,
          numPartitions: 3,
          replicationFactor: 1,
        })),
      });
      console.log(`[KafkaEventBus] Created topics: ${topicsToCreate.join(', ')}`);
    }

    console.log(`[KafkaEventBus] ${this.config.clientId} connected to Kafka`);
  }

  async publish<S extends Subject>(
    subject: S,
    data: DomainEvent<S>['data'],
    options?: {
      correlationId?: string;
      causationId?: string;
    },
  ): Promise<string> {
    const eventId = uuid();
    const event: DomainEvent<S> = {
      id: eventId,
      subject,
      timestamp: new Date().toISOString(),
      version: 1,
      correlationId: options?.correlationId,
      causationId: options?.causationId,
      data,
    };

    await this.producer.send({
      topic: subject,
      messages: [
        {
          key: eventId,
          value: JSON.stringify(event),
          headers: {
            eventId,
            correlationId: event.correlationId || '',
            causationId: event.causationId || '',
            timestamp: event.timestamp,
          },
        },
      ],
    });

    console.log(
      `[KafkaEventBus] Published: ${subject} | eventId: ${eventId}${
        event.correlationId ? ` | correlationId: ${event.correlationId}` : ''
      }`,
    );

    return eventId;
  }

  async subscribe<S extends Subject>(
    subject: S,
    durableName: string,
    handler: (event: DomainEvent<S>) => Promise<void>,
  ): Promise<void> {
    const consumer = this.kafka.consumer({
      groupId: durableName,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      retry: {
        retries: 8,
      },
    });

    await consumer.connect();
    await consumer.subscribe({
      topic: subject,
      fromBeginning: true,
    });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }: EachMessagePayload) => {
        try {
          if (!message.value) {
            console.warn('[KafkaEventBus] Received message with no value');
            return;
          }

          const event = JSON.parse(message.value.toString()) as DomainEvent<S>;
          console.log(
            `[KafkaEventBus] Received: ${topic} | eventId: ${event.id} | partition: ${partition}`,
          );

          await handler(event);
        } catch (error) {
          console.error(`[KafkaEventBus] Error processing ${topic}:`, error);

          throw error;
        }
      },
    });

    this.consumers.set(durableName, consumer);
    console.log(`[KafkaEventBus] Subscribed: ${subject} (group: ${durableName})`);
  }

  async close(): Promise<void> {
    await this.producer.disconnect();
    await this.admin.disconnect();

    for (const consumer of this.consumers.values()) {
      await consumer.disconnect();
    }

    console.log(`[KafkaEventBus] ${this.config.clientId} disconnected`);
  }

  getConnection(): Kafka {
    return this.kafka;
  }

  getProducer(): Producer {
    return this.producer;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const topics = await this.admin.listTopics();
      return topics.length >= 0;
    } catch {
      return false;
    }
  }
}
