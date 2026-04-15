import { Module, Global, OnModuleDestroy } from '@nestjs/common';
import { KafkaEventBus } from '@banking/shared';
import { config } from '../config';

const kafkaBus = new KafkaEventBus({
  brokers: config.kafka?.brokers || ['localhost:9092'],
  clientId: config.serviceName,
});

@Global()
@Module({
  providers: [
    {
      provide: 'KAFKA_BUS',
      useFactory: async () => {
        await kafkaBus.connect();
        return kafkaBus;
      },
    },
  ],
  exports: ['KAFKA_BUS'],
})
export class KafkaModule implements OnModuleDestroy {
  async onModuleDestroy() {
    await kafkaBus.close();
  }
}
