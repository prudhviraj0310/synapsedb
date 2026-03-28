// ──────────────────────────────────────────────────────────────
// SynapseDB SDK — Public API
// ──────────────────────────────────────────────────────────────

export { SynapseDB, OmniDB } from './client.js';
export { defineManifest } from './manifest.js';
export { Collection } from './collection.js';

export type {
  SynapseDBClientConfig,
  CollectionManifest,
  FieldDescriptor,
  FieldSchema,
  FieldType,
  FindOptions,
  ApiResponse,
  InsertResult,
  UpdateResult,
  DeleteResult,
  Document,
  ManifestOptions,
} from './types.js';
