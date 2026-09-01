import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { IdGenerator } from '../../application/ports/id-generator.js';

@Injectable()
export class UuidGenerator implements IdGenerator {
  next(): string {
    return randomUUID();
  }
}
