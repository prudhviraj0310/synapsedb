import type { Logger } from '../types.js';

/**
 * RetryManager provides exponential backoff for transient network errors.
 */
export class RetryManager {
  constructor(
    private readonly maxAttempts: number,
    private readonly initialDelayMs: number,
    private readonly logger: Logger
  ) {}

  /**
   * Execute an async action with exponential backoff on failure and an absolute timeout per attempt.
   */
  async execute<T>(name: string, timeoutMs: number, action: () => Promise<T>): Promise<T> {
    let attempt = 1;
    let delay = this.initialDelayMs;

    while (true) {
      try {
        let timeoutId: NodeJS.Timeout;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`[${name}] Action timeout: Exceeded ${timeoutMs}ms`)), timeoutMs);
        });

        // Promise.race allows the action to "fail fast" if it hangs indefinitely
        const result = await Promise.race([action(), timeoutPromise]);
        clearTimeout(timeoutId!);
        return result;
      } catch (err) {
        if (attempt >= this.maxAttempts) {
          this.logger.error(`[${name}] Action failed after ${attempt} attempts.`);
          throw err;
        }

        this.logger.warn(`[${name}] Action failed (Attempt ${attempt}/${this.maxAttempts}). Retrying in ${Math.round(delay)}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));

        attempt++;
        delay *= 2; // Exponential backoff
        // Add jitter to avoid thundering herd on recovery
        delay += Math.random() * (delay * 0.1);
      }
    }
  }
}
