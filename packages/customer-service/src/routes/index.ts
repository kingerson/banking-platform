import { Router, Request, Response, NextFunction } from 'express';
import { CreateClientDto, CreateAccountDto } from '@banking/shared';
import { CustomerService } from '../services/customer.service.js';

export function createRoutes(service: CustomerService): Router {
  const router = Router();

  router.post('/clients', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = CreateClientDto.parse(req.body);
      const client = await service.createClient(input, req.correlationId);
      res.status(201).json({ success: true, data: client });
    } catch (err) { next(err); }
  });

  router.get('/clients', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const clients = await service.listClients();
      res.json({ success: true, data: clients });
    } catch (err) { next(err); }
  });

  router.get('/clients/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const client = await service.getClient(id);
      res.json({ success: true, data: client });
    } catch (err) { next(err); }
  });

  router.get('/clients/:id/accounts', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const accounts = await service.getClientAccounts(id);
      res.json({ success: true, data: accounts });
    } catch (err) { next(err); }
  });

  router.post('/accounts', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const input = CreateAccountDto.parse(req.body);
      const account = await service.createAccount(input, req.correlationId);
      res.status(201).json({ success: true, data: account });
    } catch (err) { next(err); }
  });

  router.get('/accounts/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const account = await service.getAccount(id);
      res.json({ success: true, data: account });
    } catch (err) { next(err); }
  });

  router.get('/accounts/:id/balance', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const balance = await service.getBalance(id);
      res.json({ success: true, data: balance });
    } catch (err) { next(err); }
  });

  return router;
}
