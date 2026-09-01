import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CreateWalletDto } from '../dtos/wallets/create-wallet.dto.js';
import { NoOpAuthGuard } from '../guards/no-op-auth.guard.js';

@UseGuards(NoOpAuthGuard)
@Controller('wallets')
export class WalletsController {
  @Post()
  create(@Body() _dto: CreateWalletDto): never {
    throw new Error('Not implemented');
  }

  @Get(':walletId')
  findById(@Param('walletId') _walletId: string): never {
    throw new Error('Not implemented');
  }

  @Get(':walletId/ledger')
  listLedger(
    @Param('walletId') _walletId: string,
    @Query('cursor') _cursor?: string,
    @Query('limit') _limit?: string,
  ): never {
    throw new Error('Not implemented');
  }

  @Post(':walletId/reconciliation')
  reconcile(@Param('walletId') _walletId: string): never {
    throw new Error('Not implemented');
  }
}
