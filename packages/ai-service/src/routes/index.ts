import { Router, Request, Response, NextFunction } from 'express';
import { ExplainTransactionDto, AccountSummaryDto } from '@banking/shared';
import { AIService } from '../services/ai.service.js';

export function createRoutes(service: AIService): Router {
  const router = Router();

  router.post('/ai/explain', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { transactionId } = ExplainTransactionDto.parse(req.body);
      const result = await service.explainTransaction(transactionId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  });

  router.post('/ai/summary', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { accountId } = AccountSummaryDto.parse(req.body);
      const result = await service.summarizeAccount(accountId);
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  });

  router.post('/ai/translate-event', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { eventSubject, eventData } = req.body;
      const message = await service.translateEvent(eventSubject, eventData);
      res.json({ success: true, data: { message } });
    } catch (err) { next(err); }
  });

  router.get('/ai/explanations/:transactionId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const transactionId = Array.isArray(req.params.transactionId) ? req.params.transactionId[0] : req.params.transactionId;
      const explanations = await service.getExplanations(transactionId);
      res.json({ success: true, data: explanations });
    } catch (err) { next(err); }
  });

  router.post('/ai/risk', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { transactionId, type, amount, currency, sourceAccountId, targetAccountId, description } = req.body;
      if (!type || amount === undefined || !currency) {
        res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'type, amount and currency are required' } });
        return;
      }
      const result = await service.analyzeRisk({
        transactionId,
        type,
        amount: Number(amount),
        currency,
        sourceAccountId,
        targetAccountId,
        description,
      });
      res.json({ success: true, data: result });
    } catch (err) { next(err); }
  });

  return router;
}
