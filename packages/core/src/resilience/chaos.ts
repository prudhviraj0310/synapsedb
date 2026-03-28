import type { Logger } from '../types.js';

export interface ChaosConfig {
  /** Artificial latency injected before each operation (ms) */
  latencyMs?: number;
  /** Probability of dropping a request (0.0 - 1.0) */
  dropRate?: number;
  /** Whether chaos mode is enabled */
  enabled?: boolean;
}

/**
 * ChaosInjector simulates network-level failures for resilience testing.
 * Configurable via environment variables:
 *   CHAOS_ENABLED=true
 *   CHAOS_LATENCY_MS=200
 *   CHAOS_DROP_RATE=0.05
 */
export class ChaosInjector {
  private readonly config: Required<ChaosConfig>;

  constructor(config?: ChaosConfig, private readonly logger?: Logger) {
    this.config = {
      enabled: config?.enabled ?? (process.env['CHAOS_ENABLED'] === 'true'),
      latencyMs: config?.latencyMs ?? parseInt(process.env['CHAOS_LATENCY_MS'] ?? '0', 10),
      dropRate: config?.dropRate ?? parseFloat(process.env['CHAOS_DROP_RATE'] ?? '0'),
    };

    if (this.config.enabled) {
      this.logger?.warn(`[CHAOS] Chaos Engineering ACTIVE — latency: ${this.config.latencyMs}ms, dropRate: ${(this.config.dropRate * 100).toFixed(1)}%`);
    }
  }

  /**
   * Wraps an async action with chaos injection.
   * - Adds artificial latency
   * - Randomly drops requests based on dropRate
   */
  async inject<T>(action: () => Promise<T>): Promise<T> {
    if (!this.config.enabled) return action();

    // Artificial latency
    if (this.config.latencyMs > 0) {
      const jitter = Math.random() * this.config.latencyMs * 0.2;
      await new Promise(r => setTimeout(r, this.config.latencyMs + jitter));
    }

    // Random packet drop
    if (this.config.dropRate > 0 && Math.random() < this.config.dropRate) {
      this.logger?.error('[CHAOS] Simulated packet drop!');
      throw new Error('CHAOS: Simulated network failure (packet dropped)');
    }

    return action();
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }
}
