// ──────────────────────────────────────────────────────────────
// SynapseDB — Plugin Contract
// The interface every storage backend must implement.
// This is the cornerstone of SynapseDB's pluggable architecture.
// ──────────────────────────────────────────────────────────────

import type {
  StorageType,
  PluginConfig,
  HealthStatus,
  PluginCapabilities,
  CollectionManifest,
  QueryAST,
  Document,
  InsertResult,
  UpdateResult,
  DeleteResult,
  Logger,
} from '../types.js';

/**
 * IStoragePlugin — The universal contract for all storage backends.
 *
 * Any database can be integrated into SynapseDB by implementing this
 * interface. The Core Engine communicates exclusively through this
 * contract, making backends hot-swappable with zero application changes.
 *
 * @example
 * ```typescript
 * class PostgresPlugin implements IStoragePlugin {
 *   readonly name = 'postgres';
 *   readonly type = 'sql';
 *   // ... implement all methods
 * }
 * ```
 */
export interface IStoragePlugin {
  /** Unique plugin identifier (e.g., 'postgres', 'mongodb', 'redis') */
  readonly name: string;

  /** Storage category — used by the Kinetic Router for field routing */
  readonly type: StorageType;

  // ─── Lifecycle ───────────────────────────────────────────

  /**
   * Initialize the connection to the underlying database.
   * Called once during SynapseDB startup.
   */
  connect(config: PluginConfig, logger: Logger): Promise<void>;

  /**
   * Gracefully close all connections.
   * Called during SynapseDB shutdown.
   */
  disconnect(): Promise<void>;

  /**
   * Health check — returns connectivity status and latency.
   * Called periodically by the health monitor.
   */
  healthCheck(): Promise<HealthStatus>;

  // ─── Schema Management ──────────────────────────────────

  /**
   * Synchronize the database schema with the manifest.
   * - SQL: CREATE TABLE / ALTER TABLE
   * - NoSQL: Create collection + indexes
   * - Cache: Setup key patterns
   * - Vector: Create index with dimensions
   *
   * This is idempotent — safe to call multiple times.
   */
  syncSchema(manifest: CollectionManifest, fields: string[]): Promise<void>;

  // ─── CRUD Operations ────────────────────────────────────

  /**
   * Insert one or more documents.
   * The documents will only contain fields routed to this plugin.
   */
  insert(collection: string, docs: Document[], fields: string[]): Promise<InsertResult>;

  /**
   * Find documents matching the query.
   * Returns only the fields owned by this plugin.
   */
  find(collection: string, query: QueryAST, fields: string[]): Promise<Document[]>;

  /**
   * Find a single document matching the query.
   */
  findOne(collection: string, query: QueryAST, fields: string[]): Promise<Document | null>;

  /**
   * Update documents matching the query.
   * Only updates fields owned by this plugin.
   */
  update(
    collection: string,
    query: QueryAST,
    changes: Record<string, unknown>,
    fields: string[],
  ): Promise<UpdateResult>;

  /**
   * Delete documents matching the query.
   */
  delete(collection: string, query: QueryAST): Promise<DeleteResult>;

  // ─── Capabilities ───────────────────────────────────────

  /**
   * Declare what this plugin supports.
   * The Kinetic Router uses this to make routing decisions.
   */
  capabilities(): PluginCapabilities;
}

/**
 * Factory function type for creating plugin instances.
 * Plugins export this as their default export.
 */
export type PluginFactory = () => IStoragePlugin;
