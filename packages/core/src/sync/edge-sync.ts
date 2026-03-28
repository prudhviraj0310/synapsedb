// ──────────────────────────────────────────────────────────────
// SynapseDB — Edge Sync Engine
// Local-first, offline-capable sync using CRDTs.
// ──────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import type { Logger, Document } from '../types.js';

/**
 * A CRDT operation — the atomic unit of sync.
 * Uses Last-Writer-Wins (LWW) semantics with a Hybrid Logical Clock.
 */
export interface CRDTOperation {
  id: string;
  /** Hybrid Logical Clock timestamp */
  hlc: string;
  /** The node that generated this operation */
  nodeId: string;
  /** Operation type */
  type: 'SET' | 'DELETE' | 'MERGE';
  /** Target collection */
  collection: string;
  /** Document primary key */
  documentId: string;
  /** Field-level changes (for SET/MERGE) */
  fields?: Record<string, unknown>;
  /** Wall-clock time for debugging */
  wallClock: number;
  /** Whether this op has been acknowledged by the server */
  acknowledged: boolean;
}

/**
 * Hybrid Logical Clock — provides causal ordering across nodes.
 */
export class HybridLogicalClock {
  private counter: number = 0;
  private lastTimestamp: number = 0;
  private nodeId: string;

  constructor(nodeId: string) {
    this.nodeId = nodeId;
  }

  /**
   * Generate a new HLC timestamp.
   */
  now(): string {
    const physicalTime = Date.now();

    if (physicalTime > this.lastTimestamp) {
      this.lastTimestamp = physicalTime;
      this.counter = 0;
    } else {
      this.counter++;
    }

    // Format: <physical_time>:<counter>:<node_id>
    return `${this.lastTimestamp}:${String(this.counter).padStart(4, '0')}:${this.nodeId}`;
  }

  /**
   * Receive a remote HLC and update local clock.
   */
  receive(remoteHLC: string): void {
    const [remoteTime, remoteCounter] = remoteHLC.split(':').map(Number);
    const localTime = Date.now();

    if (remoteTime! > this.lastTimestamp && remoteTime! > localTime) {
      this.lastTimestamp = remoteTime!;
      this.counter = remoteCounter! + 1;
    } else if (remoteTime === this.lastTimestamp) {
      this.counter = Math.max(this.counter, remoteCounter! + 1);
    } else {
      // Local wins — just tick
      if (localTime > this.lastTimestamp) {
        this.lastTimestamp = localTime;
        this.counter = 0;
      } else {
        this.counter++;
      }
    }
  }

  /**
   * Compare two HLC timestamps. Returns -1, 0, or 1.
   */
  static compare(a: string, b: string): number {
    const [aTime, aCounter, aNode] = a.split(':');
    const [bTime, bCounter, bNode] = b.split(':');

    if (Number(aTime) !== Number(bTime)) {
      return Number(aTime) < Number(bTime) ? -1 : 1;
    }
    if (Number(aCounter) !== Number(bCounter)) {
      return Number(aCounter) < Number(bCounter) ? -1 : 1;
    }
    if (aNode !== bNode) {
      return aNode! < bNode! ? -1 : 1;
    }
    return 0;
  }
}

/**
 * Configuration for the edge sync engine.
 */
export interface EdgeSyncConfig {
  /** Unique identifier for this node */
  nodeId: string;
  /** How often to attempt sync (ms). Default: 5000 */
  syncIntervalMs: number;
  /** Maximum operations to batch per sync. Default: 100 */
  batchSize: number;
  /** Whether to enable conflict-free merge (CRDT). Default: true */
  crdtEnabled: boolean;
  /** Maximum offline queue size. Default: 10000 */
  maxQueueSize: number;
}

const DEFAULT_CONFIG: EdgeSyncConfig = {
  nodeId: randomUUID().slice(0, 8),
  syncIntervalMs: 5000,
  batchSize: 100,
  crdtEnabled: true,
  maxQueueSize: 10_000,
};

/**
 * EdgeSyncEngine — Local-First, Offline-Capable Data Sync
 *
 * Enables SynapseDB to work at the edge (browser, mobile, IoT)
 * with full offline support:
 *
 * 1. **Local writes** are immediately applied to a local store
 *    and queued as CRDT operations.
 * 2. **Background sync** periodically pushes queued ops to the
 *    SynapseDB server and pulls remote changes.
 * 3. **Conflict resolution** uses LWW (Last-Writer-Wins) with
 *    Hybrid Logical Clocks for causal ordering — no merge conflicts.
 * 4. **Offline resilience** — the queue persists even without
 *    connectivity; on reconnect, all pending ops are flushed.
 */
export class EdgeSyncEngine {
  private config: EdgeSyncConfig;
  private logger: Logger;
  private clock: HybridLogicalClock;

  /** Outbound queue — ops waiting to be pushed to server */
  private outbox: CRDTOperation[] = [];
  /** Last-known state per document (LWW register) */
  private lwwState: Map<string, Map<string, { value: unknown; hlc: string }>> = new Map();
  /** Sync timer */
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  /** Sync callback (provided by engine) */
  private syncCallback: ((ops: CRDTOperation[]) => Promise<CRDTOperation[]>) | null = null;
  /** Connection status */
  private _isOnline = true;

  constructor(config: Partial<EdgeSyncConfig> = {}, logger: Logger) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
    this.clock = new HybridLogicalClock(this.config.nodeId);
  }

  // ─── Lifecycle ──────────────────────────────────────────

  /**
   * Start the sync engine.
   */
  start(syncCallback: (ops: CRDTOperation[]) => Promise<CRDTOperation[]>): void {
    this.syncCallback = syncCallback;

    this.syncTimer = setInterval(async () => {
      if (this._isOnline && this.outbox.length > 0) {
        await this.flush();
      }
    }, this.config.syncIntervalMs);

    this.logger.info(
      `EdgeSync started — node: ${this.config.nodeId}, interval: ${this.config.syncIntervalMs}ms`,
    );
  }

  /**
   * Stop the sync engine.
   */
  stop(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    this.logger.info(`EdgeSync stopped — ${this.outbox.length} ops in outbox`);
  }

  // ─── Local Operations (Offline-Safe) ────────────────────

  /**
   * Write a document locally + queue for sync.
   */
  localSet(
    collection: string,
    documentId: string,
    fields: Record<string, unknown>,
  ): CRDTOperation {
    const op: CRDTOperation = {
      id: randomUUID(),
      hlc: this.clock.now(),
      nodeId: this.config.nodeId,
      type: 'SET',
      collection,
      documentId,
      fields,
      wallClock: Date.now(),
      acknowledged: false,
    };

    // Apply to local LWW state
    this.applyToLWW(op);

    // Queue for outbound sync
    this.enqueue(op);

    return op;
  }

  /**
   * Delete a document locally + queue for sync.
   */
  localDelete(collection: string, documentId: string): CRDTOperation {
    const op: CRDTOperation = {
      id: randomUUID(),
      hlc: this.clock.now(),
      nodeId: this.config.nodeId,
      type: 'DELETE',
      collection,
      documentId,
      wallClock: Date.now(),
      acknowledged: false,
    };

    this.applyToLWW(op);
    this.enqueue(op);

    return op;
  }

  /**
   * Read a document from local LWW state.
   */
  localGet(collection: string, documentId: string): Document | null {
    const key = `${collection}:${documentId}`;
    const fieldMap = this.lwwState.get(key);
    if (!fieldMap) return null;

    // Check if deleted
    const deletedMarker = fieldMap.get('__deleted');
    if (deletedMarker?.value === true) return null;

    const doc: Document = { id: documentId };
    for (const [field, { value }] of fieldMap) {
      if (field !== '__deleted') {
        doc[field] = value;
      }
    }

    return doc;
  }

  // ─── Sync Operations ───────────────────────────────────

  /**
   * Flush pending operations to the server.
   */
  async flush(): Promise<{ pushed: number; pulled: number }> {
    if (!this.syncCallback) {
      throw new Error('EdgeSync: No sync callback registered');
    }

    const batch = this.outbox.splice(0, this.config.batchSize);
    if (batch.length === 0) return { pushed: 0, pulled: 0 };

    try {
      // Push local ops → receive remote ops
      const remoteOps = await this.syncCallback(batch);

      // Mark pushed ops as acknowledged
      for (const op of batch) {
        op.acknowledged = true;
      }

      // Apply remote ops to local state
      let pulled = 0;
      for (const remoteOp of remoteOps) {
        this.clock.receive(remoteOp.hlc);
        if (this.applyToLWW(remoteOp)) {
          pulled++;
        }
      }

      this.logger.info(
        `EdgeSync: pushed ${batch.length}, pulled ${pulled} operations`,
      );

      return { pushed: batch.length, pulled };
    } catch (error) {
      // Push ops back to front of queue (retry on next interval)
      this.outbox.unshift(...batch);
      this.logger.error('EdgeSync: flush failed, ops re-queued', error);
      return { pushed: 0, pulled: 0 };
    }
  }

  /**
   * Receive remote operations (pulled from server).
   */
  receiveRemoteOps(ops: CRDTOperation[]): number {
    let applied = 0;
    for (const op of ops) {
      this.clock.receive(op.hlc);
      if (this.applyToLWW(op)) {
        applied++;
      }
    }
    return applied;
  }

  // ─── Connectivity ───────────────────────────────────────

  /**
   * Set online/offline status.
   */
  setOnline(online: boolean): void {
    const wasOffline = !this._isOnline;
    this._isOnline = online;

    if (online && wasOffline) {
      this.logger.info(
        `EdgeSync: Back online — ${this.outbox.length} ops pending`,
      );
      // Trigger immediate flush
      this.flush().catch(() => {});
    } else if (!online) {
      this.logger.info('EdgeSync: Going offline — writes will queue locally');
    }
  }

  get isOnline(): boolean {
    return this._isOnline;
  }

  // ─── Introspection ──────────────────────────────────────

  /**
   * Get sync status.
   */
  status(): {
    nodeId: string;
    isOnline: boolean;
    pendingOps: number;
    localDocuments: number;
  } {
    return {
      nodeId: this.config.nodeId,
      isOnline: this._isOnline,
      pendingOps: this.outbox.length,
      localDocuments: this.lwwState.size,
    };
  }

  // ─── Private ────────────────────────────────────────────

  private enqueue(op: CRDTOperation): void {
    if (this.outbox.length >= this.config.maxQueueSize) {
      this.logger.warn('EdgeSync: Outbox full — dropping oldest operation');
      this.outbox.shift();
    }
    this.outbox.push(op);
  }

  /**
   * Apply a CRDT operation to the local LWW register.
   * Returns true if the operation was applied (newer than existing state).
   */
  private applyToLWW(op: CRDTOperation): boolean {
    const key = `${op.collection}:${op.documentId}`;
    let fieldMap = this.lwwState.get(key);

    if (!fieldMap) {
      fieldMap = new Map();
      this.lwwState.set(key, fieldMap);
    }

    if (op.type === 'DELETE') {
      const existing = fieldMap.get('__deleted');
      if (existing && HybridLogicalClock.compare(op.hlc, existing.hlc) <= 0) {
        return false; // Stale delete
      }
      fieldMap.set('__deleted', { value: true, hlc: op.hlc });
      return true;
    }

    if (op.type === 'SET' || op.type === 'MERGE') {
      let anyApplied = false;

      // Remove delete marker if we're setting new values
      fieldMap.delete('__deleted');

      for (const [field, value] of Object.entries(op.fields ?? {})) {
        const existing = fieldMap.get(field);

        // LWW: only apply if this op's HLC is newer
        if (!existing || HybridLogicalClock.compare(op.hlc, existing.hlc) > 0) {
          fieldMap.set(field, { value, hlc: op.hlc });
          anyApplied = true;
        }
      }

      return anyApplied;
    }

    return false;
  }
}
