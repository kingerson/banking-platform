import { Module } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import { TransactionService } from '../services/transaction.service';
import { TransactionRepository, EventTracker, AccountProjectionRepository } from '../repositories';
import { SagaService } from '../saga/transaction.saga';
import { ProjectionService } from '../subscribers';

@Module({
  controllers: [TransactionsController],
  providers: [
    TransactionService,
    TransactionRepository,
    EventTracker,
    AccountProjectionRepository,
    SagaService,
    ProjectionService,
  ],
})
export class TransactionsModule {}
