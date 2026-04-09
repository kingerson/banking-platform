import {
  IEventBus,
  Subjects,
  DomainEvent,
  OutboxRepository,
} from '@banking/shared';
import { TransactionRepository, EventTracker, AccountProjectionRepository } from '../repositories/index.js';
import { pool } from '../models/database.js';

export function registerTransactionSaga(
  eventBus: IEventBus,
  txnRepo: TransactionRepository,
  tracker: EventTracker,
  projectionRepo: AccountProjectionRepository,
) {
  const outboxRepo = new OutboxRepository(pool);

  eventBus.subscribe(
    Subjects.TransactionRequested,
    'txn-svc-saga',
    async (event: DomainEvent<typeof Subjects.TransactionRequested>) => {
      if (await tracker.isProcessed(event.id)) {
        console.log(`[Saga] Event ${event.id} already processed`);
        return;
      }

      const { transactionId, type, amount, sourceAccountId, targetAccountId } = event.data;
      console.log(`[Saga] Processing ${type} transaction: ${transactionId}`);

      try {

        if ((type === 'withdrawal' || type === 'transfer') && sourceAccountId) {
          const exists = await projectionRepo.exists(sourceAccountId);
          if (!exists) {
            await rejectTransaction(txnRepo, outboxRepo, tracker, event, `Source account '${sourceAccountId}' not found`);
            return;
          }

          const balance = await projectionRepo.getBalance(sourceAccountId);
          if (balance === null || balance < amount) {
            await rejectTransaction(
              txnRepo, outboxRepo, tracker, event,
              `Insufficient funds. Available: ${(balance ?? 0).toFixed(2)}, required: ${amount.toFixed(2)}`,
            );
            return;
          }
        }

        if ((type === 'deposit' || type === 'transfer') && targetAccountId) {
          const exists = await projectionRepo.exists(targetAccountId);
          if (!exists) {
            await rejectTransaction(txnRepo, outboxRepo, tracker, event, `Target account '${targetAccountId}' not found`);
            return;
          }
        }

        const dbClient = await pool.connect();
        try {
          await dbClient.query('BEGIN');

          const completed = await txnRepo.updateStatus(transactionId, 'completed');

          await outboxRepo.insert(
            Subjects.TransactionCompleted,
            {
              transactionId: completed.id,
              type: completed.type,
              amount: completed.amount,
              currency: completed.currency,
              sourceAccountId: completed.sourceAccountId,
              targetAccountId: completed.targetAccountId,
              description: completed.description ?? undefined,
            },
            dbClient,
            event.correlationId,
          );

          await tracker.markProcessed(event.id, event.subject, dbClient);
          await dbClient.query('COMMIT');
          console.log(`[Saga] Transaction ${transactionId} COMPLETED`);
        } catch (error) {
          await dbClient.query('ROLLBACK');
          throw error;
        } finally {
          dbClient.release();
        }
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown processing error';
        await rejectTransaction(txnRepo, outboxRepo, tracker, event, message);
      }
    },
  );
}

async function rejectTransaction(
  txnRepo: TransactionRepository,
  outboxRepo: OutboxRepository,
  tracker: EventTracker,
  event: DomainEvent<typeof Subjects.TransactionRequested>,
  reason: string,
) {
  const { transactionId, type, amount, sourceAccountId, targetAccountId } = event.data;

  const dbClient = await pool.connect();
  try {
    await dbClient.query('BEGIN');

    await txnRepo.updateStatus(transactionId, 'rejected', reason);

    await outboxRepo.insert(
      Subjects.TransactionRejected,
      {
        transactionId,
        type,
        amount,
        reason,
        sourceAccountId,
        targetAccountId,
      },
      dbClient,
      event.correlationId,
    );

    await tracker.markProcessed(event.id, event.subject, dbClient);
    await dbClient.query('COMMIT');
    console.log(`[Saga] Transaction ${transactionId} REJECTED: ${reason}`);
  } catch (error) {
    await dbClient.query('ROLLBACK');
    throw error;
  } finally {
    dbClient.release();
  }
}
