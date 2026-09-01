import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';

@Injectable()
export class NoOpAuthGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
