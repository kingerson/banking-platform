import CircuitBreaker from 'opossum';
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';

export interface CircuitBreakerOptions {
  timeout?: number;
  errorThresholdPercentage?: number;
  resetTimeout?: number;
  rollingCountTimeout?: number;
  rollingCountBuckets?: number;
  name?: string;
}

const DEFAULT_OPTIONS: CircuitBreakerOptions = {
  timeout: 3000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  rollingCountTimeout: 10000,
  rollingCountBuckets: 10,
};

export function createHttpCircuitBreaker(
  serviceName: string,
  options: CircuitBreakerOptions = {}
): CircuitBreaker {
  const config = { ...DEFAULT_OPTIONS, ...options, name: serviceName };

  const httpCall = async (requestConfig: AxiosRequestConfig): Promise<AxiosResponse> => {
    return await axios(requestConfig);
  };

  const breaker = new CircuitBreaker(httpCall, config);

  breaker.on('open', () => {
    console.error(`[Circuit Breaker] ${serviceName} - Circuit OPENED (too many failures)`);
  });

  breaker.on('halfOpen', () => {
    console.warn(`[Circuit Breaker] ${serviceName} - Circuit HALF-OPEN (testing recovery)`);
  });

  breaker.on('close', () => {
    console.log(`[Circuit Breaker] ${serviceName} - Circuit CLOSED (service recovered)`);
  });

  breaker.on('fallback', (_result: any) => {
    console.warn(`[Circuit Breaker] ${serviceName} - Fallback executed`);
  });

  breaker.on('timeout', () => {
    console.error(`[Circuit Breaker] ${serviceName} - Request timeout (>${config.timeout}ms)`);
  });

  breaker.on('reject', () => {
    console.error(`[Circuit Breaker] ${serviceName} - Request rejected (circuit is open)`);
  });

  breaker.on('success', () => {
    console.log(`[Circuit Breaker] ${serviceName} - Request succeeded`);
  });

  breaker.on('failure', (error) => {
    console.error(`[Circuit Breaker] ${serviceName} - Request failed:`, error.message);
  });

  return breaker;
}

export interface CircuitBreakerStats {
  name: string;
  state: 'open' | 'closed' | 'half_open';
  stats: {
    fires: number;
    successes: number;
    failures: number;
    rejects: number;
    timeouts: number;
    fallbacks: number;
    latencyMean: number;
    percentiles: {
      '0.0': number;
      '0.25': number;
      '0.5': number;
      '0.75': number;
      '0.9': number;
      '0.95': number;
      '0.99': number;
      '0.995': number;
      '1.0': number;
    };
  };
}

export function getCircuitBreakerStats(breaker: CircuitBreaker): CircuitBreakerStats {
  const stats = breaker.stats;
  const state = breaker.opened ? 'open' : breaker.halfOpen ? 'half_open' : 'closed';

  return {
    name: breaker.name,
    state,
    stats: {
      fires: stats.fires,
      successes: stats.successes,
      failures: stats.failures,
      rejects: stats.rejects,
      timeouts: stats.timeouts,
      fallbacks: stats.fallbacks,
      latencyMean: stats.latencyMean,
      percentiles: stats.percentiles as any,
    },
  };
}

export function createFallbackResponse<T>(
  serviceName: string,
  defaultValue: T
): (error: Error) => T {
  return (error: Error) => {
    console.error(`[Circuit Breaker] ${serviceName} - Using fallback response`, error.message);
    return defaultValue;
  };
}
