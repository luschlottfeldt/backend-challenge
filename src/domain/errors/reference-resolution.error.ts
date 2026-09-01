import { FailureCode } from '../enums/failure-code.js';
import { WagerRejectionError } from './wager-rejection.error.js';

type ReferenceFailureCode =
  | typeof FailureCode.ReferenceRequired
  | typeof FailureCode.ReferenceNotFound
  | typeof FailureCode.ReferenceNotProcessed
  | typeof FailureCode.ReferenceKindNotAllowed
  | typeof FailureCode.ReferenceContextMismatch
  | typeof FailureCode.ReferenceAlreadyReversed
  | typeof FailureCode.AmountMismatch;

export class ReferenceResolutionError extends WagerRejectionError {
  private constructor(
    readonly code: ReferenceFailureCode,
    message: string,
  ) {
    super(message);
  }

  static required(): ReferenceResolutionError {
    return new ReferenceResolutionError(
      FailureCode.ReferenceRequired,
      'This operation requires a referenceExternalTransactionId',
    );
  }

  static notFound(): ReferenceResolutionError {
    return new ReferenceResolutionError(
      FailureCode.ReferenceNotFound,
      'Referenced transaction was not found within the retry window',
    );
  }

  static notProcessed(): ReferenceResolutionError {
    return new ReferenceResolutionError(
      FailureCode.ReferenceNotProcessed,
      'Referenced transaction is not in a PROCESSED state',
    );
  }

  static kindNotAllowed(): ReferenceResolutionError {
    return new ReferenceResolutionError(
      FailureCode.ReferenceKindNotAllowed,
      'Referenced transaction kind cannot be reversed by this operation',
    );
  }

  static contextMismatch(): ReferenceResolutionError {
    return new ReferenceResolutionError(
      FailureCode.ReferenceContextMismatch,
      'Referenced transaction belongs to a different provider, player, wallet, currency or round',
    );
  }

  static alreadyReversed(): ReferenceResolutionError {
    return new ReferenceResolutionError(
      FailureCode.ReferenceAlreadyReversed,
      'Referenced transaction was already reversed by an operation of this kind',
    );
  }

  static amountMismatch(): ReferenceResolutionError {
    return new ReferenceResolutionError(
      FailureCode.AmountMismatch,
      'Reversal amount must equal the referenced transaction amount',
    );
  }
}
