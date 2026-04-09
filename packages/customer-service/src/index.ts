import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import {
  KafkaEventBus,
  createErrorHandler,
  OutboxRepository,
  OutboxPoller,
  HealthChecker,
  correlationMiddleware,
  createCorrelationLogger,
  initRedis,
} from '@banking/shared';
import { config } from './config/index.js';
import { initDatabase, pool } from './models/database.js';
import { ClientRepository, AccountRepository, EventTracker } from './repositories/index.js';
import { CustomerService } from './services/customer.service.js';
import { createRoutes } from './routes/index.js';
import { registerSubscribers } from './subscribers/index.js';

async function bootstrap() {
  await initDatabase();

  await initRedis({
    host: config.redis?.host || 'localhost',
    port: config.redis?.port || 6379,
  });

  const eventBus = new KafkaEventBus({
    brokers: config.kafka?.brokers || ['localhost:9092'],
    clientId: config.serviceName,
  });
  await eventBus.connect();

  const clientRepo = new ClientRepository();
  const accountRepo = new AccountRepository();
  const tracker = new EventTracker();
  const customerService = new CustomerService(clientRepo, accountRepo);

  registerSubscribers(eventBus, accountRepo, tracker);

  const outboxRepo = new OutboxRepository(pool);
  const outboxPoller = new OutboxPoller(outboxRepo, eventBus, 5000, pool);
  outboxPoller.start();
  console.log('[customer-service] Outbox poller started (LISTEN/NOTIFY + 5s fallback)');

  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(correlationMiddleware());
  app.use(createCorrelationLogger(config.serviceName));
  app.use(express.json());

  const healthChecker = new HealthChecker(config.serviceName);
  app.get('/health', async (_req, res) => {
    const { redisHealthCheck } = await import('@banking/shared');
    const health = await healthChecker.check(
      pool,
      eventBus.getConnection(),
      outboxPoller.getStatus(),
      redisHealthCheck,
    );
    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
    res.status(statusCode).json(health);
  });

  app.use('/api/v1', createRoutes(customerService));
  app.use(createErrorHandler());

  app.listen(config.port, () => {
    console.log(`[${config.serviceName}] Running on port ${config.port}`);
  });

  const shutdown = async () => {
    console.log(`[${config.serviceName}] Shutting down...`);
    outboxPoller.stop();
    await eventBus.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch((err) => {
  console.error('Failed to start customer-service:', err);
  process.exit(1);
});
