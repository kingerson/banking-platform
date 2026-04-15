import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ExplainTransactionDto {
  @IsUUID()
  transactionId: string;
}

export class AccountSummaryDto {
  @IsUUID()
  accountId: string;
}

export class RiskAnalysisDto {
  @IsOptional()
  @IsUUID()
  transactionId?: string;

  @IsString()
  type: string;

  amount: number;

  @IsString()
  currency: string;

  @IsOptional()
  @IsUUID()
  sourceAccountId?: string;

  @IsOptional()
  @IsUUID()
  targetAccountId?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
