import { createClient, RedisClientType } from 'redis';

let redisClient: RedisClientType | null = null;

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
}

export async function initRedis(config: RedisConfig): Promise<RedisClientType> {
  if (redisClient) {
    return redisClient;
  }

  redisClient = createClient({
    socket: {
      host: config.host,
      port: config.port,
    },
    password: config.password,
    database: config.db || 0,
  });

  redisClient.on('error', (err) => {
    console.error('[Redis] Error:', err);
  });

  redisClient.on('connect', () => {
    console.log('[Redis] Connected');
  });

  redisClient.on('ready', () => {
    console.log('[Redis] Ready');
  });

  await redisClient.connect();

  return redisClient;
}

export function getRedisClient(): RedisClientType {
  if (!redisClient) {
    throw new Error('Redis client not initialized. Call initRedis() first.');
  }
  return redisClient;
}

export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    console.log('[Redis] Disconnected');
  }
}

export async function redisHealthCheck(): Promise<boolean> {
  try {
    if (!redisClient) return false;
    await redisClient.ping();
    return true;
  } catch {
    return false;
  }
}
