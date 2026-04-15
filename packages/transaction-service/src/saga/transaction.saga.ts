import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import {
  IEventBus,
  Subjects,
  DomainEvent,
  OutboxRepository,
} from '@banking/shared';
import { TransactionRepository, EventTracker, AccountProjectionRepository } from '../repositories';
import { pool } from '../models/database';

@Injectable()
export class SagaService implements OnModuleInit {
  private outboxRepo: OutboxRepository;

  constructor(
    @Inject('KAFKA_BUS') private readonly eventBus: IEventBus,
    @Inject(TransactionRepository) private readonly txnRepo: TransactionRepository,
    @Inject(EventTracker) private readonly tracker: EventTracker,
    @Inject(AccountProjectionRepository) private readonly projectionRepo: AccountProjectionRepository,
  ) {
    this.outboxRepo = new OutboxRepository(pool);
  }

  onModuleInit() {
    this.registerSaga();
    console.log('[transaction-service] Saga registered');
  }

  private registerSaga() {
    this.eventBus.subscribe(
      Subjects.TransactionRequested,
      'txn-svc-saga',
      async (event: DomainEvent<typeof Subjects.TransactionRequested>) => {
        if (await this.tracker.isProcessed(event.id)) {
          console.log(`[Saga] Event ${event.id} already processed`);
          return;
        }

        const { transactionId, type, amount, sourceAccountId, targetAccountId } = event.data;
        console.log(`[Saga] Processing ${type} transaction: ${transactionId}`);

        try {
          if ((type === 'withdrawal' || type === 'transfer') && sourceAccountId) {
            const exists = await this.projectionRepo.exists(sourceAccountId);
            if (!exists) {
              await this.rejectTransaction(event, `Source account '${sourceAccountId}' not found`);
              return;
            }

            const balance = await this.projectionRepo.getBalance(sourceAccountId);
            if (balance === null || balance < amount) {
              await this.rejectTransaction(
                event,
                `Insufficient funds. Available: ${(balance ?? 0).toFixed(2)}, required: ${amount.toFixed(2)}`,
              );
              return;
            }
          }

          if ((type === 'deposit' || type === 'transfer') && targetAccountId) {
            const exists = await this.projectionRepo.exists(targetAccountId);
            if (!exists) {
              await this.rejectTransaction(event, `Target account '${targetAccountId}' not found`);
              return;
            }
          }

          const dbClient = await pool.connect();
          try {
            await dbClient.query('BEGIN');

            const completed = await this.txnRepo.updateStatus(transactionId, 'completed');

            await this.outboxRepo.insert(
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

            await this.tracker.markProcessed(event.id, event.subject, dbClient);
            await dbClient.query('COMMIT');
            console.log(`[Saga] Transaction ${transactionId} COMPLETED`);
          } catch (error) {
            await dbClient.query('ROLLBACK');
            throw error;
          } finally {
            dbClient.release();
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown processing error';
          await this.rejectTransaction(event, message);
        }
      },
    );
  }

  private async rejectTransaction(
    event: DomainEvent<typeof Subjects.TransactionRequested>,
    reason: string,
  ) {
    const { transactionId, type, amount, sourceAccountId, targetAccountId } = event.data;

    const dbClient = await pool.connect();
    try {
      await dbClient.query('BEGIN');

      await this.txnRepo.updateStatus(transactionId, 'rejected', reason);

      await this.outboxRepo.insert(
        Subjects.TransactionRejected,
        { transactionId, type, amount, reason, sourceAccountId, targetAccountId },
        dbClient,
        event.correlationId,
      );

      await this.tracker.markProcessed(event.id, event.subject, dbClient);
      await dbClient.query('COMMIT');
      console.log(`[Saga] Transaction ${transactionId} REJECTED: ${reason}`);
    } catch (error) {
      await dbClient.query('ROLLBACK');
      throw error;
    } finally {
      dbClient.release();
    }
  }
}
