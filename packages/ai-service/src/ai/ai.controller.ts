import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { AIService } from '../services/ai.service';
import { ExplainTransactionDto, AccountSummaryDto, RiskAnalysisDto } from './dto/explain-transaction.dto';

@Controller('ai')
export class AIController {
  constructor(@Inject(AIService) private readonly aiService: AIService) {}

  @Post('explain')
  async explain(@Body() dto: ExplainTransactionDto) {
    const result = await this.aiService.explainTransaction(dto.transactionId);
    return { success: true, data: result };
  }

  @Post('summary')
  async summary(@Body() dto: AccountSummaryDto) {
    const result = await this.aiService.summarizeAccount(dto.accountId);
    return { success: true, data: result };
  }

  @Post('translate-event')
  async translateEvent(@Body() body: { eventSubject: string; eventData: Record<string, unknown> }) {
    const message = await this.aiService.translateEvent(body.eventSubject, body.eventData);
    return { success: true, data: { message } };
  }

  @Post('risk')
  async analyzeRisk(@Body() dto: RiskAnalysisDto) {
    if (!dto.type || dto.amount === undefined || !dto.currency) {
      throw new BadRequestException('type, amount and currency are required');
    }
    const result = await this.aiService.analyzeRisk({
      ...dto,
      amount: Number(dto.amount),
    });
    return { success: true, data: result };
  }

  @Get('explanations/:transactionId')
  async getExplanations(@Param('transactionId') transactionId: string) {
    const explanations = await this.aiService.getExplanations(transactionId);
    return { success: true, data: explanations };
  }
}
