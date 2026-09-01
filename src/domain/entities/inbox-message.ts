export interface ReceiveInboxProps {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
}

export interface InboxMessageState {
  messageId: string;
  consumerName: string;
  payloadHash: string;
  receivedAt: Date;
  processedAt?: Date;
}

export class InboxMessage {
  private constructor(
    public readonly messageId: string,
    public readonly consumerName: string,
    public readonly payloadHash: string,
    public readonly receivedAt: Date,
    private _processedAt?: Date,
  ) {}

  static receive(_props: ReceiveInboxProps): InboxMessage {
    throw new Error('Not implemented');
  }

  static rehydrate(_state: InboxMessageState): InboxMessage {
    throw new Error('Not implemented');
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  isProcessed(): boolean {
    throw new Error('Not implemented');
  }

  markProcessed(_at: Date): void {
    throw new Error('Not implemented');
  }
}
