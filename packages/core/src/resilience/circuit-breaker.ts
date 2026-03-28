import type { Logger } from '../types.js';

/**
 * CircuitBreaker prevents cascading failures by fast-failing
 * requests when a backend service (e.g., Redis, Postgres) is completely down.
 */
export class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly name: string,
    private readonly threshold: number,
    private readonly resetTimeoutMs: number,
    private readonly logger: Logger
  ) {}

  /**
   * Execute an async action through the circuit breaker.
   */
  async execute<T>(action: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure > this.resetTimeoutMs) {
        this.logger.warn(`Circuit [${this.name}] HALF_OPEN: Testing connection...`);
        this.state = 'HALF_OPEN';
      } else {
        throw new Error(`CircuitBreaker [${this.name}] is OPEN. Fast-failing.`);
      }
    }

    try {
      const result = await action();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess() {
    this.failureCount = 0;
    if (this.state === 'HALF_OPEN') {
      this.logger.info(`Circuit [${this.name}] CLOSED: Connection restored.`);
    }
    this.state = 'CLOSED';
  }

  private onFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.state === 'CLOSED' && this.failureCount >= this.threshold) {
      this.state = 'OPEN';
      this.logger.error(`Circuit [${this.name}] TRIPPED OPEN after ${this.failureCount} failures!`);
    } else if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.logger.error(`Circuit [${this.name}] RE-TRIPPED OPEN!`);
    }
  }

  /** Gets current state (for testing / observability) */
  getState() {
    return this.state;
  }
}
