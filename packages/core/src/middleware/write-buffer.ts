import type { Logger, Document } from '../types.js';

export interface WriteBufferConfig {
  enabled: boolean;
  flushIntervalMs: number;
}

const DEFAULT_CONFIG: WriteBufferConfig = {
  enabled: true,
  flushIntervalMs: 5000,
};

/**
 * WriteBuffer — Write-Behind Cache Middleware
 *
 * When the WorkloadAnalyzer detects a massive write storm on a specific collection
 * (e.g. 10,000 updates/sec to a "likes" or "views" counter), it dynamically activates
 * the WriteBuffer for that collection.
 *
 * The WriteBuffer intercepts all updates, aggregates them in memory, and asynchronously
 * flushes bulk updates to the underlying Postgres/Mongo database every 5 seconds.
 * This completely shields the primary database from crashing under viral load.
 */
export class WriteBuffer {
  private config: WriteBufferConfig;
  private logger: Logger;
  private activeCollections: Set<string> = new Set();
  
  // Format: collectionName -> Map<documentId, mergedUpdatePayload>
  private buffer: Map<string, Map<string, Partial<Document>>> = new Map();
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushCallback: ((collection: string, updates: Map<string, Partial<Document>>) => Promise<void>) | null = null;

  constructor(config: Partial<WriteBufferConfig> = {}, logger: Logger) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
  }

  /**
   * Activate write buffering for a specific collection (triggered by WorkloadAnalyzer).
   */
  activateForCollection(collection: string): void {
    if (!this.config.enabled) return;
    if (this.activeCollections.has(collection)) return;
    
    this.activeCollections.add(collection);
    this.buffer.set(collection, new Map());
    this.logger.info(`WriteBuffer: Activated for collection '${collection}' due to detected Write Storm`);

    if (!this.flushTimer) {
      this.startFlusher();
    }
  }

  /**
   * Deactivate write buffering for a collection.
   */
  deactivateForCollection(collection: string): void {
    if (this.activeCollections.has(collection)) {
      this.activeCollections.delete(collection);
      // We leave the buffer intact so the next flush clears it out
      this.logger.info(`WriteBuffer: Deactivated for collection '${collection}'`);
    }
  }

  /**
   * Provide the callback that actually executes the bulk writes.
   */
  setFlushHandler(
    handler: (collection: string, updates: Map<string, Partial<Document>>) => Promise<void>
  ): void {
    this.flushCallback = handler;
  }

  /**
   * Intercept an update operation. If the collection is active, buffer it and return true.
   * Otherwise, return false (proceed to normal DB routing).
   */
  interceptUpdate(collection: string, id: string, payload: Partial<Document>): boolean {
    if (!this.activeCollections.has(collection)) return false;

    const collectionBuffer = this.buffer.get(collection)!;
    const existing = collectionBuffer.get(id) || {};
    
    // Naively merge the updates (in a real system, we'd handle $inc, $push properly)
    const merged = { ...existing, ...payload };
    collectionBuffer.set(id, merged);

    return true; // Indicates the update was successfully buffered
  }

  /**
   * Get the current buffer size for metrics.
   */
  getBufferSize(): number {
    let size = 0;
    for (const [_, map] of this.buffer) {
      size += map.size;
    }
    return size;
  }

  private startFlusher(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch(err => {
        this.logger.error(`WriteBuffer: Flush failed — ${err.message}`);
      });
    }, this.config.flushIntervalMs);
  }

  async flush(): Promise<void> {
    if (!this.flushCallback) return;

    for (const [collection, updates] of this.buffer.entries()) {
      if (updates.size === 0) continue;

      this.logger.info(`WriteBuffer: Flushing ${updates.size} aggregated updates for '${collection}' to primary database`);
      
      try {
        // Pass a copy and clear the immediate buffer
        const updatesCopy = new Map(updates);
        updates.clear();
        
        await this.flushCallback(collection, updatesCopy);
      } catch (err: any) {
        this.logger.error(`WriteBuffer: Failed to flush ${collection} - ${err.message}`);
        // In a real system, we'd drop these back into the DLQ or retry buffer
      }
    }
    
    // Stop flusher if no active collections
    if (this.activeCollections.size === 0 && this.getBufferSize() === 0) {
      if (this.flushTimer) {
        clearInterval(this.flushTimer);
        this.flushTimer = null;
      }
    }
  }

  shutdown(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
  }
}
