// ──────────────────────────────────────────────────────────────
// SynapseDB — Routing Strategy Resolver
// Given a query, determines which plugins need to be involved.
// ──────────────────────────────────────────────────────────────

import type {
  QueryAST,
  CollectionRoutingMap,
  FilterGroup,
  FilterCondition,
} from '../types.js';

/**
 * Describes which stores are needed for a query and why.
 */
export interface RoutingDecision {
  /** Stores needed for reading data */
  readStores: string[];

  /** Stores needed for writing data */
  writeStores: string[];

  /** Whether a virtual join will be needed */
  requiresJoin: boolean;

  /** Fields grouped by store */
  storeFields: Record<string, string[]>;

  /** Explanation of the routing decision */
  reasoning: string[];
}

/**
 * Resolve the routing strategy for a query.
 *
 * Analyzes the query to determine:
 * 1. Which stores hold the requested fields
 * 2. Which stores have the filter fields (for WHERE clauses)
 * 3. Whether a virtual join is needed
 */
export function resolveStrategy(
  ast: QueryAST,
  routingMap: CollectionRoutingMap,
): RoutingDecision {
  const reasoning: string[] = [];
  const storeFields: Record<string, string[]> = {};

  // Initialize store fields from routing map
  for (const [field, route] of Object.entries(routingMap.fieldRoutes)) {
    if (!storeFields[route.store]) {
      storeFields[route.store] = [];
    }
    storeFields[route.store]!.push(field);
  }

  switch (ast.type) {
    case 'INSERT':
      return resolveInsertStrategy(ast, routingMap, storeFields, reasoning);

    case 'FIND':
    case 'FIND_ONE':
    case 'SEARCH':
      return resolveReadStrategy(ast, routingMap, storeFields, reasoning);

    case 'UPDATE':
      return resolveUpdateStrategy(ast, routingMap, storeFields, reasoning);

    case 'DELETE':
      return resolveDeleteStrategy(ast, routingMap, storeFields, reasoning);

    case 'COUNT':
      return {
        readStores: [routingMap.primaryStore],
        writeStores: [],
        requiresJoin: false,
        storeFields,
        reasoning: ['COUNT routed to primary store'],
      };

    default:
      throw new Error(`Unknown query type: ${ast.type}`);
  }
}

function resolveInsertStrategy(
  _ast: QueryAST,
  routingMap: CollectionRoutingMap,
  storeFields: Record<string, string[]>,
  reasoning: string[],
): RoutingDecision {
  // Insert needs to write to ALL involved stores
  const writeStores = routingMap.involvedStores;
  reasoning.push(`INSERT writes to all involved stores: ${writeStores.join(', ')}`);

  return {
    readStores: [],
    writeStores,
    requiresJoin: false,
    storeFields,
    reasoning,
  };
}

function resolveReadStrategy(
  ast: QueryAST,
  routingMap: CollectionRoutingMap,
  storeFields: Record<string, string[]>,
  reasoning: string[],
): RoutingDecision {
  const neededStores = new Set<string>();

  // If projection specified, only query stores that own those fields
  if (ast.projection && ast.projection.length > 0) {
    for (const field of ast.projection) {
      const route = routingMap.fieldRoutes[field];
      if (route) {
        neededStores.add(route.store);
      }
    }
    reasoning.push(`Projection targets fields in: ${[...neededStores].join(', ')}`);
  } else {
    // No projection — need all stores
    for (const store of routingMap.involvedStores) {
      neededStores.add(store);
    }
    reasoning.push('No projection — querying all stores');
  }

  // Filter fields must be queryable — add their stores
  if (ast.filters) {
    const filterFields = extractFilterFields(ast.filters);
    for (const field of filterFields) {
      const route = routingMap.fieldRoutes[field];
      if (route) {
        neededStores.add(route.store);
        reasoning.push(`Filter on "${field}" requires store: ${route.store}`);
      }
    }
  }

  // Vector search targets vector store
  if (ast.vectorQuery) {
    const route = routingMap.fieldRoutes[ast.vectorQuery.field];
    if (route) {
      neededStores.add(route.store);
      reasoning.push(`Vector search on "${ast.vectorQuery.field}" requires: ${route.store}`);
    }
  }

  // Text search targets nosql/search store
  if (ast.searchQuery) {
    // Find the store that has searchable fields
    for (const [field, route] of Object.entries(routingMap.fieldRoutes)) {
      if (storeFields[route.store]?.includes(field)) {
        neededStores.add(route.store);
      }
    }
  }

  // Always include primary store for ID-based joining
  neededStores.add(routingMap.primaryStore);

  const readStores = [...neededStores];
  const requiresJoin = readStores.length > 1;

  if (requiresJoin) {
    reasoning.push(`Virtual join needed across ${readStores.length} stores`);
  }

  return {
    readStores,
    writeStores: [],
    requiresJoin,
    storeFields,
    reasoning,
  };
}

function resolveUpdateStrategy(
  ast: QueryAST,
  routingMap: CollectionRoutingMap,
  storeFields: Record<string, string[]>,
  reasoning: string[],
): RoutingDecision {
  const writeStores = new Set<string>();
  const readStores = new Set<string>();

  // Determine which stores own the fields being updated
  if (ast.updates) {
    for (const field of Object.keys(ast.updates)) {
      const route = routingMap.fieldRoutes[field];
      if (route) {
        writeStores.add(route.store);
        reasoning.push(`Updating "${field}" → writes to: ${route.store}`);
      }
    }
  }

  // Filter fields need to be readable for the WHERE clause
  if (ast.filters) {
    const filterFields = extractFilterFields(ast.filters);
    for (const field of filterFields) {
      const route = routingMap.fieldRoutes[field];
      if (route) {
        readStores.add(route.store);
      }
    }
  }

  // Primary store always involved for ID resolution
  readStores.add(routingMap.primaryStore);

  return {
    readStores: [...readStores],
    writeStores: [...writeStores],
    requiresJoin: false,
    storeFields,
    reasoning,
  };
}

function resolveDeleteStrategy(
  ast: QueryAST,
  routingMap: CollectionRoutingMap,
  storeFields: Record<string, string[]>,
  reasoning: string[],
): RoutingDecision {
  // Delete from ALL stores
  reasoning.push(`DELETE removes from all stores: ${routingMap.involvedStores.join(', ')}`);

  const readStores = new Set<string>();

  // Need to read filter fields to find documents to delete
  if (ast.filters) {
    const filterFields = extractFilterFields(ast.filters);
    for (const field of filterFields) {
      const route = routingMap.fieldRoutes[field];
      if (route) {
        readStores.add(route.store);
      }
    }
  }

  readStores.add(routingMap.primaryStore);

  return {
    readStores: [...readStores],
    writeStores: routingMap.involvedStores,
    requiresJoin: false,
    storeFields,
    reasoning,
  };
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Extract all field names referenced in a filter group.
 */
function extractFilterFields(group: FilterGroup): string[] {
  const fields: string[] = [];

  for (const cond of group.conditions) {
    if (isFilterGroup(cond)) {
      fields.push(...extractFilterFields(cond));
    } else {
      fields.push(cond.field);
    }
  }

  return [...new Set(fields)];
}

function isFilterGroup(c: FilterCondition | FilterGroup): c is FilterGroup {
  return 'logic' in c;
}
