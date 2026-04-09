import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';
import { Request, Response, NextFunction } from 'express';

export class MetricsCollector {
  public readonly register: Registry;

  private httpRequestDuration!: Histogram;
  private httpRequestTotal!: Counter;
  private httpRequestErrors!: Counter;

  private businessCounters: Map<string, Counter> = new Map();
  private businessGauges: Map<string, Gauge> = new Map();
  private businessHistograms: Map<string, Histogram> = new Map();

  constructor(private serviceName: string) {
    this.register = new Registry();

    this.register.setDefaultLabels({
      service: serviceName,
      environment: process.env.NODE_ENV || 'development',
    });

    collectDefaultMetrics({
      register: this.register,
      prefix: 'nodejs_',
    });

    this.initHttpMetrics();
  }

  private initHttpMetrics(): void {

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
      registers: [this.register],
    });

    this.httpRequestTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.register],
    });

    this.httpRequestErrors = new Counter({
      name: 'http_request_errors_total',
      help: 'Total number of HTTP request errors',
      labelNames: ['method', 'route', 'error_type'],
      registers: [this.register],
    });
  }

  httpMetricsMiddleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const start = Date.now();

      const route = req.route?.path || req.path;

      res.on('finish', () => {
        const duration = (Date.now() - start) / 1000;
        const statusCode = res.statusCode.toString();
        const method = req.method;

        this.httpRequestDuration.labels(method, route, statusCode).observe(duration);
        this.httpRequestTotal.labels(method, route, statusCode).inc();

        if (res.statusCode >= 400) {
          const errorType = res.statusCode >= 500 ? 'server_error' : 'client_error';
          this.httpRequestErrors.labels(method, route, errorType).inc();
        }
      });

      next();
    };
  }

  createCounter(name: string, help: string, labelNames: string[] = []): Counter {
    if (this.businessCounters.has(name)) {
      return this.businessCounters.get(name)!;
    }

    const counter = new Counter({
      name: `${this.serviceName}_${name}`,
      help,
      labelNames,
      registers: [this.register],
    });

    this.businessCounters.set(name, counter);
    return counter;
  }

  createGauge(name: string, help: string, labelNames: string[] = []): Gauge {
    if (this.businessGauges.has(name)) {
      return this.businessGauges.get(name)!;
    }

    const gauge = new Gauge({
      name: `${this.serviceName}_${name}`,
      help,
      labelNames,
      registers: [this.register],
    });

    this.businessGauges.set(name, gauge);
    return gauge;
  }

  createHistogram(
    name: string,
    help: string,
    labelNames: string[] = [],
    buckets?: number[]
  ): Histogram {
    if (this.businessHistograms.has(name)) {
      return this.businessHistograms.get(name)!;
    }

    const histogram = new Histogram({
      name: `${this.serviceName}_${name}`,
      help,
      labelNames,
      buckets: buckets || [0.1, 0.5, 1, 2, 5, 10],
      registers: [this.register],
    });

    this.businessHistograms.set(name, histogram);
    return histogram;
  }

  async getMetrics(): Promise<string> {
    return await this.register.metrics();
  }

  async getMetricsJSON(): Promise<any> {
    const metrics = await this.register.getMetricsAsJSON();
    return metrics;
  }

  reset(): void {
    this.register.resetMetrics();
  }
}

export function createMetricsEndpoint(metricsCollector: MetricsCollector) {
  return async (_req: Request, res: Response) => {
    try {
      res.set('Content-Type', metricsCollector.register.contentType);
      const metrics = await metricsCollector.getMetrics();
      res.end(metrics);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  };
}

export class BankingMetrics {
  private transactionsTotal: Counter;
  private transactionAmount: Histogram;
  private accountsTotal: Gauge;
  private clientsTotal: Gauge;
  private transactionDuration: Histogram;
  private eventProcessingDuration: Histogram;
  private eventProcessingErrors: Counter;

  constructor(collector: MetricsCollector) {

    this.transactionsTotal = collector.createCounter(
      'transactions_total',
      'Total number of transactions processed',
      ['type', 'status', 'currency']
    );

    this.transactionAmount = collector.createHistogram(
      'transaction_amount',
      'Transaction amounts in currency units',
      ['type', 'currency'],
      [10, 50, 100, 500, 1000, 5000, 10000, 50000]
    );

    this.transactionDuration = collector.createHistogram(
      'transaction_duration_seconds',
      'Duration of transaction processing',
      ['type'],
      [0.1, 0.5, 1, 2, 5, 10]
    );

    this.accountsTotal = collector.createGauge(
      'accounts_total',
      'Total number of active accounts',
      ['currency']
    );

    this.clientsTotal = collector.createGauge(
      'clients_total',
      'Total number of registered clients'
    );

    this.eventProcessingDuration = collector.createHistogram(
      'event_processing_duration_seconds',
      'Duration of event processing',
      ['event_type'],
      [0.01, 0.05, 0.1, 0.5, 1, 2, 5]
    );

    this.eventProcessingErrors = collector.createCounter(
      'event_processing_errors_total',
      'Total number of event processing errors',
      ['event_type', 'error_type']
    );
  }

  recordTransaction(type: string, status: string, currency: string, amount: number): void {
    this.transactionsTotal.labels(type, status, currency).inc();
    this.transactionAmount.labels(type, currency).observe(amount);
  }

  recordTransactionDuration(type: string, durationSeconds: number): void {
    this.transactionDuration.labels(type).observe(durationSeconds);
  }

  setAccountsCount(currency: string, count: number): void {
    this.accountsTotal.labels(currency).set(count);
  }

  setClientsCount(count: number): void {
    this.clientsTotal.set(count);
  }

  recordEventProcessing(eventType: string, durationSeconds: number): void {
    this.eventProcessingDuration.labels(eventType).observe(durationSeconds);
  }

  recordEventError(eventType: string, errorType: string): void {
    this.eventProcessingErrors.labels(eventType, errorType).inc();
  }
}
