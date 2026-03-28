// ──────────────────────────────────────────────────────────────
// SynapseDB — Analytics Module (Barrel Export)
// ──────────────────────────────────────────────────────────────

export { AnalyticsEngine } from './engine.js';
export type { AnalyticsResult, AggregateOp } from './engine.js';

// Zero-ETL
export { CDCAnalyticsBridge } from './cdc-analytics-bridge.js';
export type { IAnalyticsSink } from './cdc-analytics-bridge.js';
export { ConsoleSink, FileSink, MemorySink } from './sink.js';
