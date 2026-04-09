export interface DomainEventES {
  eventId: string;
  eventType: string;
  eventData: any;
  version: number;
  timestamp: Date;
  correlationId?: string;
  causationId?: string;
  userId?: string;
}

export abstract class Aggregate<TState = any> {
  protected id: string;
  protected state: TState;
  protected version: number = 0;
  protected uncommittedEvents: DomainEventES[] = [];

  constructor(id: string, initialState: TState) {
    this.id = id;
    this.state = initialState;
  }

  getId(): string {
    return this.id;
  }

  getState(): TState {
    return this.state;
  }

  getVersion(): number {
    return this.version;
  }

  getUncommittedEvents(): DomainEventES[] {
    return this.uncommittedEvents;
  }

  markEventsAsCommitted(): void {
    this.uncommittedEvents = [];
  }

  loadFromHistory(events: DomainEventES[]): void {
    for (const event of events) {
      this.applyEvent(event, false);
      this.version = event.version;
    }
  }

  protected applyEvent(event: DomainEventES, isNew: boolean = true): void {

    this.when(event);

    if (isNew) {
      this.uncommittedEvents.push(event);
      this.version++;
    }
  }

  protected raiseEvent(
    eventType: string,
    eventData: any,
    metadata?: {
      correlationId?: string;
      causationId?: string;
      userId?: string;
    }
  ): void {
    const event: DomainEventES = {
      eventId: this.generateEventId(),
      eventType,
      eventData,
      version: this.version + 1,
      timestamp: new Date(),
      correlationId: metadata?.correlationId,
      causationId: metadata?.causationId,
      userId: metadata?.userId,
    };

    this.applyEvent(event, true);
  }

  protected abstract when(event: DomainEventES): void;

  private generateEventId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

export abstract class AggregateRepository<T extends Aggregate> {
  constructor(
    protected eventStore: any,
    protected aggregateType: string
  ) {}

  async load(aggregateId: string): Promise<T | null> {

    const snapshot = await this.eventStore.getLatestSnapshot(aggregateId);

    let aggregate: T;
    let fromVersion = 0;

    if (snapshot) {

      aggregate = this.createAggregate(aggregateId, snapshot.state);
      fromVersion = snapshot.version;
    } else {

      aggregate = this.createAggregate(aggregateId, this.getInitialState());
    }

    const events = await this.eventStore.getEvents(aggregateId, fromVersion);

    if (events.length === 0 && !snapshot) {
      return null;
    }

    aggregate.loadFromHistory(events);

    return aggregate;
  }

  async save(aggregate: T, client?: any): Promise<void> {
    const events = aggregate.getUncommittedEvents();

    if (events.length === 0) {
      return;
    }

    const db = client || this.eventStore.pool;

    for (const event of events) {
      await this.eventStore.append({
        eventId: event.eventId,
        aggregateId: aggregate.getId(),
        aggregateType: this.aggregateType,
        eventType: event.eventType,
        eventData: event.eventData,
        expectedVersion: event.version - 1,
        correlationId: event.correlationId,
        causationId: event.causationId,
        userId: event.userId,
      }, db);
    }

    aggregate.markEventsAsCommitted();

    const currentVersion = aggregate.getVersion();
    if (currentVersion % 10 === 0) {
      await this.eventStore.saveSnapshot(
        aggregate.getId(),
        this.aggregateType,
        currentVersion,
        aggregate.getState()
      );
    }
  }

  protected abstract createAggregate(id: string, state: any): T;

  protected abstract getInitialState(): any;
}
