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

  async ensureCollection(manifest: CollectionManifest): Promise<void> {
    if (!this.db) return;

    const fields = Object.entries(manifest.fields)
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

    this.db.exec(`CREATE TABLE IF NOT EXISTS "${manifest.name}" (${fields})`);

    // Create indexes on indexed fields
    for (const [name, desc] of Object.entries(manifest.fields)) {
      if (desc.indexed && !desc.primary) {
        this.db.exec(`CREATE INDEX IF NOT EXISTS "idx_${manifest.name}_${name}" ON "${manifest.name}" ("${name}")`);
      }
    }

    this.logger?.info(`SQLite: ensured table "${manifest.name}"`);
  }

  async execute(ast: QueryAST, manifest: CollectionManifest): Promise<any> {
    if (!this.db) return { success: false, data: [], meta: { took: 0, routedTo: ['sqlite'] } };

    const start = Date.now();

    switch (ast.type) {
      case 'FIND':
      case 'FIND_ONE': {
        let sql = `SELECT * FROM "${ast.collection}"`;
        const params: any[] = [];

        if (ast.filters && ast.filters.conditions.length > 0) {
          const whereClauses = ast.filters.conditions.map((cond: any) => {
            params.push(cond.value);
            return `"${cond.field}" = ?`;
          });
          sql += ` WHERE ${whereClauses.join(` ${ast.filters.logic || 'AND'} `)}`;
        }

        if (ast.sort && ast.sort.length > 0) {
          sql += ` ORDER BY ${ast.sort.map((s: any) => `"${s.field}" ${s.direction}`).join(', ')}`;
        }

        sql += ` LIMIT ${ast.type === 'FIND_ONE' ? 1 : ast.limit ?? 100}`;
        if (ast.offset) sql += ` OFFSET ${ast.offset}`;

        const rows = this.db.prepare(sql).all(...params);
        const data = ast.type === 'FIND_ONE' ? (rows[0] ?? null) : rows;

        return { success: true, data, meta: { took: Date.now() - start, routedTo: ['sqlite'] } };
      }

      case 'INSERT': {
        const docs = Array.isArray(ast.data) ? ast.data : [ast.data].filter(Boolean);
        const insertedIds: string[] = [];

        for (const doc of docs) {
          if (!doc) continue;
          const cols = Object.keys(doc).map(c => `"${c}"`).join(', ');
          const placeholders = Object.keys(doc).map(() => '?').join(', ');
          const values = Object.values(doc);

          this.db.prepare(`INSERT INTO "${ast.collection}" (${cols}) VALUES (${placeholders})`).run(...values);
          insertedIds.push((doc as any).id ?? 'auto');
        }

        return { success: true, data: { insertedCount: docs.length, insertedIds }, meta: { took: Date.now() - start, routedTo: ['sqlite'] } };
      }

      case 'UPDATE': {
        if (!ast.updates || !ast.filters) break;
        const setClauses = Object.keys(ast.updates).map(k => `"${k}" = ?`).join(', ');
        const setValues = Object.values(ast.updates);
        const whereClauses = (ast.filters.conditions as any[]).map((c: any) => `"${c.field}" = ?`);
        const whereValues = (ast.filters.conditions as any[]).map((c: any) => c.value);

        const result = this.db.prepare(
          `UPDATE "${ast.collection}" SET ${setClauses} WHERE ${whereClauses.join(' AND ')}`
        ).run(...setValues, ...whereValues);

        return { success: true, data: { matchedCount: result.changes, modifiedCount: result.changes }, meta: { took: Date.now() - start, routedTo: ['sqlite'] } };
      }

      case 'DELETE': {
        if (!ast.filters) break;
        const whereClauses = (ast.filters.conditions as any[]).map((c: any) => `"${c.field}" = ?`);
        const whereValues = (ast.filters.conditions as any[]).map((c: any) => c.value);

        const result = this.db.prepare(
          `DELETE FROM "${ast.collection}" WHERE ${whereClauses.join(' AND ')}`
        ).run(...whereValues);

        return { success: true, data: { deletedCount: result.changes }, meta: { took: Date.now() - start, routedTo: ['sqlite'] } };
      }

      case 'COUNT': {
        const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM "${ast.collection}"`).get();
        return { success: true, data: { count: row?.cnt ?? 0 }, meta: { took: Date.now() - start, routedTo: ['sqlite'] } };
      }
    }

    return { success: true, data: null, meta: { took: Date.now() - start, routedTo: ['sqlite'] } };
  }
}

export default SQLitePlugin;
