import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller';
import { CustomerService } from '../services/customer.service';
import { ClientRepository, AccountRepository } from '../repositories';

@Module({
  controllers: [ClientsController],
  providers: [CustomerService, ClientRepository, AccountRepository],
  exports: [CustomerService],
})
export class ClientsModule {}
