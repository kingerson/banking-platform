import { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { createHash } from 'crypto';

export function authenticationMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
    }

    try {

      req.user = { id: 'user-123', role: 'customer' };
      return next();
    } catch (error) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired token',
        },
      });
    }
  };
}

export function authorizationMiddleware(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userRole = req.user?.role;

    if (!userRole || !allowedRoles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions',
        },
      });
    }

    return next();
  };
}

export function maskSensitiveData(data: any): any {
  if (!data) return data;

  const sensitiveFields = ['password', 'documentNumber', 'accountNumber', 'cvv', 'pin'];

  if (typeof data === 'object') {
    const masked = { ...data };
    for (const field of sensitiveFields) {
      if (masked[field]) {
        masked[field] = '***MASKED***';
      }
    }
    return masked;
  }

  return data;
}

export function sanitizeInput(input: any): any {
  if (typeof input === 'string') {

    return input.replace(/[<>\"']/g, '');
  }

  if (typeof input === 'object' && input !== null) {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(input)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }

  return input;
}

export function securityHeadersMiddleware() {
  return (_req: Request, res: Response, next: NextFunction) => {

    res.setHeader('Content-Security-Policy', "default-src 'self'");

    res.setHeader('X-Content-Type-Options', 'nosniff');

    res.setHeader('X-Frame-Options', 'DENY');

    res.setHeader('X-XSS-Protection', '1; mode=block');

    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    return next();
  };
}

export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: {
    success: false,
    error: {
      code: 'TOO_MANY_ATTEMPTS',
      message: 'Too many login attempts. Please try again later.',
    },
  },
  standardHeaders: true,
  legacyHeaders: false,
});

export function requestSignatureMiddleware(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const signature = req.headers['x-signature'] as string;
    const timestamp = req.headers['x-timestamp'] as string;

    if (!signature || !timestamp) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_SIGNATURE',
          message: 'Request signature required',
        },
      });
    }

    const now = Date.now();
    const requestTime = parseInt(timestamp);
    const timeDiff = Math.abs(now - requestTime);

    if (timeDiff > 5 * 60 * 1000) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'EXPIRED_SIGNATURE',
          message: 'Request signature expired',
        },
      });
    }

    const payload = JSON.stringify(req.body) + timestamp;
    const expectedSignature = createHash('sha256')
      .update(payload + secret)
      .digest('hex');

    if (signature !== expectedSignature) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_SIGNATURE',
          message: 'Invalid request signature',
        },
      });
    }

    return next();
  };
}

export interface AuditLogEntry {
  timestamp: string;
  userId?: string;
  action: string;
  resource: string;
  ip: string;
  userAgent: string;
  correlationId?: string;
  success: boolean;
  errorCode?: string;
}

export function auditLogMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {

    const originalEnd = res.end;

    res.end = function (this: Response, ...args: any[]): Response {

      const auditLog: AuditLogEntry = {
        timestamp: new Date().toISOString(),
        userId: req.user?.id,
        action: `${req.method} ${req.path}`,
        resource: req.path,
        ip: req.ip || req.socket.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent'] || 'unknown',
        correlationId: req.correlationId,
        success: res.statusCode < 400,
        errorCode: res.statusCode >= 400 ? `HTTP_${res.statusCode}` : undefined,
      };

      console.log('[AUDIT]', JSON.stringify(auditLog));

      return originalEnd.call(this, args[0], args[1], args[2]);
    };

    return next();
  };
}

export function validateContentType(allowedTypes: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentType = req.headers['content-type'];

    if (!contentType || !allowedTypes.some(type => contentType.includes(type))) {
      return res.status(415).json({
        success: false,
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: `Content-Type must be one of: ${allowedTypes.join(', ')}`,
        },
      });
    }

    return next();
  };
}

export function requestSizeLimitMiddleware(maxSizeBytes: number = 1024 * 1024) {
  return (req: Request, res: Response, next: NextFunction) => {
    const contentLength = parseInt(req.headers['content-length'] || '0');

    if (contentLength > maxSizeBytes) {
      return res.status(413).json({
        success: false,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: `Request size exceeds ${maxSizeBytes} bytes`,
        },
      });
    }

    return next();
  };
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
        [key: string]: any;
      };
    }
  }
}
