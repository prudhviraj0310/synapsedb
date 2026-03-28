// ──────────────────────────────────────────────────────────────
// SynapseDB — Execution Plan Builder
// Builds a DAG of operations to execute across plugins.
// ──────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import type {
  QueryAST,
  CollectionRoutingMap,
  ExecutionPlan,
  PlanOperation,
  CollectionManifest,
} from '../types.js';
import { resolveStrategy, type RoutingDecision } from './strategy.js';
import { getPrimaryKeyField } from './analyzer.js';

/**
 * Build an execution plan for a query.
 *
 * The plan is a DAG (Directed Acyclic Graph) where:
 * - Each node is an operation against a specific plugin
 * - Edges represent data dependencies (e.g., need IDs from primary before querying secondary)
 * - Independent operations can execute in parallel
 */
export function buildExecutionPlan(
  ast: QueryAST,
  manifest: CollectionManifest,
  routingMap: CollectionRoutingMap,
): ExecutionPlan {
  const decision = resolveStrategy(ast, routingMap);
  const primaryKey = getPrimaryKeyField(manifest);
  const operations: PlanOperation[] = [];

  switch (ast.type) {
    case 'INSERT':
      buildInsertPlan(ast, routingMap, decision, operations);
      break;

    case 'FIND':
    case 'FIND_ONE':
    case 'SEARCH':
      buildReadPlan(ast, routingMap, decision, operations, primaryKey);
      break;

    case 'UPDATE':
      buildUpdatePlan(ast, routingMap, decision, operations, primaryKey);
      break;

    case 'DELETE':
      buildDeletePlan(ast, routingMap, decision, operations, primaryKey);
      break;

    case 'COUNT':
      operations.push({
        id: randomUUID(),
        plugin: routingMap.primaryStore,
        operation: 'FIND',
        fields: [],
        query: ast,
      });
      break;
  }

  return {
    collection: ast.collection,
    operations,
    requiresJoin: decision.requiresJoin,
    primaryKey,
  };
}

// ─── Plan Builders ───────────────────────────────────────────

function buildInsertPlan(
  ast: QueryAST,
  routingMap: CollectionRoutingMap,
  decision: RoutingDecision,
  operations: PlanOperation[],
): void {
  // Primary store goes first (generates IDs)
  const primaryOpId = randomUUID();
  operations.push({
    id: primaryOpId,
    plugin: routingMap.primaryStore,
    operation: 'INSERT',
    fields: decision.storeFields[routingMap.primaryStore] ?? [],
    query: ast,
  });

  // Secondary stores depend on primary (need the generated IDs)
  for (const store of decision.writeStores) {
    if (store === routingMap.primaryStore) continue;

    operations.push({
      id: randomUUID(),
      plugin: store,
      operation: 'INSERT',
      fields: decision.storeFields[store] ?? [],
      query: ast,
      dependsOn: [primaryOpId],
    });
  }
}

function buildReadPlan(
  ast: QueryAST,
  routingMap: CollectionRoutingMap,
  decision: RoutingDecision,
  operations: PlanOperation[],
  _primaryKey: string,
): void {
  if (!decision.requiresJoin) {
    // Simple case — only one store needed
    const store = decision.readStores[0] ?? routingMap.primaryStore;
    operations.push({
      id: randomUUID(),
      plugin: store,
      operation: ast.type === 'SEARCH' ? 'SEARCH' : 'FIND',
      fields: decision.storeFields[store] ?? [],
      query: ast,
    });
  } else {
    // Multi-store read — primary first, then secondaries in parallel
    const primaryOpId = randomUUID();
    operations.push({
      id: primaryOpId,
      plugin: routingMap.primaryStore,
      operation: 'FIND',
      fields: decision.storeFields[routingMap.primaryStore] ?? [],
      query: ast,
    });

    for (const store of decision.readStores) {
      if (store === routingMap.primaryStore) continue;

      operations.push({
        id: randomUUID(),
        plugin: store,
        operation: 'FIND',
        fields: decision.storeFields[store] ?? [],
        query: ast,
        dependsOn: [primaryOpId],
      });
    }
  }
}

function buildUpdatePlan(
  ast: QueryAST,
  routingMap: CollectionRoutingMap,
  decision: RoutingDecision,
  operations: PlanOperation[],
  _primaryKey: string,
): void {
  // First, read from primary to get the matching document IDs
  const readOpId = randomUUID();
  operations.push({
    id: readOpId,
    plugin: routingMap.primaryStore,
    operation: 'FIND',
    fields: decision.storeFields[routingMap.primaryStore] ?? [],
    query: { ...ast, type: 'FIND' },
  });

  // Then update in all affected stores
  for (const store of decision.writeStores) {
    operations.push({
      id: randomUUID(),
      plugin: store,
      operation: 'UPDATE',
      fields: decision.storeFields[store] ?? [],
      query: ast,
      dependsOn: [readOpId],
    });
  }
}

function buildDeletePlan(
  ast: QueryAST,
  routingMap: CollectionRoutingMap,
  decision: RoutingDecision,
  operations: PlanOperation[],
  _primaryKey: string,
): void {
  // Read IDs first from primary
  const readOpId = randomUUID();
  operations.push({
    id: readOpId,
    plugin: routingMap.primaryStore,
    operation: 'FIND',
    fields: ['id'],
    query: { ...ast, type: 'FIND' },
  });

  // Delete from all stores
  for (const store of decision.writeStores) {
    operations.push({
      id: randomUUID(),
      plugin: store,
      operation: 'DELETE',
      fields: [],
      query: ast,
      dependsOn: [readOpId],
    });
  }
}
