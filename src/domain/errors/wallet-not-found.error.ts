import { DomainError } from './domain-error.js';

export class WalletNotFoundError extends DomainError {
  readonly code = 'WALLET_NOT_FOUND';

  constructor(public readonly walletId: string) {
    super(`Wallet ${walletId} was not found`);
  }
}
