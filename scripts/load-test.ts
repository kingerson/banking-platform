#!/usr/bin/env tsx

import { randomUUID } from 'crypto';

const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const GRAPHQL_URL = process.env.GRAPHQL_URL || 'http://localhost:4000/graphql';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace('--', '').split('=');
    return [k, v ?? 'true'];
  }),
);

const CONFIG = {
  totalTransactions: parseInt(args.txns ?? '1000'),
  concurrency: parseInt(args.concurrency ?? '20'),
  mode: (args.mode ?? 'mixed') as 'write' | 'deposit' | 'read' | 'mixed' | 'stress',
  reportInterval: parseInt(args.interval ?? '5000'),
  requestTimeout: parseInt(args.timeout ?? '15000'),
  numClients: parseInt(args.clients ?? '20'),
};

interface Metrics {
  total: number;
  success: number;
  failed: number;
  latencies: number[];
  errors: Record<string, number>;
  startTime: number;
  endTime?: number;
}

interface TestAccount { id: string; }
interface TestClient  { id: string; accounts: TestAccount[]; }

async function httpPost(path: string, body: any): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Correlation-ID': randomUUID() },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(CONFIG.requestTimeout),
  });
  const json = await res.json() as any;
  if (!res.ok || json.success === false) {
    throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  }
  return json.data ?? json;
}

async function httpGet(path: string): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'X-Correlation-ID': randomUUID() },
    signal: AbortSignal.timeout(CONFIG.requestTimeout),
  });
  const json = await res.json() as any;
  if (!res.ok || json.success === false) {
    throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  }
  return json.data ?? json;
}

async function graphqlQuery(query: string, variables: any = {}): Promise<any> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Correlation-ID': randomUUID() },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(CONFIG.requestTimeout),
  });
  const json = await res.json() as any;
  if (json.errors && !json.data) throw new Error(json.errors[0].message);
  return json.data;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

const fmt = {
  ms:  (ms: number) => ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(2)}s`,
  num: (n: number)  => n.toLocaleString('es-PE'),
};

function printReport(m: Metrics, label: string) {
  const elapsed = ((m.endTime ?? Date.now()) - m.startTime) / 1000;
  const sorted  = [...m.latencies].sort((a, b) => a - b);
  const tps     = m.success / elapsed;
  const errPct  = m.total > 0 ? (m.failed / m.total * 100) : 0;

  console.log(`\n${'─'.repeat(62)}`);
  console.log(`  ${label}`);
  console.log(`${'─'.repeat(62)}`);
  console.log(`  Total requests  : ${fmt.num(m.total)}`);
  console.log(`  Exitosos        : ${fmt.num(m.success)}`);
  console.log(`  Fallidos        : ${fmt.num(m.failed)} (${errPct.toFixed(1)}%)`);
  console.log(`  Tiempo total    : ${elapsed.toFixed(1)}s`);
  console.log(`  Throughput      : ${tps.toFixed(0)} req/s`);
  if (sorted.length > 0) {
    console.log(`  Latencia`);
    console.log(`     p50 : ${fmt.ms(percentile(sorted, 50))}`);
    console.log(`     p75 : ${fmt.ms(percentile(sorted, 75))}`);
    console.log(`     p95 : ${fmt.ms(percentile(sorted, 95))}`);
    console.log(`     p99 : ${fmt.ms(percentile(sorted, 99))}`);
    console.log(`     max : ${fmt.ms(sorted[sorted.length - 1])}`);
    console.log(`     min : ${fmt.ms(sorted[0])}`);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    console.log(`     avg : ${fmt.ms(avg)}`);
  }
  if (Object.keys(m.errors).length > 0) {
    console.log(`  Top errores:`);
    Object.entries(m.errors)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([msg, cnt]) => console.log(`     ${msg.substring(0, 55)}: ${cnt}`));
  }
}

async function setupTestData(numClients: number): Promise<TestClient[]> {
  console.log(`\nCreando ${numClients} clientes con 2 cuentas cada uno...`);
  const clients: TestClient[] = [];
  const ts = Date.now();

  for (let i = 0; i < numClients; i++) {
    try {
      const client = await httpPost('/api/v1/clients', {
        name: `LoadTest User ${i}`,
        email: `lt_${ts}_${i}@test.com`,
        documentNumber: `${String(ts).slice(-6)}${String(i).padStart(6, '0')}`,
      });

      const [accA, accB] = await Promise.all([
        httpPost('/api/v1/accounts', { clientId: client.id, currency: 'PEN' }),
        httpPost('/api/v1/accounts', { clientId: client.id, currency: 'PEN' }),
      ]);

      clients.push({ id: client.id, accounts: [{ id: accA.id }, { id: accB.id }] });
      process.stdout.write(`\r  Creados: ${clients.length}/${numClients}`);
    } catch (e: any) {
      process.stdout.write(`\r  Error cliente ${i}: ${e.message.substring(0, 40)}\n`);
    }
  }

  console.log(`\n  ${clients.length} clientes listos`);
  return clients;
}

async function seedDeposits(clients: TestClient[]): Promise<void> {
  console.log('\nEsperando propagacion CQRS de cuentas (20s)...');
  await new Promise(r => setTimeout(r, 20000));

  console.log('\nDepositando saldo inicial (100,000 por cuenta A)...');
  let done = 0;
  let failed = 0;

  for (const c of clients) {
    try {
      await httpPost('/api/v1/transactions', {
        type: 'deposit',
        amount: 100000,
        targetAccountId: c.accounts[0].id,
        currency: 'PEN',
        idempotencyKey: `seed-${c.accounts[0].id}`,
      });
      done++;
    } catch (e: any) {
      failed++;
      if (failed <= 3) {
        process.stdout.write(`\n  Seed deposit error (acc=${c.accounts[0].id}): ${e.message}\n`);
      }
    }
    process.stdout.write(`\r  Depositados: ${done} ok, ${failed} err / ${clients.length}`);
  }

  console.log('\n  Esperando procesamiento del saga (15s)...');
  await new Promise(r => setTimeout(r, 15000));

  let withBalance = 0;
  for (const c of clients.slice(0, Math.min(5, clients.length))) {
    try {
      const bal = await httpGet(`/api/v1/accounts/${c.accounts[0].id}/balance`);
      if ((bal?.balance ?? 0) > 0) withBalance++;
    } catch { }
  }
  const sample = Math.min(5, clients.length);
  console.log(`  Balances verificados: ${withBalance}/${sample} cuentas con saldo`);
  if (withBalance === 0) {
    console.log('  Los balances aun no estan disponibles. El load test usara solo depositos.');
  }
}

async function depositWorker(clients: TestClient[], m: Metrics, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const c = clients[Math.floor(Math.random() * clients.length)];
    const acc = c.accounts[Math.floor(Math.random() * c.accounts.length)];
    const body = {
      type: 'deposit',
      amount: Math.floor(Math.random() * 1000) + 100,
      targetAccountId: acc.id,
      currency: 'PEN',
      idempotencyKey: randomUUID(),
    };
    const t0 = Date.now();
    try {
      await httpPost('/api/v1/transactions', body);
      m.latencies.push(Date.now() - t0);
      m.success++;
    } catch (e: any) {
      m.failed++;
      const key = (e.message ?? 'unknown').substring(0, 60);
      m.errors[key] = (m.errors[key] ?? 0) + 1;
    }
    m.total++;
  }
}

async function writeWorker(clients: TestClient[], m: Metrics, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const c   = clients[Math.floor(Math.random() * clients.length)];
    const [a, b] = c.accounts;
    const roll = Math.random();

    let body: any;
    if (roll < 0.4) {
      body = { type: 'transfer', amount: Math.floor(Math.random() * 200) + 10,
               sourceAccountId: a.id, targetAccountId: b.id,
               currency: 'PEN', idempotencyKey: randomUUID(),
               description: `Load test transfer #${i}` };
    } else if (roll < 0.7) {
      body = { type: 'deposit', amount: Math.floor(Math.random() * 1000) + 100,
               targetAccountId: a.id, currency: 'PEN', idempotencyKey: randomUUID() };
    } else if (roll < 0.85) {
      body = { type: 'withdrawal', amount: Math.floor(Math.random() * 100) + 10,
               sourceAccountId: a.id, currency: 'PEN', idempotencyKey: randomUUID() };
    } else {
      body = { type: 'transfer', amount: Math.floor(Math.random() * 50) + 5,
               sourceAccountId: b.id, targetAccountId: a.id,
               currency: 'PEN', idempotencyKey: randomUUID() };
    }

    const t0 = Date.now();
    try {
      await httpPost('/api/v1/transactions', body);
      m.latencies.push(Date.now() - t0);
      m.success++;
    } catch (e: any) {
      m.failed++;
      const key = (e.message ?? 'unknown').substring(0, 60);
      m.errors[key] = (m.errors[key] ?? 0) + 1;
    }
    m.total++;
  }
}

async function readWorker(clients: TestClient[], m: Metrics, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    const c   = clients[Math.floor(Math.random() * clients.length)];
    const acc = c.accounts[Math.floor(Math.random() * c.accounts.length)];
    const roll = Math.random();

    const t0 = Date.now();
    try {
      if (roll < 0.25) {
        await graphqlQuery(`query($id:ID!){client(id:$id){id name accounts{id balance}}}`, { id: c.id });
      } else if (roll < 0.5) {
        await httpGet(`/api/v1/accounts/${acc.id}/balance`);
      } else if (roll < 0.75) {
        await httpGet(`/api/v1/clients/${c.id}`);
      } else {
        await httpGet(`/api/v1/accounts/${acc.id}/transactions`);
      }
      m.latencies.push(Date.now() - t0);
      m.success++;
    } catch (e: any) {
      m.failed++;
      const key = (e.message ?? 'unknown').substring(0, 60);
      m.errors[key] = (m.errors[key] ?? 0) + 1;
    }
    m.total++;
  }
}

async function stressTest(clients: TestClient[]): Promise<void> {
  console.log('\nSTRESS TEST — Ctrl+C para detener\n');
  const m: Metrics = { total: 0, success: 0, failed: 0, latencies: [], errors: {}, startTime: Date.now() };
  let running = true;

  process.on('SIGINT', () => {
    running = false;
    m.endTime = Date.now();
    printReport(m, 'STRESS TEST — Resultado Final');
    process.exit(0);
  });

  const interval = setInterval(() => {
    if (!running) return;
    const elapsed = (Date.now() - m.startTime) / 1000;
    const sorted  = [...m.latencies].sort((a, b) => a - b);
    console.log(
      `[${new Date().toLocaleTimeString()}] ` +
      `total=${fmt.num(m.total)} ok=${fmt.num(m.success)} err=${fmt.num(m.failed)} ` +
      `tps=${(m.success / elapsed).toFixed(0)} p95=${fmt.ms(percentile(sorted, 95))}`
    );
  }, CONFIG.reportInterval);

  await Promise.all(
    Array.from({ length: CONFIG.concurrency }, async () => {
      while (running) {
        if (Math.random() < 0.65) await writeWorker(clients, m, 1);
        else                       await readWorker(clients, m, 1);
      }
    })
  );

  clearInterval(interval);
}

async function benchmark(clients: TestClient[]): Promise<void> {
  const { totalTransactions, concurrency, mode } = CONFIG;

  console.log(`\nBENCHMARK`);
  console.log(`   Modo         : ${mode}`);
  console.log(`   Transacciones: ${fmt.num(totalTransactions)}`);
  console.log(`   Concurrencia : ${concurrency} workers`);

  if (mode === 'write' || mode === 'deposit' || mode === 'mixed') {
    const writeTxns = mode === 'mixed' ? Math.floor(totalTransactions * 0.7) : totalTransactions;
    const perWorker = Math.ceil(writeTxns / concurrency);
    const m: Metrics = { total: 0, success: 0, failed: 0, latencies: [], errors: {}, startTime: Date.now() };
    const workerFn = mode === 'deposit'
      ? (c: TestClient[], met: Metrics, n: number) => depositWorker(c, met, n)
      : (c: TestClient[], met: Metrics, n: number) => writeWorker(c, met, n);
    const label = mode === 'deposit' ? 'DEPOSIT' : 'WRITE';

    console.log(`\n${label} Phase: ${fmt.num(writeTxns)} transacciones (${perWorker} por worker)...`);

    const iv = setInterval(() => {
      const elapsed = (Date.now() - m.startTime) / 1000;
      process.stdout.write(
        `\r  ${fmt.num(m.total)}/${fmt.num(writeTxns)} (${(m.total / writeTxns * 100).toFixed(1)}%) ` +
        `| ok=${fmt.num(m.success)} err=${fmt.num(m.failed)} ` +
        `| ${(m.success / Math.max(elapsed, 0.1)).toFixed(0)} tps`
      );
    }, 300);

    await Promise.all(Array.from({ length: concurrency }, () => workerFn(clients, m, perWorker)));

    clearInterval(iv);
    m.endTime = Date.now();
    console.log('');
    printReport(m, `${label} — Transacciones`);
  }

  if (mode === 'read' || mode === 'mixed') {
    if (mode === 'mixed') {
      console.log('\nEsperando procesamiento async Kafka (8s)...');
      await new Promise(r => setTimeout(r, 8000));
    }

    const readTxns  = mode === 'mixed' ? Math.floor(totalTransactions * 0.3) : totalTransactions;
    const perWorker = Math.ceil(readTxns / concurrency);
    const m: Metrics = { total: 0, success: 0, failed: 0, latencies: [], errors: {}, startTime: Date.now() };

    console.log(`\nRead Phase: ${fmt.num(readTxns)} queries (${perWorker} por worker)...`);

    const iv = setInterval(() => {
      const elapsed = (Date.now() - m.startTime) / 1000;
      process.stdout.write(
        `\r  ${fmt.num(m.total)}/${fmt.num(readTxns)} (${(m.total / readTxns * 100).toFixed(1)}%) ` +
        `| ok=${fmt.num(m.success)} err=${fmt.num(m.failed)} ` +
        `| ${(m.success / Math.max(elapsed, 0.1)).toFixed(0)} rps`
      );
    }, 300);

    await Promise.all(Array.from({ length: concurrency }, () => readWorker(clients, m, perWorker)));

    clearInterval(iv);
    m.endTime = Date.now();
    console.log('');
    printReport(m, 'READ — Consultas');
  }
}

async function main() {
  console.log('Banking Platform — Load Test');
  console.log(`  API URL     : ${BASE_URL}`);
  console.log(`  GraphQL     : ${GRAPHQL_URL}`);
  console.log(`  Modo        : ${CONFIG.mode}`);
  console.log(`  Txns        : ${fmt.num(CONFIG.totalTransactions)}`);
  console.log(`  Concurrencia: ${CONFIG.concurrency}`);
  console.log(`  Clientes    : ${CONFIG.numClients}`);

  console.log('\nVerificando servicios...');
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log('  API Gateway OK');
  } catch (e: any) {
    console.error(`\nAPI Gateway no responde en ${BASE_URL}: ${e.message}`);
    process.exit(1);
  }

  const clients = await setupTestData(CONFIG.numClients);
  if (clients.length === 0) {
    console.error('\nNo se pudieron crear clientes de prueba');
    process.exit(1);
  }

  if (CONFIG.mode !== 'read' && CONFIG.mode !== 'deposit') {
    await seedDeposits(clients);
  } else if (CONFIG.mode === 'deposit') {
    console.log('\nEsperando propagacion CQRS de cuentas (20s)...');
    await new Promise(r => setTimeout(r, 20000));
    console.log('  Listo para depositar');
  }

  if (CONFIG.mode === 'stress') {
    await stressTest(clients);
  } else {
    await benchmark(clients);
  }

  console.log('\nLoad test completado\n');
}

main().catch(e => {
  console.error('\nError fatal:', e.message);
  process.exit(1);
});
