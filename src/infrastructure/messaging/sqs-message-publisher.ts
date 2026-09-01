import { Injectable } from '@nestjs/common';
import { SendMessageCommand, type SQSClient } from '@aws-sdk/client-sqs';
import type {
  MessagePublisher,
  OutboundMessage,
} from '../../application/ports/message-publisher.js';

@Injectable()
export class SqsMessagePublisher implements MessagePublisher {
  constructor(
    private readonly sqs: SQSClient,
    private readonly queueUrl: string,
  ) {}

  async publish(message: OutboundMessage): Promise<void> {
    await this.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: message.body,
        MessageGroupId: message.groupId,
        MessageDeduplicationId: message.deduplicationId,
        MessageAttributes: {
          eventType: { DataType: 'String', StringValue: message.type },
        },
      }),
    );
  }
}
