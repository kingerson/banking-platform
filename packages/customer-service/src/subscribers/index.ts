import { IEventBus, Subjects, DomainEvent, OutboxRepository } from '@banking/shared';
import { AccountRepository, EventTracker } from '../repositories/index.js';
import { pool } from '../models/database.js';

export function registerSubscribers(eventBus: IEventBus, accountRepo: AccountRepository, tracker: EventTracker) {
  const outboxRepo = new OutboxRepository(pool);

  eventBus.subscribe(
    Subjects.TransactionCompleted,
    'customer-svc-txn-completed',
    async (event: DomainEvent<typeof Subjects.TransactionCompleted>) => {
      if (await tracker.isProcessed(event.id)) {
        console.log(`[Subscriber] Event ${event.id} already processed, skipping`);
        return;
      }

      const { type, amount, sourceAccountId, targetAccountId, transactionId } = event.data;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        if (type === 'deposit' && targetAccountId) {
          const updated = await accountRepo.updateBalance(targetAccountId, amount, 'credit', client);
          if (updated) {

            await outboxRepo.insert(
              Subjects.BalanceUpdated,
              {
                accountId: targetAccountId,
                previousBalance: updated.balance - amount,
                newBalance: updated.balance,
                transactionId,
              },
              client,
              event.correlationId,
            );
            await tracker.markProcessed(event.id, event.subject, client);
            await client.query('COMMIT');
            console.log(`[Subscriber] Processed deposit: ${transactionId}`);
            return;
          }
        }

        if (type === 'withdrawal' && sourceAccountId) {
          const updated = await accountRepo.updateBalance(sourceAccountId, amount, 'debit', client);
          if (updated) {

            await outboxRepo.insert(
              Subjects.BalanceUpdated,
              {
                accountId: sourceAccountId,
                previousBalance: updated.balance + amount,
                newBalance: updated.balance,
                transactionId,
              },
              client,
              event.correlationId,
            );
            await tracker.markProcessed(event.id, event.subject, client);
            await client.query('COMMIT');
            console.log(`[Subscriber] Processed withdrawal: ${transactionId}`);
            return;
          }
        }

        if (type === 'transfer' && sourceAccountId && targetAccountId) {

          const debited = await accountRepo.updateBalance(sourceAccountId, amount, 'debit', client);
          if (!debited) {
            throw new Error(`Failed to debit account ${sourceAccountId}`);
          }

          const credited = await accountRepo.updateBalance(targetAccountId, amount, 'credit', client);
          if (!credited) {
            throw new Error(`Failed to credit account ${targetAccountId}`);
          }

          await outboxRepo.insert(
            Subjects.BalanceUpdated,
            {
              accountId: sourceAccountId,
              previousBalance: debited.balance + amount,
              newBalance: debited.balance,
              transactionId,
            },
            client,
            event.correlationId,
          );
          await outboxRepo.insert(
            Subjects.BalanceUpdated,
            {
              accountId: targetAccountId,
              previousBalance: credited.balance - amount,
              newBalance: credited.balance,
              transactionId,
            },
            client,
            event.correlationId,
          );

          await tracker.markProcessed(event.id, event.subject, client);
          await client.query('COMMIT');
          console.log(`[Subscriber] Processed transfer: ${transactionId} (atomic)`);
          return;
        }

        await tracker.markProcessed(event.id, event.subject, client);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`[Subscriber] ROLLBACK for ${transactionId}:`, error);
        throw error;
      } finally {
        client.release();
      }
    },
  );
}
