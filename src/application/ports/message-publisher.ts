export interface OutboundMessage {
  id: string;
  type: string;
  body: string;
  groupId: string;
  deduplicationId: string;
}

export interface MessagePublisher {
  publish(message: OutboundMessage): Promise<void>;
}

export const MESSAGE_PUBLISHER = Symbol('MessagePublisher');
