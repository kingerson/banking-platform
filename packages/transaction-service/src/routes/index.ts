import { Router, Request, Response, NextFunction } from 'express';
import { CreateTransactionDto } from '@banking/shared';
import { TransactionService } from '../services/transaction.service.js';

export function createRoutes(service: TransactionService): Router {
  const router = Router();

  router.post('/transactions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = CreateTransactionDto.parse(req.body);
      const txn = await service.requestTransaction(input, req.correlationId);

      res.status(202).json({ success: true, data: txn });
    } catch (err) { next(err); }
  });

  router.get('/transactions/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const txn = await service.getTransaction(id);
      res.json({ success: true, data: txn });
    } catch (err) { next(err); }
  });

  router.get('/accounts/:accountId/transactions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const accountId = Array.isArray(req.params.accountId) ? req.params.accountId[0] : req.params.accountId;
      const txns = await service.getAccountTransactions(accountId);
      res.json({ success: true, data: txns });
    } catch (err) { next(err); }
  });

  return router;
}
