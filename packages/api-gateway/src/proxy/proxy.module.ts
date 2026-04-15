import { Module } from '@nestjs/common';
import {
  ClientsProxyController,
  AccountsProxyController,
  TransactionsProxyController,
  AIProxyController,
} from './proxy.controller';

@Module({
  controllers: [
    ClientsProxyController,
    AccountsProxyController,
    TransactionsProxyController,
    AIProxyController,
  ],
})
export class ProxyModule {}
