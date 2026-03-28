// ──────────────────────────────────────────────────────────────
// SynapseDB — Internal Event Bus
// Async pub/sub system for CDC change propagation.
// ──────────────────────────────────────────────────────────────

import type { ChangeEvent, Logger } from '../types.js';

type EventHandler = (event: ChangeEvent) => Promise<void>;

/**
 * EventBus — Internal async event system for CDC.
 *
 * When data is written to a primary store, the engine emits
 * a change event. Subscribers (secondary stores) receive the
 * event and update themselves accordingly.
 */
export class EventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private globalHandlers: Set<EventHandler> = new Set();
  private logger: Logger;
  private processing = false;
  private queue: ChangeEvent[] = [];

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Subscribe to change events for a specific collection.
   */
  on(collection: string, handler: EventHandler): () => void {
    if (!this.handlers.has(collection)) {
      this.handlers.set(collection, new Set());
    }
    this.handlers.get(collection)!.add(handler);

    this.logger.debug(`Event handler registered for collection: ${collection}`);

    // Return unsubscribe function
    return () => {
      this.handlers.get(collection)?.delete(handler);
    };
  }

  /**
   * Subscribe to ALL change events (global handler).
   */
  onAll(handler: EventHandler): () => void {
    this.globalHandlers.add(handler);
    return () => {
      this.globalHandlers.delete(handler);
    };
  }

  /**
   * Emit a change event.
   * Handlers run asynchronously — the emit returns immediately.
   */
  async emit(event: ChangeEvent): Promise<void> {
    this.queue.push(event);

    this.logger.debug(
      `Change event: ${event.operation} on ${event.collection} (key: ${event.primaryKey})`,
    );

    // Process queue if not already processing
    if (!this.processing) {
      await this.processQueue();
    }
  }

  /**
   * Process the event queue sequentially.
   */
  private async processQueue(): Promise<void> {
    this.processing = true;

    while (this.queue.length > 0) {
      const event = this.queue.shift()!;

      // Collect all handlers for this event
      const handlers: EventHandler[] = [];

      // Collection-specific handlers
      const collectionHandlers = this.handlers.get(event.collection);
      if (collectionHandlers) {
        handlers.push(...collectionHandlers);
      }

      // Global handlers
      handlers.push(...this.globalHandlers);

      // Execute all handlers in parallel
      if (handlers.length > 0) {
        const results = await Promise.allSettled(
          handlers.map((handler) => handler(event)),
        );

        // Log failures
        for (const result of results) {
          if (result.status === 'rejected') {
            this.logger.error(
              `Event handler failed for ${event.collection}:${event.operation}`,
              result.reason,
            );
          }
        }
      }
    }

    this.processing = false;
  }

  /**
   * Remove all handlers.
   */
  clear(): void {
    this.handlers.clear();
    this.globalHandlers.clear();
    this.queue = [];
  }

  /**
   * Get statistics about registered handlers.
   */
  stats(): { collections: number; handlers: number; queueSize: number } {
    let totalHandlers = this.globalHandlers.size;
    for (const handlers of this.handlers.values()) {
      totalHandlers += handlers.size;
    }

    return {
      collections: this.handlers.size,
      handlers: totalHandlers,
      queueSize: this.queue.length,
    };
  }
}
