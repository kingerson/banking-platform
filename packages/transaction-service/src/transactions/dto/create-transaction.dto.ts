import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateTransactionDto {
  @IsIn(['deposit', 'withdrawal', 'transfer'])
  type: 'deposit' | 'withdrawal' | 'transfer';

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsIn(['PEN', 'USD'])
  currency?: string;

  @IsOptional()
  @IsUUID()
  sourceAccountId?: string;

  @IsOptional()
  @IsUUID()
  targetAccountId?: string;

  @IsString()
  @IsNotEmpty()
  idempotencyKey: string;

  @IsOptional()
  @IsString()
  description?: string;
}
