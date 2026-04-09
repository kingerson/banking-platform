import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  serviceName: 'customer-service',
  kafka: {
    brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'],
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5433', 10),
    database: process.env.DB_NAME || 'customers_db',
    user: process.env.DB_USER || 'customers_user',
    password: process.env.DB_PASSWORD || 'customers_pass',
    max: parseInt(process.env.DB_POOL_MAX || '50'),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
} as const;
