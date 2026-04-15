import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { CustomerService } from '../services/customer.service';
import { ClientRepository, AccountRepository } from '../repositories';

@Module({
  controllers: [AccountsController],
  providers: [CustomerService, ClientRepository, AccountRepository],
})
export class AccountsModule {}
