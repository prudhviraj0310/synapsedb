// ──────────────────────────────────────────────────────────────
// SynapseDB — Shared Types
// The universal type system for the entire SynapseDB ecosystem
// ──────────────────────────────────────────────────────────────

// ─── Field Type System ───────────────────────────────────────

/**
 * Primitive field types that SynapseDB understands.
 * These map to native types in each storage backend.
 */
export type FieldType =
  | 'string'
  | 'text'
  | 'number'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'uuid'
  | 'timestamp'
  | 'date'
  | 'json'
  | 'array'
  | 'vector'
  | 'binary';

/**
 * Field descriptor — declares the *intention* behind a field.
 * The SynapseDB Router uses these annotations to determine
 * which storage backend should own this field.
 */
export interface FieldDescriptor {
  /** Primitive type of the field */
  type: FieldType;

  /** This field is the primary key */
  primary?: boolean;

  /** Enforce uniqueness (routes to SQL for B-tree index) */
  unique?: boolean;

  /** Create an index on this field */
  indexed?: boolean;

  /** This field requires ACID transactional guarantees (→ SQL) */
  transactional?: boolean;

  /** Schema-less / deeply nested data (→ NoSQL) */
  flexible?: boolean;

  /** This field should support full-text search (→ NoSQL / search engine) */
  searchable?: boolean;

  /** This field should be cached for fast reads (→ Cache) */
  cached?: boolean;

  /** Cache TTL in seconds (only relevant when cached: true) */
  ttl?: number;

  /** Vector dimensions (only relevant when type: 'vector') */
  dimensions?: number;

  /** Auto-generate value on insert (e.g., UUID, timestamp) */
  auto?: boolean;

  /** Field is required (non-nullable) */
  required?: boolean;

  /** Default value */
  default?: unknown;

  /** Allow nested sub-fields (→ NoSQL) */
  nested?: boolean;

  /** Human-readable description */
  description?: string;
}

/**
 * A schema describing all fields in a collection.
 */
export type FieldSchema = Record<string, FieldDescriptor>;

// ─── Manifest ────────────────────────────────────────────────

/**
 * Collection Manifest — the top-level data model declaration.
 * Developers create these to define the shape and behavior of their data.
 */
export interface CollectionManifest {
  /** Collection name (e.g., 'users', 'products') */
  name: string;

  /** Field definitions with intention annotations */
  fields: FieldSchema;

  /** Optional collection-level config */
  options?: ManifestOptions;
}

export interface ManifestOptions {
  /** Enable CDC sync for this collection */
  syncEnabled?: boolean;

  /** Default cache TTL for all cached fields (seconds) */
  defaultCacheTTL?: number;

  /** Timestamp auto-management */
  timestamps?: boolean;

  /** Soft delete support */
  softDelete?: boolean;
}

// ─── Query AST ───────────────────────────────────────────────

/**
 * Comparison operators supported in queries.
 */
export type ComparisonOp =
  | 'EQ'
  | 'NEQ'
  | 'GT'
  | 'GTE'
  | 'LT'
  | 'LTE'
  | 'IN'
  | 'NIN'
  | 'LIKE'
  | 'REGEX'
  | 'EXISTS';

/**
 * Logical operators for combining filter conditions.
 */
export type LogicalOp = 'AND' | 'OR' | 'NOT';

/**
 * A single filter condition in a query.
 */
export interface FilterCondition {
  field: string;
  op: ComparisonOp;
  value: unknown;
}

/**
 * A group of conditions combined with a logical operator.
 */
export interface FilterGroup {
  logic: LogicalOp;
  conditions: Array<FilterCondition | FilterGroup>;
}

/**
 * Sort specification.
 */
export interface SortSpec {
  field: string;
  direction: 'ASC' | 'DESC';
}

/**
 * The Query AST — the intermediate representation that the
 * Unified Query Compiler translates into native database queries.
 */
export interface QueryAST {
  type: 'FIND' | 'FIND_ONE' | 'INSERT' | 'UPDATE' | 'DELETE' | 'SEARCH' | 'COUNT';
  collection: string;
  filters?: FilterGroup;
  projection?: string[] | null;
  sort?: SortSpec[];
  limit?: number;
  offset?: number;
  data?: Document | Document[];
  updates?: Record<string, unknown>;
  searchQuery?: string;
  vectorQuery?: {
    field: string;
    vector: number[];
    topK: number;
    threshold?: number;
  };
}

// ─── Documents & Results ─────────────────────────────────────

/**
 * A generic document — the universal data unit in SynapseDB.
 */
export type Document = Record<string, unknown>;

/**
 * Result of an insert operation.
 */
export interface InsertResult {
  insertedCount: number;
  insertedIds: string[];
}

/**
 * Result of an update operation.
 */
export interface UpdateResult {
  matchedCount: number;
  modifiedCount: number;
}

/**
 * Result of a delete operation.
 */
export interface DeleteResult {
  deletedCount: number;
}

// ─── Plugin Types ────────────────────────────────────────────

/**
 * Storage backend categories.
 */
export type StorageType = 'sql' | 'nosql' | 'vector' | 'cache';

/**
 * Plugin configuration passed during initialization.
 */
export interface PluginConfig {
  /** Connection URI or host */
  connectionUri?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;

  /** Connection pool settings */
  pool?: {
    min?: number;
    max?: number;
    idleTimeoutMs?: number;
  };

  /** Arbitrary plugin-specific options */
  options?: Record<string, unknown>;
}

/**
 * Health status reported by a plugin.
 */
export interface HealthStatus {
  healthy: boolean;
  latencyMs: number;
  message?: string;
  details?: Record<string, unknown>;
}

/**
 * Capabilities a plugin declares — used by the Kinetic Router
 * to determine which plugins can handle which field types.
 */
export interface PluginCapabilities {
  supportsTransactions: boolean;
  supportsFullTextSearch: boolean;
  supportsVectorSearch: boolean;
  supportsNestedDocuments: boolean;
  supportsTTL: boolean;
  supportsIndexes: boolean;
  supportsUniqueConstraints: boolean;
  maxDocumentSize?: number;
}

// ─── Routing Types ───────────────────────────────────────────

/**
 * Describes where a single field is routed.
 */
export interface FieldRoute {
  store: string;       // Plugin name (e.g., 'postgres', 'mongodb')
  reason: string;      // Human-readable reason for the routing decision
}

/**
 * Complete routing map for a collection.
 */
export interface CollectionRoutingMap {
  collection: string;
  primaryStore: string;
  fieldRoutes: Record<string, FieldRoute>;
  involvedStores: string[];
}

// ─── Execution Plan ──────────────────────────────────────────

/**
 * A single operation in an execution plan.
 */
export interface PlanOperation {
  id: string;
  plugin: string;
  operation: 'INSERT' | 'FIND' | 'UPDATE' | 'DELETE' | 'SEARCH';
  fields: string[];
  query: QueryAST;
  dependsOn?: string[];
}

/**
 * Execution plan — a DAG of operations across plugins.
 */
export interface ExecutionPlan {
  collection: string;
  operations: PlanOperation[];
  requiresJoin: boolean;
  primaryKey: string;
}

// ─── CDC / Sync Types ────────────────────────────────────────

/**
 * Change event emitted by the CDC system.
 */
export interface ChangeEvent {
  id: string;
  timestamp: number;
  collection: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  primaryKey: string;
  document?: Document;
  previousDocument?: Document;
  changedFields?: string[];
  sourcePlugin: string;
}

// ─── Server / API Types ──────────────────────────────────────

/**
 * SynapseDB server configuration.
 */
export interface SynapseConfig {
  /** Server host */
  host?: string;

  /** Server port */
  port?: number;

  /** API key for authentication */
  apiKey?: string;

  /** Plugin configurations keyed by plugin name */
  plugins: Record<string, {
    type: StorageType;
    package: string;
    config: PluginConfig;
    priority?: number;
  }>;

  /** Logging level */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';

  /** Enable CDC sync globally */
  syncEnabled?: boolean;

  /** Query cache configuration */
  cache?: {
    enabled?: boolean;
    maxSize?: number;
    defaultTTL?: number;
  };

  /** Auto-connect database URIs (DB Detector) */
  connections?: string[];

  // ─── v0.4 Resilience & Consistency ───────────────

  topology?: {
    consistency?: 'EVENTUAL' | 'STRONG';
    retries?: {
      maxAttempts?: number;
      initialDelayMs?: number;
      timeoutMs?: number;
    };
    circuitBreaker?: {
      failureThreshold?: number;
      resetTimeoutMs?: number;
    };
  };

  // ─── v0.3 Advanced Features ──────────────────────

  /** AI Workload Analyzer configuration */
  intelligence?: {
    enabled?: boolean;
    analyzeIntervalMs?: number;
    cachePromotionThreshold?: number;
    coldArchivalMinutes?: number;
    autoApplyThreshold?: number;
    windowSize?: number;
  };

  /** Cold Storage Archiver configuration */
  archiver?: {
    enabled?: boolean;
    coldThresholdMinutes?: number;
    archiveThresholdMinutes?: number;
    backend?: 'local' | 's3' | 'gcs';
    basePath?: string;
  };

  /** Edge Sync (Local-First / CRDT) configuration */
  edgeSync?: {
    nodeId?: string;
    syncIntervalMs?: number;
    batchSize?: number;
    crdtEnabled?: boolean;
    maxQueueSize?: number;
  };
}

/** @deprecated Use SynapseConfig instead */
export type OmniDBConfig = SynapseConfig;

/**
 * Standard API response envelope.
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  meta?: {
    took: number;
    routedTo: string[];
    operationId?: string;
  };
}

/**
 * Context provided to execution layers (v0.5 Production Upgrade).
 * Carries idempotency, tenant scope, and security roles.
 */
export interface OperationContext {
  operationId?: string;
  tenantId?: string;
  role?: string;
}

// ─── Logger Interface ────────────────────────────────────────

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
