import { Module, Global } from '@nestjs/common';
import { pool, initDatabase } from '../models/database';

@Global()
@Module({
  providers: [
    {
      provide: 'PG_POOL',
      useFactory: async () => {
        await initDatabase();
        return pool;
      },
    },
  ],
  exports: ['PG_POOL'],
})
export class DatabaseModule {}
