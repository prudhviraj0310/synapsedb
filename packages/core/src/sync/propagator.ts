// ──────────────────────────────────────────────────────────────
// SynapseDB — Change Propagator
// Handles fan-out of change events to secondary stores.
// ──────────────────────────────────────────────────────────────

import type { ChangeEvent, CollectionManifest, CollectionRoutingMap, Logger } from '../types.js';
import type { PluginRegistry } from '../plugin/registry.js';
import type { EventBus } from './event-bus.js';
import { buildQueryAST } from '../compiler/parser.js';

/**
 * Propagator — Listens for change events and propagates
 * changes to all secondary stores.
 *
 * Flow:
 * 1. Primary store writes data → emits ChangeEvent
 * 2. Propagator receives event
 * 3. For each secondary store that owns fields in this collection:
 *    - INSERT: Insert the relevant fields
 *    - UPDATE: Update the relevant fields
 *    - DELETE: Delete the document
 */
export class Propagator {
  private registry: PluginRegistry;
  private eventBus: EventBus;
  private logger: Logger;
  private routingMaps: Map<string, CollectionRoutingMap> = new Map();
  private manifests: Map<string, CollectionManifest> = new Map();
  private unsubscribers: Array<() => void> = [];

  constructor(
    registry: PluginRegistry,
    eventBus: EventBus,
    logger: Logger,
  ) {
    this.registry = registry;
    this.eventBus = eventBus;
    this.logger = logger;
  }

  /**
   * Register a collection for change propagation.
   */
  register(
    manifest: CollectionManifest,
    routingMap: CollectionRoutingMap,
  ): void {
    this.routingMaps.set(manifest.name, routingMap);
    this.manifests.set(manifest.name, manifest);

    // Subscribe to changes on this collection
    const unsub = this.eventBus.on(manifest.name, async (event) => {
      await this.propagate(event);
    });
    this.unsubscribers.push(unsub);

    this.logger.info(`Propagation registered for collection: ${manifest.name}`);
  }

  /**
   * Propagate a change event to all secondary stores.
   */
  private async propagate(event: ChangeEvent): Promise<void> {
    const routingMap = this.routingMaps.get(event.collection);
    if (!routingMap) {
      this.logger.warn(`No routing map for collection: ${event.collection}`);
      return;
    }

    // Determine secondary stores (all stores except the source)
    const secondaryStores = routingMap.involvedStores.filter(
      (store) => store !== event.sourcePlugin,
    );

    if (secondaryStores.length === 0) {
      return;
    }

    this.logger.debug(
      `Propagating ${event.operation} on ${event.collection} to: ${secondaryStores.join(', ')}`,
    );

    const promises = secondaryStores.map(async (storeName) => {
      try {
        const plugin = this.registry.get(storeName);

        // Get fields owned by this store
        const storeFields = Object.entries(routingMap.fieldRoutes)
          .filter(([, route]) => route.store === storeName)
          .map(([field]) => field);

        if (storeFields.length === 0 && event.operation !== 'DELETE') {
          return;
        }

        switch (event.operation) {
          case 'INSERT':
            if (event.document) {
              await plugin.insert(event.collection, [event.document], storeFields);
            }
            break;

          case 'UPDATE':
            if (event.document && event.changedFields) {
              // Only propagate fields owned by this store
              const relevantChanges: Record<string, unknown> = {};
              for (const field of event.changedFields) {
                if (storeFields.includes(field) && event.document[field] !== undefined) {
                  relevantChanges[field] = event.document[field];
                }
              }

              if (Object.keys(relevantChanges).length > 0) {
                const updateQuery = buildQueryAST({
                  type: 'UPDATE',
                  collection: event.collection,
                  query: { id: event.primaryKey },
                  updates: relevantChanges,
                });
                await plugin.update(
                  event.collection,
                  updateQuery,
                  relevantChanges,
                  storeFields,
                );
              }
            }
            break;

          case 'DELETE': {
            const deleteQuery = buildQueryAST({
              type: 'DELETE',
              collection: event.collection,
              query: { id: event.primaryKey },
            });
            await plugin.delete(event.collection, deleteQuery);
            break;
          }
        }

        this.logger.debug(`Propagated ${event.operation} to ${storeName} ✓`);
      } catch (error) {
        this.logger.error(
          `Failed to propagate ${event.operation} to ${storeName}`,
          error,
        );
        // Don't rethrow — propagation failures should not block the primary write
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Stop all propagation.
   */
  shutdown(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    this.routingMaps.clear();
    this.manifests.clear();
    this.logger.info('Propagator shutdown');
  }
}
