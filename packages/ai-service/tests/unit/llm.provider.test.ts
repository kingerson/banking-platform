import { describe, it, expect } from 'vitest';
import { MockLLMProvider } from '../../src/providers/llm.provider';

describe('MockLLMProvider', () => {
  const provider = new MockLLMProvider();

  it('should explain a rejected transaction with insufficient funds', async () => {
    const result = await provider.explain('Transaction rejected. Reason: Insufficient funds');
    expect(result).toContain('rechazada');
    expect(result).toContain('saldo');
  });

  it('should explain a completed deposit', async () => {
    const result = await provider.explain('Transaction type: deposit, status: completed');
    expect(result).toContain('depósito');
    expect(result).toContain('exitoso');
  });

  it('should explain a completed withdrawal', async () => {
    const result = await provider.explain('Transaction type: withdrawal, status: completed');
    expect(result).toContain('retiro');
  });

  it('should explain a completed transfer', async () => {
    const result = await provider.explain('Transaction type: transfer, status: completed');
    expect(result).toContain('transferencia');
    expect(result).toContain('completó');
  });

  it('should generate a summary for account history', async () => {
    const result = await provider.explain('Resume el historial de la cuenta');
    expect(result).toContain('Resumen');
  });

  it('should return a generic message for unknown prompts', async () => {
    const result = await provider.explain('something completely different');
    expect(result.length).toBeGreaterThan(10);
  });
});
