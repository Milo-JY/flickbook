/** An expected failure: print the message, exit 1, no stack trace. */
export class RrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RrError';
  }
}
