// ──────────────────────────────────────────────────────────────
// SynapseDB — Redis Emitter
// Translates Query AST into Redis command sequences.
// ──────────────────────────────────────────────────────────────

import type { QueryAST, FilterCondition, FilterGroup } from '../types.js';

export interface RedisCommand {
  command: string;
  args: (string | number)[];
}

export interface RedisOutput {
  commands: RedisCommand[];
  keyPattern: string;
  ttl?: number;
}

/**
 * Key naming convention for Redis:
 * - Hash: `{collection}:{id}` — stores all cached fields for a document
 * - Set index: `{collection}:idx:{field}:{value}` — secondary index
 * - TTL: applied per-key
 */

/**
 * Emit Redis commands from a QueryAST.
 */
export function emitRedis(
  ast: QueryAST,
  fields: string[],
  ttl?: number,
): RedisOutput {
  switch (ast.type) {
    case 'INSERT':
      return emitRedisInsert(ast, fields, ttl);
    case 'FIND':
    case 'FIND_ONE':
      return emitRedisFind(ast, fields);
    case 'UPDATE':
      return emitRedisUpdate(ast, fields, ttl);
    case 'DELETE':
      return emitRedisDelete(ast);
    default:
      throw new Error(`Redis emitter does not support operation: ${ast.type}`);
  }
}

function emitRedisInsert(ast: QueryAST, fields: string[], ttl?: number): RedisOutput {
  const docs = Array.isArray(ast.data) ? ast.data : [ast.data];
  const commands: RedisCommand[] = [];

  for (const doc of docs) {
    if (!doc) continue;

    const id = doc['id'] ?? doc['_id'];
    if (!id) continue;

    const key = `${ast.collection}:${id}`;

    // Store cached fields as hash
    const hashFields: (string | number)[] = [];
    for (const [k, v] of Object.entries(doc)) {
      if (fields.includes(k) || k === 'id' || k === '_id') {
        hashFields.push(k, serializeValue(v));
      }
    }

    if (hashFields.length > 0) {
      commands.push({ command: 'HSET', args: [key, ...hashFields] });

      // Set TTL if configured
      if (ttl && ttl > 0) {
        commands.push({ command: 'EXPIRE', args: [key, ttl] });
      }
    }
  }

  return {
    commands,
    keyPattern: `${ast.collection}:*`,
    ttl,
  };
}

function emitRedisFind(ast: QueryAST, fields: string[]): RedisOutput {
  const commands: RedisCommand[] = [];

  // If we have a direct ID lookup
  const idFilter = extractIdFromFilters(ast.filters);

  if (idFilter) {
    const key = `${ast.collection}:${idFilter}`;

    if (fields.length > 0) {
      commands.push({ command: 'HMGET', args: [key, ...fields] });
    } else {
      commands.push({ command: 'HGETALL', args: [key] });
    }
  } else {
    // Scan-based lookup (less efficient, but functional)
    commands.push({
      command: 'SCAN',
      args: [0, 'MATCH', `${ast.collection}:*`, 'COUNT', 100],
    });
  }

  return {
    commands,
    keyPattern: `${ast.collection}:*`,
  };
}

function emitRedisUpdate(
  ast: QueryAST,
  fields: string[],
  ttl?: number,
): RedisOutput {
  const commands: RedisCommand[] = [];
  const idFilter = extractIdFromFilters(ast.filters);

  if (idFilter && ast.updates) {
    const key = `${ast.collection}:${idFilter}`;

    const hashFields: (string | number)[] = [];
    for (const [k, v] of Object.entries(ast.updates)) {
      if (fields.includes(k)) {
        hashFields.push(k, serializeValue(v));
      }
    }

    if (hashFields.length > 0) {
      commands.push({ command: 'HSET', args: [key, ...hashFields] });

      if (ttl && ttl > 0) {
        commands.push({ command: 'EXPIRE', args: [key, ttl] });
      }
    }
  }

  return {
    commands,
    keyPattern: `${ast.collection}:*`,
    ttl,
  };
}

function emitRedisDelete(ast: QueryAST): RedisOutput {
  const commands: RedisCommand[] = [];
  const idFilter = extractIdFromFilters(ast.filters);

  if (idFilter) {
    commands.push({
      command: 'DEL',
      args: [`${ast.collection}:${idFilter}`],
    });
  }

  return {
    commands,
    keyPattern: `${ast.collection}:*`,
  };
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Extract a direct ID value from filters (for O(1) key lookup).
 */
function extractIdFromFilters(filters?: FilterGroup): string | null {
  if (!filters) return null;

  for (const cond of filters.conditions) {
    if (!isFilterGroup(cond)) {
      if ((cond.field === 'id' || cond.field === '_id') && cond.op === 'EQ') {
        return String(cond.value);
      }
    }
  }

  return null;
}

function serializeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function isFilterGroup(c: FilterCondition | FilterGroup): c is FilterGroup {
  return 'logic' in c;
}
