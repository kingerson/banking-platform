import CircuitBreaker from 'opossum';
import { createHttpCircuitBreaker, createFallbackResponse } from './circuit-breaker.js';

export const customerServiceBreaker: CircuitBreaker = createHttpCircuitBreaker('customer-service', {
  timeout: 3000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
});

customerServiceBreaker.fallback(createFallbackResponse('customer-service', {
  success: false,
  error: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Customer service is temporarily unavailable. Please try again later.',
  },
}));

export const transactionServiceBreaker: CircuitBreaker = createHttpCircuitBreaker('transaction-service', {
  timeout: 5000,
  errorThresholdPercentage: 40,
  resetTimeout: 60000,
});

transactionServiceBreaker.fallback(createFallbackResponse('transaction-service', {
  success: false,
  error: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Transaction service is temporarily unavailable. Your request has not been processed.',
  },
}));

export const aiServiceBreaker: CircuitBreaker = createHttpCircuitBreaker('ai-service', {
  timeout: 10000,
  errorThresholdPercentage: 60,
  resetTimeout: 20000,
});

aiServiceBreaker.fallback(createFallbackResponse('ai-service', {
  success: true,
  data: {
    explanation: 'AI service is temporarily unavailable. Transaction completed successfully.',
  },
}));

export async function callWithCircuitBreaker(
  breaker: CircuitBreaker,
  url: string,
  options: any = {}
): Promise<any> {
  try {
    const response: any = await breaker.fire({
      url,
      method: options.method || 'GET',
      headers: options.headers || {},
      data: options.data,
      params: options.params,
    });
    return response.data;
  } catch (error: any) {

    if (error.message === 'Breaker is open') {
      throw new Error('Service temporarily unavailable due to repeated failures');
    }
    throw error;
  }
}

export function getAllBreakers(): CircuitBreaker[] {
  return [
    customerServiceBreaker,
    transactionServiceBreaker,
    aiServiceBreaker,
  ];
}

export function getCircuitBreakersHealth() {
  return getAllBreakers().map(breaker => ({
    service: breaker.name,
    state: breaker.opened ? 'open' : breaker.halfOpen ? 'half-open' : 'closed',
    healthy: !breaker.opened,
    stats: {
      fires: breaker.stats.fires,
      successes: breaker.stats.successes,
      failures: breaker.stats.failures,
      rejects: breaker.stats.rejects,
      timeouts: breaker.stats.timeouts,
      successRate: breaker.stats.fires > 0
        ? ((breaker.stats.successes / breaker.stats.fires) * 100).toFixed(2) + '%'
        : 'N/A',
    },
  }));
}
