// ──────────────────────────────────────────────────────────────
// SynapseDB — Manifest Field Analyzer
// Analyzes field annotations to determine optimal storage routing.
// ──────────────────────────────────────────────────────────────

import type {
  CollectionManifest,
  FieldDescriptor,
  FieldRoute,
  CollectionRoutingMap,
} from '../types.js';
import type { IStoragePlugin } from '../plugin/contract.js';
import type { PluginRegistry } from '../plugin/registry.js';

/**
 * Analyze a manifest and produce a complete routing map.
 * Each field is assigned to the most suitable storage backend
 * based on its declared intentions (annotations).
 */
export function analyzeManifest(
  manifest: CollectionManifest,
  registry: PluginRegistry,
): CollectionRoutingMap {
  const fieldRoutes: Record<string, FieldRoute> = {};
  const involvedStores = new Set<string>();
  let primaryStore = '';

  // Get available plugins by type
  const sqlPlugins = registry.getByType('sql');
  const nosqlPlugins = registry.getByType('nosql');
  const vectorPlugins = registry.getByType('vector');
  const cachePlugins = registry.getByType('cache');

  // Determine the primary store (first SQL plugin, or first NoSQL plugin)
  const primaryPlugin = sqlPlugins[0] ?? nosqlPlugins[0];
  if (!primaryPlugin) {
    throw new Error('No primary storage plugin (SQL or NoSQL) is registered');
  }
  primaryStore = primaryPlugin.name;

  for (const [fieldName, descriptor] of Object.entries(manifest.fields)) {
    const route = routeField(fieldName, descriptor, {
      primaryStore,
      sqlPlugin: sqlPlugins[0],
      nosqlPlugin: nosqlPlugins[0],
      vectorPlugin: vectorPlugins[0],
      cachePlugin: cachePlugins[0],
    });

    fieldRoutes[fieldName] = route;
    involvedStores.add(route.store);
  }

  return {
    collection: manifest.name,
    primaryStore,
    fieldRoutes,
    involvedStores: [...involvedStores],
  };
}

interface RoutingContext {
  primaryStore: string;
  sqlPlugin?: IStoragePlugin;
  nosqlPlugin?: IStoragePlugin;
  vectorPlugin?: IStoragePlugin;
  cachePlugin?: IStoragePlugin;
}

/**
 * Route a single field to the optimal storage backend.
 *
 * Priority order:
 * 1. Vector type → Vector store
 * 2. Cached → Cache store (+ mirror in primary)
 * 3. Flexible / Nested / Searchable → NoSQL store
 * 4. Transactional / Unique / Indexed / Primary → SQL store
 * 5. Default → Primary store
 */
function routeField(
  fieldName: string,
  descriptor: FieldDescriptor,
  ctx: RoutingContext,
): FieldRoute {
  // ── Vector fields → always go to vector store ──
  if (descriptor.type === 'vector') {
    if (ctx.vectorPlugin) {
      return { store: ctx.vectorPlugin.name, reason: 'vector type → vector store' };
    }
    // Fallback: store as JSON in NoSQL
    if (ctx.nosqlPlugin) {
      return { store: ctx.nosqlPlugin.name, reason: 'vector type (no vector plugin, fallback to NoSQL)' };
    }
  }

  // ── Cached fields → cache store (read-through) ──
  if (descriptor.cached && ctx.cachePlugin) {
    return { store: ctx.cachePlugin.name, reason: 'cached field → cache store' };
  }

  // ── Flexible / nested / searchable → NoSQL ──
  if (descriptor.flexible || descriptor.nested) {
    if (ctx.nosqlPlugin) {
      return { store: ctx.nosqlPlugin.name, reason: 'flexible/nested data → document store' };
    }
  }

  if (descriptor.searchable && descriptor.type === 'text') {
    if (ctx.nosqlPlugin) {
      return { store: ctx.nosqlPlugin.name, reason: 'searchable text → document store (full-text)' };
    }
  }

  // ── JSON type → NoSQL ──
  if (descriptor.type === 'json' && ctx.nosqlPlugin) {
    if (descriptor.flexible !== false) {
      return { store: ctx.nosqlPlugin.name, reason: 'json type → document store' };
    }
  }

  // ── Transactional / unique / indexed / primary → SQL ──
  if (descriptor.transactional || descriptor.unique || descriptor.primary) {
    if (ctx.sqlPlugin) {
      return { store: ctx.sqlPlugin.name, reason: 'transactional/unique/primary → SQL store' };
    }
  }

  if (descriptor.indexed) {
    if (ctx.sqlPlugin) {
      return { store: ctx.sqlPlugin.name, reason: 'indexed field → SQL store (B-tree)' };
    }
  }

  // ── Default: route to primary store ──
  return { store: ctx.primaryStore, reason: 'default → primary store' };
}

/**
 * Get all fields that should be routed to a specific store.
 */
export function getFieldsForStore(
  routingMap: CollectionRoutingMap,
  storeName: string,
): string[] {
  const fields: string[] = [];

  for (const [fieldName, route] of Object.entries(routingMap.fieldRoutes)) {
    if (route.store === storeName) {
      fields.push(fieldName);
    }
  }

  // Always include the primary key in every store
  for (const [fieldName, route] of Object.entries(routingMap.fieldRoutes)) {
    if (route.store !== storeName) {
      // Check if this field is a primary key
      // The primary key should be present in all stores for joining
    }
  }

  return fields;
}

/**
 * Find the primary key field name in a manifest.
 */
export function getPrimaryKeyField(manifest: CollectionManifest): string {
  for (const [fieldName, descriptor] of Object.entries(manifest.fields)) {
    if (descriptor.primary) {
      return fieldName;
    }
  }
  return 'id'; // Default primary key
}
