import { config } from '../config/index.js';
import { SYSTEM_PROMPT } from '../prompts/index.js';

export interface LLMProvider {
  explain(prompt: string): Promise<string>;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 500,
): Promise<T> {
  let lastError: Error = new Error('Unknown error');
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (attempt === maxAttempts) break;
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 100;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError;
}

class LLMRateLimiter {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(
    private readonly maxConcurrent: number,
    private readonly minIntervalMs: number,
    private lastCallAt = 0,
  ) {}

  async acquire(): Promise<void> {
    return new Promise(resolve => {
      const tryAcquire = () => {
        const now = Date.now();
        const sinceLastCall = now - this.lastCallAt;
        if (this.running < this.maxConcurrent && sinceLastCall >= this.minIntervalMs) {
          this.running++;
          this.lastCallAt = now;
          resolve();
        } else {
          const wait = Math.max(0, this.minIntervalMs - sinceLastCall);
          setTimeout(tryAcquire, wait + 10);
        }
      };
      tryAcquire();
    });
  }

  release(): void {
    this.running = Math.max(0, this.running - 1);
    const next = this.queue.shift();
    if (next) next();
  }
}

const rateLimiter = new LLMRateLimiter(3, 200);

export class MockLLMProvider implements LLMProvider {
  async explain(prompt: string): Promise<string> {
    await new Promise(r => setTimeout(r, 200));

    if (prompt.includes('riskLevel') || prompt.includes('analyzeRisk') || prompt.includes('Analiza el riesgo')) {
      const amount = parseFloat(prompt.match(/Monto: ([\d.]+)/)?.[1] || '0');
      const balance = parseFloat(prompt.match(/Saldo disponible: ([\d.]+)/)?.[1] || '9999');
      const ratio = balance > 0 ? amount / balance : 1;
      const riskLevel = ratio > 0.8 ? 'high' : ratio > 0.4 ? 'medium' : 'low';
      const score = Math.min(100, Math.round(ratio * 100));
      const reasons: string[] = [];
      if (ratio > 0.8) reasons.push('El monto supera el 80% del saldo disponible');
      if (amount > 5000) reasons.push('Monto elevado para una sola operación');
      if (reasons.length === 0) reasons.push('Transacción dentro de parámetros normales');
      return JSON.stringify({
        riskLevel,
        score,
        reasons,
        recommendation: riskLevel === 'high'
          ? 'Revisar manualmente antes de aprobar'
          : riskLevel === 'medium'
          ? 'Monitorear actividad de la cuenta'
          : 'Aprobar automáticamente',
      });
    }

    if (prompt.includes('rejected') && prompt.includes('Insufficient funds')) {
      return 'La transferencia fue rechazada porque el saldo disponible en la cuenta de origen era insuficiente para cubrir el monto solicitado. Te recomendamos verificar tu saldo antes de realizar nuevas operaciones.';
    }

    if (prompt.includes('rejected')) {
      return 'La transacción no pudo ser procesada. Esto puede deberse a fondos insuficientes, una cuenta inexistente o un error temporal del sistema. Por favor, verifica los datos e intenta nuevamente.';
    }

    if ((prompt.includes('depósito') || prompt.includes('deposit')) &&
        (prompt.includes('completada') || prompt.includes('completed'))) {
      return 'Se realizó un depósito exitoso en tu cuenta. El monto ha sido acreditado y ya se refleja en tu saldo disponible.';
    }

    if ((prompt.includes('retiro') || prompt.includes('withdrawal')) &&
        (prompt.includes('completada') || prompt.includes('completed'))) {
      return 'Se procesó un retiro de tu cuenta exitosamente. El monto fue debitado de tu saldo disponible.';
    }

    if ((prompt.includes('transferencia') || prompt.includes('transfer')) &&
        (prompt.includes('completada') || prompt.includes('completed'))) {
      return 'La transferencia se completó exitosamente. El monto fue debitado de la cuenta de origen y acreditado en la cuenta de destino.';
    }

    if (prompt.includes('Resume el historial') || prompt.includes('historial')) {
      return 'Resumen de movimientos: Tu cuenta muestra actividad reciente incluyendo depósitos y transferencias. El saldo refleja todas las operaciones completadas. Para más detalles, consulta el historial completo de transacciones.';
    }

    return 'La operación ha sido procesada correctamente. Si tienes alguna duda, no dudes en contactar a soporte.';
  }
}

export class AnthropicLLMProvider implements LLMProvider {
  private apiKey: string;
  private model: string;

  constructor() {
    this.apiKey = config.llm.apiKey;
    this.model = config.llm.model;
  }

  async explain(prompt: string): Promise<string> {
    await rateLimiter.acquire();
    try {
      return await withRetry(async () => {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: this.model,
            max_tokens: 500,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: prompt }],
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (response.status === 429 || response.status >= 500) {
          throw new Error(`Anthropic API error: ${response.status}`);
        }

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`Anthropic API error: ${response.status} - ${error}`);
        }

        const data = await response.json() as {
          content: Array<{ type: string; text: string }>;
        };

        return data.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('\n');
      }, 3, 1000);
    } finally {
      rateLimiter.release();
    }
  }
}

export class FallbackLLMProvider implements LLMProvider {
  private primary: LLMProvider;
  private fallback: LLMProvider;

  constructor(primary: LLMProvider, fallback: LLMProvider) {
    this.primary = primary;
    this.fallback = fallback;
  }

  async explain(prompt: string): Promise<string> {
    try {
      return await this.primary.explain(prompt);
    } catch (err: any) {
      console.warn('[LLM] Primary provider failed, using fallback:', err.message);
      return this.fallback.explain(prompt);
    }
  }
}

export function createLLMProvider(): LLMProvider {
  const mock = new MockLLMProvider();

  switch (config.llm.provider) {
    case 'anthropic': {
      if (!config.llm.apiKey) {
        console.warn('[LLM] Anthropic selected but no API key found, using Mock');
        return mock;
      }
      console.log('[LLM] Using Anthropic Claude provider with Mock fallback');
      return new FallbackLLMProvider(new AnthropicLLMProvider(), mock);
    }
    case 'mock':
    default:
      console.log('[LLM] Using Mock provider');
      return mock;
  }
}
