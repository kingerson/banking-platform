import { Module, OnModuleInit, Inject } from '@nestjs/common';
import { OutboxRepository, OutboxPoller, IEventBus } from '@banking/shared';
import { pool } from '../models/database';

@Module({})
export class OutboxModule implements OnModuleInit {
  private poller: OutboxPoller;

  constructor(@Inject('KAFKA_BUS') private readonly eventBus: IEventBus) {
    const outboxRepo = new OutboxRepository(pool);
    this.poller = new OutboxPoller(outboxRepo, eventBus, 5000, pool);
  }

  onModuleInit() {
    this.poller.start();
    console.log('[transaction-service] Outbox poller started (LISTEN/NOTIFY + 5s fallback)');
  }
}
