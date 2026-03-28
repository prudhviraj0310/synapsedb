// ──────────────────────────────────────────────────────────────
// @synapsedb/plugin-postgres
// The official PostgreSQL driver for SynapseDB Data OS.
// Connects the core orchestration engine to a real PostgreSQL Pool.
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
  FieldDescriptor,
} from '@synapsedb/core/types';
import type { IStoragePlugin } from '@synapsedb/core';
import { SynapseError } from '@synapsedb/core';
import pg from 'pg';

export class PostgresPlugin implements IStoragePlugin {
  readonly name = 'postgres';
  readonly type: StorageType = 'sql';

  private pool: pg.Pool | null = null;
  private logger: Logger | null = null;
  private config: PluginConfig;

  constructor(config: PluginConfig) {
    this.config = config;
  }

  async connect(config: PluginConfig, logger: Logger): Promise<void> {
    this.logger = logger;
    this.config = { ...this.config, ...config };

    try {
      this.pool = new pg.Pool({
        connectionString: this.config.connectionUri,
        host: this.config.host ?? 'localhost',
        port: this.config.port ?? 5432,
        database: this.config.database ?? 'postgres',
        user: this.config.username,
        password: this.config.password,
        max: 10,
        idleTimeoutMillis: 30000,
        ssl: (this.config as any).ssl ? { rejectUnauthorized: false } : undefined,
      });

      // Test connection
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      this.logger?.info('PostgreSQL connected successfully.');
    } catch (err: any) {
      throw new SynapseError('PLUGIN_CONNECTION_FAILED', err.message);
    }
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    if (!this.pool) {
      return { healthy: false, latencyMs: -1, message: 'Not connected' };
    }

    const start = Date.now();
    try {
      await this.pool.query('SELECT 1');
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
    if (!this.pool) throw new SynapseError('PLUGIN_CONNECTION_FAILED', 'Not connected');

    const columns = fields
      .map((fieldName) => {
        const desc = manifest.fields[fieldName];
        if (!desc) return null;
        let colDef = `"${fieldName}" ${mapFieldToSQL(fieldName, desc)}`;
        if (desc.primary) colDef += ' PRIMARY KEY';
        if (desc.unique) colDef += ' UNIQUE';
        if (desc.required && !desc.primary) colDef += ' NOT NULL';
        return colDef;
      })
      .filter(Boolean)
      .join(',\n  ');

    if (!columns) return;

    const sql = `
CREATE TABLE IF NOT EXISTS "${manifest.name}" (
  ${columns}
);`;

    try {
      await this.pool.query(sql);
      this.logger?.debug(`Synced schema for table: ${manifest.name}`);
    } catch (err: any) {
      throw new SynapseError('PLUGIN_QUERY_FAILED', `Failed to sync schema: ${err.message}`);
    }
  }

  async insert(collection: string, docs: Document[], fields: string[]): Promise<InsertResult> {
    if (!this.pool) throw new SynapseError('PLUGIN_CONNECTION_FAILED', 'Not connected');
    if (docs.length === 0 || fields.length === 0) {
      return { insertedCount: 0, insertedIds: [] };
    }

    // Parameterized batch insert
    const values: any[] = [];
    const placeholders: string[] = [];

    const fieldNames = fields.map((f) => `"${f}"`).join(', ');
    let paramIndex = 1;

    for (const doc of docs) {
      const docPlaceholders: string[] = [];
      for (const field of fields) {
        values.push(doc[field] ?? null);
        docPlaceholders.push(`$${paramIndex++}`);
      }
      placeholders.push(`(${docPlaceholders.join(', ')})`);
    }

    const sql = `INSERT INTO "${collection}" (${fieldNames}) VALUES ${placeholders.join(', ')} RETURNING id`;

    try {
      const result = await this.pool.query(sql, values);
      return {
        insertedCount: result.rowCount ?? 0,
        insertedIds: result.rows.map((r) => String(r.id)),
      };
    } catch (err: any) {
      // Catch idempotency duplicates (Postgres unique violation is 23505)
      if (err.code === '23505') {
        const ids = docs.map((d) => String(d.id));
        this.logger?.warn(`Idempotency hit: Documents ${ids.join(',')} already exist in PostgreSQL`);
        return { insertedCount: 0, insertedIds: ids };
      }
      throw new SynapseError('PLUGIN_QUERY_FAILED', `Insert failed: ${err.message}`);
    }
  }

  async find(collection: string, ast: QueryAST, fields: string[]): Promise<Document[]> {
    if (!this.pool) throw new SynapseError('PLUGIN_CONNECTION_FAILED', 'Not connected');

    const selectFields = fields.length > 0 ? fields.map((f) => `"${f}"`).join(', ') : '*';
    const { where, values } = this.buildWhereClause(ast);

    let sql = `SELECT ${selectFields} FROM "${collection}"`;
    if (where) sql += ` WHERE ${where}`;

    // Order By
    if (ast.sort) {
      const sorts = ast.sort.map((s) => `"${s.field}" ${s.direction}`);
      if (sorts.length > 0) sql += ` ORDER BY ${sorts.join(', ')}`;
    }

    // Limit and Offset
    if (ast.limit) {
      sql += ` LIMIT $${values.length + 1}`;
      values.push(ast.limit);
    }
    if (ast.offset) {
      sql += ` OFFSET $${values.length + 1}`;
      values.push(ast.offset);
    }

    try {
      const result = await this.pool.query(sql, values);
      return result.rows;
    } catch (err: any) {
      throw new SynapseError('PLUGIN_QUERY_FAILED', `Find failed: ${err.message}`);
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
    if (!this.pool) throw new SynapseError('PLUGIN_CONNECTION_FAILED', 'Not connected');

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const field of fields) {
      if (field in changes) {
        setClauses.push(`"${field}" = $${paramIndex++}`);
        values.push(changes[field]);
      }
    }

    if (setClauses.length === 0) return { matchedCount: 0, modifiedCount: 0 };

    const { where, values: whereValues } = this.buildWhereClause(ast, paramIndex);
    values.push(...whereValues);

    let sql = `UPDATE "${collection}" SET ${setClauses.join(', ')}`;
    if (where) sql += ` WHERE ${where}`;

    try {
      const result = await this.pool.query(sql, values);
      return {
        matchedCount: result.rowCount ?? 0,
        modifiedCount: result.rowCount ?? 0,
      };
    } catch (err: any) {
      throw new SynapseError('PLUGIN_QUERY_FAILED', `Update failed: ${err.message}`);
    }
  }

  async delete(collection: string, ast: QueryAST): Promise<DeleteResult> {
    if (!this.pool) throw new SynapseError('PLUGIN_CONNECTION_FAILED', 'Not connected');

    const { where, values } = this.buildWhereClause(ast);
    let sql = `DELETE FROM "${collection}"`;
    if (where) sql += ` WHERE ${where}`;

    try {
      const result = await this.pool.query(sql, values);
      return {
        deletedCount: result.rowCount ?? 0,
      };
    } catch (err: any) {
      throw new SynapseError('PLUGIN_QUERY_FAILED', `Delete failed: ${err.message}`);
    }
  }

  capabilities(): PluginCapabilities {
    return {
      supportsTransactions: true,
      supportsIndexes: true,
      supportsUniqueConstraints: true,
      supportsNestedDocuments: true, // we use JSONB
      supportsFullTextSearch: false,
      supportsVectorSearch: false,
      supportsTTL: false,
    };
  }

  // Helper to map QueryAST Filters to SQL WHERE clauses
  private buildWhereClause(ast: QueryAST, startIndex: number = 1): { where: string; values: any[] } {
    const values: any[] = [];
    let where = '';

    if (!ast.filters?.conditions?.length) return { where, values };

    const clauses: string[] = [];
    let idx = startIndex;

    for (const comp of ast.filters.conditions) {
      // Type asserting as the AST runtime guarantees field/value properties based on schema logic
      const field = (comp as any).field;
      const val = (comp as any).value;
      const op = (comp as any).operator ?? 'eq';

      if (!field) continue;

      let sqlOp = '=';
      switch (op) {
        case 'EQ':
          sqlOp = '=';
          break;
        case 'GT':
          sqlOp = '>';
          break;
        case 'LT':
          sqlOp = '<';
          break;
        case 'GTE':
          sqlOp = '>=';
          break;
        case 'LTE':
          sqlOp = '<=';
          break;
        case 'IN':
          sqlOp = 'IN';
          break;
      }

      if (op === 'IN' && Array.isArray(val)) {
        const inVars = val.map(() => `$${idx++}`).join(', ');
        clauses.push(`"${field}" IN (${inVars})`);
        values.push(...val);
      } else {
        clauses.push(`"${field}" ${sqlOp} $${idx++}`);
        values.push(val);
      }
    }

    if (clauses.length > 0) {
      where = clauses.join(ast.filters.logic === 'OR' ? ' OR ' : ' AND ');
    }

    return { where, values };
  }
}

// Map logical intent to Postgres Data Types
function mapFieldToSQL(fieldName: string, desc: FieldDescriptor): string {
  if (fieldName === 'id') return 'UUID';
  switch (desc.type) {
    case 'string':
      return 'TEXT';
    case 'uuid':
      return 'UUID';
    case 'integer':
      return 'INTEGER';
    case 'float':
      return 'DOUBLE PRECISION';
    case 'boolean':
      return 'BOOLEAN';
    case 'date':
      return 'TIMESTAMP WITH TIME ZONE';
    case 'json':
    case 'array':
      return 'JSONB';
    default:
      return 'TEXT';
  }
}

// ─── PLUGIN FACTORY ───
// Default export pattern requested by Prompt Step 1
export default function createPostgresPlugin(config: PluginConfig): IStoragePlugin {
  return new PostgresPlugin(config);
}
