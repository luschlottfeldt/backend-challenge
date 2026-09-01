import { DomainError } from './domain-error.js';

export class WalletAlreadyExistsError extends DomainError {
  readonly code = 'WALLET_ALREADY_EXISTS';

  constructor(
    public readonly playerId: string,
    public readonly currency: string,
  ) {
    super(`A wallet already exists for player ${playerId} in ${currency}`);
  }
}
