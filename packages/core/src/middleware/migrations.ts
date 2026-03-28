// ──────────────────────────────────────────────────────────────
// SynapseDB — Schema Migrator
// Tracks manifest versions and generates migration operations
// when schemas evolve over time.
// ──────────────────────────────────────────────────────────────

import type { CollectionManifest, FieldDescriptor, Logger } from '../types.js';

/**
 * Types of schema changes detected.
 */
export type MigrationOp =
  | { type: 'ADD_FIELD'; field: string; descriptor: FieldDescriptor }
  | { type: 'REMOVE_FIELD'; field: string }
  | { type: 'MODIFY_FIELD'; field: string; from: FieldDescriptor; to: FieldDescriptor }
  | { type: 'ADD_INDEX'; field: string; indexType: 'unique' | 'indexed' | 'text' }
  | { type: 'REMOVE_INDEX'; field: string; indexType: 'unique' | 'indexed' | 'text' };

/**
 * A single migration record.
 */
export interface MigrationRecord {
  id: string;
  collection: string;
  timestamp: number;
  operations: MigrationOp[];
  fromVersion: number;
  toVersion: number;
}

/**
 * SchemaMigrator — Schema Evolution Tracker
 *
 * When `registerManifest()` is called, the migrator:
 * 1. Compares the incoming manifest against the previously registered version
 * 2. Generates a list of migration operations (add field, remove field, etc.)
 * 3. Stores the migration history for auditing
 *
 * The actual execution of migrations (ALTER TABLE, etc.) is delegated
 * to the individual storage plugins.
 */
export class SchemaMigrator {
  private previousManifests: Map<string, CollectionManifest> = new Map();
  private versions: Map<string, number> = new Map();
  private history: MigrationRecord[] = [];
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Diff a new manifest against the previously registered one.
   * Returns migration operations needed, or empty array if this
   * is the first registration.
   */
  diff(manifest: CollectionManifest): MigrationOp[] {
    const previous = this.previousManifests.get(manifest.name);

    if (!previous) {
      // First registration — no migrations needed
      return [];
    }

    const ops: MigrationOp[] = [];
    const prevFields = previous.fields;
    const newFields = manifest.fields;

    // Check for added fields
    for (const [name, descriptor] of Object.entries(newFields)) {
      if (!(name in prevFields)) {
        ops.push({ type: 'ADD_FIELD', field: name, descriptor });

        // Check if new field has indexes
        if (descriptor.indexed) {
          ops.push({ type: 'ADD_INDEX', field: name, indexType: 'indexed' });
        }
        if (descriptor.unique) {
          ops.push({ type: 'ADD_INDEX', field: name, indexType: 'unique' });
        }
        if (descriptor.searchable && descriptor.type === 'text') {
          ops.push({ type: 'ADD_INDEX', field: name, indexType: 'text' });
        }
      }
    }

    // Check for removed fields
    for (const name of Object.keys(prevFields)) {
      if (!(name in newFields)) {
        ops.push({ type: 'REMOVE_FIELD', field: name });
      }
    }

    // Check for modified fields
    for (const [name, newDesc] of Object.entries(newFields)) {
      const prevDesc = prevFields[name];
      if (!prevDesc) continue;

      if (hasFieldChanged(prevDesc, newDesc)) {
        ops.push({ type: 'MODIFY_FIELD', field: name, from: prevDesc, to: newDesc });
      }

      // Index changes
      if (!prevDesc.indexed && newDesc.indexed) {
        ops.push({ type: 'ADD_INDEX', field: name, indexType: 'indexed' });
      }
      if (prevDesc.indexed && !newDesc.indexed) {
        ops.push({ type: 'REMOVE_INDEX', field: name, indexType: 'indexed' });
      }
      if (!prevDesc.unique && newDesc.unique) {
        ops.push({ type: 'ADD_INDEX', field: name, indexType: 'unique' });
      }
      if (prevDesc.unique && !newDesc.unique) {
        ops.push({ type: 'REMOVE_INDEX', field: name, indexType: 'unique' });
      }
    }

    return ops;
  }

  /**
   * Record a migration and update the stored manifest.
   */
  record(manifest: CollectionManifest, ops: MigrationOp[]): MigrationRecord | null {
    const currentVersion = this.versions.get(manifest.name) ?? 0;
    const newVersion = currentVersion + 1;

    if (ops.length === 0 && currentVersion > 0) {
      // No changes — don't record
      return null;
    }

    const record: MigrationRecord = {
      id: `${manifest.name}_v${newVersion}_${Date.now()}`,
      collection: manifest.name,
      timestamp: Date.now(),
      operations: ops,
      fromVersion: currentVersion,
      toVersion: newVersion,
    };

    this.history.push(record);
    this.versions.set(manifest.name, newVersion);
    this.previousManifests.set(manifest.name, structuredClone(manifest));

    if (ops.length > 0) {
      this.logger.info(
        `Migration v${currentVersion}→v${newVersion} for "${manifest.name}": ${ops.length} operation(s)`,
      );
      for (const op of ops) {
        this.logger.debug(`  ${formatOp(op)}`);
      }
    }

    return record;
  }

  /**
   * Get migration history for a collection (or all collections).
   */
  getHistory(collection?: string): MigrationRecord[] {
    if (collection) {
      return this.history.filter((r) => r.collection === collection);
    }
    return [...this.history];
  }

  /**
   * Get the current schema version for a collection.
   */
  getVersion(collection: string): number {
    return this.versions.get(collection) ?? 0;
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function hasFieldChanged(a: FieldDescriptor, b: FieldDescriptor): boolean {
  // Compare the core type and routing-relevant properties
  return (
    a.type !== b.type ||
    a.primary !== b.primary ||
    a.transactional !== b.transactional ||
    a.flexible !== b.flexible ||
    a.searchable !== b.searchable ||
    a.cached !== b.cached ||
    a.dimensions !== b.dimensions
  );
}

function formatOp(op: MigrationOp): string {
  switch (op.type) {
    case 'ADD_FIELD':    return `+ ADD FIELD "${op.field}" (${op.descriptor.type})`;
    case 'REMOVE_FIELD': return `- REMOVE FIELD "${op.field}"`;
    case 'MODIFY_FIELD': return `~ MODIFY FIELD "${op.field}" (${op.from.type} → ${op.to.type})`;
    case 'ADD_INDEX':    return `+ ADD ${op.indexType.toUpperCase()} INDEX on "${op.field}"`;
    case 'REMOVE_INDEX': return `- REMOVE ${op.indexType.toUpperCase()} INDEX on "${op.field}"`;
  }
}
