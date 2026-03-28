// ──────────────────────────────────────────────────────────────
// SynapseDB — Cold Storage Archiver
// Automatic archival of cold data to reduce costs.
// ──────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import type { Logger, Document } from '../types.js';

/**
 * A record in the cold storage archive.
 */
export interface ArchivedRecord {
  id: string;
  collection: string;
  documentId: string;
  /** The full document at time of archival */
  document: Document;
  /** When the document was archived */
  archivedAt: number;
  /** When the document was last accessed before archival */
  lastAccessedAt: number;
  /** Size in bytes (approximate) */
  sizeBytes: number;
  /** Compression applied */
  compression: 'none' | 'gzip' | 'snappy';
  /** Archive storage tier */
  tier: 'warm' | 'cold' | 'glacier';
}

/**
 * Archive manifest — metadata for a batch of archived records.
 */
export interface ArchiveManifest {
  id: string;
  collection: string;
  recordCount: number;
  totalSizeBytes: number;
  createdAt: number;
  tier: 'warm' | 'cold' | 'glacier';
  /** Storage backend (e.g., 's3', 'gcs', 'local') */
  backend: string;
  /** Path/key in the storage backend */
  path: string;
}

/**
 * Configuration for the cold storage archiver.
 */
export interface ArchiverConfig {
  enabled: boolean;
  /** Minutes without access before a record is considered "cold" */
  coldThresholdMinutes: number;
  /** Minutes without access before auto-archival triggers */
  archiveThresholdMinutes: number;
  /** Maximum records to archive per batch */
  batchSize: number;
  /** How often to check for cold data (ms) */
  scanIntervalMs: number;
  /** Storage backend type */
  backend: 'local' | 's3' | 'gcs';
  /** Base path for archived data */
  basePath: string;
}

const DEFAULT_CONFIG: ArchiverConfig = {
  enabled: true,
  coldThresholdMinutes: 1440,          // 1 day
  archiveThresholdMinutes: 1440 * 30,  // 30 days
  batchSize: 500,
  scanIntervalMs: 300_000,             // 5 minutes
  backend: 'local',
  basePath: '.synapsedb/archive',
};

/**
 * ColdStorageArchiver — S3-Native Data Lifecycle Management
 *
 * Automatically manages data lifecycle across storage tiers:
 *
 * HOT (Primary DBs) → WARM (30 days) → COLD (90 days) → GLACIER (365 days)
 *
 * Flow:
 * 1. Tracks last-access time for every document via the `accessTracker`
 * 2. Periodically scans for documents past the archive threshold
 * 3. Serializes cold documents to compressed archives (Parquet/JSON)
 * 4. Removes from hot storage (Postgres/MongoDB) to save space/cost
 * 5. On future reads, transparently fetches from archive → returns to caller
 *
 * In a production deployment, the `backend` would be S3/GCS.
 * This implementation uses an in-memory store for zero-dependency dev.
 */
export class ColdStorageArchiver {
  private config: ArchiverConfig;
  private logger: Logger;

  /** In-memory archive (would be S3/GCS in production) */
  private archive: Map<string, ArchivedRecord> = new Map();
  /** Per-document last-access tracker */
  private accessTracker: Map<string, number> = new Map();
  /** Archive manifests */
  private manifests: ArchiveManifest[] = [];
  /** Scan timer */
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  /** Stats */
  private stats = {
    totalArchived: 0,
    totalRestored: 0,
    totalSizeBytes: 0,
    costSavingsEstimate: 0,
  };

  constructor(config: Partial<ArchiverConfig> = {}, logger: Logger) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
  }

  // ─── Lifecycle ──────────────────────────────────────────

  /**
   * Start the archiver — begins periodic cold-data scanning.
   */
  start(): void {
    if (!this.config.enabled) return;

    this.scanTimer = setInterval(() => {
      this.scan();
    }, this.config.scanIntervalMs);

    this.logger.info(
      `ColdStorageArchiver started — threshold: ${this.config.archiveThresholdMinutes}min, backend: ${this.config.backend}`,
    );
  }

  /**
   * Stop the archiver.
   */
  stop(): void {
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
  }

  // ─── Access Tracking ────────────────────────────────────

  /**
   * Record a document access (read or write).
   * Call this from the engine on every find/insert/update.
   */
  trackAccess(collection: string, documentId: string): void {
    const key = `${collection}:${documentId}`;
    this.accessTracker.set(key, Date.now());
  }

  /**
   * Get the temperature classification of a document.
   */
  getTemperature(collection: string, documentId: string): 'hot' | 'warm' | 'cold' | 'archived' {
    const key = `${collection}:${documentId}`;

    // Check if archived
    if (this.archive.has(key)) {
      return 'archived';
    }

    const lastAccess = this.accessTracker.get(key);
    if (!lastAccess) return 'cold';

    const minutesSinceAccess = (Date.now() - lastAccess) / 60_000;

    if (minutesSinceAccess < 60) return 'hot';
    if (minutesSinceAccess < this.config.coldThresholdMinutes) return 'warm';
    return 'cold';
  }

  // ─── Archive Operations ─────────────────────────────────

  /**
   * Archive a document — moves it from hot storage to cold storage.
   */
  archiveDocument(
    collection: string,
    documentId: string,
    document: Document,
  ): ArchivedRecord {
    const key = `${collection}:${documentId}`;
    const sizeBytes = JSON.stringify(document).length;
    const lastAccess = this.accessTracker.get(key) ?? Date.now();

    // Determine tier based on age
    const minutesSinceAccess = (Date.now() - lastAccess) / 60_000;
    let tier: 'warm' | 'cold' | 'glacier';
    if (minutesSinceAccess < this.config.archiveThresholdMinutes) {
      tier = 'warm';
    } else if (minutesSinceAccess < this.config.archiveThresholdMinutes * 3) {
      tier = 'cold';
    } else {
      tier = 'glacier';
    }

    const record: ArchivedRecord = {
      id: randomUUID(),
      collection,
      documentId,
      document: { ...document },
      archivedAt: Date.now(),
      lastAccessedAt: lastAccess,
      sizeBytes,
      compression: 'none',  // Would be gzip/snappy in production
      tier,
    };

    this.archive.set(key, record);
    this.accessTracker.delete(key);

    // Update stats
    this.stats.totalArchived++;
    this.stats.totalSizeBytes += sizeBytes;
    // Rough estimate: $0.023/GB/month for S3 vs $0.10/GB/month for RDS
    this.stats.costSavingsEstimate += (sizeBytes / 1e9) * 0.077;

    this.logger.debug(
      `Archived: ${collection}/${documentId} → ${tier} (${sizeBytes} bytes)`,
    );

    return record;
  }

  /**
   * Archive multiple documents in a batch.
   */
  archiveBatch(
    collection: string,
    documents: Array<{ id: string; document: Document }>,
  ): ArchiveManifest {
    let totalSize = 0;

    for (const { id, document } of documents) {
      const record = this.archiveDocument(collection, id, document);
      totalSize += record.sizeBytes;
    }

    const manifest: ArchiveManifest = {
      id: randomUUID(),
      collection,
      recordCount: documents.length,
      totalSizeBytes: totalSize,
      createdAt: Date.now(),
      tier: 'cold',
      backend: this.config.backend,
      path: `${this.config.basePath}/${collection}/${Date.now()}.archive`,
    };

    this.manifests.push(manifest);
    return manifest;
  }

  /**
   * Restore a document from cold storage.
   * Transparently fetches the archived version.
   */
  restore(collection: string, documentId: string): Document | null {
    const key = `${collection}:${documentId}`;
    const record = this.archive.get(key);

    if (!record) return null;

    // Remove from archive, put back in access tracker
    this.archive.delete(key);
    this.accessTracker.set(key, Date.now());

    this.stats.totalRestored++;

    this.logger.debug(
      `Restored from archive: ${collection}/${documentId} (was ${record.tier})`,
    );

    return record.document;
  }

  /**
   * Check if a document is archived.
   */
  isArchived(collection: string, documentId: string): boolean {
    return this.archive.has(`${collection}:${documentId}`);
  }

  /**
   * Get an archived document without restoring it.
   */
  peek(collection: string, documentId: string): ArchivedRecord | null {
    return this.archive.get(`${collection}:${documentId}`) ?? null;
  }

  // ─── Scanning ───────────────────────────────────────────

  /**
   * Scan for cold documents that should be archived.
   * Returns the list of document keys that exceed the threshold.
   */
  scan(): Array<{ collection: string; documentId: string; minutesSinceAccess: number }> {
    const candidates: Array<{ collection: string; documentId: string; minutesSinceAccess: number }> = [];
    const now = Date.now();

    for (const [key, lastAccess] of this.accessTracker) {
      const [collection, documentId] = key.split(':');
      const minutesSinceAccess = (now - lastAccess) / 60_000;

      if (minutesSinceAccess >= this.config.archiveThresholdMinutes) {
        candidates.push({
          collection: collection!,
          documentId: documentId!,
          minutesSinceAccess: Math.round(minutesSinceAccess),
        });
      }
    }

    if (candidates.length > 0) {
      this.logger.info(
        `ColdStorageArchiver: found ${candidates.length} cold document(s) eligible for archival`,
      );
    }

    return candidates.slice(0, this.config.batchSize);
  }

  // ─── Introspection ──────────────────────────────────────

  /**
   * Get archiver statistics and cost savings.
   */
  getStats(): {
    totalArchived: number;
    totalRestored: number;
    totalSizeBytes: number;
    costSavingsEstimate: number;
    archiveCount: number;
    manifestCount: number;
    temperatureBreakdown: Record<string, number>;
  } {
    // Count temperatures
    const breakdown: Record<string, number> = { hot: 0, warm: 0, cold: 0, archived: 0 };
    const now = Date.now();

    for (const [, lastAccess] of this.accessTracker) {
      const minutes = (now - lastAccess) / 60_000;
      if (minutes < 60) breakdown.hot!++;
      else if (minutes < this.config.coldThresholdMinutes) breakdown.warm!++;
      else breakdown.cold!++;
    }
    breakdown.archived = this.archive.size;

    return {
      ...this.stats,
      archiveCount: this.archive.size,
      manifestCount: this.manifests.length,
      temperatureBreakdown: breakdown,
    };
  }

  /**
   * Get archive manifests.
   */
  getManifests(collection?: string): ArchiveManifest[] {
    if (collection) {
      return this.manifests.filter((m) => m.collection === collection);
    }
    return [...this.manifests];
  }
}
