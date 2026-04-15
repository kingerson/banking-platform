import { Injectable, Inject, Optional } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import {
  CreateClientInput,
  CreateAccountInput,
  Subjects,
  NotFoundError,
  ConflictError,
  generateAccountNumber,
} from '@banking/shared';
import { ClientRepository, AccountRepository, OutboxRepository } from '../repositories';
import { pool as defaultPool } from '../models/database';
import type { Pool } from 'pg';

@Injectable()
export class CustomerService {
  private outboxRepo: OutboxRepository;
  private pool: Pool;

  constructor(
    @Inject(ClientRepository) private clientRepo: ClientRepository,
    @Inject(AccountRepository) private accountRepo: AccountRepository,
    @Optional() @Inject('PG_POOL') injectedPool?: Pool,
  ) {
    this.pool = injectedPool ?? defaultPool;
    this.outboxRepo = new OutboxRepository(this.pool);
  }

  async createClient(input: CreateClientInput, correlationId?: string) {
    const existing = await this.clientRepo.findByEmail(input.email);
    if (existing) {
      throw new ConflictError(`Client with email '${input.email}' already exists`);
    }

    const dbClient = await this.pool.connect();
    try {
      await dbClient.query('BEGIN');

      const client = await this.clientRepo.create({
        id: uuid(),
        ...input,
      });

      await this.outboxRepo.insert(
        Subjects.ClientCreated,
        {
          clientId: client.id,
          name: client.name,
          email: client.email,
          documentNumber: client.documentNumber,
        },
        dbClient,
        correlationId,
      );

      await dbClient.query('COMMIT');
      return client;
    } catch (error) {
      await dbClient.query('ROLLBACK');
      throw error;
    } finally {
      dbClient.release();
    }
  }

  async getClient(id: string) {
    const client = await this.clientRepo.findById(id);
    if (!client) throw new NotFoundError('Client', id);
    return client;
  }

  async listClients() {
    return this.clientRepo.findAll();
  }

  async createAccount(input: CreateAccountInput, correlationId?: string) {
    const client = await this.clientRepo.findById(input.clientId);
    if (!client) throw new NotFoundError('Client', input.clientId);

    const dbClient = await this.pool.connect();
    try {
      await dbClient.query('BEGIN');

      const account = await this.accountRepo.create({
        id: uuid(),
        clientId: input.clientId,
        accountNumber: generateAccountNumber(),
        balance: 0,
        currency: input.currency || 'PEN',
        status: 'active',
      });

      await this.outboxRepo.insert(
        Subjects.AccountCreated,
        {
          accountId: account.id,
          clientId: account.clientId,
          accountNumber: account.accountNumber,
          currency: account.currency,
          initialBalance: input.initialBalance ?? 0,
        },
        dbClient,
        correlationId,
      );

      await dbClient.query('COMMIT');
      return account;
    } catch (error) {
      await dbClient.query('ROLLBACK');
      throw error;
    } finally {
      dbClient.release();
    }
  }

  async getAccount(id: string) {
    const account = await this.accountRepo.findById(id);
    if (!account) throw new NotFoundError('Account', id);
    return account;
  }

  async getClientAccounts(clientId: string) {
    const client = await this.clientRepo.findById(clientId);
    if (!client) throw new NotFoundError('Client', clientId);
    return this.accountRepo.findByClientId(clientId);
  }

  async getBalance(accountId: string) {
    const balance = await this.accountRepo.getBalance(accountId);
    if (balance === null) throw new NotFoundError('Account', accountId);
    return { accountId, balance };
  }
}
