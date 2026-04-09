import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3002', 10),
  serviceName: 'transaction-service',
  kafka: {
    brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'],
  },
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5434', 10),
    database: process.env.DB_NAME || 'transactions_db',
    user: process.env.DB_USER || 'transactions_user',
    password: process.env.DB_PASSWORD || 'transactions_pass',
    max: parseInt(process.env.DB_POOL_MAX || '50'),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  },
  customerServiceUrl: process.env.CUSTOMER_SERVICE_URL || 'http://localhost:3001',
} as const;
