import { AggregateRepository } from './aggregate';
import { AccountAggregate, AccountState } from './account.aggregate';
import { EventStoreRepository } from './event-store.repository';

export class AccountAggregateRepository extends AggregateRepository<AccountAggregate> {
  constructor(eventStore: EventStoreRepository) {
    super(eventStore, 'Account');
  }

  protected createAggregate(id: string, state: AccountState): AccountAggregate {
    const aggregate = new AccountAggregate(id, state);
    return aggregate;
  }

  protected getInitialState(): AccountState {
    return {
      id: '',
      clientId: '',
      accountNumber: '',
      balance: 0,
      currency: 'USD',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  async getBalanceAt(accountId: string, timestamp: Date): Promise<number | null> {

    const allEvents = await this.eventStore.getEvents(accountId);
    const eventsUntil = allEvents.filter((e: any) => e.timestamp <= timestamp);

    if (eventsUntil.length === 0) {
      return null;
    }

    const aggregate = this.createAggregate(accountId, this.getInitialState());
    aggregate.loadFromHistory(eventsUntil);

    return aggregate.getBalance();
  }

  async getHistory(accountId: string): Promise<Array<{
    timestamp: Date;
    eventType: string;
    balance: number;
    change: number;
    description?: string;
  }>> {
    const events = await this.eventStore.getEvents(accountId);

    const history: Array<{
      timestamp: Date;
      eventType: string;
      balance: number;
      change: number;
      description?: string;
    }> = [];

    let currentBalance = 0;

    for (const event of events) {
      if (event.eventType === 'MoneyDeposited') {
        const change = event.eventData.amount;
        currentBalance += change;
        history.push({
          timestamp: event.timestamp,
          eventType: event.eventType,
          balance: currentBalance,
          change: +change,
          description: event.eventData.description,
        });
      } else if (event.eventType === 'MoneyWithdrawn') {
        const change = event.eventData.amount;
        currentBalance -= change;
        history.push({
          timestamp: event.timestamp,
          eventType: event.eventType,
          balance: currentBalance,
          change: -change,
          description: event.eventData.description,
        });
      }
    }

    return history;
  }
}
