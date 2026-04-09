import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3003', 10),
  serviceName: 'ai-service',
  kafka: {
    brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'],
  },
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5435', 10),
    database: process.env.DB_NAME || 'ai_db',
    user: process.env.DB_USER || 'ai_user',
    password: process.env.DB_PASSWORD || 'ai_pass',
  },
  llm: {
    provider: process.env.LLM_PROVIDER || 'mock',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'claude-sonnet-4-20250514',
  },
  transactionServiceUrl: process.env.TRANSACTION_SERVICE_URL || 'http://localhost:3002',
  customerServiceUrl: process.env.CUSTOMER_SERVICE_URL || 'http://localhost:3001',
} as const;
