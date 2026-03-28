// ──────────────────────────────────────────────────────────────
// SynapseDB — MongoDB Storage Plugin
// Implements IStoragePlugin for MongoDB via native driver.
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

let mongodb: typeof import('mongodb') | null = null;

type MongoClient = InstanceType<typeof import('mongodb').MongoClient>;
type Db = ReturnType<MongoClient['db']>;

/**
 * MongoPlugin — NoSQL Document Plugin
 *
 * Handles flexible, deeply-nested data and full-text search.
 * Automatically creates collections and indexes from manifests.
 */
export class MongoPlugin implements IStoragePlugin {
  readonly name = 'mongodb';
  readonly type: StorageType = 'nosql';

  private client: MongoClient | null = null;
  private db: Db | null = null;
  private logger: Logger | null = null;

  async connect(config: PluginConfig, logger: Logger): Promise<void> {
    this.logger = logger;

    try {
      mongodb = await import('mongodb');
    } catch {
      throw new Error('MongoDB driver not found. Install it with: npm install mongodb');
    }

    const uri = config.connectionUri ?? `mongodb://${config.host ?? 'localhost'}:${config.port ?? 27017}`;

    this.client = new mongodb.MongoClient(uri);
    await this.client.connect();
    this.db = this.client.db(config.database ?? 'omnidb');

    logger.info('MongoDB connected');
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.db) {
      return { healthy: false, latencyMs: -1, message: 'Not connected' };
    }

    const start = Date.now();
    try {
      await this.db.command({ ping: 1 });
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async syncSchema(manifest: CollectionManifest, fields: string[]): Promise<void> {
    if (!this.db) throw new Error('Not connected');

    // Create collection (idempotent)
    const collections = await this.db.listCollections({ name: manifest.name }).toArray();
    if (collections.length === 0) {
      await this.db.createCollection(manifest.name);
    }

    const collection = this.db.collection(manifest.name);

    // Create indexes for designated fields
    for (const fieldName of fields) {
      const desc = manifest.fields[fieldName];
      if (!desc) continue;

      if (desc.indexed) {
        await collection.createIndex(
          { [fieldName]: 1 },
          { name: `idx_${fieldName}`, background: true },
        );
      }

      if (desc.unique) {
        await collection.createIndex(
          { [fieldName]: 1 },
          { name: `udx_${fieldName}`, unique: true, background: true },
        );
      }

      if (desc.searchable && desc.type === 'text') {
        await collection.createIndex(
          { [fieldName]: 'text' },
          { name: `txt_${fieldName}`, background: true },
        ).catch(() => {
          // Text index may already exist on different field
          this.logger?.warn(`Text index on ${fieldName} may conflict with existing text index`);
        });
      }
    }

    // Ensure id index
    await collection.createIndex({ id: 1 }, { name: 'idx_id', background: true });

    this.logger?.info(`Schema synced for collection: ${manifest.name}`);
  }

  async insert(collection: string, docs: Document[], fields: string[]): Promise<InsertResult> {
    if (!this.db) throw new Error('Not connected');

    const col = this.db.collection(collection);

    // Filter documents to only include relevant fields
    const filteredDocs = docs.map((doc) => {
      const filtered: Document = {};
      for (const [k, v] of Object.entries(doc)) {
        if (fields.includes(k) || k === 'id' || k === '_id') {
          filtered[k] = v;
        }
      }
      // Use 'id' as '_id' if no _id present
      if (filtered['id'] && !filtered['_id']) {
        filtered['_id'] = filtered['id'];
      }
      return filtered;
    });

    const result = await col.insertMany(filteredDocs);
    const insertedIds = Object.values(result.insertedIds).map(String);

    return {
      insertedCount: result.insertedCount,
      insertedIds,
    };
  }

  async find(collection: string, query: QueryAST, fields: string[]): Promise<Document[]> {
    if (!this.db) throw new Error('Not connected');

    const { emitMongo } = await import('@synapsedb/core/compiler/mongo-emitter');
    const mongoQuery = emitMongo(query, fields);

    const col = this.db.collection(collection);
    let cursor = col.find(mongoQuery.filter);

    if (mongoQuery.options.projection) {
      cursor = cursor.project(mongoQuery.options.projection);
    }
    if (mongoQuery.options.sort) {
      cursor = cursor.sort(mongoQuery.options.sort);
    }
    if (mongoQuery.options.limit) {
      cursor = cursor.limit(mongoQuery.options.limit);
    }
    if (mongoQuery.options.skip) {
      cursor = cursor.skip(mongoQuery.options.skip);
    }

    const results = await cursor.toArray();

    // Normalize _id to id
    return results.map((doc) => {
      const normalized: Document = {};
      for (const [k, v] of Object.entries(doc)) {
        if (k === '_id') {
          normalized['id'] = String(v);
        } else {
          normalized[k] = v;
        }
      }
      return normalized;
    });
  }

  async findOne(collection: string, query: QueryAST, fields: string[]): Promise<Document | null> {
    const results = await this.find(collection, { ...query, type: 'FIND_ONE' }, fields);
    return results[0] ?? null;
  }

  async update(
    collection: string,
    query: QueryAST,
    changes: Record<string, unknown>,
    fields: string[],
  ): Promise<UpdateResult> {
    if (!this.db) throw new Error('Not connected');

    const { emitMongo } = await import('@synapsedb/core/compiler/mongo-emitter');
    const updateAST: QueryAST = { ...query, type: 'UPDATE', updates: changes };
    const mongoQuery = emitMongo(updateAST, fields);

    const col = this.db.collection(collection);
    const result = await col.updateMany(
      mongoQuery.filter,
      mongoQuery.update ?? { $set: changes },
    );

    return {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
    };
  }

  async delete(collection: string, query: QueryAST): Promise<DeleteResult> {
    if (!this.db) throw new Error('Not connected');

    const { emitMongo } = await import('@synapsedb/core/compiler/mongo-emitter');
    const mongoQuery = emitMongo(query, []);

    const col = this.db.collection(collection);
    const result = await col.deleteMany(mongoQuery.filter);

    return {
      deletedCount: result.deletedCount,
    };
  }

  capabilities(): PluginCapabilities {
    return {
      supportsTransactions: false,
      supportsFullTextSearch: true,
      supportsVectorSearch: false,
      supportsNestedDocuments: true,
      supportsTTL: true,
      supportsIndexes: true,
      supportsUniqueConstraints: true,
    };
  }
}

export default function createMongoPlugin(): MongoPlugin {
  return new MongoPlugin();
}
