import { Inject, Injectable } from '@nestjs/common';
import { WalletNotFoundError } from '../../domain/errors/wallet-not-found.error.js';
import type { IWalletRepository } from '../../domain/repositories/wallet.repository.interface.js';
import { WALLET_REPOSITORY } from '../../domain/repositories/tokens.js';
import { toWalletView, type WalletView } from './views.js';

@Injectable()
export class GetWalletUseCase {
  constructor(@Inject(WALLET_REPOSITORY) private readonly wallets: IWalletRepository) {}

  async execute(walletId: string): Promise<WalletView> {
    const wallet = await this.wallets.findById(walletId);
    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }
    return toWalletView(wallet);
  }
}
