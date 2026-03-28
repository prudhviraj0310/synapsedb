// ──────────────────────────────────────────────────────────────
// SynapseDB — Unified Query Compiler (UQC)
// The orchestrator that routes AST nodes to the correct emitter.
// ──────────────────────────────────────────────────────────────

export { buildQueryAST, parseFilters, parseSort } from './parser.js';
export { emitSQL } from './sql-emitter.js';
export { emitMongo } from './mongo-emitter.js';
export { emitRedis } from './redis-emitter.js';
export type { RedisCommand, RedisOutput } from './redis-emitter.js';
export { emitVector } from './vector-emitter.js';
export type { VectorOutput, VectorSearchParams, VectorInsertParams, VectorDeleteParams } from './vector-emitter.js';
