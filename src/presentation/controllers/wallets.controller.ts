import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CreateWalletDto } from '../dtos/wallets/create-wallet.dto.js';
import { NoOpAuthGuard } from '../guards/no-op-auth.guard.js';
import { CreateWalletUseCase } from '../../application/use-cases/create-wallet.use-case.js';
import { GetWalletUseCase } from '../../application/use-cases/get-wallet.use-case.js';
import { GetWalletLedgerUseCase } from '../../application/use-cases/get-wallet-ledger.use-case.js';
import { ReconcileWalletUseCase } from '../../application/use-cases/reconcile-wallet.use-case.js';

@UseGuards(NoOpAuthGuard)
@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly createWallet: CreateWalletUseCase,
    private readonly getWallet: GetWalletUseCase,
    private readonly getLedger: GetWalletLedgerUseCase,
    private readonly reconcile: ReconcileWalletUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: CreateWalletDto,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    return this.createWallet.execute({
      playerId: dto.playerId,
      initialBalance: dto.initialBalance,
      correlationId,
    });
  }

  @Get(':walletId')
  findById(@Param('walletId') walletId: string) {
    return this.getWallet.execute(walletId);
  }

  @Get(':walletId/ledger')
  listLedger(
    @Param('walletId') walletId: string,
    @Query('cursor') cursor?: string,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    return this.getLedger.execute({ walletId, cursor, limit });
  }

  @Post(':walletId/reconciliation')
  @HttpCode(HttpStatus.OK)
  reconcileWallet(@Param('walletId') walletId: string) {
    return this.reconcile.execute(walletId);
  }
}
