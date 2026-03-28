// ──────────────────────────────────────────────────────────────
// SynapseDB — MongoDB Emitter
// Translates Query AST into MongoDB query/operation objects.
// ──────────────────────────────────────────────────────────────

import type { QueryAST, FilterGroup, FilterCondition } from '../types.js';

interface MongoOutput {
  filter: Record<string, unknown>;
  options: MongoOptions;
  update?: Record<string, unknown>;
  documents?: Record<string, unknown>[];
}

interface MongoOptions {
  projection?: Record<string, number>;
  sort?: Record<string, 1 | -1>;
  limit?: number;
  skip?: number;
}

/**
 * Emit a MongoDB query from a QueryAST.
 */
export function emitMongo(ast: QueryAST, fields: string[]): MongoOutput {
  const output: MongoOutput = {
    filter: {},
    options: {},
  };

  // Build filter
  if (ast.filters) {
    output.filter = emitFilterGroup(ast.filters);
  }

  // Projection — only include fields owned by this plugin
  if (ast.projection) {
    const proj: Record<string, number> = {};
    for (const f of ast.projection) {
      if (fields.includes(f)) {
        proj[f] = 1;
      }
    }
    // Always include _id / primary key
    proj['_id'] = 1;
    output.options.projection = proj;
  } else if (fields.length > 0) {
    const proj: Record<string, number> = { _id: 1 };
    for (const f of fields) {
      proj[f] = 1;
    }
    output.options.projection = proj;
  }

  // Sort
  if (ast.sort && ast.sort.length > 0) {
    const sort: Record<string, 1 | -1> = {};
    for (const s of ast.sort) {
      sort[s.field] = s.direction === 'ASC' ? 1 : -1;
    }
    output.options.sort = sort;
  }

  // Limit & Offset
  if (ast.limit !== undefined) {
    output.options.limit = ast.limit;
  }
  if (ast.type === 'FIND_ONE' && ast.limit === undefined) {
    output.options.limit = 1;
  }
  if (ast.offset !== undefined) {
    output.options.skip = ast.offset;
  }

  // Documents for insert
  if (ast.type === 'INSERT' && ast.data) {
    const docs = Array.isArray(ast.data) ? ast.data : [ast.data];
    output.documents = docs.map((doc) => {
      const filtered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(doc)) {
        if (fields.includes(k) || k === 'id' || k === '_id') {
          filtered[k] = v;
        }
      }
      return filtered;
    });
  }

  // Update payload
  if (ast.type === 'UPDATE' && ast.updates) {
    const setFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(ast.updates)) {
      if (fields.includes(k)) {
        setFields[k] = v;
      }
    }
    output.update = { $set: setFields };
  }

  // Text search
  if (ast.searchQuery) {
    output.filter['$text'] = { $search: ast.searchQuery };
  }

  return output;
}

// ─── Filter Emission ─────────────────────────────────────────

function emitFilterGroup(group: FilterGroup): Record<string, unknown> {
  if (group.conditions.length === 0) {
    return {};
  }

  if (group.logic === 'NOT') {
    const inner = group.conditions[0];
    if (!inner) return {};
    const innerFilter = isFilterGroup(inner)
      ? emitFilterGroup(inner)
      : emitCondition(inner);
    // Wrap in $nor for NOT semantics
    return { $nor: [innerFilter] };
  }

  if (group.logic === 'OR') {
    return {
      $or: group.conditions.map((c) =>
        isFilterGroup(c) ? emitFilterGroup(c) : emitCondition(c),
      ),
    };
  }

  // AND — can flatten into a single object if no key collisions
  if (group.conditions.length === 1) {
    const c = group.conditions[0]!;
    return isFilterGroup(c) ? emitFilterGroup(c) : emitCondition(c);
  }

  // Use $and to avoid key collision issues
  return {
    $and: group.conditions.map((c) =>
      isFilterGroup(c) ? emitFilterGroup(c) : emitCondition(c),
    ),
  };
}

function emitCondition(condition: FilterCondition): Record<string, unknown> {
  const { field, op, value } = condition;

  switch (op) {
    case 'EQ':
      return { [field]: value };
    case 'NEQ':
      return { [field]: { $ne: value } };
    case 'GT':
      return { [field]: { $gt: value } };
    case 'GTE':
      return { [field]: { $gte: value } };
    case 'LT':
      return { [field]: { $lt: value } };
    case 'LTE':
      return { [field]: { $lte: value } };
    case 'IN':
      return { [field]: { $in: value } };
    case 'NIN':
      return { [field]: { $nin: value } };
    case 'LIKE':
      // Convert SQL LIKE pattern to regex
      const pattern = String(value)
        .replace(/%/g, '.*')
        .replace(/_/g, '.');
      return { [field]: { $regex: pattern, $options: 'i' } };
    case 'REGEX':
      return { [field]: { $regex: value } };
    case 'EXISTS':
      return { [field]: { $exists: !!value } };
    default:
      throw new Error(`Unknown comparison operator: ${op}`);
  }
}

function isFilterGroup(c: FilterCondition | FilterGroup): c is FilterGroup {
  return 'logic' in c;
}
