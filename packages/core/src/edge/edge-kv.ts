// ──────────────────────────────────────────────────────────────
// SynapseDB — Edge KV Store
// Sub-millisecond edge cache simulating Upstash / Cloudflare KV.
// ──────────────────────────────────────────────────────────────

import type { Document, Logger } from '../types.js';

interface CacheEntry {
  value: Document;
  expiresAt: number;
  region: string;
}

/**
 * EdgeKVStore — Global Edge Cache
 *
 * In production, this would be Upstash Redis or Cloudflare KV.
 * This implementation provides the identical API with an in-memory
 * store, delivering sub-millisecond reads to simulate edge behavior.
 *
 * Features:
 * - TTL-based automatic expiration
 * - Per-region namespacing (Tokyo, London, US-East, etc.)
 * - Cache-aside pattern: miss → fetch from origin → cache → return
 * - Hit/miss telemetry for observability
 */
export class EdgeKVStore {
  private store: Map<string, CacheEntry> = new Map();
  private logger: Logger;
  private defaultTTL: number;

  // Telemetry
  private hits = 0;
  private misses = 0;

  constructor(logger: Logger, defaultTTLMs = 30_000) {
    this.logger = logger;
    this.defaultTTL = defaultTTLMs;
  }

  /**
   * Get a document from the edge cache.
   * Returns null on miss or expiry.
   */
  get(collection: string, key: string, region = 'global'): Document | null {
    const cacheKey = `${region}:${collection}:${key}`;
    const entry = this.store.get(cacheKey);

    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(cacheKey);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.value;
  }

  /**
   * Store a document in the edge cache.
   */
  set(collection: string, key: string, value: Document, region = 'global', ttlMs?: number): void {
    const cacheKey = `${region}:${collection}:${key}`;
    this.store.set(cacheKey, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTTL),
      region,
    });
  }

  /**
   * Invalidate a cached document across all regions.
   */
  invalidate(collection: string, key: string): void {
    const suffix = `${collection}:${key}`;
    for (const cacheKey of this.store.keys()) {
      if (cacheKey.endsWith(suffix)) {
        this.store.delete(cacheKey);
      }
    }
  }

  /**
   * Invalidate all documents in a collection.
   */
  invalidateCollection(collection: string): void {
    for (const cacheKey of this.store.keys()) {
      if (cacheKey.includes(`:${collection}:`)) {
        this.store.delete(cacheKey);
      }
    }
  }

  /**
   * Get cache telemetry.
   */
  stats() {
    return {
      entries: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0
        ? Math.round((this.hits / (this.hits + this.misses)) * 100)
        : 0,
    };
  }

  /**
   * Clear entire cache.
   */
  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }
}
