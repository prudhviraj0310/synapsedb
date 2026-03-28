// ──────────────────────────────────────────────────────────────
// @synapsedb/plugin-redis
// The official Redis driver for SynapseDB Data OS.
// Implements high-speed ephemeral caching with ioredis.
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
import type { IStoragePlugin } from '@synapsedb/core';
import { SynapseError } from '@synapsedb/core';

import { Redis } from 'ioredis';

export class RedisPlugin implements IStoragePlugin {
  readonly name = 'redis';
  readonly type: StorageType = 'cache';

  private client: Redis | null = null;
  private logger: Logger | null = null;
  private defaultTTL: number = 3600; // 1 hour default
  private config: PluginConfig;

  constructor(config: PluginConfig) {
    this.config = config;
  }

  async connect(pluginConfig: PluginConfig, logger: Logger): Promise<void> {
    this.logger = logger;
    this.config = { ...this.config, ...pluginConfig };

    try {
      if (this.config.connectionUri) {
        this.client = new Redis(this.config.connectionUri, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
        });
      } else {
        this.client = new Redis({
          host: this.config.host ?? 'localhost',
          port: this.config.port ?? 6379,
          password: this.config.password,
          db: typeof this.config.options?.db === 'number' ? this.config.options.db : 0,
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
        });
      }

      const ttl = this.config.options?.defaultTTL;
      if (typeof ttl === 'number') {
        this.defaultTTL = ttl;
      }

      await this.client.connect();
      await this.client.ping();
      this.logger.info('Redis connected successfully.');
    } catch (err: any) {
      // Cleanup the broken client so disconnect() doesn't hang
      if (this.client) {
        this.client.disconnect(false);
        this.client = null;
      }
      throw new SynapseError('PLUGIN_CONNECTION_FAILED', err.message);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.client) return { healthy: false, latencyMs: -1, message: 'Not connected' };

    const start = Date.now();
    try {
      await this.client.ping();
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (err: any) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        message: err.message,
      };
    }
  }

  async syncSchema(manifest: CollectionManifest, fields: string[]): Promise<void> {
    // Redis is schema-less, no table structures to create.
    this.logger?.debug(`Redis sync schema (no-op) for: ${manifest.name}`);
  }

  async insert(collection: string, docs: Document[], fields: string[]): Promise<InsertResult> {
    if (!this.client) throw new SynapseError('PLUGIN_CONNECTION_FAILED', 'Not connected');
    if (docs.length === 0 || fields.length === 0) return { insertedCount: 0, insertedIds: [] };

    try {
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
      return { insertedCount: insertedIds.length, insertedIds };
    } catch (err: any) {
      throw new SynapseError('PLUGIN_QUERY_FAILED', `Redis insert failed: ${err.message}`);
    }
  }

  async find(collection: string, query: QueryAST, fields: string[]): Promise<Document[]> {
    if (!this.client) throw new SynapseError('PLUGIN_CONNECTION_FAILED', 'Not connected');

    try {
      const id = extractIdFromQuery(query);
      if (id) {
        const doc = await this.getDocument(collection, id, fields);
        return doc ? [doc] : [];
      }

      const documents: Document[] = [];
      let cursor = '0';

      do {
        const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', `${collection}:*`, 'COUNT', 100);
        cursor = String(nextCursor);

        for (const key of keys) {
          const data = await this.client.hgetall(key);
          if (Object.keys(data).length > 0) {
            documents.push(deserializeDoc(data));
          }
        }
      } while (cursor !== '0');

      if (query.limit) {
        return documents.slice(0, query.limit);
      }
      return documents;
    } catch (err: any) {
      throw new SynapseError('PLUGIN_QUERY_FAILED', `Redis find failed: ${err.message}`);
    }
  }

  async findOne(collection: string, query: QueryAST, fields: string[]): Promise<Document | null> {
    const id = extractIdFromQuery(query);
    if (id) return this.getDocument(collection, id, fields);

    const docs = await this.find(collection, { ...query, limit: 1 }, fields);
    return docs.length > 0 ? (docs[0] ?? null) : null;
  }

  async update(collection: string, query: QueryAST, changes: Record<string, unknown>, fields: string[]): Promise<UpdateResult> {
    if (!this.client) throw new SynapseError('PLUGIN_CONNECTION_FAILED', 'Not connected');

    try {
      const id = extractIdFromQuery(query);
      if (!id) return { matchedCount: 0, modifiedCount: 0 };

      const key = `${collection}:${id}`;
      const exists = await this.client.exists(key);
      if (!exists) return { matchedCount: 0, modifiedCount: 0 };

      const hashData: Record<string, string> = {};
      for (const [k, v] of Object.entries(changes)) {
        if (fields.includes(k)) {
          hashData[k] = serialize(v);
        }
      }

      if (Object.keys(hashData).length > 0) {
        await this.client.hset(key, hashData);
        await this.client.expire(key, this.defaultTTL);
      }

      return { matchedCount: 1, modifiedCount: 1 };
    } catch (err: any) {
      throw new SynapseError('PLUGIN_QUERY_FAILED', `Redis update failed: ${err.message}`);
    }
  }

  async delete(collection: string, query: QueryAST): Promise<DeleteResult> {
    if (!this.client) throw new SynapseError('PLUGIN_CONNECTION_FAILED', 'Not connected');

    try {
      const id = extractIdFromQuery(query);
      if (!id) return { deletedCount: 0 };

      const deletedCount = await this.client.del(`${collection}:${id}`);
      return { deletedCount };
    } catch (err: any) {
      throw new SynapseError('PLUGIN_QUERY_FAILED', `Redis delete failed: ${err.message}`);
    }
  }

  capabilities(): PluginCapabilities {
    return {
      supportsTransactions: false,
      supportsIndexes: false,
      supportsUniqueConstraints: false,
      supportsNestedDocuments: false,
      supportsFullTextSearch: false,
      supportsVectorSearch: false,
      supportsTTL: true,
    };
  }

  private async getDocument(collection: string, id: string, fields: string[]): Promise<Document | null> {
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
          data[fieldName] = String(val);
        }
      }
    } else {
      data = await this.client.hgetall(key);
    }

    if (Object.keys(data).length === 0) return null;
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
  
  const num = Number(value);
  if (!isNaN(num) && value.trim() !== '') return num;

  try {
    if (value.startsWith('{') || value.startsWith('[')) {
      return JSON.parse(value);
    }
  } catch {}

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

// ─── PLUGIN FACTORY ───
export default function createRedisPlugin(config: PluginConfig = {}): IStoragePlugin {
  return new RedisPlugin(config);
}
