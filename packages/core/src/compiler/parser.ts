// ──────────────────────────────────────────────────────────────
// SynapseDB — Query AST Parser
// Transforms SDK query objects into the intermediate Query AST.
// ──────────────────────────────────────────────────────────────

import type { QueryAST, FilterGroup, FilterCondition, ComparisonOp, SortSpec } from '../types.js';

/**
 * Operator mapping from SDK shorthand to AST operator.
 */
const OP_MAP: Record<string, ComparisonOp> = {
  $eq: 'EQ',
  $neq: 'NEQ',
  $ne: 'NEQ',
  $gt: 'GT',
  $gte: 'GTE',
  $lt: 'LT',
  $lte: 'LTE',
  $in: 'IN',
  $nin: 'NIN',
  $like: 'LIKE',
  $regex: 'REGEX',
  $exists: 'EXISTS',
};

/**
 * Parse a raw SDK query object into a FilterGroup AST node.
 *
 * Supports MongoDB-style query syntax:
 * - `{ name: 'John' }` → EQ filter
 * - `{ age: { $gt: 21 } }` → GT filter
 * - `{ $or: [{ a: 1 }, { b: 2 }] }` → OR group
 * - `{ $and: [{ a: 1 }, { b: 2 }] }` → AND group
 */
export function parseFilters(query: Record<string, unknown>): FilterGroup {
  const conditions: Array<FilterCondition | FilterGroup> = [];

  for (const [key, value] of Object.entries(query)) {
    // Logical operators
    if (key === '$or' || key === '$and') {
      if (!Array.isArray(value)) {
        throw new Error(`${key} must be an array`);
      }
      const logic = key === '$or' ? 'OR' : 'AND';
      const subConditions = value.map((sub) => parseFilters(sub as Record<string, unknown>));
      conditions.push({
        logic: logic,
        conditions: subConditions,
      } as FilterGroup);
      continue;
    }

    if (key === '$not') {
      conditions.push({
        logic: 'NOT',
        conditions: [parseFilters(value as Record<string, unknown>)],
      } as FilterGroup);
      continue;
    }

    // Field-level conditions
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      // Operator syntax: { age: { $gt: 21 } }
      const valueObj = value as Record<string, unknown>;
      for (const [op, opValue] of Object.entries(valueObj)) {
        const mappedOp = OP_MAP[op];
        if (!mappedOp) {
          throw new Error(`Unknown operator: ${op}`);
        }
        conditions.push({ field: key, op: mappedOp, value: opValue });
      }
    } else {
      // Shorthand equality: { name: 'John' }
      conditions.push({ field: key, op: 'EQ', value });
    }
  }

  return {
    logic: 'AND',
    conditions,
  };
}

/**
 * Parse sort specification from SDK format.
 * Accepts: { name: 1, age: -1 } or [['name', 'asc'], ['age', 'desc']]
 */
export function parseSort(
  sort: Record<string, number> | Array<[string, string]>,
): SortSpec[] {
  if (Array.isArray(sort)) {
    return sort.map(([field, dir]) => ({
      field,
      direction: dir.toLowerCase() === 'desc' ? 'DESC' : 'ASC',
    }));
  }

  return Object.entries(sort).map(([field, dir]) => ({
    field,
    direction: dir === -1 ? 'DESC' : 'ASC',
  }));
}

/**
 * Build a complete QueryAST from SDK request parameters.
 */
export function buildQueryAST(params: {
  type: QueryAST['type'];
  collection: string;
  query?: Record<string, unknown>;
  data?: Record<string, unknown> | Record<string, unknown>[];
  updates?: Record<string, unknown>;
  projection?: string[];
  sort?: Record<string, number> | Array<[string, string]>;
  limit?: number;
  offset?: number;
  searchQuery?: string;
  vectorQuery?: QueryAST['vectorQuery'];
}): QueryAST {
  const ast: QueryAST = {
    type: params.type,
    collection: params.collection,
  };

  if (params.query && Object.keys(params.query).length > 0) {
    ast.filters = parseFilters(params.query);
  }

  if (params.projection) {
    ast.projection = params.projection;
  }

  if (params.sort) {
    ast.sort = parseSort(params.sort);
  }

  if (params.limit !== undefined) {
    ast.limit = params.limit;
  }

  if (params.offset !== undefined) {
    ast.offset = params.offset;
  }

  if (params.data) {
    ast.data = params.data;
  }

  if (params.updates) {
    ast.updates = params.updates;
  }

  if (params.searchQuery) {
    ast.searchQuery = params.searchQuery;
  }

  if (params.vectorQuery) {
    ast.vectorQuery = params.vectorQuery;
  }

  return ast;
}
