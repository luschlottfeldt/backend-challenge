import { IsString, Matches } from 'class-validator';

export class MoneyDto {
  @IsString()
  @Matches(/^\d+\.\d{2}$/)
  amount!: string;

  @IsString()
  @Matches(/^[A-Z]{3}$/)
  currency!: string;
}
