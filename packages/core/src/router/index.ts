// ──────────────────────────────────────────────────────────────
// SynapseDB — Kinetic Routing Engine
// ──────────────────────────────────────────────────────────────

export { analyzeManifest, getFieldsForStore, getPrimaryKeyField } from './analyzer.js';
export { resolveStrategy } from './strategy.js';
export type { RoutingDecision } from './strategy.js';
export { buildExecutionPlan } from './plan.js';
