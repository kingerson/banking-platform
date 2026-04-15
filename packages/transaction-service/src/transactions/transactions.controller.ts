import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { TransactionService } from '../services/transaction.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';

@Controller()
export class TransactionsController {
  constructor(@Inject(TransactionService) private readonly transactionService: TransactionService) {}

  @Post('transactions')
  @HttpCode(HttpStatus.ACCEPTED)
  async create(@Body() dto: CreateTransactionDto) {
    const txn = await this.transactionService.requestTransaction(dto);
    return { success: true, data: txn };
  }

  @Get('transactions/:id')
  async findOne(@Param('id') id: string) {
    const txn = await this.transactionService.getTransaction(id);
    return { success: true, data: txn };
  }

  @Get('accounts/:accountId/transactions')
  async getByAccount(@Param('accountId') accountId: string) {
    const txns = await this.transactionService.getAccountTransactions(accountId);
    return { success: true, data: txns };
  }
}
