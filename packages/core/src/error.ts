export class SynapseError extends Error {
  public code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SynapseError';
    this.code = code;
    Object.setPrototypeOf(this, SynapseError.prototype);
  }
}
