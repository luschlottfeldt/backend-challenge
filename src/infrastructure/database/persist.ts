import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { PersistenceConflictError } from '../../domain/errors/persistence-conflict.error.js';

export async function persistOrConflict(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error) {
    if (error instanceof UniqueConstraintViolationException) {
      const constraint =
        (error as { constraint?: string }).constraint ??
        ((error as { cause?: { constraint?: string } }).cause?.constraint ?? 'uniqueness');
      throw new PersistenceConflictError(constraint);
    }
    throw error;
  }
}
