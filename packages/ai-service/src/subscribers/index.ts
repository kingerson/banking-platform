import { IEventBus, Subjects, DomainEvent } from '@banking/shared';
import { AIService } from '../services/ai.service.js';
import { LLMProvider } from '../providers/llm.provider.js';
import { Prompts } from '../prompts/index.js';
import { Pool } from 'pg';
import { pool } from '../models/database.js';

export function registerSubscribers(eventBus: IEventBus, aiService: AIService, llm: LLMProvider) {
  const tracker = new EventTrackerAI(pool);

  eventBus.subscribe(
    Subjects.TransactionCompleted,
    'ai-svc-txn-completed',
    async (event: DomainEvent<typeof Subjects.TransactionCompleted>) => {
      if (await tracker.isProcessed(event.id)) return;

      const { transactionId, type, amount, currency, sourceAccountId, targetAccountId } = event.data;

      const prompt = Prompts.explainCompleted({ type, amount, currency, sourceAccountId, targetAccountId });

      try {
        const explanation = await llm.explain(prompt);
        await aiService.storeEventExplanation(transactionId, event.subject, event.data as any, explanation);
        console.log(`[AI Subscriber] Generated explanation for completed txn: ${transactionId}`);
      } catch (error) {
        console.error(`[AI Subscriber] Failed to generate explanation:`, error);
      }

      await tracker.markProcessed(event.id, event.subject);
    },
  );

  eventBus.subscribe(
    Subjects.TransactionRejected,
    'ai-svc-txn-rejected',
    async (event: DomainEvent<typeof Subjects.TransactionRejected>) => {
      if (await tracker.isProcessed(event.id)) return;

      const { transactionId, type, amount, reason } = event.data;

      const prompt = Prompts.explainRejected({
        type,
        amount,
        currency: (event.data as any).currency || 'USD',
        reason: reason || 'Motivo no especificado',
      });

      try {
        const explanation = await llm.explain(prompt);
        await aiService.storeEventExplanation(transactionId, event.subject, event.data as any, explanation);
        console.log(`[AI Subscriber] Generated explanation for rejected txn: ${transactionId}`);
      } catch (error) {
        console.error(`[AI Subscriber] Failed to generate explanation:`, error);
      }

      await tracker.markProcessed(event.id, event.subject);
    },
  );

  eventBus.subscribe(
    Subjects.TransactionRequested,
    'ai-svc-risk-analysis',
    async (event: DomainEvent<typeof Subjects.TransactionRequested>) => {
      const { transactionId, type, amount, currency, sourceAccountId, targetAccountId, description } = event.data as any;

      try {
        const risk = await aiService.analyzeRisk({
          transactionId,
          type,
          amount,
          currency: currency || 'USD',
          sourceAccountId,
          targetAccountId,
          description,
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
