import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { IEventBus, Subjects, DomainEvent } from '@banking/shared';
import { AIService } from '../services/ai.service';
import { LLMProvider } from '../providers/llm.provider';
import { Prompts } from '../prompts';
import { Pool } from 'pg';
import { pool } from '../models/database';

class EventTrackerAI {
  constructor(private pool: Pool) {}

  async isProcessed(eventId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM processed_events WHERE event_id = $1`,
      [eventId],
    );
    return rows.length > 0;
  }

  async markProcessed(eventId: string, subject: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO processed_events (event_id, subject) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [eventId, subject],
    );
  }
}

@Injectable()
export class AISubscriberService implements OnModuleInit {
  private tracker = new EventTrackerAI(pool);

  constructor(
    @Inject('KAFKA_BUS') private readonly eventBus: IEventBus,
    @Inject(AIService) private readonly aiService: AIService,
    @Inject('LLM_PROVIDER') private readonly llm: LLMProvider,
  ) {}

  onModuleInit() {
    this.registerSubscribers();
    console.log('[ai-service] Kafka subscribers registered');
  }

  private registerSubscribers() {
    this.eventBus.subscribe(
      Subjects.TransactionCompleted,
      'ai-svc-txn-completed',
      async (event: DomainEvent<typeof Subjects.TransactionCompleted>) => {
        if (await this.tracker.isProcessed(event.id)) return;

        const { transactionId, type, amount, currency, sourceAccountId, targetAccountId } = event.data;
        const prompt = Prompts.explainCompleted({ type, amount, currency, sourceAccountId, targetAccountId });

        try {
          const explanation = await this.llm.explain(prompt);
          await this.aiService.storeEventExplanation(transactionId, event.subject, event.data as any, explanation);
          console.log(`[AI Subscriber] Generated explanation for completed txn: ${transactionId}`);
        } catch (error) {
          console.error('[AI Subscriber] Failed to generate explanation:', error);
        }

        await this.tracker.markProcessed(event.id, event.subject);
      },
    );

    this.eventBus.subscribe(
      Subjects.TransactionRejected,
      'ai-svc-txn-rejected',
      async (event: DomainEvent<typeof Subjects.TransactionRejected>) => {
        if (await this.tracker.isProcessed(event.id)) return;

        const { transactionId, type, amount, reason } = event.data;
        const prompt = Prompts.explainRejected({
          type,
          amount,
          currency: (event.data as any).currency || 'USD',
          reason: reason || 'Motivo no especificado',
        });

        try {
          const explanation = await this.llm.explain(prompt);
          await this.aiService.storeEventExplanation(transactionId, event.subject, event.data as any, explanation);
          console.log(`[AI Subscriber] Generated explanation for rejected txn: ${transactionId}`);
        } catch (error) {
          console.error('[AI Subscriber] Failed to generate explanation:', error);
        }

        await this.tracker.markProcessed(event.id, event.subject);
      },
    );

    this.eventBus.subscribe(
      Subjects.TransactionRequested,
      'ai-svc-risk-analysis',
      async (event: DomainEvent<typeof Subjects.TransactionRequested>) => {
        const { transactionId, type, amount, currency, sourceAccountId, targetAccountId, description } = event.data as any;

        try {
          const risk = await this.aiService.analyzeRisk({
            transactionId, type, amount,
            currency: currency || 'USD',
            sourceAccountId, targetAccountId, description,
          });

          if (risk.riskLevel === 'high') {
            console.warn(`[AI Risk] HIGH RISK transaction ${transactionId}: score=${risk.score} reasons=${risk.reasons.join(', ')}`);
          } else {
            console.log(`[AI Risk] Transaction ${transactionId}: ${risk.riskLevel} (score=${risk.score})`);
          }
        } catch (error) {
          console.error(`[AI Risk] Failed to analyze risk for txn ${transactionId}:`, error);
        }
      },
    );
  }
}
