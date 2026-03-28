// ──────────────────────────────────────────────────────────────
// SynapseDB — Observability / Metrics Collector
// Tracks per-operation metrics across all storage plugins.
// ──────────────────────────────────────────────────────────────

import type { Logger } from '../types.js';

/**
 * Operation types tracked by the metrics collector.
 */
export type OperationType = 'insert' | 'find' | 'findOne' | 'update' | 'delete' | 'search';

/**
 * A single latency observation.
 */
interface LatencyRecord {
  durationMs: number;
  timestamp: number;
  stores: string[];
  success: boolean;
}

/**
 * Aggregated metrics for a collection + operation pair.
 */
export interface OperationMetrics {
  count: number;
  errorCount: number;
  errorRate: number;
  latency: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
  };
  storeHits: Record<string, number>;
}

/**
 * System-wide metrics snapshot.
 */
export interface SystemMetrics {
  uptime: number;
  totalOperations: number;
  totalErrors: number;
  operationsPerSecond: number;
  collections: Record<string, Record<OperationType, OperationMetrics>>;
  storeHealth: Record<string, { totalOps: number; errorRate: number }>;
}

/**
 * MetricsCollector — Operation-Level Observability
 *
 * Every CRUD operation passes through the collector.
 * Tracks: latency percentiles, error rates, store hit frequency,
 * and operations per second.
 *
 * Data is kept in-memory with a rolling window (configurable).
 */
export class MetricsCollector {
  private records: Map<string, LatencyRecord[]> = new Map();
  private startTime: number;
  private maxRecordsPerKey: number;
  private logger: Logger;

  constructor(logger: Logger, maxRecordsPerKey: number = 1000) {
    this.startTime = Date.now();
    this.maxRecordsPerKey = maxRecordsPerKey;
    this.logger = logger;
  }

  /**
   * Record an operation.
   */
  record(
    collection: string,
    operation: OperationType,
    durationMs: number,
    stores: string[],
    success: boolean,
  ): void {
    const key = `${collection}:${operation}`;

    if (!this.records.has(key)) {
      this.records.set(key, []);
    }

    const records = this.records.get(key)!;
    records.push({
      durationMs,
      timestamp: Date.now(),
      stores,
      success,
    });

    // Trim to rolling window
    if (records.length > this.maxRecordsPerKey) {
      records.splice(0, records.length - this.maxRecordsPerKey);
    }
  }

  /**
   * Get metrics for a specific collection + operation.
   */
  getMetrics(collection: string, operation: OperationType): OperationMetrics {
    const key = `${collection}:${operation}`;
    const records = this.records.get(key) ?? [];

    if (records.length === 0) {
      return {
        count: 0,
        errorCount: 0,
        errorRate: 0,
        latency: { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 },
        storeHits: {},
      };
    }

    const durations = records.map((r) => r.durationMs).sort((a, b) => a - b);
    const errorCount = records.filter((r) => !r.success).length;

    // Store hit frequency
    const storeHits: Record<string, number> = {};
    for (const record of records) {
      for (const store of record.stores) {
        storeHits[store] = (storeHits[store] ?? 0) + 1;
      }
    }

    return {
      count: records.length,
      errorCount,
      errorRate: errorCount / records.length,
      latency: {
        min: durations[0]!,
        max: durations[durations.length - 1]!,
        avg: durations.reduce((a, b) => a + b, 0) / durations.length,
        p50: percentile(durations, 50),
        p95: percentile(durations, 95),
        p99: percentile(durations, 99),
      },
      storeHits,
    };
  }

  /**
   * Get system-wide metrics snapshot.
   */
  snapshot(): SystemMetrics {
    const collections: Record<string, Record<OperationType, OperationMetrics>> = {};
    const storeOps: Record<string, { total: number; errors: number }> = {};
    let totalOps = 0;
    let totalErrors = 0;

    for (const [key, records] of this.records) {
      const [collection, operation] = key.split(':') as [string, OperationType];

      if (!collections[collection]) {
        collections[collection] = {} as Record<OperationType, OperationMetrics>;
      }

      const metrics = this.getMetrics(collection, operation);
      collections[collection][operation] = metrics;

      totalOps += metrics.count;
      totalErrors += metrics.errorCount;

      // Aggregate store-level stats
      for (const record of records) {
        for (const store of record.stores) {
          if (!storeOps[store]) {
            storeOps[store] = { total: 0, errors: 0 };
          }
          storeOps[store].total++;
          if (!record.success) storeOps[store].errors++;
        }
      }
    }

    const uptimeMs = Date.now() - this.startTime;
    const uptimeSec = uptimeMs / 1000;

    const storeHealth: Record<string, { totalOps: number; errorRate: number }> = {};
    for (const [store, stats] of Object.entries(storeOps)) {
      storeHealth[store] = {
        totalOps: stats.total,
        errorRate: stats.total > 0 ? stats.errors / stats.total : 0,
      };
    }

    return {
      uptime: uptimeMs,
      totalOperations: totalOps,
      totalErrors,
      operationsPerSecond: uptimeSec > 0 ? totalOps / uptimeSec : 0,
      collections,
      storeHealth,
    };
  }

  /**
   * Reset all metrics.
   */
  reset(): void {
    this.records.clear();
    this.startTime = Date.now();
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, idx)]!;
}
