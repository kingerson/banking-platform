import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { IEventBus, Subjects, DomainEvent, OutboxRepository } from '@banking/shared';
import { AccountProjectionRepository, EventTracker, TransactionRepository } from '../repositories';
import { pool } from '../models/database';

@Injectable()
export class ProjectionService implements OnModuleInit {
  private outboxRepo: OutboxRepository;

  constructor(
    @Inject('KAFKA_BUS') private readonly eventBus: IEventBus,
    @Inject(AccountProjectionRepository) private readonly projectionRepo: AccountProjectionRepository,
    @Inject(EventTracker) private readonly tracker: EventTracker,
    @Inject(TransactionRepository) private readonly txnRepo: TransactionRepository,
  ) {
    this.outboxRepo = new OutboxRepository(pool);
  }

  onModuleInit() {
    this.registerSubscribers();
    console.log('[transaction-service] Projection subscribers registered');
  }

  private registerSubscribers() {
    this.eventBus.subscribe(
      Subjects.AccountCreated,
      'txn-svc-account-created',
      async (event: DomainEvent<typeof Subjects.AccountCreated>) => {
        if (await this.tracker.isProcessed(event.id)) return;

        const initialBalance = event.data.initialBalance ?? 0;
        await this.projectionRepo.upsert(event.data.accountId, 0, event.data.currency);
        await this.tracker.markProcessed(event.id, event.subject);
        console.log(`[Projection] Account ${event.data.accountId} seeded with balance 0`);

        if (initialBalance > 0) {
          const idempotencyKey = `initial-deposit-${event.data.accountId}`;
          const existing = await this.txnRepo.findByIdempotencyKey(idempotencyKey);
          if (!existing) {
            const dbClient = await pool.connect();
            try {
              await dbClient.query('BEGIN');
              const txn = await this.txnRepo.create({
                id: uuid(),
                type: 'deposit',
                amount: initialBalance,
                currency: event.data.currency,
                sourceAccountId: null,
                targetAccountId: event.data.accountId,
                idempotencyKey,
                description: 'Initial deposit',
              });
              await this.outboxRepo.insert(
                Subjects.TransactionRequested,
                {
                  transactionId: txn.id,
                  type: 'deposit',
                  amount: initialBalance,
                  currency: event.data.currency,
                  sourceAccountId: null,
                  targetAccountId: event.data.accountId,
                  idempotencyKey,
                  description: 'Initial deposit',
                },
                dbClient,
              );
              await dbClient.query('COMMIT');
              console.log(`[Projection] Initial deposit of ${initialBalance} queued for account ${event.data.accountId}`);
            } catch (err) {
              await dbClient.query('ROLLBACK');
              console.error('[Projection] Failed to create initial deposit:', err);
            } finally {
              dbClient.release();
            }
          }
        }
      },
    );

    this.eventBus.subscribe(
      Subjects.BalanceUpdated,
      'txn-svc-balance-updated',
      async (event: DomainEvent<typeof Subjects.BalanceUpdated>) => {
        if (await this.tracker.isProcessed(event.id)) return;

        await this.projectionRepo.upsert(event.data.accountId, event.data.newBalance);
        await this.tracker.markProcessed(event.id, event.subject);
        console.log(`[Projection] Account ${event.data.accountId} balance → ${event.data.newBalance}`);
      },
    );
  }
}
