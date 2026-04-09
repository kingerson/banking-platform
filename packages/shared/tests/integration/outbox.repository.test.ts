import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Pool } from 'pg';
import { OutboxRepository } from '../../src/outbox/outbox.repository.js';
import { Subjects } from '../../src/events/index.js';

const pool = new Pool({
  host: 'localhost',
  port: 5433,
  database: 'customers_db',
  user: 'customers_user',
  password: 'customers_pass',
});

describe('OutboxRepository', () => {
  let repo: OutboxRepository;

  beforeEach(async () => {
    repo = new OutboxRepository(pool);
    // Clean outbox before each test
    await pool.query('DELETE FROM outbox');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('should insert a message into outbox', async () => {
    const id = await repo.insert(
      Subjects.ClientCreated,
      { clientId: '123', name: 'Test', email: 'test@test.com', documentNumber: '123' },
    );

    expect(id).toBeDefined();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('should retrieve pending messages', async () => {
    await repo.insert(Subjects.ClientCreated, { clientId: '1' });
    await repo.insert(Subjects.AccountCreated, { accountId: '2' });

    const pending = await repo.getPending();

    expect(pending).toHaveLength(2);
    expect(pending[0].publishedAt).toBeNull();
  });

  it('should mark message as published', async () => {
    const id = await repo.insert(Subjects.ClientCreated, { clientId: '1' });
    await repo.markPublished(id);

    const pending = await repo.getPending();
    expect(pending).toHaveLength(0);
  });

  it('should record failure attempts', async () => {
    const id = await repo.insert(Subjects.ClientCreated, { clientId: '1' });
    await repo.recordFailure(id, 'Connection timeout');

    const failed = await repo.getFailed(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].attempts).toBe(1);
    expect(failed[0].lastError).toBe('Connection timeout');
  });

  it('should store and retrieve correlation ID', async () => {
    const correlationId = '550e8400-e29b-41d4-a716-446655440000';
    await repo.insert(Subjects.ClientCreated, { clientId: '1' }, undefined, correlationId);

    const pending = await repo.getPending();
    expect(pending[0].correlationId).toBe(correlationId);
  });

  it('should delete old published messages', async () => {
    const id = await repo.insert(Subjects.ClientCreated, { clientId: '1' });
    await repo.markPublished(id);

    // Manually set published_at to 25 hours ago
    await pool.query(
      `UPDATE outbox SET published_at = NOW() - INTERVAL '25 hours' WHERE id = $1`,
      [id],
    );

    const deleted = await repo.deletePublished(24);
    expect(deleted).toBe(1);
  });
});
