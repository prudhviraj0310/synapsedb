// ──────────────────────────────────────────────────────────────
// @synapsedb/plugin-sqlite
// SQLite Zero-Dependency Local Adapter for SynapseDB Data OS.
// Allows full engine operation without Docker or cloud databases.
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

export class SQLitePlugin implements IStoragePlugin {
  readonly name = 'sqlite';
  readonly type: StorageType = 'sql';

  private db: any = null;
  private logger: Logger | null = null;

  constructor(_config: PluginConfig) {}

  async connect(config: PluginConfig, logger: Logger): Promise<void> {
    this.logger = logger;

    try {
      const Database = (await import('better-sqlite3')).default;
      const dbPath = (config.options?.path as string) || '.synapse-data/local.db';
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      this.logger?.info(`SQLite connected: ${dbPath}`);
    } catch (err: any) {
      this.logger?.warn(`SQLite connection failed: ${err.message}. Running in stub mode.`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.db) return { healthy: false, latencyMs: -1, message: 'Not connected' };
    const start = Date.now();
    try {
      this.db.prepare('SELECT 1').get();
      return { healthy: true, latencyMs: Date.now() - start, message: 'SQLite OK' };
    } catch {
      return { healthy: false, latencyMs: -1, message: 'SQLite query failed' };
    }
  }

  capabilities(): PluginCapabilities {
    return {
      supportsTransactions: true,
      supportsFullTextSearch: true,
      supportsVectorSearch: false,
      supportsNestedDocuments: false,
      supportsTTL: false,
      supportsIndexes: true,
      supportsUniqueConstraints: true,
    };
  }

  async syncSchema(manifest: CollectionManifest, fields: Record<string, FieldDescriptor>): Promise<void> {
    if (!this.db) return;

    const columnDefs = Object.entries(manifest.fields)
      .map(([name, desc]) => {
        let sqlType = 'TEXT';
        if (desc.type === 'integer') sqlType = 'INTEGER';
        if (desc.type === 'number' || desc.type === 'float') sqlType = 'REAL';
        if (desc.type === 'boolean') sqlType = 'INTEGER';
        if (desc.type === 'json') sqlType = 'TEXT';
        if (desc.type === 'uuid') sqlType = 'TEXT';
        if (desc.type === 'timestamp' || desc.type === 'date') sqlType = 'TEXT';

        let constraints = '';
        if (desc.primary) constraints += ' PRIMARY KEY';
        if (desc.unique) constraints += ' UNIQUE';
        if (desc.required) constraints += ' NOT NULL';

        return `"${name}" ${sqlType}${constraints}`;
      })
      .join(', ');

    this.db.exec(`CREATE TABLE IF NOT EXISTS "${manifest.name}" (${columnDefs})`);

    // Create indexes on indexed fields
    for (const [name, desc] of Object.entries(manifest.fields)) {
      if (desc.indexed && !desc.primary) {
        this.db.exec(`CREATE INDEX IF NOT EXISTS "idx_${manifest.name}_${name}" ON "${manifest.name}" ("${name}")`);
      }
    }

    this.logger?.info(`SQLite: ensured table "${manifest.name}"`);
  }

  async insert(collection: string, docs: Document[], fields: string[]): Promise<InsertResult> {
    if (!this.db || !docs.length) return { insertedCount: 0, insertedIds: [] };

    const insertedIds: string[] = [];
    for (const doc of docs) {
      if (!doc) continue;
      // Only insert fields routed to this plugin + primary key
      const docFields = Object.keys(doc).filter(k => fields.includes(k) || k === 'id' || k === '_id');
      if (!docFields.length) continue;

      const cols = docFields.map(c => `"${c}"`).join(', ');
      const placeholders = docFields.map(() => '?').join(', ');
      const values = docFields.map(k => doc[k]);

      this.db.prepare(`INSERT INTO "${collection}" (${cols}) VALUES (${placeholders})`).run(...values);
      insertedIds.push(String(doc.id || doc._id || 'auto'));
    }

    return { insertedCount: insertedIds.length, insertedIds };
  }

  async find(collection: string, query: QueryAST, fields: string[]): Promise<Document[]> {
    if (!this.db) return [];

    let sql = `SELECT * FROM "${collection}"`;
    const params: any[] = [];

    if (query.filters && query.filters.conditions.length > 0) {
      const whereClauses = query.filters.conditions.map((cond: any) => {
        params.push(cond.value);
        return `"${cond.field}" = ?`;
      });
      sql += ` WHERE ${whereClauses.join(` ${query.filters.logic || 'AND'} `)}`;
    }

    if (query.sort && query.sort.length > 0) {
      sql += ` ORDER BY ${query.sort.map((s: any) => `"${s.field}" ${s.direction}`).join(', ')}`;
    }

    sql += ` LIMIT ${query.limit ?? 100}`;
    if (query.offset) sql += ` OFFSET ${query.offset}`;

    return this.db.prepare(sql).all(...params) as Document[];
  }

  async findOne(collection: string, query: QueryAST, fields: string[]): Promise<Document | null> {
    const rows = await this.find(collection, { ...query, limit: 1 }, fields);
    return rows[0] || null;
  }

  async update(collection: string, query: QueryAST, changes: Record<string, unknown>, fields: string[]): Promise<UpdateResult> {
    if (!this.db || !query.filters) return { matchedCount: 0, modifiedCount: 0 };
    
    const updateFields = Object.keys(changes).filter(k => fields.includes(k));
    if (!updateFields.length) return { matchedCount: 0, modifiedCount: 0 };

    const setClauses = updateFields.map(k => `"${k}" = ?`).join(', ');
    const setValues = updateFields.map(k => changes[k]);
    
    const whereClauses = (query.filters.conditions as any[]).map((c: any) => `"${c.field}" = ?`);
    const whereValues = (query.filters.conditions as any[]).map((c: any) => c.value);

    const result = this.db.prepare(
      `UPDATE "${collection}" SET ${setClauses} WHERE ${whereClauses.join(' AND ')}`
    ).run(...setValues, ...whereValues);

    return { matchedCount: result.changes, modifiedCount: result.changes };
  }

  async delete(collection: string, query: QueryAST): Promise<DeleteResult> {
    if (!this.db || !query.filters) return { deletedCount: 0 };
    
    const whereClauses = (query.filters.conditions as any[]).map((c: any) => `"${c.field}" = ?`);
    const whereValues = (query.filters.conditions as any[]).map((c: any) => c.value);

    const result = this.db.prepare(
      `DELETE FROM "${collection}" WHERE ${whereClauses.join(' AND ')}`
    ).run(...whereValues);

    return { deletedCount: result.changes };
  }
}

export default function createSQLitePlugin(config: PluginConfig): IStoragePlugin {
  return new SQLitePlugin(config);
}
