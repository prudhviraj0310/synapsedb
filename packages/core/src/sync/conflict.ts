// ──────────────────────────────────────────────────────────────
// SynapseDB — Conflict Resolution
// Strategies for handling write conflicts across stores.
// ──────────────────────────────────────────────────────────────

import type { Document, Logger } from '../types.js';

export type ConflictStrategy = 'last-write-wins' | 'primary-wins' | 'merge';

export interface ConflictResolutionConfig {
  strategy: ConflictStrategy;
}

/**
 * Resolve conflicts between two versions of a document.
 *
 * Default strategy: last-write-wins (based on timestamp).
 */
export function resolveConflict(
  primary: Document,
  secondary: Document,
  strategy: ConflictStrategy = 'last-write-wins',
  logger?: Logger,
): Document {
  switch (strategy) {
    case 'last-write-wins':
      return lastWriteWins(primary, secondary, logger);

    case 'primary-wins':
      return primaryWins(primary, secondary);

    case 'merge':
      return mergeDocuments(primary, secondary, logger);

    default:
      return primary;
  }
}

function lastWriteWins(
  primary: Document,
  secondary: Document,
  logger?: Logger,
): Document {
  const primaryTime = getTimestamp(primary);
  const secondaryTime = getTimestamp(secondary);

  if (secondaryTime > primaryTime) {
    logger?.debug('Conflict resolution: secondary document is newer, using it');
    return { ...primary, ...secondary };
  }

  return primary;
}

function primaryWins(
  primary: Document,
  _secondary: Document,
): Document {
  return primary;
}

function mergeDocuments(
  primary: Document,
  secondary: Document,
  logger?: Logger,
): Document {
  const merged: Document = { ...primary };

  for (const [key, value] of Object.entries(secondary)) {
    if (!(key in merged) || merged[key] === undefined || merged[key] === null) {
      merged[key] = value;
    } else if (merged[key] !== value) {
      // Field exists in both — keep primary value but log
      logger?.debug(`Merge conflict on field "${key}": keeping primary value`);
    }
  }

  return merged;
}

function getTimestamp(doc: Document): number {
  const ts = doc['updatedAt'] ?? doc['updated_at'] ?? doc['__omni_updated'] ?? 0;
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') return new Date(ts).getTime();
  return 0;
}
