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

/**
 * The caller asked for a resource that doesn't exist. Distinct from
 * ClientError so route handlers can map this to 404 — useful when the
 * caller's input parsed fine but the referenced row is missing.
 */
export class NotFoundError extends Error {
  readonly status = 404 as const;
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
