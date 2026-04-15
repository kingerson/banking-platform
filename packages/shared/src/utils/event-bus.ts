import {
  connect,
  NatsConnection,
  JetStreamClient,
  JetStreamManager,
  StringCodec,
  ConsumerConfig,
  DeliverPolicy,
  AckPolicy,
} from 'nats';
import { v4 as uuid } from 'uuid';
import { DomainEvent, Subject } from '../events/index';

const sc = StringCodec();

export interface EventBusConfig {
  url: string;
  name: string;
  streamName?: string;
}

export class EventBus {
  private nc!: NatsConnection;
  private js!: JetStreamClient;
  private jsm!: JetStreamManager;
  private config: EventBusConfig;
  private streamName: string;

  constructor(config: EventBusConfig) {
    this.config = config;
    this.streamName = config.streamName || 'BANKING';
  }

  async connect(): Promise<void> {
    this.nc = await connect({
      servers: this.config.url,
      name: this.config.name,
      reconnect: true,
      maxReconnectAttempts: -1,
      reconnectTimeWait: 2000,
    });

    this.jsm = await this.nc.jetstreamManager();
    this.js = this.nc.jetstream();

    try {
      await this.jsm.streams.info(this.streamName);
    } catch {
      await this.jsm.streams.add({
        name: this.streamName,
        subjects: ['banking.>'],
        retention: 'limits' as any,
        max_msgs: 100000,
        max_age: 7 * 24 * 60 * 60 * 1_000_000_000,
      });
    }

    console.log(`[EventBus] ${this.config.name} connected to NATS`);
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

    await this.js.publish(subject, sc.encode(JSON.stringify(event)));
    console.log(
      `[EventBus] Published: ${subject} | eventId: ${event.id}${
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
    const consumerConfig: Partial<ConsumerConfig> = {
      durable_name: durableName,
      deliver_policy: DeliverPolicy.All,
      ack_policy: AckPolicy.Explicit,
      filter_subject: subject,
    };

    try {
      await this.jsm.consumers.info(this.streamName, durableName);
    } catch {
      await this.jsm.consumers.add(this.streamName, consumerConfig);
    }

    const consumer = await this.js.consumers.get(this.streamName, durableName);

    (async () => {
      const messages = await consumer.consume();
      for await (const msg of messages) {
        try {
          const event = JSON.parse(sc.decode(msg.data)) as DomainEvent<S>;
          console.log(`[EventBus] Received: ${subject} | eventId: ${event.id}`);
          await handler(event);
          msg.ack();
        } catch (error) {
          console.error(`[EventBus] Error processing ${subject}:`, error);
          msg.nak(5000);
        }
      }
    })();

    console.log(`[EventBus] Subscribed: ${subject} (durable: ${durableName})`);
  }

  async close(): Promise<void> {
    await this.nc?.drain();
    console.log(`[EventBus] ${this.config.name} disconnected`);
  }

  getConnection(): NatsConnection | null {
    return this.nc || null;
  }
}
