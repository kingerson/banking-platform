import { PrismaClient } from '@prisma/client';
import { Client, Account } from '@banking/shared';
import { createPrismaClient } from '@banking/shared';

let prisma: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = createPrismaClient(PrismaClient, 'customer-service');
  }
  return prisma;
}

export class PrismaClientRepository {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || getPrismaClient();
  }

  async create(client: Omit<Client, 'createdAt'> & { createdAt?: string }): Promise<Client> {
    const created = await this.prisma.client.create({
      data: {
        id: client.id,
        name: client.name,
        email: client.email,
        documentNumber: client.documentNumber,
        createdAt: client.createdAt ? new Date(client.createdAt) : undefined,
      },
    });

    return {
      id: created.id,
      name: created.name,
      email: created.email,
      documentNumber: created.documentNumber,
      createdAt: created.createdAt.toISOString(),
    };
  }

  async findById(id: string): Promise<Client | null> {
    const client = await this.prisma.client.findUnique({
      where: { id },
    });

    if (!client) return null;

    return {
      id: client.id,
      name: client.name,
      email: client.email,
      documentNumber: client.documentNumber,
      createdAt: client.createdAt.toISOString(),
    };
  }

  async findByEmail(email: string): Promise<Client | null> {
    const client = await this.prisma.client.findUnique({
      where: { email },
    });

    if (!client) return null;

    return {
      id: client.id,
      name: client.name,
      email: client.email,
      documentNumber: client.documentNumber,
      createdAt: client.createdAt.toISOString(),
    };
  }

  async findAll(): Promise<Client[]> {
    const clients = await this.prisma.client.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return clients.map((c: any) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      documentNumber: c.documentNumber,
      createdAt: c.createdAt.toISOString(),
    }));
  }
}

export class PrismaAccountRepository {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || getPrismaClient();
  }

  async create(account: Omit<Account, 'createdAt'> & { createdAt?: string }): Promise<Account> {
    const created = await this.prisma.account.create({
      data: {
        id: account.id,
        clientId: account.clientId,
        accountNumber: account.accountNumber,
        balance: account.balance,
        currency: account.currency,
        status: account.status,
        createdAt: account.createdAt ? new Date(account.createdAt) : undefined,
      },
    });

    return {
      id: created.id,
      clientId: created.clientId,
      accountNumber: created.accountNumber,
      balance: parseFloat(created.balance.toString()),
      currency: created.currency as 'PEN' | 'USD',
      status: created.status as 'active' | 'inactive' | 'frozen',
      createdAt: created.createdAt.toISOString(),
    };
  }

  async findById(id: string): Promise<Account | null> {
    const account = await this.prisma.account.findUnique({
      where: { id },
    });

    if (!account) return null;

    return {
      id: account.id,
      clientId: account.clientId,
      accountNumber: account.accountNumber,
      balance: parseFloat(account.balance.toString()),
      currency: account.currency as 'PEN' | 'USD',
      status: account.status as 'active' | 'inactive' | 'frozen',
      createdAt: account.createdAt.toISOString(),
    };
  }

  async findByClientId(clientId: string): Promise<Account[]> {
    const accounts = await this.prisma.account.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
    });

    return accounts.map((a: any) => ({
      id: a.id,
      clientId: a.clientId,
      accountNumber: a.accountNumber,
      balance: parseFloat(a.balance.toString()),
      currency: a.currency as 'PEN' | 'USD',
      status: a.status as 'active' | 'inactive' | 'frozen',
      createdAt: a.createdAt.toISOString(),
    }));
  }

  async updateBalance(
    accountId: string,
    amount: number,
    operation: 'credit' | 'debit',
  ): Promise<Account | null> {
    try {
      const updated = await this.prisma.account.update({
        where: { id: accountId },
        data: {
          balance: {
            [operation === 'credit' ? 'increment' : 'decrement']: amount,
          },
        },
      });

      return {
        id: updated.id,
        clientId: updated.clientId,
        accountNumber: updated.accountNumber,
        balance: parseFloat(updated.balance.toString()),
        currency: updated.currency as 'PEN' | 'USD',
        status: updated.status as 'active' | 'inactive' | 'frozen',
        createdAt: updated.createdAt.toISOString(),
      };
    } catch (error) {
      return null;
    }
  }

  async getBalance(accountId: string): Promise<number | null> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      select: { balance: true },
    });

    return account ? parseFloat(account.balance.toString()) : null;
  }
}

export class PrismaEventTracker {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient || getPrismaClient();
  }

  async isProcessed(eventId: string): Promise<boolean> {
    const event = await this.prisma.processedEvent.findUnique({
      where: { eventId },
    });
    return !!event;
  }

  async markProcessed(eventId: string, subject: string): Promise<void> {
    await this.prisma.processedEvent.upsert({
      where: { eventId },
      create: { eventId, subject },
      update: {},
    });
  }
}
