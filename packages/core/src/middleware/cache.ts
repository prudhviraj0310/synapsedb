// ──────────────────────────────────────────────────────────────
// SynapseDB — Query Cache (LRU)
// In-memory LRU cache for read queries with automatic
// invalidation on write operations.
// ──────────────────────────────────────────────────────────────

import type { Logger } from '../types.js';

/**
 * Cache entry with TTL tracking.
 */
interface CacheEntry<T = unknown> {
  value: T;
  createdAt: number;
  ttl: number;
  hits: number;
}

/**
 * QueryCache configuration.
 */
export interface QueryCacheConfig {
  /** Maximum number of entries in the cache */
  maxSize?: number;

  /** Default TTL in milliseconds */
  defaultTTL?: number;

  /** Whether caching is enabled */
  enabled?: boolean;
}

/**
 * Cache statistics.
 */
export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  maxSize: number;
  hitRate: number;
  enabled: boolean;
}

/**
 * QueryCache — LRU Cache for Read Queries
 *
 * Caches the results of find/findOne/search operations.
 * Automatically invalidated when write operations (insert/update/delete)
 * occur on the same collection.
 *
 * Cache key format: `{collection}:{hash(query+projection)}`
 */
export class QueryCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize: number;
  private defaultTTL: number;
  private enabled: boolean;
  private enabledCollections: Set<string> = new Set();
  private logger: Logger;

  // Stats
  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;

  constructor(config: QueryCacheConfig, logger: Logger) {
    this.maxSize = config.maxSize ?? 1000;
    this.defaultTTL = config.defaultTTL ?? 30_000; // 30 seconds
    this.enabled = config.enabled ?? true;
    this.logger = logger;
  }

  /**
   * Enable caching dynamically for a specific collection (Auto-Tuner).
   */
  enableForCollection(collection: string): void {
    this.enabledCollections.add(collection);
  }

  /**
   * Get a cached result.
   * Returns undefined on miss or expired entry.
   */
  get<T>(key: string): T | undefined {
    const collection = key.split(':')[0];
    if (!this.enabled && collection && !this.enabledCollections.has(collection)) return undefined;

    const entry = this.cache.get(key);
    if (!entry) {
      this._misses++;
      return undefined;
    }

    // Check TTL
    if (Date.now() - entry.createdAt > entry.ttl) {
      this.cache.delete(key);
      this._misses++;
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    entry.hits++;
    this.cache.set(key, entry);
    this._hits++;

    return entry.value as T;
  }

  /**
   * Store a result in the cache.
   */
  set<T>(key: string, value: T, ttl?: number): void {
    const collection = key.split(':')[0];
    if (!this.enabled && collection && !this.enabledCollections.has(collection)) return;

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
        this._evictions++;
      }
    }

    this.cache.set(key, {
      value,
      createdAt: Date.now(),
      ttl: ttl ?? this.defaultTTL,
      hits: 0,
    });
  }

  /**
   * Invalidate all cache entries for a collection.
   * Called on write operations (insert, update, delete).
   */
  invalidateCollection(collection: string): void {
    const prefix = `${collection}:`;
    let invalidated = 0;

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        invalidated++;
      }
    }

    if (invalidated > 0) {
      this.logger.debug(`Cache: invalidated ${invalidated} entries for "${collection}"`);
    }
  }

  /**
   * Clear the entire cache.
   */
  clear(): void {
    this.cache.clear();
    this.logger.debug('Cache: cleared all entries');
  }

  /**
   * Get cache statistics.
   */
  stats(): CacheStats {
    const total = this._hits + this._misses;
    return {
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: total > 0 ? this._hits / total : 0,
      enabled: this.enabled,
    };
  }

  /**
   * Build a cache key from query parameters.
   */
  static buildKey(
    collection: string,
    query: Record<string, unknown>,
    projection?: string[],
  ): string {
    const queryHash = simpleHash(JSON.stringify(query));
    const projHash = projection ? simpleHash(JSON.stringify(projection)) : '0';
    return `${collection}:${queryHash}:${projHash}`;
  }
}

/**
 * Simple string hash (FNV-1a inspired).
 * Not cryptographic — just for cache keying.
 */
function simpleHash(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
