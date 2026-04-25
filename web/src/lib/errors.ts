/**
 * Throwing a ClientError signals "the caller passed bad input" rather than
 * "the server is broken". Route handlers map this to a 400 response.
 */
export class ClientError extends Error {
  readonly status = 400 as const;
  constructor(message: string) {
    super(message);
    this.name = 'ClientError';
  }
}
