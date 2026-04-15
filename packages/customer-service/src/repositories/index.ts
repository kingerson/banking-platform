import { Injectable, Inject, Optional } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { Client, Account, OutboxRepository } from '@banking/shared';
import { pool as defaultPool } from '../models/database';

export { OutboxRepository };

@Injectable()
export class ClientRepository {
  private pool: Pool;

  constructor(@Optional() @Inject('PG_POOL') dbPool?: Pool) {
    this.pool = dbPool || defaultPool;
  }

  async create(client: Omit<Client, 'createdAt'> & { createdAt?: string }): Promise<Client> {
    const { rows } = await this.pool.query<Client>(
      `INSERT INTO clients (id, name, email, document_number, created_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, email, document_number AS "documentNumber", created_at AS "createdAt"`,
      [client.id, client.name, client.email, client.documentNumber, client.createdAt || new Date().toISOString()],
    );
    return rows[0];
  }

  async findById(id: string): Promise<Client | null> {
    const { rows } = await this.pool.query<Client>(
      `SELECT id, name, email, document_number AS "documentNumber", created_at AS "createdAt"
       FROM clients WHERE id = $1`,
      [id],
    );
    return rows[0] || null;
  }

  async findByEmail(email: string): Promise<Client | null> {
    const { rows } = await this.pool.query<Client>(
      `SELECT id, name, email, document_number AS "documentNumber", created_at AS "createdAt"
       FROM clients WHERE email = $1`,
      [email],
    );
    return rows[0] || null;
  }

  async findAll(): Promise<Client[]> {
    const { rows } = await this.pool.query<Client>(
      `SELECT id, name, email, document_number AS "documentNumber", created_at AS "createdAt"
       FROM clients ORDER BY created_at DESC`,
    );
    return rows;
  }
}

@Injectable()
export class AccountRepository {
  private pool: Pool;

  constructor(@Optional() @Inject('PG_POOL') dbPool?: Pool) {
    this.pool = dbPool || defaultPool;
  }

  async create(account: Omit<Account, 'createdAt'> & { createdAt?: string }): Promise<Account> {
    const { rows } = await this.pool.query<Account>(
      `INSERT INTO accounts (id, client_id, account_number, balance, currency, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, client_id AS "clientId", account_number AS "accountNumber",
                 balance::float, currency, status, created_at AS "createdAt"`,
      [
        account.id, account.clientId, account.accountNumber,
        account.balance, account.currency, account.status,
        account.createdAt || new Date().toISOString(),
      ],
    );
    return rows[0];
  }

  async findById(id: string): Promise<Account | null> {
    const { rows } = await this.pool.query<Account>(
      `SELECT id, client_id AS "clientId", account_number AS "accountNumber",
              balance::float, currency, status, created_at AS "createdAt"
       FROM accounts WHERE id = $1`,
      [id],
    );
    return rows[0] || null;
  }

  async findByClientId(clientId: string): Promise<Account[]> {
    const { rows } = await this.pool.query<Account>(
      `SELECT id, client_id AS "clientId", account_number AS "accountNumber",
              balance::float, currency, status, created_at AS "createdAt"
       FROM accounts WHERE client_id = $1 ORDER BY created_at DESC`,
      [clientId],
    );
    return rows;
  }

  async updateBalance(
    accountId: string,
    amount: number,
    operation: 'credit' | 'debit',
    txClient?: PoolClient,
  ): Promise<Account> {
    const executor = txClient || this.pool;
    const operator = operation === 'credit' ? '+' : '-';

    const { rows } = await executor.query<Account>(
      `UPDATE accounts
       SET balance = balance ${operator} $2
       WHERE id = $1 AND status = 'active'
       ${operation === 'debit' ? 'AND balance >= $2' : ''}
       RETURNING id, client_id AS "clientId", account_number AS "accountNumber",
                 balance::float, currency, status, created_at AS "createdAt"`,
      [accountId, amount],
    );

    return rows[0];
  }

  async getBalance(accountId: string): Promise<number | null> {
    const { rows } = await this.pool.query<{ balance: number }>(
      `SELECT balance::float FROM accounts WHERE id = $1`,
      [accountId],
    );
    return rows[0]?.balance ?? null;
  }
}

@Injectable()
export class EventTracker {
  private pool: Pool;

  constructor(@Optional() @Inject('PG_POOL') dbPool?: Pool) {
    this.pool = dbPool || defaultPool;
  }

  async isProcessed(eventId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM processed_events WHERE event_id = $1`,
      [eventId],
    );
    return rows.length > 0;
  }

  async markProcessed(eventId: string, subject: string, txClient?: PoolClient): Promise<void> {
    const executor = txClient || this.pool;
    await executor.query(
      `INSERT INTO processed_events (event_id, subject) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [eventId, subject],
    );
  }
}
