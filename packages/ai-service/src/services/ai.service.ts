import { Injectable, Inject, Optional } from '@nestjs/common';
import { Pool } from 'pg';
import { NotFoundError } from '@banking/shared';
import { pool as defaultPool } from '../models/database';
import { LLMProvider } from '../providers/llm.provider';
import { Prompts } from '../prompts';
import { config } from '../config';

export interface RiskAnalysis {
  transactionId?: string;
  riskLevel: 'low' | 'medium' | 'high';
  score: number;
  reasons: string[];
  recommendation: string;
}

@Injectable()
export class AIService {
  private pool: Pool;

  constructor(
    @Inject('LLM_PROVIDER') private readonly llm: LLMProvider,
    @Optional() @Inject('PG_POOL') dbPool?: Pool,
  ) {
    this.pool = dbPool || defaultPool;
  }

  async explainTransaction(transactionId: string): Promise<{ transactionId: string; explanation: string }> {
    const { rows: cached } = await this.pool.query<{ explanation: string }>(
      `SELECT explanation FROM ai_explanations WHERE transaction_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [transactionId],
    );

    if (cached.length > 0) {
      return { transactionId, explanation: cached[0].explanation };
    }

    const txn = await this.fetchTransaction(transactionId);
    if (!txn) throw new NotFoundError('Transaction', transactionId);

    const prompt = txn.status === 'rejected'
      ? Prompts.explainRejected({
          type: txn.type,
          amount: txn.amount,
          currency: txn.currency,
          reason: txn.reason || txn.rejectionReason || 'Motivo no especificado',
        })
      : Prompts.explainCompleted({
          type: txn.type,
          amount: txn.amount,
          currency: txn.currency,
          sourceAccountId: txn.sourceAccountId,
          targetAccountId: txn.targetAccountId,
          description: txn.description,
        });

    const explanation = await this.llm.explain(prompt);

    await this.pool.query(
      `INSERT INTO ai_explanations (transaction_id, event_subject, event_data, explanation)
       VALUES ($1, $2, $3, $4)`,
      [transactionId, 'api.explain', JSON.stringify(txn), explanation],
    );

    return { transactionId, explanation };
  }

  async summarizeAccount(accountId: string): Promise<{ accountId: string; summary: string }> {
    const res = await fetch(`${config.transactionServiceUrl}/api/v1/accounts/${accountId}/transactions`);
    if (!res.ok) throw new NotFoundError('Account transactions', accountId);

    const body = await res.json() as { success: boolean; data: any[] };
    const transactions = body.data;

    if (transactions.length === 0) {
      return { accountId, summary: 'Esta cuenta no tiene transacciones registradas aún.' };
    }

    const totalDeposits = transactions
      .filter((t: any) => t.type === 'deposit' && t.status === 'completed')
      .reduce((sum: number, t: any) => sum + t.amount, 0);

    const totalWithdrawals = transactions
      .filter((t: any) => t.type === 'withdrawal' && t.status === 'completed')
      .reduce((sum: number, t: any) => sum + t.amount, 0);

    const totalTransfersOut = transactions
      .filter((t: any) => t.type === 'transfer' && t.status === 'completed' && t.sourceAccountId === accountId)
      .reduce((sum: number, t: any) => sum + t.amount, 0);

    const totalTransfersIn = transactions
      .filter((t: any) => t.type === 'transfer' && t.status === 'completed' && t.targetAccountId === accountId)
      .reduce((sum: number, t: any) => sum + t.amount, 0);

    const rejected = transactions.filter((t: any) => t.status === 'rejected').length;

    const prompt = Prompts.summarizeAccount({
      accountId,
      totalDeposits,
      totalWithdrawals,
      totalTransfersOut,
      totalTransfersIn,
      totalTransactions: transactions.length,
      rejected,
    });

    const summary = await this.llm.explain(prompt);
    return { accountId, summary };
  }

  async translateEvent(eventSubject: string, eventData: Record<string, unknown>): Promise<string> {
    const prompt = Prompts.translateEvent(eventSubject, eventData);
    return this.llm.explain(prompt);
  }

  async analyzeRisk(params: {
    transactionId?: string;
    type: string;
    amount: number;
    currency: string;
    sourceAccountId?: string;
    targetAccountId?: string;
    description?: string;
  }): Promise<RiskAnalysis> {
    let accountBalance: number | undefined;
    let recentTransactionCount: number | undefined;

    if (params.sourceAccountId) {
      try {
        const balRes = await fetch(
          `${config.customerServiceUrl}/api/v1/accounts/${params.sourceAccountId}/balance`,
        );
        if (balRes.ok) {
          const balBody = await balRes.json() as { success: boolean; data: { balance: number } };
          accountBalance = balBody.data?.balance;
        }
      } catch { }

      try {
        const { rows } = await this.pool.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM ai_explanations
           WHERE event_data->>'sourceAccountId' = $1
             AND created_at > NOW() - INTERVAL '24 hours'`,
          [params.sourceAccountId],
        );
        recentTransactionCount = parseInt(rows[0]?.count ?? '0', 10);
      } catch { }
    }

    const prompt = Prompts.analyzeRisk({ ...params, accountBalance, recentTransactionCount });
    const raw = await this.llm.explain(prompt);

    let parsed: Omit<RiskAnalysis, 'transactionId'>;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch?.[0] ?? raw);
    } catch {
      parsed = {
        riskLevel: 'low',
        score: 10,
        reasons: ['No se pudo analizar el riesgo automáticamente'],
        recommendation: 'Revisión manual recomendada',
      };
    }

    return { transactionId: params.transactionId, ...parsed };
  }

  async storeEventExplanation(
    transactionId: string | null,
    eventSubject: string,
    eventData: Record<string, unknown>,
    explanation: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO ai_explanations (transaction_id, event_subject, event_data, explanation)
       VALUES ($1, $2, $3, $4)`,
      [transactionId, eventSubject, JSON.stringify(eventData), explanation],
    );
  }

  async getExplanations(transactionId: string) {
    const { rows } = await this.pool.query(
      `SELECT id, transaction_id AS "transactionId", event_subject AS "eventSubject",
              explanation, created_at AS "createdAt"
       FROM ai_explanations WHERE transaction_id = $1 ORDER BY created_at DESC`,
      [transactionId],
    );
    return rows;
  }

  private async fetchTransaction(transactionId: string): Promise<any | null> {
    try {
      const res = await fetch(`${config.transactionServiceUrl}/api/v1/transactions/${transactionId}`);
      if (!res.ok) return null;
      const body = await res.json() as { success: boolean; data: any };
      return body.data;
    } catch {
      return null;
    }
  }
}
