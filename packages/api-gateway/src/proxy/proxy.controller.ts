import {
  Controller,
  All,
  Req,
  Res,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { Request, Response } from 'express';

const CUSTOMER_URL = process.env.CUSTOMER_SERVICE_URL || 'http://localhost:3001';
const TRANSACTION_URL = process.env.TRANSACTION_SERVICE_URL || 'http://localhost:3002';
const AI_URL = process.env.AI_SERVICE_URL || 'http://localhost:3003';

function checkRole(req: Request, allowed: string[]) {
  const user = (req as any).user;
  const role = user?.role || req.headers['x-user-role'];
  if (!role || !allowed.includes(role as string)) {
    throw new ForbiddenException(`Role '${role}' not allowed. Required: ${allowed.join(' | ')}`);
  }
}

async function proxyRequest(req: Request, res: Response, targetBase: string) {
  const target = `${targetBase}${req.originalUrl}`;
  const logger = new Logger('ProxyController');

  try {
    const headers: Record<string, string> = {
      'content-type': (req.headers['content-type'] as string) || 'application/json',
      'x-correlation-id': (req.headers['x-correlation-id'] as string) || '',
      'x-user-id': (req.headers['x-user-id'] as string) || '',
      'x-user-role': (req.headers['x-user-role'] as string) || '',
      'x-user-email': (req.headers['x-user-email'] as string) || '',
    };

    const hasBody = ['POST', 'PUT', 'PATCH'].includes(req.method) && req.body;

    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(10000),
    });

    const data = await upstream.json().catch(() => ({}));
    res.status(upstream.status).json(data);
  } catch (err: any) {
    if (err instanceof ForbiddenException) throw err;
    const msg = err?.name === 'TimeoutError' ? 'Upstream timeout' : 'Upstream error';
    logger.error(`Proxy error to ${target}: ${err?.message}`);
    res.status(502).json({ success: false, error: { code: 'BAD_GATEWAY', message: msg } });
  }
}

const WRITE_ROLES = ['customer', 'admin'];
const READ_ROLES = ['customer', 'admin', 'readonly'];
const AI_ROLES = ['customer', 'admin', 'readonly'];

@Controller('api/v1/clients')
export class ClientsProxyController {
  @All()
  async proxyRoot(@Req() req: Request, @Res() res: Response) {
    checkRole(req, req.method === 'GET' ? READ_ROLES : WRITE_ROLES);
    await proxyRequest(req, res, CUSTOMER_URL);
  }

  @All('*')
  async proxy(@Req() req: Request, @Res() res: Response) {
    checkRole(req, req.method === 'GET' ? READ_ROLES : WRITE_ROLES);
    await proxyRequest(req, res, CUSTOMER_URL);
  }
}

@Controller('api/v1/accounts')
export class AccountsProxyController {
  @All()
  async proxyRoot(@Req() req: Request, @Res() res: Response) {
    checkRole(req, req.method === 'GET' ? READ_ROLES : WRITE_ROLES);
    await proxyRequest(req, res, CUSTOMER_URL);
  }

  @All('*')
  async proxy(@Req() req: Request, @Res() res: Response) {
    checkRole(req, req.method === 'GET' ? READ_ROLES : WRITE_ROLES);
    await proxyRequest(req, res, CUSTOMER_URL);
  }
}

@Controller('api/v1/transactions')
export class TransactionsProxyController {
  @All()
  async proxyRoot(@Req() req: Request, @Res() res: Response) {
    checkRole(req, req.method === 'GET' ? READ_ROLES : WRITE_ROLES);
    await proxyRequest(req, res, TRANSACTION_URL);
  }

  @All('*')
  async proxy(@Req() req: Request, @Res() res: Response) {
    checkRole(req, req.method === 'GET' ? READ_ROLES : WRITE_ROLES);
    await proxyRequest(req, res, TRANSACTION_URL);
  }
}

@Controller('api/v1/ai')
export class AIProxyController {
  @All()
  async proxyRoot(@Req() req: Request, @Res() res: Response) {
    checkRole(req, AI_ROLES);
    await proxyRequest(req, res, AI_URL);
  }

  @All('*')
  async proxy(@Req() req: Request, @Res() res: Response) {
    checkRole(req, AI_ROLES);
    await proxyRequest(req, res, AI_URL);
  }
}
