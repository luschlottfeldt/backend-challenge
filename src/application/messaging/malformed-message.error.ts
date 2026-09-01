export class MalformedMessageError extends Error {
  constructor(reason: string) {
    super(`Malformed inbound message: ${reason}`);
    this.name = 'MalformedMessageError';
  }
}
