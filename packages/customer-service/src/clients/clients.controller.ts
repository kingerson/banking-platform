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
import { CreateClientDto } from './dto/create-client.dto';

@Controller('clients')
export class ClientsController {
  constructor(@Inject(CustomerService) private readonly customerService: CustomerService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateClientDto) {
    const client = await this.customerService.createClient(dto);
    return { success: true, data: client };
  }

  @Get()
  async findAll() {
    const clients = await this.customerService.listClients();
    return { success: true, data: clients };
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    const client = await this.customerService.getClient(id);
    return { success: true, data: client };
  }

  @Get(':id/accounts')
  async getAccounts(@Param('id') id: string) {
    const accounts = await this.customerService.getClientAccounts(id);
    return { success: true, data: accounts };
  }
}
