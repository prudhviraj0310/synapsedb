// ──────────────────────────────────────────────────────────────
// SynapseDB — Middleware Module
// ──────────────────────────────────────────────────────────────

export { QueryCache } from './cache.js';
export type { QueryCacheConfig, CacheStats } from './cache.js';

export { SchemaMigrator } from './migrations.js';
export type { MigrationOp, MigrationRecord } from './migrations.js';

export { MetricsCollector } from './observability.js';
export type { OperationType, OperationMetrics, SystemMetrics } from './observability.js';
