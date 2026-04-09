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
} from '@banking/shared';
import { config } from './config/index.js';
import { initDatabase, pool } from './models/database.js';
import { TransactionRepository, EventTracker, AccountProjectionRepository } from './repositories/index.js';
import { TransactionService } from './services/transaction.service.js';
import { registerTransactionSaga } from './saga/transaction.saga.js';
import { registerProjectionSubscribers } from './subscribers/index.js';
import { createRoutes } from './routes/index.js';

async function bootstrap() {
  await initDatabase();

  const eventBus = new KafkaEventBus({
    brokers: config.kafka?.brokers || ['localhost:9092'],
    clientId: config.serviceName,
  });
  await eventBus.connect();

  const txnRepo = new TransactionRepository();
  const tracker = new EventTracker();
  const projectionRepo = new AccountProjectionRepository();
  const txnService = new TransactionService(txnRepo);

  registerProjectionSubscribers(eventBus, projectionRepo, tracker, txnRepo);

  registerTransactionSaga(eventBus, txnRepo, tracker, projectionRepo);

  const outboxRepo = new OutboxRepository(pool);
  const outboxPoller = new OutboxPoller(outboxRepo, eventBus, 5000, pool);
  outboxPoller.start();
  console.log('[transaction-service] Outbox poller started (LISTEN/NOTIFY + 5s fallback)');

  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(correlationMiddleware());
  app.use(createCorrelationLogger(config.serviceName));
  app.use(express.json());

  const healthChecker = new HealthChecker(config.serviceName);
  app.get('/health', async (_req, res) => {
    const health = await healthChecker.check(
      pool,
      eventBus.getConnection(),
      outboxPoller.getStatus(),
    );
    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
    res.status(statusCode).json(health);
  });

  app.use('/api/v1', createRoutes(txnService));
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
  console.error('Failed to start transaction-service:', err);
  process.exit(1);
});
