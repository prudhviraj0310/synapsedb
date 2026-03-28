// ──────────────────────────────────────────────────────────────
// SynapseDB — SQL Emitter
// Translates Query AST into parameterized SQL statements.
// ──────────────────────────────────────────────────────────────

import type { QueryAST, FilterGroup, FilterCondition, SortSpec } from '../types.js';

interface SQLOutput {
  text: string;
  values: unknown[];
}

/**
 * Emit a complete SQL statement from a QueryAST.
 */
export function emitSQL(ast: QueryAST, fields: string[]): SQLOutput {
  switch (ast.type) {
    case 'FIND':
    case 'FIND_ONE':
      return emitSelect(ast, fields);
    case 'INSERT':
      return emitInsert(ast, fields);
    case 'UPDATE':
      return emitUpdate(ast, fields);
    case 'DELETE':
      return emitDelete(ast);
    case 'COUNT':
      return emitCount(ast);
    default:
      throw new Error(`SQL emitter does not support operation: ${ast.type}`);
  }
}

function emitSelect(ast: QueryAST, fields: string[]): SQLOutput {
  const values: unknown[] = [];
  let paramIndex = 1;

  // SELECT clause
  const selectFields = ast.projection
    ? ast.projection.filter((f) => fields.includes(f))
    : fields;
  const selectClause = selectFields.length > 0 ? selectFields.map(quoteIdent).join(', ') : '*';

  let sql = `SELECT ${selectClause} FROM ${quoteIdent(ast.collection)}`;

  // WHERE clause
  if (ast.filters) {
    const where = emitFilterGroup(ast.filters, values, () => paramIndex++);
    paramIndex = values.length + 1;
    if (where) {
      sql += ` WHERE ${where}`;
    }
  }

  // ORDER BY
  if (ast.sort && ast.sort.length > 0) {
    sql += ` ORDER BY ${emitSort(ast.sort)}`;
  }

  // LIMIT / OFFSET
  if (ast.limit !== undefined) {
    sql += ` LIMIT $${paramIndex++}`;
    values.push(ast.limit);
  }

  if (ast.type === 'FIND_ONE' && ast.limit === undefined) {
    sql += ` LIMIT $${paramIndex++}`;
    values.push(1);
  }

  if (ast.offset !== undefined) {
    sql += ` OFFSET $${paramIndex++}`;
    values.push(ast.offset);
  }

  return { text: sql, values };
}

function emitInsert(ast: QueryAST, fields: string[]): SQLOutput {
  const docs = Array.isArray(ast.data) ? ast.data : [ast.data];
  if (!docs.length || !docs[0]) {
    throw new Error('INSERT requires at least one document');
  }

  const values: unknown[] = [];
  let paramIndex = 1;

  // Only include fields that belong to this plugin
  const insertFields = Object.keys(docs[0]).filter((f) => fields.includes(f));
  const columns = insertFields.map(quoteIdent).join(', ');

  const rowPlaceholders = docs.map((doc) => {
    const placeholders = insertFields.map((f) => {
      values.push(doc![f]);
      return `$${paramIndex++}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  const sql = `INSERT INTO ${quoteIdent(ast.collection)} (${columns}) VALUES ${rowPlaceholders.join(', ')} RETURNING *`;

  return { text: sql, values };
}

function emitUpdate(ast: QueryAST, fields: string[]): SQLOutput {
  if (!ast.updates || Object.keys(ast.updates).length === 0) {
    throw new Error('UPDATE requires at least one field to update');
  }

  const values: unknown[] = [];
  let paramIndex = 1;

  // SET clause — only update fields owned by this plugin
  const setClauses: string[] = [];
  for (const [field, value] of Object.entries(ast.updates)) {
    if (fields.includes(field)) {
      setClauses.push(`${quoteIdent(field)} = $${paramIndex++}`);
      values.push(value);
    }
  }

  if (setClauses.length === 0) {
    throw new Error('No fields to update belong to this plugin');
  }

  let sql = `UPDATE ${quoteIdent(ast.collection)} SET ${setClauses.join(', ')}`;

  // WHERE clause
  if (ast.filters) {
    const where = emitFilterGroup(ast.filters, values, () => paramIndex++);
    if (where) {
      sql += ` WHERE ${where}`;
    }
  }

  return { text: sql, values };
}

function emitDelete(ast: QueryAST): SQLOutput {
  const values: unknown[] = [];
  let paramIndex = 1;

  let sql = `DELETE FROM ${quoteIdent(ast.collection)}`;

  if (ast.filters) {
    const where = emitFilterGroup(ast.filters, values, () => paramIndex++);
    if (where) {
      sql += ` WHERE ${where}`;
    }
  }

  return { text: sql, values };
}

function emitCount(ast: QueryAST): SQLOutput {
  const values: unknown[] = [];
  let paramIndex = 1;

  let sql = `SELECT COUNT(*) as count FROM ${quoteIdent(ast.collection)}`;

  if (ast.filters) {
    const where = emitFilterGroup(ast.filters, values, () => paramIndex++);
    paramIndex = values.length + 1;
    if (where) {
      sql += ` WHERE ${where}`;
    }
  }

  return { text: sql, values };
}

// ─── Filter Emission ─────────────────────────────────────────

function emitFilterGroup(
  group: FilterGroup,
  values: unknown[],
  nextParam: () => number,
): string {
  if (group.conditions.length === 0) {
    return '';
  }

  if (group.logic === 'NOT') {
    const inner = group.conditions[0];
    if (!inner) return '';
    const innerSQL = isFilterGroup(inner)
      ? emitFilterGroup(inner, values, nextParam)
      : emitCondition(inner, values, nextParam);
    return `NOT (${innerSQL})`;
  }

  const parts = group.conditions
    .map((c) => {
      if (isFilterGroup(c)) {
        return `(${emitFilterGroup(c, values, nextParam)})`;
      }
      return emitCondition(c, values, nextParam);
    })
    .filter((p) => p !== '');

  return parts.join(` ${group.logic} `);
}

function emitCondition(
  condition: FilterCondition,
  values: unknown[],
  nextParam: () => number,
): string {
  const field = quoteIdent(condition.field);
  const paramIdx = nextParam();

  switch (condition.op) {
    case 'EQ':
      if (condition.value === null) {
        return `${field} IS NULL`;
      }
      values.push(condition.value);
      return `${field} = $${paramIdx}`;

    case 'NEQ':
      if (condition.value === null) {
        return `${field} IS NOT NULL`;
      }
      values.push(condition.value);
      return `${field} != $${paramIdx}`;

    case 'GT':
      values.push(condition.value);
      return `${field} > $${paramIdx}`;

    case 'GTE':
      values.push(condition.value);
      return `${field} >= $${paramIdx}`;

    case 'LT':
      values.push(condition.value);
      return `${field} < $${paramIdx}`;

    case 'LTE':
      values.push(condition.value);
      return `${field} <= $${paramIdx}`;

    case 'IN':
      values.push(condition.value);
      return `${field} = ANY($${paramIdx})`;

    case 'NIN':
      values.push(condition.value);
      return `${field} != ALL($${paramIdx})`;

    case 'LIKE':
      values.push(condition.value);
      return `${field} LIKE $${paramIdx}`;

    case 'REGEX':
      values.push(condition.value);
      return `${field} ~ $${paramIdx}`;

    case 'EXISTS':
      return condition.value ? `${field} IS NOT NULL` : `${field} IS NULL`;

    default:
      throw new Error(`Unknown comparison operator: ${condition.op}`);
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function emitSort(specs: SortSpec[]): string {
  return specs.map((s) => `${quoteIdent(s.field)} ${s.direction}`).join(', ');
}

function quoteIdent(name: string): string {
  // Escape double quotes and wrap in double quotes for PostgreSQL
  return `"${name.replace(/"/g, '""')}"`;
}

function isFilterGroup(c: FilterCondition | FilterGroup): c is FilterGroup {
  return 'logic' in c;
}
