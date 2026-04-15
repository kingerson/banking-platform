import { Pool, PoolClient } from 'pg';
import { IEventBus } from '../types/event-bus.interface';
import { OutboxRepository } from './outbox.repository';
import { Subject } from '../events/index';

export class OutboxPoller {
  private intervalId: NodeJS.Timeout | null = null;
  private listenClient: PoolClient | null = null;
  private isRunning = false;
  private isPollRunning = false;

  constructor(
    private outboxRepo: OutboxRepository,
    private eventBus: IEventBus,
    private intervalMs: number = 5000,
    private pool?: Pool,
  ) {}

  start(pool?: Pool): void {
    if (this.isRunning) {
      console.log('[OutboxPoller] Already running');
      return;
    }

    this.isRunning = true;
    const resolvedPool = pool || this.pool;
    console.log(`[OutboxPoller] Starting (interval fallback: ${this.intervalMs}ms, LISTEN/NOTIFY: ${resolvedPool ? 'enabled' : 'disabled'})`);

    this.poll();

    this.intervalId = setInterval(() => this.poll(), this.intervalMs);

    if (resolvedPool) {
      this.setupListener(resolvedPool);
    }
  }

  private async setupListener(pool: Pool): Promise<void> {
    try {
      this.listenClient = await pool.connect();
      await this.listenClient.query('LISTEN outbox_insert');
      console.log('[OutboxPoller] LISTEN outbox_insert — reactive mode active');

      this.listenClient.on('notification', () => {
        this.poll();
      });

      this.listenClient.on('error', async () => {
        this.listenClient?.release();
        this.listenClient = null;
        if (this.isRunning) {
          setTimeout(() => this.setupListener(pool), 2000);
        }
      });
    } catch (err) {
      console.warn('[OutboxPoller] Could not set up LISTEN, falling back to interval only:', err);
    }
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.listenClient) {
      this.listenClient.release();
      this.listenClient = null;
    }
    this.isRunning = false;
    console.log('[OutboxPoller] Stopped');
  }

  private async poll(): Promise<void> {

    if (this.isPollRunning) return;
    this.isPollRunning = true;
    try {
      const messages = await this.outboxRepo.getPending(50);

      if (messages.length === 0) {
        return;
      }

      console.log(`[OutboxPoller] Processing ${messages.length} pending messages`);

      for (const message of messages) {
        try {

          const payload = typeof message.payload === 'string'
            ? JSON.parse(message.payload)
            : message.payload;

          await this.eventBus.publish(
            message.subject as Subject,
            payload,
            message.correlationId ? { correlationId: message.correlationId } : undefined,
          );

          await this.outboxRepo.markPublished(message.id);

          console.log(
            `[OutboxPoller] Published: ${message.subject} (id: ${message.id})${
              message.correlationId ? ` | correlationId: ${message.correlationId}` : ''
            }`,
          );
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`[OutboxPoller] Failed to publish ${message.id}:`, errorMsg);

          await this.outboxRepo.recordFailure(message.id, errorMsg);

          if (message.attempts >= 5) {
            console.error(
              `[OutboxPoller] ALERT: Message ${message.id} failed ${message.attempts + 1} times. Subject: ${message.subject}`,
            );
          }
        }
      }

      const deleted = await this.outboxRepo.deletePublished(24);
      if (deleted > 0) {
        console.log(`[OutboxPoller] Cleaned up ${deleted} old messages`);
      }
    } catch (error) {
      console.error('[OutboxPoller] Poll cycle error:', error);
    } finally {
      this.isPollRunning = false;
    }
  }

  getStatus(): { running: boolean; intervalMs: number } {
    return {
      running: this.isRunning,
      intervalMs: this.intervalMs,
    };
  }
}
