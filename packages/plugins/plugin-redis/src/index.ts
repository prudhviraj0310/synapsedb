// ──────────────────────────────────────────────────────────────
// SynapseDB — Redis Storage Plugin
// Implements IStoragePlugin for Redis via `ioredis` driver.
// ──────────────────────────────────────────────────────────────

import type {
  StorageType,
  PluginConfig,
  HealthStatus,
  PluginCapabilities,
  CollectionManifest,
  QueryAST,
  Document,
  InsertResult,
  UpdateResult,
  DeleteResult,
  Logger,
} from '@synapsedb/core/types';
import type { IStoragePlugin } from '@synapsedb/core/plugin/contract';

let RedisConstructor: any = null;
type RedisClient = InstanceType<typeof import('ioredis').default>;

/**
 * RedisPlugin — Ephemeral Cache Plugin
 *
 * Handles high-speed, temporary data with TTL support.
 * Uses Redis hashes for structured document storage.
 *
 * Key format: `{collection}:{id}` (hash)
 */
export class RedisPlugin implements IStoragePlugin {
  readonly name = 'redis';
  readonly type: StorageType = 'cache';

  private client: RedisClient | null = null;
  private logger: Logger | null = null;
  private defaultTTL: number = 3600; // 1 hour default

  async connect(config: PluginConfig, logger: Logger): Promise<void> {
    this.logger = logger;

    try {
      const ioredis = await import('ioredis');
      RedisConstructor = ioredis.default;
    } catch {
      throw new Error('Redis driver not found. Install it with: npm install ioredis');
    }

    if (config.connectionUri) {
      this.client = new RedisConstructor(config.connectionUri) as RedisClient;
    } else {
      this.client = new RedisConstructor({
        host: config.host ?? 'localhost',
        port: config.port ?? 6379,
        password: config.password,
        db: typeof config.options?.db === 'number' ? config.options.db : 0,
      }) as RedisClient;
    }

    if (config.options?.defaultTTL && typeof config.options.defaultTTL === 'number') {
      this.defaultTTL = config.options.defaultTTL;
    }

    // Test connection
    await this.client.ping();
    logger.info('Redis connected');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.client) {
      return { healthy: false, latencyMs: -1, message: 'Not connected' };
    }

    const start = Date.now();
    try {
      await this.client.ping();
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async syncSchema(_manifest: CollectionManifest, _fields: string[]): Promise<void> {
    // Redis is schema-less — no sync needed
    this.logger?.info(`Redis schema sync (no-op) for: ${_manifest.name}`);
  }

  async insert(collection: string, docs: Document[], fields: string[]): Promise<InsertResult> {
    if (!this.client) throw new Error('Not connected');

    const pipeline = this.client.pipeline();
    const insertedIds: string[] = [];

    for (const doc of docs) {
      const id = String(doc['id'] ?? doc['_id'] ?? '');
      if (!id) continue;

      const key = `${collection}:${id}`;
      const hashData: Record<string, string> = {};

      for (const [k, v] of Object.entries(doc)) {
        if (fields.includes(k) || k === 'id') {
          hashData[k] = serialize(v);
        }
      }

      if (Object.keys(hashData).length > 0) {
        pipeline.hset(key, hashData);
        pipeline.expire(key, this.defaultTTL);
        insertedIds.push(id);
      }
    }

    await pipeline.exec();

    return {
      insertedCount: insertedIds.length,
      insertedIds,
    };
  }

  async find(collection: string, query: QueryAST, fields: string[]): Promise<Document[]> {
    if (!this.client) throw new Error('Not connected');

    // Try direct ID lookup first (O(1))
    const id = extractIdFromQuery(query);

    if (id) {
      const doc = await this.getDocument(collection, id, fields);
      return doc ? [doc] : [];
    }

    // Fallback: scan all keys for this collection
    const documents: Document[] = [];
    let cursor = '0';

    do {
      const [nextCursor, keys] = await this.client.scan(
        Number(cursor),
        'MATCH',
        `${collection}:*`,
        'COUNT',
        100,
      );
      cursor = nextCursor;

      for (const key of keys) {
        const data = await this.client.hgetall(key);
        if (Object.keys(data).length > 0) {
          const doc = deserializeDoc(data);
          documents.push(doc);
        }
      }
    } while (cursor !== '0');

    // Apply limit
    if (query.limit) {
      return documents.slice(0, query.limit);
    }

    return documents;
  }

  async findOne(collection: string, query: QueryAST, fields: string[]): Promise<Document | null> {
    const id = extractIdFromQuery(query);

    if (id) {
      return this.getDocument(collection, id, fields);
    }

    const results = await this.find(collection, { ...query, limit: 1 }, fields);
    return results[0] ?? null;
  }

  async update(
    collection: string,
    query: QueryAST,
    changes: Record<string, unknown>,
    fields: string[],
  ): Promise<UpdateResult> {
    if (!this.client) throw new Error('Not connected');

    const id = extractIdFromQuery(query);
    if (!id) {
      return { matchedCount: 0, modifiedCount: 0 };
    }

    const key = `${collection}:${id}`;
    const exists = await this.client.exists(key);

    if (!exists) {
      return { matchedCount: 0, modifiedCount: 0 };
    }

    const hashData: Record<string, string> = {};
    for (const [k, v] of Object.entries(changes)) {
      if (fields.includes(k)) {
        hashData[k] = serialize(v);
      }
    }

    if (Object.keys(hashData).length > 0) {
      await this.client.hset(key, hashData);
      // Refresh TTL
      await this.client.expire(key, this.defaultTTL);
    }

    return { matchedCount: 1, modifiedCount: 1 };
  }

  async delete(collection: string, query: QueryAST): Promise<DeleteResult> {
    if (!this.client) throw new Error('Not connected');

    const id = extractIdFromQuery(query);
    if (!id) {
      return { deletedCount: 0 };
    }

    const key = `${collection}:${id}`;
    const result = await this.client.del(key);

    return { deletedCount: result };
  }

  capabilities(): PluginCapabilities {
    return {
      supportsTransactions: false,
      supportsFullTextSearch: false,
      supportsVectorSearch: false,
      supportsNestedDocuments: false,
      supportsTTL: true,
      supportsIndexes: false,
      supportsUniqueConstraints: false,
    };
  }

  // ─── Private Helpers ────────────────────────────────────

  private async getDocument(
    collection: string,
    id: string,
    fields: string[],
  ): Promise<Document | null> {
    if (!this.client) return null;

    const key = `${collection}:${id}`;

    let data: Record<string, string>;

    if (fields.length > 0) {
      const values = await this.client.hmget(key, ...fields);
      data = {};
      for (let i = 0; i < fields.length; i++) {
        const val = values[i];
        const fieldName = fields[i];
        if (val !== null && val !== undefined && fieldName !== undefined) {
          data[fieldName] = val as string;
        }
      }
    } else {
      data = await this.client.hgetall(key);
    }

    if (Object.keys(data).length === 0) {
      return null;
    }

    return deserializeDoc(data);
  }
}

// ─── Utilities ──────────────────────────────────────────────

function serialize(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function deserializeDoc(data: Record<string, string>): Document {
  const doc: Document = {};
  for (const [k, v] of Object.entries(data)) {
    doc[k] = tryParse(v);
  }
  return doc;
}

function tryParse(value: string): unknown {
  if (value === '') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Try number
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== '') return num;

  // Try JSON
  try {
    if (value.startsWith('{') || value.startsWith('[')) {
      return JSON.parse(value);
    }
  } catch {
    // Not JSON
  }

  return value;
}

function extractIdFromQuery(query: QueryAST): string | null {
  if (!query.filters) return null;

  for (const cond of query.filters.conditions) {
    if ('field' in cond && (cond.field === 'id' || cond.field === '_id') && cond.op === 'EQ') {
      return String(cond.value);
    }
  }

  return null;
}

export default function createRedisPlugin(): RedisPlugin {
  return new RedisPlugin();
}
