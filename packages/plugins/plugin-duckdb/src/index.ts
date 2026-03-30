// ──────────────────────────────────────────────────────────────
// @synapsedb/plugin-duckdb
// DuckDB Columnar Analytics Engine for SynapseDB Data OS.
// Provides OLAP query execution for analytical workloads.
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

export class DuckDBPlugin implements IStoragePlugin {
  readonly name = 'duckdb';
  readonly type: StorageType = 'sql';

  private db: any = null;
  private logger: Logger | null = null;

  constructor(_config: PluginConfig) {}

  async connect(config: PluginConfig, logger: Logger): Promise<void> {
    this.logger = logger;

    try {
      const duckdb = await import('duckdb');
      const dbPath = config.options?.path as string || ':memory:';
      this.db = new duckdb.Database(dbPath);
      this.logger?.info(`DuckDB connected: ${dbPath}`);
    } catch (err: any) {
      this.logger?.warn(`DuckDB connection failed: ${err.message}. Running in stub mode.`);
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
    return { healthy: true, latencyMs: Date.now() - start, message: 'DuckDB OK' };
  }

  capabilities(): PluginCapabilities {
    return {
      supportsTransactions: false,
      supportsFullTextSearch: false,
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
        let sqlType = 'VARCHAR';
        if (desc.type === 'integer' || desc.type === 'number') sqlType = 'DOUBLE';
        if (desc.type === 'boolean') sqlType = 'BOOLEAN';
        if (desc.type === 'timestamp' || desc.type === 'date') sqlType = 'TIMESTAMP';
        if (desc.type === 'uuid') sqlType = 'VARCHAR';
        if (desc.type === 'json') sqlType = 'JSON';
        return `"${name}" ${sqlType}`;
      })
      .join(', ');

    const sql = `CREATE TABLE IF NOT EXISTS "${manifest.name}" (${fields})`;
    await this.runQuery(sql);
    this.logger?.info(`DuckDB: ensured table "${manifest.name}"`);
  }

  async execute(ast: QueryAST, manifest: CollectionManifest): Promise<any> {
    if (!this.db) return { success: false, data: [], meta: { took: 0, routedTo: ['duckdb'] } };

    const start = Date.now();
    switch (ast.type) {
      case 'FIND':
      case 'FIND_ONE': {
        const rows = await this.runQuery(`SELECT * FROM "${ast.collection}" LIMIT ${ast.limit ?? 100}`);
        return { success: true, data: rows, meta: { took: Date.now() - start, routedTo: ['duckdb'] } };
      }
      case 'INSERT': {
        const docs = Array.isArray(ast.data) ? ast.data : [ast.data];
        for (const doc of docs ?? []) {
          const cols = Object.keys(doc).map(c => `"${c}"`).join(', ');
          const vals = Object.values(doc).map(v => typeof v === 'string' ? `'${v}'` : v).join(', ');
          await this.runQuery(`INSERT INTO "${ast.collection}" (${cols}) VALUES (${vals})`);
        }
        return { success: true, data: { insertedCount: docs?.length ?? 0, insertedIds: [] }, meta: { took: Date.now() - start, routedTo: ['duckdb'] } };
      }
      case 'COUNT': {
        const result = await this.runQuery(`SELECT COUNT(*) as cnt FROM "${ast.collection}"`);
        return { success: true, data: { count: result[0]?.cnt ?? 0 }, meta: { took: Date.now() - start, routedTo: ['duckdb'] } };
      }
      default:
        return { success: true, data: null, meta: { took: Date.now() - start, routedTo: ['duckdb'] } };
    }
  }

  private runQuery(sql: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) return resolve([]);
      this.db.all(sql, (err: any, rows: any[]) => {
        if (err) reject(err); else resolve(rows ?? []);
      });
    });
  }
}

export default DuckDBPlugin;
