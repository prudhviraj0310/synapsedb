// ──────────────────────────────────────────────────────────────
// SynapseDB SDK — Data Manifest
// Define the shape and behavior of your data with intentions.
// ──────────────────────────────────────────────────────────────

import type { FieldSchema, CollectionManifest, ManifestOptions } from './types.js';

/**
 * Define a data manifest for a collection.
 *
 * @example
 * ```typescript
 * const users = defineManifest('users', {
 *   id:        { type: 'uuid', primary: true },
 *   email:     { type: 'string', unique: true, indexed: true },
 *   name:      { type: 'string' },
 *   bio:       { type: 'text', searchable: true },
 *   profile:   { type: 'json', flexible: true },
 *   embedding: { type: 'vector', dimensions: 768 },
 *   lastSeen:  { type: 'timestamp', cached: true, ttl: 60 },
 * });
 * ```
 */
export function defineManifest(
  name: string,
  fields: FieldSchema,
  options?: ManifestOptions,
): CollectionManifest {
  // Validate manifest
  validateManifest(name, fields);

  return {
    name,
    fields,
    options: {
      syncEnabled: true,
      timestamps: true,
      ...options,
    },
  };
}

/**
 * Validate a manifest for common issues.
 */
function validateManifest(name: string, fields: FieldSchema): void {
  if (!name || typeof name !== 'string') {
    throw new Error('Manifest name must be a non-empty string');
  }

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(
      `Invalid manifest name "${name}". Use alphanumeric characters and underscores only.`,
    );
  }

  if (!fields || Object.keys(fields).length === 0) {
    throw new Error('Manifest must define at least one field');
  }

  let hasPrimary = false;

  for (const [fieldName, descriptor] of Object.entries(fields)) {
    if (descriptor.primary) {
      if (hasPrimary) {
        throw new Error('Manifest can only have one primary key field');
      }
      hasPrimary = true;
    }

    if (descriptor.type === 'vector' && !descriptor.dimensions) {
      throw new Error(`Vector field "${fieldName}" must specify dimensions`);
    }

    if (descriptor.cached && descriptor.ttl !== undefined && descriptor.ttl < 0) {
      throw new Error(`Field "${fieldName}" has an invalid TTL (must be positive)`);
    }
  }
}
