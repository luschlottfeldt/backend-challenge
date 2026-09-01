import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(_exception: unknown, _host: ArgumentsHost): void {
    throw new Error('Not implemented');
  }
}
