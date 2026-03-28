// ──────────────────────────────────────────────────────────────
// @synapsedb/plugin-mongodb
// The official MongoDB driver for SynapseDB Data OS.
// Connects the core orchestration engine to MongoDB clusters natively.
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
import { MongoClient, Db, Filter } from 'mongodb';

export class MongoPlugin implements IStoragePlugin {
  readonly name = 'mongodb';
  readonly type: StorageType = 'nosql';

  private client: MongoClient | null = null;
  private db: Db | null = null;
  private logger: Logger | null = null;
  private config: PluginConfig;

  constructor(config: PluginConfig) {
    this.config = config;
  }

  async connect(pluginConfig: PluginConfig, logger: Logger): Promise<void> {
    this.logger = logger;
    this.config = { ...this.config, ...pluginConfig };

    try {
      const uri = this.config.connectionUri ?? `mongodb://${this.config.username ?? ''}:${this.config.password ?? ''}@${this.config.host ?? 'localhost'}:${this.config.port ?? 27017}/${this.config.database ?? 'omnidb'}`;
      
      this.client = new MongoClient(uri, {
        maxPoolSize: this.config.pool?.max ?? 10,
        minPoolSize: this.config.pool?.min ?? 2,
      });

      await this.client.connect();
      this.db = this.client.db(this.config.database ?? 'omnidb');
      
      // Test connection
      await this.db.command({ ping: 1 });
      this.logger?.info('MongoDB connected successfully.');
    } catch (err: any) {
      throw new SynapseError('PLUGIN_CONNECTION_FAILED', err.message);
    }
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
    } catch (err: any) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        message: err.message,
      };
    }
  }

  async syncSchema(manifest: CollectionManifest, fields: string[]): Promise<void> {
    if (!this.db) throw new SynapseError('PLUGIN_CONNECTION_FAILED', 'Not connected');

    try {
      // Ensure collection exists
      const collections = await this.db.listCollections({ name: manifest.name }).toArray();
      if (collections.length === 0) {
        await this.db.createCollection(manifest.name);
        this.logger?.debug(`MongoDB Collection created: ${manifest.name}`);
      }

      // Sync Indexes
      for (const fieldName of fields) {
        const desc = manifest.fields[fieldName];
        if (!desc) continue;

        if (desc.unique) {
          await this.db.collection(manifest.name).createIndex({ [fieldName]: 1 }, { unique: true });
        } else if (desc.indexed) {
          await this.db.collection(manifest.name).createIndex({ [fieldName]: 1 });
        } else if (desc.searchable) {
          // Native text indexes
          await this.db.collection(manifest.name).createIndex({ [fieldName]: 'text' });
        }
      }
    } catch (err: any) {
      throw new SynapseError('PLUGIN_QUERY_FAILED', `Schema sync failed: ${err.message}`);
    }
  }

  async insert(collection: string, docs: Document[], fields: string[]): Promise<InsertResult> {
    if (!this.db) throw new SynapseError('PLUGIN_CONNECTION_FAILED', 'Not connected');
    if (docs.length === 0 || fields.length === 0) {
      return { insertedCount: 0, insertedIds: [] };
    }

    // Filter documents to map ONLY bounded fields, and enforce Mongo `_id` behavior.
    const mappedDocs = docs.map(doc => {
      const sanitized: any = {};
      if (doc.id) sanitized._id = doc.id; // Map abstract 'id' to Mongo _id natively
      
      for (const f of fields) {
        if (f in doc && f !== 'id') sanitized[f] = doc[f];
      }
      return sanitized;
    });

    try {
      const result = await this.db.collection(collection).insertMany(mappedDocs, { ordered: false });
      return {
        insertedCount: result.insertedCount,
        insertedIds: Object.values(result.insertedIds).map(id => String(id)),
      };
    } catch (err: any) {
      // 11000 is Mongo's Duplicate Key error code
      if (err.code === 11000) {
         return { insertedCount: 0, insertedIds: mappedDocs.map(d => String(d._id)) };
      }
      throw new SynapseError('PLUGIN_QUERY_FAILED', `MongoDB insert failed: ${err.message}`);
    }
  }

  async find(collection: string, ast: QueryAST, fields: string[]): Promise<Document[]> {
    if (!this.db) throw new SynapseError('PLUGIN_CONNECTION_FAILED', 'Not connected');

    try {
      const filter = this.buildMongoFilter(ast);
      
      // Projections (map `id` seamlessly)
      const projection: any = { _id: 1 }; 
      if (fields.length > 0) {
        fields.forEach(f => { if (f !== 'id') projection[f] = 1 });
      }

      let cursor = this.db.collection(collection).find(filter, { projection });

      if (ast.sort) {
        const sortDoc: any = {};
        ast.sort.forEach(s => {
           sortDoc[s.field === 'id' ? '_id' : s.field] = s.direction === 'ASC' ? 1 : -1;
        });
        cursor = cursor.sort(sortDoc);
      }
      if (ast.limit) cursor = cursor.limit(ast.limit);
      if (ast.offset) cursor = cursor.skip(ast.offset);

      const rows = await cursor.toArray();

      // Reverse map `_id` to `id`
      return rows.map(r => {
        const { _id, ...rest } = r;
        return { ...rest, id: String(_id) };
      });
    } catch (err: any) {
      throw new SynapseError('PLUGIN_QUERY_FAILED', `MongoDB find failed: ${err.message}`);
    }
  }

  async findOne(collection: string, ast: QueryAST, fields: string[]): Promise<Document | null> {
    const originalLimit = ast.limit;
    ast.limit = 1;
    const docs = await this.find(collection, ast, fields);
    ast.limit = originalLimit;
    return docs.length > 0 ? (docs[0] ?? null) : null;
  }

  async update(collection: string, ast: QueryAST, changes: Record<string, unknown>, fields: string[]): Promise<UpdateResult> {
    if (!this.db) throw new SynapseError('PLUGIN_CONNECTION_FAILED', 'Not connected');

    const setObj: any = {};
    for (const f of fields) {
      if (f in changes && f !== 'id') setObj[f] = changes[f];
    }
    if (Object.keys(setObj).length === 0) return { matchedCount: 0, modifiedCount: 0 };

    try {
      const filter = this.buildMongoFilter(ast);
      const result = await this.db.collection(collection).updateMany(filter, { $set: setObj });
      return {
        matchedCount: result.matchedCount,
        modifiedCount: result.modifiedCount,
      };
    } catch (err: any) {
      throw new SynapseError('PLUGIN_QUERY_FAILED', `MongoDB update failed: ${err.message}`);
    }
  }

  async delete(collection: string, ast: QueryAST): Promise<DeleteResult> {
    if (!this.db) throw new SynapseError('PLUGIN_CONNECTION_FAILED', 'Not connected');

    try {
      const filter = this.buildMongoFilter(ast);
      const result = await this.db.collection(collection).deleteMany(filter);
      return { deletedCount: result.deletedCount };
    } catch (err: any) {
      throw new SynapseError('PLUGIN_QUERY_FAILED', `MongoDB delete failed: ${err.message}`);
    }
  }

  capabilities(): PluginCapabilities {
    return {
      supportsTransactions: false,
      supportsIndexes: true,
      supportsUniqueConstraints: true,
      supportsNestedDocuments: true,
      supportsFullTextSearch: true,
      supportsVectorSearch: false,
      supportsTTL: true,
    };
  }

  // Helper mapper mapping AST operators to native Mongo `$gt`, `$in` queries
  private buildMongoFilter(ast: QueryAST): Filter<any> {
    if (!ast.filters?.conditions?.length) return {};

    const clauses: any[] = [];

    for (const comp of ast.filters.conditions) {
      let field = (comp as any).field;
      const val = (comp as any).value;
      const op = (comp as any).op ?? 'EQ';

      if (!field) continue;
      if (field === 'id') field = '_id'; // Translation to generic Native ID

      let operator = '$eq';
      switch (op) {
        case 'EQ': operator = '$eq'; break;
        case 'NEQ': operator = '$ne'; break;
        case 'GT': operator = '$gt'; break;
        case 'LT': operator = '$lt'; break;
        case 'GTE': operator = '$gte'; break;
        case 'LTE': operator = '$lte'; break;
        case 'IN': operator = '$in'; break;
        case 'NIN': operator = '$nin'; break;
        case 'LIKE': 
        case 'REGEX': operator = '$regex'; break;
      }

      if (operator === '$regex') {
        clauses.push({ [field]: { $regex: val } });
      } else {
        clauses.push({ [field]: { [operator]: val } });
      }
    }

    if (clauses.length === 0) return {};
    if (clauses.length === 1) return clauses[0];

    if (ast.filters.logic === 'OR') return { $or: clauses };
    return { $and: clauses };
  }
}

// ─── PLUGIN FACTORY ───
export default function createMongoPlugin(config: PluginConfig = {}): IStoragePlugin {
  return new MongoPlugin(config);
}
