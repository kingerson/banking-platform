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
import { CustomerService } from '../services/customer.service';
import { CreateAccountDto } from './dto/create-account.dto';

@Controller('accounts')
export class AccountsController {
  constructor(@Inject(CustomerService) private readonly customerService: CustomerService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateAccountDto) {
    const account = await this.customerService.createAccount(dto);
    return { success: true, data: account };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const account = await this.customerService.getAccount(id);
    return { success: true, data: account };
  }

  @Get(':id/balance')
  async getBalance(@Param('id') id: string) {
    const balance = await this.customerService.getBalance(id);
    return { success: true, data: balance };
  }
}
