// ──────────────────────────────────────────────────────────────
// SynapseDB SDK — Types
// Type definitions for the client SDK.
// ──────────────────────────────────────────────────────────────

/**
 * Primitive field types that SynapseDB understands.
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
 * Field descriptor with intention annotations.
 */
export interface FieldDescriptor {
  type: FieldType;
  primary?: boolean;
  unique?: boolean;
  indexed?: boolean;
  transactional?: boolean;
  flexible?: boolean;
  searchable?: boolean;
  cached?: boolean;
  ttl?: number;
  dimensions?: number;
  auto?: boolean;
  required?: boolean;
  default?: unknown;
  nested?: boolean;
  description?: string;
}

export type FieldSchema = Record<string, FieldDescriptor>;

export interface ManifestOptions {
  syncEnabled?: boolean;
  defaultCacheTTL?: number;
  timestamps?: boolean;
  softDelete?: boolean;
}

export interface CollectionManifest {
  name: string;
  fields: FieldSchema;
  options?: ManifestOptions;
}

/**
 * SDK client configuration.
 */
export interface SynapseDBClientConfig {
  endpoint: string;
  apiKey?: string;
  timeout?: number;
}

/**
 * Query filter options.
 */
export interface FindOptions {
  projection?: string[];
  sort?: Record<string, number>;
  limit?: number;
  offset?: number;
}

/**
 * API response envelope.
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
  };
}

export interface InsertResult {
  insertedCount: number;
  insertedIds: string[];
}

export interface UpdateResult {
  matchedCount: number;
  modifiedCount: number;
}

export interface DeleteResult {
  deletedCount: number;
}

export type Document = Record<string, unknown>;
