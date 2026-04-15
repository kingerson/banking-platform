import { DLQRepository } from './dlq.repository';
import { DomainEvent, Subject } from '../events/index';

export interface DLQHandlerConfig {
  maxRetries: number;
  serviceName: string;
  consumerGroup?: string;
}

const DEFAULT_CONFIG: DLQHandlerConfig = {
  maxRetries: 3,
  serviceName: 'unknown-service',
};

export class DLQHandler {
  private retryAttempts: Map<string, number> = new Map();

  constructor(
    private dlqRepo: DLQRepository,
    private config: DLQHandlerConfig = DEFAULT_CONFIG
  ) {}

  wrap<S extends Subject>(
    handler: (event: DomainEvent<S>) => Promise<void>
  ): (event: DomainEvent<S>) => Promise<void> {
    return async (event: DomainEvent<S>) => {
      const eventId = event.id;
      const currentAttempts = this.retryAttempts.get(eventId) || 0;

      try {

        await handler(event);

        this.retryAttempts.delete(eventId);

      } catch (error: any) {
        const newAttempts = currentAttempts + 1;

        console.error(
          `[DLQ Handler] Event ${eventId} failed (attempt ${newAttempts}/${this.config.maxRetries}):`,
          error.message
        );

        if (newAttempts >= this.config.maxRetries) {

          await this.moveToDLQ(event, error);
          this.retryAttempts.delete(eventId);

          console.error(
            `[DLQ Handler] Event ${eventId} moved to Dead Letter Queue after ${newAttempts} failed attempts`
          );
        } else {

          this.retryAttempts.set(eventId, newAttempts);

          throw error;
        }
      }
    };
  }

  private async moveToDLQ<S extends Subject>(
    event: DomainEvent<S>,
    error: Error
  ): Promise<void> {
    try {

      const exists = await this.dlqRepo.exists(event.id);

      if (exists) {

        await this.dlqRepo.incrementFailureCount(event.id, error.message);
      } else {

        await this.dlqRepo.add({
          eventId: event.id,
          eventSubject: event.subject,
          eventData: event.data,
          originalError: error.message,
          failureCount: this.config.maxRetries,
          correlationId: event.correlationId,
          serviceName: this.config.serviceName,
          consumerGroup: this.config.consumerGroup,
        });
      }
    } catch (dlqError: any) {
      console.error('[DLQ Handler] Failed to add event to DLQ:', dlqError.message);

    }
  }

  async retryFromDLQ(
    eventId: string,
    handler: (event: any) => Promise<void>
  ): Promise<boolean> {
    try {
      const dlqEvent = await this.dlqRepo.findByEventId(eventId);

      if (!dlqEvent) {
        console.error(`[DLQ Handler] Event ${eventId} not found in DLQ`);
        return false;
      }

      if (dlqEvent.status !== 'failed') {
        console.error(`[DLQ Handler] Event ${eventId} is not in 'failed' status`);
        return false;
      }

      const event: DomainEvent<any> = {
        id: dlqEvent.eventId,
        subject: dlqEvent.eventSubject as any,
        data: dlqEvent.eventData,
        correlationId: dlqEvent.correlationId,
        timestamp: dlqEvent.firstFailedAt.toISOString(),
        version: 1,
      };

      await handler(event);

      await this.dlqRepo.update(dlqEvent.id, {
        status: 'resolved',
        resolutionNotes: 'Successfully retried from DLQ',
        resolvedBy: 'system',
      });

      console.log(`[DLQ Handler] Event ${eventId} successfully retried and resolved`);
      return true;

    } catch (error: any) {
      console.error(`[DLQ Handler] Retry failed for event ${eventId}:`, error.message);

      await this.dlqRepo.incrementFailureCount(eventId, error.message);

      return false;
    }
  }

  async retryBatch(
    handler: (event: any) => Promise<void>,
    limit: number = 10
  ): Promise<{ succeeded: number; failed: number }> {
    const failedEvents = await this.dlqRepo.findByService(this.config.serviceName, limit);

    let succeeded = 0;
    let failed = 0;

    for (const dlqEvent of failedEvents) {
      const success = await this.retryFromDLQ(dlqEvent.eventId, handler);
      if (success) {
        succeeded++;
      } else {
        failed++;
      }
    }

    console.log(
      `[DLQ Handler] Batch retry completed: ${succeeded} succeeded, ${failed} failed`
    );

    return { succeeded, failed };
  }

  async getStats() {
    return await this.dlqRepo.getStats();
  }

  async cleanup(olderThanDays: number = 30): Promise<number> {
    const deleted = await this.dlqRepo.cleanup(olderThanDays);
    console.log(`[DLQ Handler] Cleaned up ${deleted} old resolved events`);
    return deleted;
  }
}
