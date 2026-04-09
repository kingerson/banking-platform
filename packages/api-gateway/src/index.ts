import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);
const CUSTOMER_URL   = process.env.CUSTOMER_SERVICE_URL   || 'http://localhost:3001';
const TRANSACTION_URL = process.env.TRANSACTION_SERVICE_URL || 'http://localhost:3002';
const AI_URL         = process.env.AI_SERVICE_URL         || 'http://localhost:3003';
const JWT_SECRET     = process.env.JWT_SECRET || 'banking-platform-secret-key-2024';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h';

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan('short'));
app.use(express.json());

const IS_PROD = process.env.NODE_ENV === 'production';
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX ?? (IS_PROD ? '100' : '100000'));
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many requests' } },
}));

interface JwtPayload {
  sub: string;
  email: string;
  role: 'admin' | 'customer' | 'readonly';
  clientId?: string;
  iat?: number;
  exp?: number;
}

function requireAuth(roles?: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Bearer token required' } });
      return;
    }
    try {
      const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET) as JwtPayload;
      if (roles?.length && !roles.includes(decoded.role)) {
        res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: `Role '${decoded.role}' not allowed. Required: ${roles.join(' | ')}` } });
        return;
      }
      req.headers['x-user-id']    = decoded.sub;
      req.headers['x-user-role']  = decoded.role;
      req.headers['x-user-email'] = decoded.email;
      next();
    } catch (err) {
      const message = err instanceof jwt.TokenExpiredError ? 'Token expired'
        : err instanceof jwt.JsonWebTokenError ? 'Invalid token' : 'Authentication failed';
      res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message } });
    }
  };
}

function proxyTo(baseUrl: string) {
  return async (req: Request, res: Response): Promise<void> => {
    const target = `${baseUrl}${req.originalUrl}`;
    try {
      const headers: Record<string, string> = {
        'content-type': req.headers['content-type'] || 'application/json',
        'x-correlation-id': (req.headers['x-correlation-id'] as string) || '',
        'x-user-id':    (req.headers['x-user-id'] as string)    || '',
        'x-user-role':  (req.headers['x-user-role'] as string)  || '',
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
      const msg = err?.name === 'TimeoutError' ? 'Upstream timeout' : 'Upstream error';
      res.status(502).json({ success: false, error: { code: 'BAD_GATEWAY', message: msg } });
    }
  };
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api-gateway' });
});

app.post('/auth/login', (req: Request, res: Response) => {
  const { email, password, role = 'customer' } = req.body;
  if (!email || !password) {
    res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'email and password are required' } });
    return;
  }

  const DEMO_USERS: Record<string, { password: string; role: string; clientId?: string }> = {
    'admin@bank.com':    { password: 'admin123',    role: 'admin' },
    'customer@bank.com': { password: 'customer123', role: 'customer' },
    'readonly@bank.com': { password: 'readonly123', role: 'readonly' },
  };

  const user = DEMO_USERS[email];
  const isDemo = !user && password === 'demo';

  if (!user && !isDemo) {
    res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
    return;
  }
  if (user && user.password !== password) {
    res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
    return;
  }

  const payload: JwtPayload = {
    sub: `user-${Date.now()}`,
    email,
    role: (user?.role || role) as JwtPayload['role'],
    clientId: user?.clientId,
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
  const decoded = jwt.decode(token) as JwtPayload;

  res.json({
    success: true,
    data: {
      token,
      type: 'Bearer',
      expiresAt: new Date(decoded.exp! * 1000).toISOString(),
      user: { id: payload.sub, email, role: payload.role },
    },
  });
});

app.post('/auth/refresh', requireAuth(), (req: Request, res: Response) => {
  const decoded = jwt.decode(req.headers.authorization!.slice(7)) as JwtPayload;
  const newToken = jwt.sign(
    { sub: decoded.sub, email: decoded.email, role: decoded.role, clientId: decoded.clientId },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions,
  );
  const nd = jwt.decode(newToken) as JwtPayload;
  res.json({ success: true, data: { token: newToken, type: 'Bearer', expiresAt: new Date(nd.exp! * 1000).toISOString() } });
});

app.get('/auth/me', requireAuth(), (req: Request, res: Response) => {
  const decoded = jwt.decode(req.headers.authorization!.slice(7)) as JwtPayload;
  res.json({
    success: true,
    data: { id: decoded.sub, email: decoded.email, role: decoded.role, clientId: decoded.clientId, tokenExpiresAt: new Date(decoded.exp! * 1000).toISOString() },
  });
});

app.use('/api/v1/clients',      requireAuth(['customer', 'admin']),           proxyTo(CUSTOMER_URL));
app.use('/api/v1/accounts',     requireAuth(['customer', 'admin']),           proxyTo(CUSTOMER_URL));
app.use('/api/v1/transactions', requireAuth(['customer', 'admin']),           proxyTo(TRANSACTION_URL));
app.use('/api/v1/ai',           requireAuth(['customer', 'admin', 'readonly']), proxyTo(AI_URL));

app.listen(PORT, () => {
  console.log(`[api-gateway] Running on port ${PORT}`);
  console.log(`  → customers:    ${CUSTOMER_URL}`);
  console.log(`  → transactions: ${TRANSACTION_URL}`);
  console.log(`  → ai:           ${AI_URL}`);
  console.log(`  → JWT secret:   ${JWT_SECRET.slice(0, 8)}...`);
});
