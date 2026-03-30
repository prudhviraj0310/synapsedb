// ──────────────────────────────────────────────────────────────
// SynapseDB Core — Entry Point
// ──────────────────────────────────────────────────────────────

export { SynapseEngine, OmniDBEngine } from './engine.js';
export { createServer, startServer } from './server.js';
export { createLogger } from './logger.js';
export { SynapseError } from './error.js';

// Sub-modules
export * from './plugin/index.js';
export * from './compiler/index.js';
export * from './router/index.js';
export * from './joiner/index.js';
export * from './sync/index.js';
export * from './detector/index.js';
export * from './bridge/index.js';
export * from './middleware/index.js';

// v0.3 — Advanced Features
export * from './intelligence/index.js';
export * from './analytics/index.js';
export * from './storage/index.js';

// v0.5 — Data OS
export * from './edge/index.js';

// Telemetry
export * from './telemetry/index.js';

// Types
export type {
  SynapseConfig,
  OmniDBConfig,
  CollectionManifest,
  FieldDescriptor,
  FieldSchema,
  FieldType,
  QueryAST,
  Document,
  InsertResult,
  UpdateResult,
  DeleteResult,
  ApiResponse,
  PluginConfig,
  HealthStatus,
  PluginCapabilities,
  StorageType,
  CollectionRoutingMap,
  FieldRoute,
  ChangeEvent,
  Logger,
} from './types.js';
