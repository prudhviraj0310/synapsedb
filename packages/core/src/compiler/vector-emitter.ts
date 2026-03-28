// ──────────────────────────────────────────────────────────────
// SynapseDB — Vector Emitter
// Translates Query AST into vector search operations.
// ──────────────────────────────────────────────────────────────

import type { QueryAST } from '../types.js';

export interface VectorSearchParams {
  collection: string;
  field: string;
  vector: number[];
  topK: number;
  threshold?: number;
  filters?: Record<string, unknown>;
}

export interface VectorInsertParams {
  collection: string;
  documents: Array<{
    id: string;
    vectors: Record<string, number[]>;
    metadata: Record<string, unknown>;
  }>;
}

export interface VectorDeleteParams {
  collection: string;
  ids: string[];
}

export type VectorOutput =
  | { type: 'search'; params: VectorSearchParams }
  | { type: 'insert'; params: VectorInsertParams }
  | { type: 'delete'; params: VectorDeleteParams };

/**
 * Emit vector store operations from a QueryAST.
 */
export function emitVector(ast: QueryAST, fields: string[]): VectorOutput {
  switch (ast.type) {
    case 'SEARCH':
      return emitVectorSearch(ast);
    case 'FIND':
    case 'FIND_ONE':
      if (ast.vectorQuery) {
        return emitVectorSearch(ast);
      }
      throw new Error('Vector emitter requires vectorQuery for FIND operations');
    case 'INSERT':
      return emitVectorInsert(ast, fields);
    case 'DELETE':
      return emitVectorDelete(ast);
    default:
      throw new Error(`Vector emitter does not support operation: ${ast.type}`);
  }
}

function emitVectorSearch(ast: QueryAST): VectorOutput {
  if (!ast.vectorQuery) {
    throw new Error('Vector search requires vectorQuery parameter');
  }

  return {
    type: 'search',
    params: {
      collection: ast.collection,
      field: ast.vectorQuery.field,
      vector: ast.vectorQuery.vector,
      topK: ast.vectorQuery.topK,
      threshold: ast.vectorQuery.threshold,
    },
  };
}

function emitVectorInsert(ast: QueryAST, fields: string[]): VectorOutput {
  const docs = Array.isArray(ast.data) ? ast.data : [ast.data];
  const vectorDocs: VectorInsertParams['documents'] = [];

  for (const doc of docs) {
    if (!doc) continue;

    const id = String(doc['id'] ?? doc['_id'] ?? '');
    const vectors: Record<string, number[]> = {};
    const metadata: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(doc)) {
      if (fields.includes(k) && Array.isArray(v)) {
        vectors[k] = v as number[];
      } else if (k === 'id' || k === '_id') {
        // skip
      } else if (fields.includes(k)) {
        metadata[k] = v;
      }
    }

    if (Object.keys(vectors).length > 0) {
      vectorDocs.push({ id, vectors, metadata });
    }
  }

  return {
    type: 'insert',
    params: {
      collection: ast.collection,
      documents: vectorDocs,
    },
  };
}

function emitVectorDelete(ast: QueryAST): VectorOutput {
  // Extract IDs from filters
  const ids: string[] = [];

  if (ast.filters) {
    for (const cond of ast.filters.conditions) {
      if ('field' in cond && (cond.field === 'id' || cond.field === '_id')) {
        if (cond.op === 'EQ') {
          ids.push(String(cond.value));
        } else if (cond.op === 'IN' && Array.isArray(cond.value)) {
          ids.push(...cond.value.map(String));
        }
      }
    }
  }

  return {
    type: 'delete',
    params: {
      collection: ast.collection,
      ids,
    },
  };
}
