// ──────────────────────────────────────────────────────────────
// SynapseDB — In-Memory Result Merger
// Stitches results from multiple backends into unified documents.
// ──────────────────────────────────────────────────────────────

import type { Document } from '../types.js';
import type { FetchResult } from './fetcher.js';

/**
 * Merge results from multiple fetch operations.
 *
 * The merger uses the primary key to correlate documents
 * across different stores and stitches their fields together.
 *
 * @param results - Results from parallel fetch operations
 * @param primaryKey - Field name used to correlate documents (e.g., 'id')
 * @param primaryStore - Name of the primary plugin (its documents define the base set)
 */
export function mergeResults(
  results: FetchResult[],
  primaryKey: string,
  primaryStore: string,
): Document[] {
  if (results.length === 0) {
    return [];
  }

  // If only one source, return directly
  if (results.length === 1) {
    return results[0]!.documents;
  }

  // Find the primary result set (defines the document IDs)
  const primaryResult = results.find((r) => r.plugin === primaryStore);
  const secondaryResults = results.filter((r) => r.plugin !== primaryStore && !r.error);

  if (!primaryResult || primaryResult.documents.length === 0) {
    // If primary has no results, try to merge whatever we have
    return mergeFallback(results, primaryKey);
  }

  // Build lookup indexes for secondary results
  const secondaryIndexes = secondaryResults.map((result) => {
    const index = new Map<string, Document>();
    for (const doc of result.documents) {
      const key = extractKey(doc, primaryKey);
      if (key) {
        index.set(key, doc);
      }
    }
    return { plugin: result.plugin, index };
  });

  // Merge: start with primary documents, layer on secondary fields
  const merged: Document[] = [];

  for (const primaryDoc of primaryResult.documents) {
    const key = extractKey(primaryDoc, primaryKey);
    if (!key) continue;

    const unified: Document = { ...primaryDoc };

    for (const { index } of secondaryIndexes) {
      const secondaryDoc = index.get(key);
      if (secondaryDoc) {
        // Merge secondary fields into the unified document
        for (const [field, value] of Object.entries(secondaryDoc)) {
          // Don't overwrite primary key or existing primary fields
          if (field === primaryKey || field === '_id') continue;
          if (!(field in unified) || unified[field] === undefined || unified[field] === null) {
            unified[field] = value;
          }
        }
      }
    }

    merged.push(unified);
  }

  return merged;
}

/**
 * Fallback merge when primary store has no results.
 * Attempts to merge all available results by primary key.
 */
function mergeFallback(results: FetchResult[], primaryKey: string): Document[] {
  const allDocs = new Map<string, Document>();

  for (const result of results) {
    if (result.error) continue;

    for (const doc of result.documents) {
      const key = extractKey(doc, primaryKey);
      if (!key) continue;

      const existing = allDocs.get(key);
      if (existing) {
        // Merge new fields
        for (const [field, value] of Object.entries(doc)) {
          if (!(field in existing) || existing[field] === undefined) {
            existing[field] = value;
          }
        }
      } else {
        allDocs.set(key, { ...doc });
      }
    }
  }

  return [...allDocs.values()];
}

/**
 * Extract the primary key value from a document.
 * Handles both 'id' and '_id' conventions.
 */
function extractKey(doc: Document, primaryKey: string): string | null {
  const value = doc[primaryKey] ?? doc['id'] ?? doc['_id'];
  if (value === null || value === undefined) return null;
  return String(value);
}
