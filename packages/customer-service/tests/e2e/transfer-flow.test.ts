import { describe, it, expect } from 'vitest';

/**
 * E2E Test: Full Transfer Flow
 *
 * Prerequisites:
 *   - docker compose up -d (NATS + 3 PostgreSQL)
 *   - All 3 microservices running
 *
 * This test exercises the complete async flow:
 *   1. Create two clients
 *   2. Create accounts for each
 *   3. Deposit funds into source account
 *   4. Transfer from source to target
 *   5. Verify balances updated
 *   6. Get AI explanation
 */

const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:3000';

async function api(method: string, path: string, body?: any) {
  const res = await fetch(`${GATEWAY}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('E2E: Full Transfer Flow', () => {
  let clientA: any;
  let clientB: any;
  let accountA: any;
  let accountB: any;

  it('1. should create two clients', async () => {
    const resA = await api('POST', '/api/v1/clients', {
      name: 'Alice García',
      email: `alice-${Date.now()}@test.com`,
      documentNumber: `A${Date.now()}`.slice(0, 15),
    });
    expect(resA.success).toBe(true);
    clientA = resA.data;

    const resB = await api('POST', '/api/v1/clients', {
      name: 'Bob López',
      email: `bob-${Date.now()}@test.com`,
      documentNumber: `B${Date.now()}`.slice(0, 15),
    });
    expect(resB.success).toBe(true);
    clientB = resB.data;
  });

  it('2. should create accounts', async () => {
    const resA = await api('POST', '/api/v1/accounts', { clientId: clientA.id });
    expect(resA.success).toBe(true);
    accountA = resA.data;
    expect(accountA.balance).toBe(0);

    const resB = await api('POST', '/api/v1/accounts', { clientId: clientB.id });
    expect(resB.success).toBe(true);
    accountB = resB.data;
  });

  it('3. should deposit 1000 into account A', async () => {
    const res = await api('POST', '/api/v1/transactions', {
      type: 'deposit',
      amount: 1000,
      targetAccountId: accountA.id,
      idempotencyKey: `dep-${Date.now()}`,
      description: 'Initial deposit',
    });
    expect(res.success).toBe(true);
    expect(res.data.status).toBe('pending');

    // Wait for async processing
    await sleep(3000);

    // Verify balance
    const balance = await api('GET', `/api/v1/accounts/${accountA.id}/balance`);
    expect(balance.data.balance).toBe(1000);
  });

  it('4. should transfer 350 from A to B', async () => {
    const res = await api('POST', '/api/v1/transactions', {
      type: 'transfer',
      amount: 350,
      sourceAccountId: accountA.id,
      targetAccountId: accountB.id,
      idempotencyKey: `xfer-${Date.now()}`,
      description: 'Payment for services',
    });
    expect(res.success).toBe(true);
    expect(res.data.status).toBe('pending');

    // Wait for saga + balance update
    await sleep(3000);

    const balA = await api('GET', `/api/v1/accounts/${accountA.id}/balance`);
    const balB = await api('GET', `/api/v1/accounts/${accountB.id}/balance`);

    expect(balA.data.balance).toBe(650);
    expect(balB.data.balance).toBe(350);
  });

  it('5. should reject transfer with insufficient funds', async () => {
    const res = await api('POST', '/api/v1/transactions', {
      type: 'transfer',
      amount: 9999,
      sourceAccountId: accountA.id,
      targetAccountId: accountB.id,
      idempotencyKey: `xfer-fail-${Date.now()}`,
    });
    expect(res.success).toBe(true);

    await sleep(3000);

    const txn = await api('GET', `/api/v1/transactions/${res.data.id}`);
    expect(txn.data.status).toBe('rejected');
    expect(txn.data.reason).toContain('Insufficient');
  });

  it('6. should get AI explanation for a transaction', async () => {
    // Get latest transactions
    const txns = await api('GET', `/api/v1/accounts/${accountA.id}/transactions`);
    const completedTxn = txns.data.find((t: any) => t.status === 'completed');

    if (completedTxn) {
      const explanation = await api('POST', '/api/v1/ai/explain', {
        transactionId: completedTxn.id,
      });
      expect(explanation.success).toBe(true);
      expect(explanation.data.explanation.length).toBeGreaterThan(10);
    }
  });

  it('7. should get AI account summary', async () => {
    const summary = await api('POST', '/api/v1/ai/summary', {
      accountId: accountA.id,
    });
    expect(summary.success).toBe(true);
    expect(summary.data.summary.length).toBeGreaterThan(10);
  });
});
