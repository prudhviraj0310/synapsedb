// ──────────────────────────────────────────────────────────────
// SynapseDB — In-Memory Vector Storage Plugin
// Self-contained vector search with zero external dependencies.
// ──────────────────────────────────────────────────────────────

import type {
  StorageType,
  PluginConfig,
  HealthStatus,
  PluginCapabilities,
  CollectionManifest,
  QueryAST,
  Document,
  InsertResult,
  UpdateResult,
  DeleteResult,
  Logger,
} from '@synapsedb/core/types';
import type { IStoragePlugin } from '@synapsedb/core/plugin/contract';

/**
 * A stored vector entry with its metadata.
 */
interface VectorEntry {
  id: string;
  vectors: Record<string, number[]>;
  metadata: Record<string, unknown>;
}

/**
 * Search result with similarity score.
 */
interface ScoredResult {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

/**
 * VectorPlugin — In-Memory Vector Semantic Plugin
 *
 * Handles AI embeddings and similarity search using
 * cosine similarity. Zero external dependencies.
 *
 * Designed as a drop-in replacement — swap this with a
 * Pinecone or Milvus adapter later by just changing config.
 */
export class VectorPlugin implements IStoragePlugin {
  readonly name = 'vector';
  readonly type: StorageType = 'vector';

  private storage: Map<string, Map<string, VectorEntry>> = new Map();
  private dimensions: Map<string, Map<string, number>> = new Map(); // collection → field → dimensions
  private logger: Logger | null = null;

  async connect(_config: PluginConfig, logger: Logger): Promise<void> {
    this.logger = logger;
    logger.info('Vector store initialized (in-memory)');
  }

  async disconnect(): Promise<void> {
    this.storage.clear();
    this.dimensions.clear();
  }

  async healthCheck(): Promise<HealthStatus> {
    const totalVectors = [...this.storage.values()].reduce(
      (sum, col) => sum + col.size,
      0,
    );

    return {
      healthy: true,
      latencyMs: 0,
      details: {
        collections: this.storage.size,
        totalVectors,
        engine: 'in-memory',
      },
    };
  }

  async syncSchema(manifest: CollectionManifest, fields: string[]): Promise<void> {
    if (!this.storage.has(manifest.name)) {
      this.storage.set(manifest.name, new Map());
    }

    if (!this.dimensions.has(manifest.name)) {
      this.dimensions.set(manifest.name, new Map());
    }

    // Record vector dimensions
    for (const fieldName of fields) {
      const desc = manifest.fields[fieldName];
      if (desc?.type === 'vector' && desc.dimensions) {
        this.dimensions.get(manifest.name)!.set(fieldName, desc.dimensions);
      }
    }

    this.logger?.info(`Vector schema synced for: ${manifest.name}`);
  }

  async insert(collection: string, docs: Document[], fields: string[]): Promise<InsertResult> {
    const col = this.getOrCreateCollection(collection);
    const insertedIds: string[] = [];

    for (const doc of docs) {
      const id = String(doc['id'] ?? doc['_id'] ?? '');
      if (!id) continue;

      const vectors: Record<string, number[]> = {};
      const metadata: Record<string, unknown> = {};

      for (const [k, v] of Object.entries(doc)) {
        if (k === 'id' || k === '_id') continue;

        if (fields.includes(k) && Array.isArray(v) && v.every((n) => typeof n === 'number')) {
          vectors[k] = v;
        } else if (fields.includes(k)) {
          metadata[k] = v;
        }
      }

      col.set(id, { id, vectors, metadata });
      insertedIds.push(id);
    }

    return {
      insertedCount: insertedIds.length,
      insertedIds,
    };
  }

  async find(collection: string, query: QueryAST, _fields: string[]): Promise<Document[]> {
    // Vector find only makes sense with a vector query
    if (query.vectorQuery) {
      const results = this.search(
        collection,
        query.vectorQuery.field,
        query.vectorQuery.vector,
        query.vectorQuery.topK,
        query.vectorQuery.threshold,
      );

      return results.map((r) => ({
        id: r.id,
        __score: r.score,
        ...r.metadata,
      }));
    }

    // Fallback: return all entries
    const col = this.storage.get(collection);
    if (!col) return [];

    return [...col.values()].map((entry) => ({
      id: entry.id,
      ...entry.metadata,
      ...Object.fromEntries(
        Object.entries(entry.vectors).map(([k, v]) => [k, v]),
      ),
    }));
  }

  async findOne(collection: string, query: QueryAST, fields: string[]): Promise<Document | null> {
    // Direct ID lookup
    if (query.filters) {
      for (const cond of query.filters.conditions) {
        if ('field' in cond && (cond.field === 'id' || cond.field === '_id') && cond.op === 'EQ') {
          const col = this.storage.get(collection);
          const entry = col?.get(String(cond.value));
          if (entry) {
            return {
              id: entry.id,
              ...entry.metadata,
              ...entry.vectors,
            };
          }
          return null;
        }
      }
    }

    const results = await this.find(collection, { ...query, limit: 1 }, fields);
    return results[0] ?? null;
  }

  async update(
    collection: string,
    query: QueryAST,
    changes: Record<string, unknown>,
    fields: string[],
  ): Promise<UpdateResult> {
    const col = this.storage.get(collection);
    if (!col) return { matchedCount: 0, modifiedCount: 0 };

    // Extract ID from query
    let targetId: string | null = null;
    if (query.filters) {
      for (const cond of query.filters.conditions) {
        if ('field' in cond && (cond.field === 'id' || cond.field === '_id') && cond.op === 'EQ') {
          targetId = String(cond.value);
        }
      }
    }

    if (!targetId) return { matchedCount: 0, modifiedCount: 0 };

    const entry = col.get(targetId);
    if (!entry) return { matchedCount: 0, modifiedCount: 0 };

    // Update vectors or metadata
    for (const [k, v] of Object.entries(changes)) {
      if (fields.includes(k)) {
        if (Array.isArray(v) && v.every((n) => typeof n === 'number')) {
          entry.vectors[k] = v;
        } else {
          entry.metadata[k] = v;
        }
      }
    }

    return { matchedCount: 1, modifiedCount: 1 };
  }

  async delete(collection: string, query: QueryAST): Promise<DeleteResult> {
    const col = this.storage.get(collection);
    if (!col) return { deletedCount: 0 };

    let deletedCount = 0;

    if (query.filters) {
      for (const cond of query.filters.conditions) {
        if ('field' in cond && (cond.field === 'id' || cond.field === '_id')) {
          if (cond.op === 'EQ') {
            if (col.delete(String(cond.value))) deletedCount++;
          } else if (cond.op === 'IN' && Array.isArray(cond.value)) {
            for (const id of cond.value) {
              if (col.delete(String(id))) deletedCount++;
            }
          }
        }
      }
    }

    return { deletedCount };
  }

  capabilities(): PluginCapabilities {
    return {
      supportsTransactions: false,
      supportsFullTextSearch: false,
      supportsVectorSearch: true,
      supportsNestedDocuments: false,
      supportsTTL: false,
      supportsIndexes: false,
      supportsUniqueConstraints: false,
    };
  }

  // ─── Vector Search Engine ─────────────────────────────────

  /**
   * Perform similarity search using cosine similarity.
   */
  private search(
    collection: string,
    field: string,
    queryVector: number[],
    topK: number,
    threshold?: number,
  ): ScoredResult[] {
    const col = this.storage.get(collection);
    if (!col) return [];

    const results: ScoredResult[] = [];

    for (const entry of col.values()) {
      const vector = entry.vectors[field];
      if (!vector) continue;

      const score = cosineSimilarity(queryVector, vector);

      if (threshold !== undefined && score < threshold) {
        continue;
      }

      results.push({
        id: entry.id,
        score,
        metadata: entry.metadata,
      });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, topK);
  }

  private getOrCreateCollection(name: string): Map<string, VectorEntry> {
    if (!this.storage.has(name)) {
      this.storage.set(name, new Map());
    }
    return this.storage.get(name)!;
  }
}

// ─── Math Utilities ──────────────────────────────────────────

/**
 * Compute cosine similarity between two vectors.
 * Returns a value between -1 and 1 (1 = identical).
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);

  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

export default function createVectorPlugin(): VectorPlugin {
  return new VectorPlugin();
}
