// ──────────────────────────────────────────────────────────────
// SynapseDB — Zero-Lag CDC Sync Engine
// ──────────────────────────────────────────────────────────────

export { EventBus } from './event-bus.js';
export { Propagator } from './propagator.js';
export { resolveConflict } from './conflict.js';
export type { ConflictStrategy, ConflictResolutionConfig } from './conflict.js';

// Edge Sync (Local-First / Offline)
export { EdgeSyncEngine, HybridLogicalClock } from './edge-sync.js';
export type { CRDTOperation, EdgeSyncConfig } from './edge-sync.js';

// Distributed Locking
export { LockManager } from './lock.js';
export type { ILockManager } from './lock.js';
