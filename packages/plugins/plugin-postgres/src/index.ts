// ──────────────────────────────────────────────────────────────
// SynapseDB — PostgreSQL Storage Plugin
// Implements IStoragePlugin for PostgreSQL via `pg` driver.
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
import type { IStoragePlugin } from '@synapsedb/core/plugin/contract';

// We use dynamic imports to avoid hard dependency
let pg: typeof import('pg') | null = null;

type Pool = InstanceType<typeof import('pg').Pool>;

/**
 * PostgresPlugin — SQL Master Plugin
 *
 * Handles strict, transactional data with ACID guarantees.
 * Automatically creates tables and indexes from manifests.
 */
export class PostgresPlugin implements IStoragePlugin {
  readonly name = 'postgres';
  readonly type: StorageType = 'sql';

  private pool: Pool | null = null;
  private logger: Logger | null = null;

  async connect(config: PluginConfig, logger: Logger): Promise<void> {
    this.logger = logger;

    try {
      pg = await import('pg');
    } catch {
      throw new Error('PostgreSQL driver not found. Install it with: npm install pg');
    }

    this.pool = new pg.Pool({
      connectionString: config.connectionUri,
      host: config.host ?? 'localhost',
      port: config.port ?? 5432,
      database: config.database ?? 'omnidb',
      user: config.username,
      password: config.password,
      min: config.pool?.min ?? 2,
      max: config.pool?.max ?? 10,
      idleTimeoutMillis: config.pool?.idleTimeoutMs ?? 30000,
    });

    // Test connection
    const client = await this.pool.connect();
    client.release();
    logger.info('PostgreSQL connected');
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
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async syncSchema(manifest: CollectionManifest, fields: string[]): Promise<void> {
    if (!this.pool) throw new Error('Not connected');

    const columns = fields
      .map((fieldName) => {
        const desc = manifest.fields[fieldName];
        if (!desc) return null;
        return `  "${fieldName}" ${mapFieldToSQL(fieldName, desc)}`;
      })
      .filter(Boolean);

    // Always include id column
    const hasIdColumn = fields.some((f) => {
      const desc = manifest.fields[f];
      return desc?.primary;
    });

    if (!hasIdColumn) {
      columns.unshift('  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid()');
    }

    // Add timestamp columns if configured
    if (manifest.options?.timestamps) {
      columns.push('  "createdAt" TIMESTAMPTZ DEFAULT NOW()');
      columns.push('  "updatedAt" TIMESTAMPTZ DEFAULT NOW()');
    }

    const createSQL = `CREATE TABLE IF NOT EXISTS "${manifest.name}" (\n${columns.join(',\n')}\n)`;

    await this.pool.query(createSQL);

    // Create indexes
    for (const fieldName of fields) {
      const desc = manifest.fields[fieldName];
      if (!desc) continue;

      if (desc.indexed && !desc.primary && !desc.unique) {
        await this.pool.query(
          `CREATE INDEX IF NOT EXISTS "idx_${manifest.name}_${fieldName}" ON "${manifest.name}" ("${fieldName}")`,
        );
      }

      if (desc.unique && !desc.primary) {
        await this.pool.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS "udx_${manifest.name}_${fieldName}" ON "${manifest.name}" ("${fieldName}")`,
        );
      }
    }

    this.logger?.info(`Schema synced for table: ${manifest.name}`);
  }

  async insert(collection: string, docs: Document[], fields: string[]): Promise<InsertResult> {
    if (!this.pool) throw new Error('Not connected');
    if (docs.length === 0) return { insertedCount: 0, insertedIds: [] };

    const insertFields = fields.filter((f) => docs[0]![f] !== undefined);

    // Always include id if present
    if (docs[0]!['id'] !== undefined && !insertFields.includes('id')) {
      insertFields.unshift('id');
    }

    const values: unknown[] = [];
    let paramIdx = 1;

    const rowPlaceholders = docs.map((doc) => {
      const placeholders = insertFields.map((f) => {
        const value = doc[f];
        values.push(typeof value === 'object' && value !== null && !Array.isArray(value)
          ? JSON.stringify(value)
          : value);
        return `$${paramIdx++}`;
      });
      return `(${placeholders.join(', ')})`;
    });

    const columns = insertFields.map((f) => `"${f}"`).join(', ');
    const sql = `INSERT INTO "${collection}" (${columns}) VALUES ${rowPlaceholders.join(', ')} RETURNING "id"`;

    const result = await this.pool.query(sql, values);
    const insertedIds = result.rows.map((row: Record<string, unknown>) => String(row['id']));

    return {
      insertedCount: result.rowCount ?? docs.length,
      insertedIds,
    };
  }

  async find(collection: string, query: QueryAST, fields: string[]): Promise<Document[]> {
    if (!this.pool) throw new Error('Not connected');

    // Dynamic import of emitter to avoid circular deps
    const { emitSQL } = await import('@synapsedb/core/compiler/sql-emitter');
    const sql = emitSQL(query, fields);

    const result = await this.pool.query(sql.text, sql.values);
    return result.rows as Document[];
  }

  async findOne(collection: string, query: QueryAST, fields: string[]): Promise<Document | null> {
    const onceQuery = { ...query, type: 'FIND_ONE' as const };
    const results = await this.find(collection, onceQuery, fields);
    return results[0] ?? null;
  }

  async update(
    collection: string,
    query: QueryAST,
    changes: Record<string, unknown>,
    fields: string[],
  ): Promise<UpdateResult> {
    if (!this.pool) throw new Error('Not connected');

    const { emitSQL } = await import('@synapsedb/core/compiler/sql-emitter');
    const updateAST: QueryAST = { ...query, type: 'UPDATE', updates: changes };
    const sql = emitSQL(updateAST, fields);

    const result = await this.pool.query(sql.text, sql.values);

    return {
      matchedCount: result.rowCount ?? 0,
      modifiedCount: result.rowCount ?? 0,
    };
  }

  async delete(collection: string, query: QueryAST): Promise<DeleteResult> {
    if (!this.pool) throw new Error('Not connected');

    const { emitSQL } = await import('@synapsedb/core/compiler/sql-emitter');
    const deleteAST: QueryAST = { ...query, type: 'DELETE' };
    const sql = emitSQL(deleteAST, []);

    const result = await this.pool.query(sql.text, sql.values);

    return {
      deletedCount: result.rowCount ?? 0,
    };
  }

  capabilities(): PluginCapabilities {
    return {
      supportsTransactions: true,
      supportsFullTextSearch: false,
      supportsVectorSearch: false,
      supportsNestedDocuments: false,
      supportsTTL: false,
      supportsIndexes: true,
      supportsUniqueConstraints: true,
    };
  }
}

// ─── SQL Type Mapping ────────────────────────────────────────

function mapFieldToSQL(fieldName: string, desc: FieldDescriptor): string {
  let sql = '';

  switch (desc.type) {
    case 'uuid':
      sql = 'UUID';
      if (desc.primary) sql += ' PRIMARY KEY DEFAULT gen_random_uuid()';
      break;
    case 'string':
      sql = 'VARCHAR(255)';
      break;
    case 'text':
      sql = 'TEXT';
      break;
    case 'number':
    case 'float':
      sql = 'DOUBLE PRECISION';
      break;
    case 'integer':
      sql = 'INTEGER';
      break;
    case 'boolean':
      sql = 'BOOLEAN';
      break;
    case 'timestamp':
      sql = 'TIMESTAMPTZ';
      if (desc.auto) sql += ' DEFAULT NOW()';
      break;
    case 'date':
      sql = 'DATE';
      break;
    case 'json':
      sql = 'JSONB';
      break;
    case 'array':
      sql = 'JSONB'; // Store arrays as JSONB
      break;
    case 'binary':
      sql = 'BYTEA';
      break;
    default:
      sql = 'TEXT';
  }

  if (desc.required && !desc.primary) {
    sql += ' NOT NULL';
  }

  if (desc.unique && !desc.primary) {
    sql += ' UNIQUE';
  }

  if (desc.default !== undefined && !desc.auto) {
    sql += ` DEFAULT ${formatDefault(desc.default)}`;
  }

  return sql;
}

function formatDefault(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value === null) return 'NULL';
  return String(value);
}

export default function createPostgresPlugin(): PostgresPlugin {
  return new PostgresPlugin();
}
