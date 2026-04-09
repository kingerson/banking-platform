import { getRedisClient } from './redis-client.js';

export class CacheService {

  async getBalance(accountId: string): Promise<number | null> {
    try {
      const redis = getRedisClient();
      const cached = await redis.get(`balance:${accountId}`);

      if (cached) {
        console.log(`[Cache] HIT - balance:${accountId}`);
        return parseFloat(cached);
      }

      console.log(`[Cache] MISS - balance:${accountId}`);
      return null;
    } catch (error) {
      console.error('[Cache] Error getting balance:', error);
      return null;
    }
  }

  async setBalance(accountId: string, balance: number, ttl: number = 30): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.setEx(`balance:${accountId}`, ttl, balance.toString());
      console.log(`[Cache] SET - balance:${accountId} = ${balance} (TTL: ${ttl}s)`);
    } catch (error) {
      console.error('[Cache] Error setting balance:', error);

    }
  }

  async invalidateBalance(accountId: string): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.del(`balance:${accountId}`);
      console.log(`[Cache] INVALIDATE - balance:${accountId}`);
    } catch (error) {
      console.error('[Cache] Error invalidating balance:', error);
    }
  }

  async getClient(clientId: string): Promise<any | null> {
    try {
      const redis = getRedisClient();
      const cached = await redis.get(`client:${clientId}`);

      if (cached) {
        console.log(`[Cache] HIT - client:${clientId}`);
        return JSON.parse(cached);
      }

      console.log(`[Cache] MISS - client:${clientId}`);
      return null;
    } catch (error) {
      console.error('[Cache] Error getting client:', error);
      return null;
    }
  }

  async setClient(clientId: string, client: any, ttl: number = 300): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.setEx(`client:${clientId}`, ttl, JSON.stringify(client));
      console.log(`[Cache] SET - client:${clientId} (TTL: ${ttl}s)`);
    } catch (error) {
      console.error('[Cache] Error setting client:', error);
    }
  }

  async invalidateClient(clientId: string): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.del(`client:${clientId}`);
      console.log(`[Cache] INVALIDATE - client:${clientId}`);
    } catch (error) {
      console.error('[Cache] Error invalidating client:', error);
    }
  }

  async getAccount(accountId: string): Promise<any | null> {
    try {
      const redis = getRedisClient();
      const cached = await redis.get(`account:${accountId}`);

      if (cached) {
        console.log(`[Cache] HIT - account:${accountId}`);
        return JSON.parse(cached);
      }

      console.log(`[Cache] MISS - account:${accountId}`);
      return null;
    } catch (error) {
      console.error('[Cache] Error getting account:', error);
      return null;
    }
  }

  async setAccount(accountId: string, account: any, ttl: number = 120): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.setEx(`account:${accountId}`, ttl, JSON.stringify(account));
      console.log(`[Cache] SET - account:${accountId} (TTL: ${ttl}s)`);
    } catch (error) {
      console.error('[Cache] Error setting account:', error);
    }
  }

  async invalidateAccount(accountId: string): Promise<void> {
    try {
      const redis = getRedisClient();

      await redis.del(`account:${accountId}`);
      await redis.del(`balance:${accountId}`);
      console.log(`[Cache] INVALIDATE - account:${accountId} + balance`);
    } catch (error) {
      console.error('[Cache] Error invalidating account:', error);
    }
  }

  async checkRateLimit(
    key: string,
    maxRequests: number,
    windowSeconds: number
  ): Promise<{ allowed: boolean; remaining: number }> {
    try {
      const redis = getRedisClient();
      const now = Date.now();
      const windowStart = now - windowSeconds * 1000;

      const multi = redis.multi();

      multi.zRemRangeByScore(`ratelimit:${key}`, 0, windowStart);

      multi.zCard(`ratelimit:${key}`);

      multi.zAdd(`ratelimit:${key}`, { score: now, value: `${now}` });

      multi.expire(`ratelimit:${key}`, windowSeconds);

      const results = await multi.exec();
      const count = (results[1] as unknown) as number;

      const allowed = count < maxRequests;
      const remaining = Math.max(0, maxRequests - count - 1);

      if (!allowed) {
        console.log(`[Cache] RATE LIMIT - ${key} (${count}/${maxRequests})`);
      }

      return { allowed, remaining };
    } catch (error) {
      console.error('[Cache] Error checking rate limit:', error);

      return { allowed: true, remaining: maxRequests };
    }
  }

  async getSession(sessionId: string): Promise<any | null> {
    try {
      const redis = getRedisClient();
      const cached = await redis.get(`session:${sessionId}`);

      if (cached) {
        console.log(`[Cache] HIT - session:${sessionId}`);
        return JSON.parse(cached);
      }

      return null;
    } catch (error) {
      console.error('[Cache] Error getting session:', error);
      return null;
    }
  }

  async setSession(sessionId: string, session: any, ttl: number = 3600): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.setEx(`session:${sessionId}`, ttl, JSON.stringify(session));
      console.log(`[Cache] SET - session:${sessionId} (TTL: ${ttl}s)`);
    } catch (error) {
      console.error('[Cache] Error setting session:', error);
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.del(`session:${sessionId}`);
      console.log(`[Cache] DELETE - session:${sessionId}`);
    } catch (error) {
      console.error('[Cache] Error deleting session:', error);
    }
  }

  async flushAll(): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.flushDb();
      console.log('[Cache] FLUSH ALL');
    } catch (error) {
      console.error('[Cache] Error flushing cache:', error);
    }
  }

  async getStats(): Promise<{
    keys: number;
    memory: string;
    hits: number;
    misses: number;
  }> {
    try {
      const redis = getRedisClient();
      const info = await redis.info('stats');
      const dbSize = await redis.dbSize();

      const hits = parseInt(info.match(/keyspace_hits:(\d+)/)?.[1] || '0');
      const misses = parseInt(info.match(/keyspace_misses:(\d+)/)?.[1] || '0');
      const memory = info.match(/used_memory_human:(\S+)/)?.[1] || 'unknown';

      return {
        keys: dbSize,
        memory,
        hits,
        misses,
      };
    } catch (error) {
      console.error('[Cache] Error getting stats:', error);
      return { keys: 0, memory: 'unknown', hits: 0, misses: 0 };
    }
  }
}

export const cacheService = new CacheService();
