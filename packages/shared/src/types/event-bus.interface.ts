import { DomainEvent, Subject } from '../events/index';

export interface IEventBus {

  connect(): Promise<void>;

  publish<S extends Subject>(
    subject: S,
    data: DomainEvent<S>['data'],
    options?: {
      correlationId?: string;
      causationId?: string;
    },
  ): Promise<string>;

  subscribe<S extends Subject>(
    subject: S,
    durableName: string,
    handler: (event: DomainEvent<S>) => Promise<void>,
  ): Promise<void>;

  close(): Promise<void>;

  getConnection(): any;

  healthCheck?(): Promise<boolean>;
}
