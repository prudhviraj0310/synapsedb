// ──────────────────────────────────────────────────────────────
// SynapseDB — Parallel Multi-DB Fetcher
// Fires queries to multiple plugins simultaneously.
// ──────────────────────────────────────────────────────────────

import type { Document, QueryAST, Logger } from '../types.js';
import type { IStoragePlugin } from '../plugin/contract.js';

export interface FetchResult {
  plugin: string;
  documents: Document[];
  fields: string[];
  error?: Error;
  latencyMs: number;
}

/**
 * Execute queries across multiple plugins in parallel.
 *
 * Uses Promise.allSettled() to ensure all queries complete
 * even if some fail — partial results are still useful.
 */
export async function parallelFetch(
  queries: Array<{
    plugin: IStoragePlugin;
    query: QueryAST;
    fields: string[];
  }>,
  logger: Logger,
): Promise<FetchResult[]> {
  const startTime = Date.now();

  const promises = queries.map(async ({ plugin, query, fields }) => {
    const opStart = Date.now();
    try {
      let documents: Document[];

      if (query.type === 'FIND_ONE') {
        const doc = await plugin.findOne(query.collection, query, fields);
        documents = doc ? [doc] : [];
      } else {
        documents = await plugin.find(query.collection, query, fields);
      }

      const latencyMs = Date.now() - opStart;
      logger.debug(
        `Fetch from ${plugin.name}: ${documents.length} docs in ${latencyMs}ms`,
      );

      return {
        plugin: plugin.name,
        documents,
        fields,
        latencyMs,
      } satisfies FetchResult;
    } catch (error) {
      const latencyMs = Date.now() - opStart;
      logger.error(`Fetch from ${plugin.name} failed after ${latencyMs}ms`, error);

      return {
        plugin: plugin.name,
        documents: [],
        fields,
        error: error instanceof Error ? error : new Error(String(error)),
        latencyMs,
      } satisfies FetchResult;
    }
  });

  const results = await Promise.allSettled(promises);
  const totalMs = Date.now() - startTime;

  logger.debug(`Parallel fetch completed: ${results.length} sources in ${totalMs}ms`);

  return results.map((r) => {
    if (r.status === 'fulfilled') {
      return r.value;
    }
    return {
      plugin: 'unknown',
      documents: [],
      fields: [],
      error: r.reason instanceof Error ? r.reason : new Error(String(r.reason)),
      latencyMs: -1,
    };
  });
}
