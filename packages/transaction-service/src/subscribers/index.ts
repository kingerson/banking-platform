import { v4 as uuid } from 'uuid';
import { IEventBus, Subjects, DomainEvent, OutboxRepository } from '@banking/shared';
import { AccountProjectionRepository, EventTracker, TransactionRepository } from '../repositories/index.js';
import { pool } from '../models/database.js';

export function registerProjectionSubscribers(
  eventBus: IEventBus,
  projectionRepo: AccountProjectionRepository,
  tracker: EventTracker,
  txnRepo?: TransactionRepository,
) {
  const outboxRepo = new OutboxRepository(pool);

  eventBus.subscribe(
    Subjects.AccountCreated,
    'txn-svc-account-created',
    async (event: DomainEvent<typeof Subjects.AccountCreated>) => {
      if (await tracker.isProcessed(event.id)) return;

      const initialBalance = event.data.initialBalance ?? 0;
      await projectionRepo.upsert(event.data.accountId, 0, event.data.currency);
      await tracker.markProcessed(event.id, event.subject);
      console.log(`[Projection] Account ${event.data.accountId} seeded with balance 0`);

      if (initialBalance > 0 && txnRepo) {
        const idempotencyKey = `initial-deposit-${event.data.accountId}`;
        const existing = await txnRepo.findByIdempotencyKey(idempotencyKey);
        if (!existing) {
          const dbClient = await pool.connect();
          try {
            await dbClient.query('BEGIN');
            const txn = await txnRepo.create({
              id: uuid(),
              type: 'deposit',
              amount: initialBalance,
              currency: event.data.currency,
              sourceAccountId: null,
              targetAccountId: event.data.accountId,
              idempotencyKey,
              description: 'Initial deposit',
            });
            await outboxRepo.insert(
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
            console.error(`[Projection] Failed to create initial deposit:`, err);
          } finally {
            dbClient.release();
          }
        }
      }
    },
  );

  eventBus.subscribe(
    Subjects.BalanceUpdated,
    'txn-svc-balance-updated',
    async (event: DomainEvent<typeof Subjects.BalanceUpdated>) => {
      if (await tracker.isProcessed(event.id)) return;

      await projectionRepo.upsert(event.data.accountId, event.data.newBalance);
      await tracker.markProcessed(event.id, event.subject);
      console.log(`[Projection] Account ${event.data.accountId} balance → ${event.data.newBalance}`);
    },
  );
}
