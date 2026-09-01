import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { SubmitWagerTransactionDto } from '../dtos/wagering/submit-wager-transaction.dto.js';
import { NoOpAuthGuard } from '../guards/no-op-auth.guard.js';
import { WagerTransactionStatus } from '../../domain/enums/wager-transaction-status.enum.js';
import {
  SubmitWagerTransactionUseCase,
  type SubmitWagerTransactionResult,
} from '../../application/use-cases/submit-wager-transaction.use-case.js';
import { GetWagerTransactionUseCase } from '../../application/use-cases/get-wager-transaction.use-case.js';

@UseGuards(NoOpAuthGuard)
@Controller()
export class WageringTransactionsController {
  constructor(
    private readonly submitUseCase: SubmitWagerTransactionUseCase,
    private readonly getTransaction: GetWagerTransactionUseCase,
  ) {}

  @Post('wagering/transactions')
  async submit(
    @Body() dto: SubmitWagerTransactionDto,
    @Res({ passthrough: true }) res: Response,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-correlation-id') correlationId?: string,
  ): Promise<SubmitWagerTransactionResult> {
    if (!idempotencyKey || idempotencyKey.trim() === '') {
      throw new BadRequestException('The Idempotency-Key header is required');
    }

    const result = await this.submitUseCase.execute({
      idempotencyKey: idempotencyKey.trim(),
      providerId: dto.providerId,
      externalTransactionId: dto.externalTransactionId,
      playerId: dto.playerId,
      walletId: dto.walletId,
      roundId: dto.roundId,
      gameId: dto.gameId,
      kind: dto.kind,
      money: dto.money,
      referenceExternalTransactionId: dto.referenceExternalTransactionId,
      correlationId,
    });

    res.status(statusForOutcome(result.status));
    return result;
  }

  @Get('wagering/transactions/:transactionId')
  findById(@Param('transactionId') transactionId: string) {
    return this.getTransaction.byId(transactionId);
  }

  @Get('providers/:providerId/wagering/transactions/:externalTransactionId')
  findByProviderAndExternalId(
    @Param('providerId') providerId: string,
    @Param('externalTransactionId') externalTransactionId: string,
  ) {
    return this.getTransaction.byProviderAndExternalId(providerId, externalTransactionId);
  }
}

function statusForOutcome(status: WagerTransactionStatus): number {
  switch (status) {
    case WagerTransactionStatus.Processed:
      return 200;
    case WagerTransactionStatus.PendingReference:
      return 202;
    case WagerTransactionStatus.Rejected:
    case WagerTransactionStatus.Failed:
      return 422;
    default:
      return 200;
  }
}
