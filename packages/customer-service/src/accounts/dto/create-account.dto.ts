import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateAccountDto {
  @IsUUID()
  @IsNotEmpty()
  clientId: string;

  @IsOptional()
  @IsIn(['PEN', 'USD'])
  currency?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  initialBalance?: number;
}
