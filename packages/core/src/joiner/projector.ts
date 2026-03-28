// ──────────────────────────────────────────────────────────────
// SynapseDB — Field Projection & Response Shaping
// Filters and transforms merged results before returning to SDK.
// ──────────────────────────────────────────────────────────────

import type { Document } from '../types.js';

/**
 * Apply field projection to documents.
 * Only include the requested fields (plus primary key).
 */
export function projectFields(
  documents: Document[],
  projection: string[] | null | undefined,
  primaryKey: string = 'id',
): Document[] {
  if (!projection || projection.length === 0) {
    return documents;
  }

  // Always include the primary key
  const allowedFields = new Set([...projection, primaryKey, '_id']);

  return documents.map((doc) => {
    const projected: Document = {};
    for (const [field, value] of Object.entries(doc)) {
      if (allowedFields.has(field)) {
        projected[field] = value;
      }
    }
    return projected;
  });
}

/**
 * Normalize document keys.
 * - Converts `_id` to `id` for consistency
 * - Removes internal metadata fields
 */
export function normalizeDocuments(documents: Document[]): Document[] {
  return documents.map((doc) => {
    const normalized: Document = {};

    for (const [field, value] of Object.entries(doc)) {
      if (field === '_id') {
        normalized['id'] = value;
      } else if (!field.startsWith('__omni_')) {
        normalized[field] = value;
      }
    }

    return normalized;
  });
}

/**
 * Apply limit and offset to a document array.
 * Used for post-merge pagination when results came from multiple stores.
 */
export function applyPagination(
  documents: Document[],
  limit?: number,
  offset?: number,
): Document[] {
  let result = documents;

  if (offset !== undefined && offset > 0) {
    result = result.slice(offset);
  }

  if (limit !== undefined && limit > 0) {
    result = result.slice(0, limit);
  }

  return result;
}

/**
 * Sort documents by the given specifications.
 * Used for post-merge sorting when results came from multiple stores.
 */
export function sortDocuments(
  documents: Document[],
  sort: Array<{ field: string; direction: 'ASC' | 'DESC' }>,
): Document[] {
  if (sort.length === 0) return documents;

  return [...documents].sort((a, b) => {
    for (const { field, direction } of sort) {
      const aVal = a[field];
      const bVal = b[field];

      if (aVal === bVal) continue;
      if (aVal === null || aVal === undefined) return direction === 'ASC' ? -1 : 1;
      if (bVal === null || bVal === undefined) return direction === 'ASC' ? 1 : -1;

      const comparison = aVal < bVal ? -1 : 1;
      return direction === 'ASC' ? comparison : -comparison;
    }
    return 0;
  });
}
