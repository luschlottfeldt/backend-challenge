import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { ListQueuesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { SQS_CLIENT } from './sqs-client.provider.js';

@Injectable()
export class SqsHealthIndicator {
  constructor(
    @Inject(SQS_CLIENT) private readonly sqsClient: SQSClient,
    private readonly healthIndicatorService: HealthIndicatorService,
  ) {}

  async check(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await this.sqsClient.send(new ListQueuesCommand({}));
      return indicator.up();
    } catch (error) {
      return indicator.down({ message: (error as Error).message });
    }
  }
}
