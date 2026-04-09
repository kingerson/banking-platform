import { Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

export function correlationMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {

    const correlationId = (req.headers['x-correlation-id'] as string) || uuid();

    req.correlationId = correlationId;

    res.setHeader('X-Correlation-ID', correlationId);

    next();
  };
}

export function createCorrelationLogger(serviceName: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const start = Date.now();
    const correlationId = req.correlationId || 'unknown';

    console.log(
      `[${serviceName}] ${req.method} ${req.path} | correlationId: ${correlationId}`,
    );

    _res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(
        `[${serviceName}] ${req.method} ${req.path} ${_res.statusCode} | ${duration}ms | correlationId: ${correlationId}`,
      );
    });

    next();
  };
}
