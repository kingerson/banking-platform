import { Module, OnModuleInit, Inject } from '@nestjs/common';
import { IEventBus } from '@banking/shared';
import { AccountRepository, EventTracker } from '../repositories';
import { registerSubscribers } from '../subscribers';

@Module({
  providers: [AccountRepository, EventTracker],
})
export class EventsModule implements OnModuleInit {
  constructor(
    @Inject('KAFKA_BUS') private readonly eventBus: IEventBus,
    @Inject(AccountRepository) private readonly accountRepo: AccountRepository,
    @Inject(EventTracker) private readonly tracker: EventTracker,
  ) {}

  onModuleInit() {
    registerSubscribers(this.eventBus, this.accountRepo, this.tracker);
    console.log('[customer-service] Kafka subscribers registered');
  }
}
