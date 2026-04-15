import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import * as dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);
const CUSTOMER_URL    = process.env.CUSTOMER_SERVICE_URL    || 'http://localhost:3001';
const TRANSACTION_URL = process.env.TRANSACTION_SERVICE_URL || 'http://localhost:3002';
const AI_URL          = process.env.AI_SERVICE_URL          || 'http://localhost:3003';
const IS_PROD = process.env.NODE_ENV === 'production';
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX ?? (IS_PROD ? '100' : '100000'));

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  app.enableCors();

  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many requests' } },
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  await app.listen(PORT);

  const logger = new Logger('Bootstrap');
  logger.log(`[api-gateway] Running on port ${PORT}`);
  logger.log(`  → customers:    ${CUSTOMER_URL}`);
  logger.log(`  → transactions: ${TRANSACTION_URL}`);
  logger.log(`  → ai:           ${AI_URL}`);
}

bootstrap().catch((err) => {
  console.error('Failed to start api-gateway:', err);
  process.exit(1);
});
