import { Pool } from 'pg';
import { NatsConnection } from 'nats';
import { Kafka } from 'kafkajs';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthCheck {
  status: HealthStatus;
  timestamp: string;
  service: string;
  version: string;
  dependencies: {
    database: DependencyHealth;
    eventBus: DependencyHealth;
    redis?: DependencyHealth;
    outboxPoller?: DependencyHealth;
  };
  uptime: number;
}

export interface DependencyHealth {
  status: HealthStatus;
  message?: string;
  latencyMs?: number;
}

export class HealthChecker {
  private startTime: number;

  constructor(
    private serviceName: string,
    private version: string = '1.0.0',
  ) {
    this.startTime = Date.now();
  }

  async check(
    dbPool: Pool,
    eventBusConnection: NatsConnection | Kafka | null,
    outboxPollerStatus?: { running: boolean; intervalMs: number },
    redisHealthCheck?: () => Promise<boolean>,
  ): Promise<HealthCheck> {
    const [dbHealth, eventBusHealth, redisHealth] = await Promise.all([
      this.checkDatabase(dbPool),
      this.checkEventBus(eventBusConnection),
      redisHealthCheck ? this.checkRedis(redisHealthCheck) : Promise.resolve(undefined),
    ]);

    const outboxHealth = outboxPollerStatus
      ? this.checkOutboxPoller(outboxPollerStatus)
      : undefined;

    const statuses = [
      dbHealth.status,
      eventBusHealth.status,
      redisHealth?.status,
      outboxHealth?.status,
    ].filter(Boolean) as HealthStatus[];
    const overallStatus = this.aggregateStatus(statuses);

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      service: this.serviceName,
      version: this.version,
      dependencies: {
        database: dbHealth,
        eventBus: eventBusHealth,
        ...(redisHealth && { redis: redisHealth }),
        ...(outboxHealth && { outboxPoller: outboxHealth }),
      },
      uptime: Date.now() - this.startTime,
    };
  }

  private async checkDatabase(pool: Pool): Promise<DependencyHealth> {
    const start = Date.now();
    try {
      await pool.query('SELECT 1');
      const latencyMs = Date.now() - start;

      return {
        status: latencyMs < 100 ? 'healthy' : 'degraded',
        message: latencyMs < 100 ? 'Connected' : 'Slow response',
        latencyMs,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  private async checkEventBus(
    connection: NatsConnection | Kafka | null,
  ): Promise<DependencyHealth> {
    if (!connection) {
      return {
        status: 'unhealthy',
        message: 'Not connected',
      };
    }

    if ('isClosed' in connection) {
      return this.checkNats(connection as NatsConnection);
    }

    if ('admin' in connection) {
      return this.checkKafka(connection as Kafka);
    }

    return {
      status: 'unhealthy',
      message: 'Unknown event bus type',
    };
  }

  private async checkNats(nc: NatsConnection): Promise<DependencyHealth> {
    try {
      const isClosed = nc.isClosed();
      const isDraining = nc.isDraining();

      if (isClosed) {
        return {
          status: 'unhealthy',
          message: 'Connection closed',
        };
      }

      if (isDraining) {
        return {
          status: 'degraded',
          message: 'Connection draining',
        };
      }

      return {
        status: 'healthy',
        message: 'Connected',
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async checkKafka(kafka: Kafka): Promise<DependencyHealth> {
    const start = Date.now();
    try {
      const admin = kafka.admin();
      await admin.connect();
      await admin.listTopics();
      await admin.disconnect();
      const latencyMs = Date.now() - start;

      return {
        status: latencyMs < 200 ? 'healthy' : 'degraded',
        message: latencyMs < 200 ? 'Connected' : 'Slow response',
        latencyMs,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  private async checkRedis(healthCheck: () => Promise<boolean>): Promise<DependencyHealth> {
    const start = Date.now();
    try {
      const isHealthy = await healthCheck();
      const latencyMs = Date.now() - start;

      if (!isHealthy) {
        return {
          status: 'unhealthy',
          message: 'Health check failed',
        };
      }

      return {
        status: latencyMs < 50 ? 'healthy' : 'degraded',
        message: latencyMs < 50 ? 'Connected' : 'Slow response',
        latencyMs,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: error instanceof Error ? error.message : 'Connection failed',
      };
    }
  }

  private checkOutboxPoller(status: { running: boolean; intervalMs: number }): DependencyHealth {
    if (!status.running) {
      return {
        status: 'unhealthy',
        message: 'Poller not running',
      };
    }

    return {
      status: 'healthy',
      message: `Running (${status.intervalMs}ms interval)`,
    };
  }

  private aggregateStatus(statuses: HealthStatus[]): HealthStatus {
    if (statuses.includes('unhealthy')) return 'unhealthy';
    if (statuses.includes('degraded')) return 'degraded';
    return 'healthy';
  }
}
