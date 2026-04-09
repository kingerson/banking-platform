import { Aggregate, DomainEventES } from './aggregate.js';

export interface AccountState {
  id: string;
  clientId: string;
  accountNumber: string;
  balance: number;
  currency: string;
  status: 'active' | 'frozen' | 'closed';
  createdAt: Date;
  updatedAt: Date;
}

export class AccountAggregate extends Aggregate<AccountState> {

  static create(
    id: string,
    clientId: string,
    accountNumber: string,
    currency: string,
    metadata?: { correlationId?: string; userId?: string }
  ): AccountAggregate {
    const aggregate = new AccountAggregate(id, {
      id,
      clientId,
      accountNumber,
      balance: 0,
      currency,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    aggregate.raiseEvent('AccountCreated', {
      accountId: id,
      clientId,
      accountNumber,
      currency,
    }, metadata);

    return aggregate;
  }

  deposit(
    amount: number,
    description?: string,
    metadata?: { correlationId?: string; causationId?: string; userId?: string }
  ): void {
    if (amount <= 0) {
      throw new Error('Deposit amount must be positive');
    }

    if (this.state.status !== 'active') {
      throw new Error(`Cannot deposit to ${this.state.status} account`);
    }

    this.raiseEvent('MoneyDeposited', {
      accountId: this.id,
      amount,
      description,
      previousBalance: this.state.balance,
      newBalance: this.state.balance + amount,
    }, metadata);
  }

  withdraw(
    amount: number,
    description?: string,
    metadata?: { correlationId?: string; causationId?: string; userId?: string }
  ): void {
    if (amount <= 0) {
      throw new Error('Withdrawal amount must be positive');
    }

    if (this.state.status !== 'active') {
      throw new Error(`Cannot withdraw from ${this.state.status} account`);
    }

    if (this.state.balance < amount) {
      throw new Error('Insufficient funds');
    }

    this.raiseEvent('MoneyWithdrawn', {
      accountId: this.id,
      amount,
      description,
      previousBalance: this.state.balance,
      newBalance: this.state.balance - amount,
    }, metadata);
  }

  freeze(
    reason: string,
    metadata?: { correlationId?: string; userId?: string }
  ): void {
    if (this.state.status === 'frozen') {
      throw new Error('Account is already frozen');
    }

    if (this.state.status === 'closed') {
      throw new Error('Cannot freeze a closed account');
    }

    this.raiseEvent('AccountFrozen', {
      accountId: this.id,
      reason,
    }, metadata);
  }

  unfreeze(
    metadata?: { correlationId?: string; userId?: string }
  ): void {
    if (this.state.status !== 'frozen') {
      throw new Error('Account is not frozen');
    }

    this.raiseEvent('AccountUnfrozen', {
      accountId: this.id,
    }, metadata);
  }

  getBalance(): number {
    return this.state.balance;
  }

  getStatus(): string {
    return this.state.status;
  }

  protected when(event: DomainEventES): void {
    switch (event.eventType) {
      case 'AccountCreated':
        this.state.createdAt = event.timestamp;
        this.state.updatedAt = event.timestamp;
        break;

      case 'MoneyDeposited':
        this.state.balance = event.eventData.newBalance;
        this.state.updatedAt = event.timestamp;
        break;

      case 'MoneyWithdrawn':
        this.state.balance = event.eventData.newBalance;
        this.state.updatedAt = event.timestamp;
        break;

      case 'AccountFrozen':
        this.state.status = 'frozen';
        this.state.updatedAt = event.timestamp;
        break;

      case 'AccountUnfrozen':
        this.state.status = 'active';
        this.state.updatedAt = event.timestamp;
        break;

      default:
        console.warn(`[AccountAggregate] Unknown event type: ${event.eventType}`);
    }
  }
}
