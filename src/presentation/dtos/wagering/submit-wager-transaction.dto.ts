import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { WagerTransactionKind } from '../../../domain/enums/wager-transaction-kind.enum.js';
import { MoneyDto } from '../shared/money.dto.js';

const SUBMITTABLE_KINDS = [
  WagerTransactionKind.Bet,
  WagerTransactionKind.Win,
  WagerTransactionKind.Loss,
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
];

export class SubmitWagerTransactionDto {
  @IsString()
  providerId!: string;

  @IsString()
  externalTransactionId!: string;

  @IsUUID()
  playerId!: string;

  @IsUUID()
  walletId!: string;

  @IsString()
  roundId!: string;

  @IsString()
  gameId!: string;

  @IsIn(SUBMITTABLE_KINDS)
  kind!: WagerTransactionKind;

  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  @IsOptional()
  @IsString()
  referenceExternalTransactionId?: string;
}
