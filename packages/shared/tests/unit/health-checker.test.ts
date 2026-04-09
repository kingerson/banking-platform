import { describe, it, expect, vi } from 'vitest';
import { Pool } from 'pg';
import { HealthChecker } from '../../src/health/health-checker.js';

describe('HealthChecker', () => {
  it('should return healthy status when all dependencies are ok', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    } as unknown as Pool;

    const mockNats = {
      isClosed: vi.fn().mockReturnValue(false),
      isDraining: vi.fn().mockReturnValue(false),
    } as any;

    const checker = new HealthChecker('test-service');
    const health = await checker.check(mockPool, mockNats, { running: true, intervalMs: 5000 });

    expect(health.status).toBe('healthy');
    expect(health.service).toBe('test-service');
    expect(health.dependencies.database.status).toBe('healthy');
    expect(health.dependencies.eventBus.status).toBe('healthy');
    expect(health.dependencies.outboxPoller?.status).toBe('healthy');
  });

  it('should return unhealthy when database is down', async () => {
    const mockPool = {
      query: vi.fn().mockRejectedValue(new Error('Connection refused')),
    } as unknown as Pool;

    const mockNats = {
      isClosed: vi.fn().mockReturnValue(false),
      isDraining: vi.fn().mockReturnValue(false),
    } as any;

    const checker = new HealthChecker('test-service');
    const health = await checker.check(mockPool, mockNats);

    expect(health.status).toBe('unhealthy');
    expect(health.dependencies.database.status).toBe('unhealthy');
    expect(health.dependencies.database.message).toContain('Connection refused');
  });

  it('should return degraded when database is slow', async () => {
    const mockPool = {
      query: vi.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => resolve({ rows: [{ '?column?': 1 }] }), 150);
        });
      }),
    } as unknown as Pool;

    const mockNats = {
      isClosed: vi.fn().mockReturnValue(false),
      isDraining: vi.fn().mockReturnValue(false),
    } as any;

    const checker = new HealthChecker('test-service');
    const health = await checker.check(mockPool, mockNats);

    expect(health.status).toBe('degraded');
    expect(health.dependencies.database.status).toBe('degraded');
  });

  it('should return unhealthy when NATS is closed', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    } as unknown as Pool;

    const mockNats = {
      isClosed: vi.fn().mockReturnValue(true),
      isDraining: vi.fn().mockReturnValue(false),
    } as any;

    const checker = new HealthChecker('test-service');
    const health = await checker.check(mockPool, mockNats);

    expect(health.status).toBe('unhealthy');
    expect(health.dependencies.eventBus.status).toBe('unhealthy');
  });

  it('should include uptime in health check', async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    } as unknown as Pool;

    const checker = new HealthChecker('test-service');
    
    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const health = await checker.check(mockPool, null);

    expect(health.uptime).toBeGreaterThan(90);
  });
});
