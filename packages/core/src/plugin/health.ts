// ──────────────────────────────────────────────────────────────
// SynapseDB — Plugin Health Monitor
// Periodic health checking and status reporting for all plugins.
// ──────────────────────────────────────────────────────────────

import type { PluginRegistry } from './registry.js';
import type { HealthStatus, Logger } from '../types.js';

export interface HealthMonitorConfig {
  /** Health check interval in milliseconds (default: 30000) */
  intervalMs?: number;

  /** Consider a plugin unhealthy after this many consecutive failures */
  failureThreshold?: number;
}

/**
 * HealthMonitor — Periodically checks plugin health and tracks status.
 */
export class HealthMonitor {
  private registry: PluginRegistry;
  private logger: Logger;
  private intervalMs: number;
  private failureThreshold: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private failureCounts: Map<string, number> = new Map();
  private lastStatus: Map<string, HealthStatus> = new Map();

  constructor(registry: PluginRegistry, logger: Logger, config: HealthMonitorConfig = {}) {
    this.registry = registry;
    this.logger = logger;
    this.intervalMs = config.intervalMs ?? 30000;
    this.failureThreshold = config.failureThreshold ?? 3;
  }

  /**
   * Start periodic health checking.
   */
  start(): void {
    if (this.timer) {
      return;
    }

    this.logger.info(`Health monitor started (interval: ${this.intervalMs}ms)`);

    this.timer = setInterval(async () => {
      await this.checkAll();
    }, this.intervalMs);

    // Run first check immediately
    void this.checkAll();
  }

  /**
   * Stop periodic health checking.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info('Health monitor stopped');
    }
  }

  /**
   * Run health checks on all plugins.
   */
  async checkAll(): Promise<Record<string, HealthStatus>> {
    const results = await this.registry.healthCheckAll();

    for (const [name, status] of Object.entries(results)) {
      this.lastStatus.set(name, status);

      if (!status.healthy) {
        const count = (this.failureCounts.get(name) ?? 0) + 1;
        this.failureCounts.set(name, count);

        if (count >= this.failureThreshold) {
          this.logger.error(
            `Plugin "${name}" is UNHEALTHY (${count} consecutive failures): ${status.message}`,
          );
        } else {
          this.logger.warn(
            `Plugin "${name}" health check failed (${count}/${this.failureThreshold}): ${status.message}`,
          );
        }
      } else {
        // Reset failure count on success
        if (this.failureCounts.has(name)) {
          this.logger.info(`Plugin "${name}" recovered (latency: ${status.latencyMs}ms)`);
        }
        this.failureCounts.set(name, 0);
      }
    }

    return results;
  }

  /**
   * Get the last known health status for all plugins.
   */
  getStatus(): Record<string, HealthStatus & { consecutiveFailures: number }> {
    const result: Record<string, HealthStatus & { consecutiveFailures: number }> = {};

    for (const [name, status] of this.lastStatus) {
      result[name] = {
        ...status,
        consecutiveFailures: this.failureCounts.get(name) ?? 0,
      };
    }

    return result;
  }

  /**
   * Check if all plugins are healthy.
   */
  isSystemHealthy(): boolean {
    for (const status of this.lastStatus.values()) {
      if (!status.healthy) {
        return false;
      }
    }
    return true;
  }
}
