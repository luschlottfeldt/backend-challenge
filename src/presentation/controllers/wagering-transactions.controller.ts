import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { SubmitWagerTransactionDto } from '../dtos/wagering/submit-wager-transaction.dto.js';
import { NoOpAuthGuard } from '../guards/no-op-auth.guard.js';

@UseGuards(NoOpAuthGuard)
@Controller()
export class WageringTransactionsController {
  @Post('wagering/transactions')
  submit(
    @Headers('Idempotency-Key') _idempotencyKey: string,
    @Body() _dto: SubmitWagerTransactionDto,
  ): never {
    throw new Error('Not implemented');
  }

  @Get('wagering/transactions/:transactionId')
  findById(@Param('transactionId') _transactionId: string): never {
    throw new Error('Not implemented');
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  findByProviderAndExternalId(
    @Param('providerId') _providerId: string,
    @Param('externalTransactionId') _externalTransactionId: string,
  ): never {
    throw new Error('Not implemented');
  }
}
