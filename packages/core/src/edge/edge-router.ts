// ──────────────────────────────────────────────────────────────
// SynapseDB — Edge Router
// Web-standard request handler for Cloudflare Workers / Vercel Edge.
// ──────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import type { Document, Logger } from '../types.js';
import { EdgeKVStore } from './edge-kv.js';
import type { EdgeSyncEngine } from '../sync/edge-sync.js';

/**
 * Origin fetch callback — the edge router calls this to
 * reach the central SynapseDB engine when cache misses.
 */
export interface OriginFetcher {
  find(collection: string, query: Record<string, unknown>): Promise<Document[]>;
  findOne(collection: string, query: Record<string, unknown>): Promise<Document | null>;
  insert(collection: string, docs: Document[]): Promise<{ insertedCount: number; insertedIds: string[] }>;
  update(collection: string, query: Record<string, unknown>, updates: Record<string, unknown>): Promise<{ matchedCount: number; modifiedCount: number }>;
}

/**
 * Parsed edge request.
 */
interface EdgeRequest {
  method: string;
  collection: string;
  id?: string;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  region: string;
}

/**
 * EdgeRouter — Global Data Fabric Request Handler
 *
 * This is the piece that runs at the edge (Cloudflare Workers,
 * Vercel Edge Functions, Deno Deploy). It intercepts every
 * database request and:
 *
 * 1. READS: Serve from EdgeKV cache (sub-ms). On miss, fetch
 *    from origin SynapseDB, cache the result, and return.
 *
 * 2. WRITES: Log locally via EdgeSyncEngine CRDT queue,
 *    return immediately (optimistic), and async-push to origin.
 *    On conflict, HLC + LWW resolves automatically.
 *
 * 3. GEO-ROUTING: Detects the nearest region from request
 *    headers (CF-IPCountry, X-Vercel-IP-Country) and routes
 *    to the closest cache partition.
 *
 * The API uses Web-standard Request/Response objects so it
 * runs identically on Node.js, Cloudflare Workers, and Deno.
 */
export class EdgeRouter {
  private kv: EdgeKVStore;
  private sync: EdgeSyncEngine;
  private logger: Logger;
  private origin: OriginFetcher | null = null;

  // Telemetry
  private stats = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    originFetches: 0,
    crdtWrites: 0,
    regions: new Map<string, number>(),
  };

  constructor(kv: EdgeKVStore, sync: EdgeSyncEngine, logger: Logger) {
    this.kv = kv;
    this.sync = sync;
    this.logger = logger;
  }

  /**
   * Connect the edge router to the origin SynapseDB engine.
   */
  setOrigin(origin: OriginFetcher): void {
    this.origin = origin;
  }

  /**
   * Handle an incoming edge request.
   * Compatible with Cloudflare Workers fetch() handler.
   */
  async handleRequest(request: Request): Promise<Response> {
    this.stats.totalRequests++;
    const startTime = Date.now();

    try {
      const parsed = this.parseRequest(request);
      this.trackRegion(parsed.region);

      switch (request.method) {
        case 'GET':
          return await this.handleRead(parsed, startTime);
        case 'POST':
          return await this.handleWrite(parsed, startTime);
        case 'PUT':
        case 'PATCH':
          return await this.handleUpdate(parsed, startTime);
        default:
          return this.jsonResponse(405, { error: 'Method not allowed' }, startTime);
      }
    } catch (err: any) {
      return this.jsonResponse(500, { error: err.message }, startTime);
    }
  }

  /**
   * Programmatic edge read — bypasses HTTP parsing.
   * Use this when calling from within the same runtime.
   */
  async edgeGet(collection: string, id: string, region = 'global'): Promise<Document | null> {
    // 1. Check edge cache
    const cached = this.kv.get(collection, id, region);
    if (cached) {
      this.stats.cacheHits++;
      return cached;
    }

    this.stats.cacheMisses++;

    // 2. Check local CRDT state
    const local = this.sync.localGet(collection, id);
    if (local) {
      this.kv.set(collection, id, local, region);
      return local;
    }

    // 3. Fetch from origin
    if (this.origin) {
      this.stats.originFetches++;
      const doc = await this.origin.findOne(collection, { id });
      if (doc) {
        this.kv.set(collection, id, doc, region);
        return doc;
      }
    }

    return null;
  }

  /**
   * Programmatic edge write — instant local write + async CRDT sync.
   */
  edgeSet(collection: string, id: string, fields: Record<string, unknown>, region = 'global'): void {
    // 1. Write to local CRDT state (instant, offline-safe)
    this.sync.localSet(collection, id, fields);
    this.stats.crdtWrites++;

    // 2. Update edge cache immediately (optimistic)
    const doc = { id, ...fields };
    this.kv.set(collection, id, doc, region);

    // 3. CRDT sync will async-push to origin on next flush
  }

  /**
   * Programmatic edge query — fetch multiple documents.
   */
  async edgeFind(collection: string, query: Record<string, unknown>, region = 'global'): Promise<Document[]> {
    // For queries, we always go to origin (edge cache is key-value only)
    if (!this.origin) return [];
    this.stats.originFetches++;
    return this.origin.find(collection, query);
  }

  // ─── HTTP Handlers ─────────────────────────────────────

  private async handleRead(req: EdgeRequest, startTime: number): Promise<Response> {
    if (req.id) {
      const doc = await this.edgeGet(req.collection, req.id, req.region);
      if (!doc) return this.jsonResponse(404, { error: 'Not found' }, startTime);
      return this.jsonResponse(200, { data: doc, source: 'edge' }, startTime);
    }

    const docs = await this.edgeFind(req.collection, req.query ?? {}, req.region);
    return this.jsonResponse(200, { data: docs, source: 'origin' }, startTime);
  }

  private async handleWrite(req: EdgeRequest, startTime: number): Promise<Response> {
    if (!req.body) return this.jsonResponse(400, { error: 'Body required' }, startTime);

    const id = (req.body.id as string) || randomUUID();
    this.edgeSet(req.collection, id, req.body, req.region);

    return this.jsonResponse(201, {
      data: { id, status: 'queued' },
      source: 'edge-crdt',
    }, startTime);
  }

  private async handleUpdate(req: EdgeRequest, startTime: number): Promise<Response> {
    if (!req.id || !req.body) return this.jsonResponse(400, { error: 'ID and body required' }, startTime);

    this.edgeSet(req.collection, req.id, req.body, req.region);

    return this.jsonResponse(200, {
      data: { id: req.id, status: 'queued' },
      source: 'edge-crdt',
    }, startTime);
  }

  // ─── Helpers ───────────────────────────────────────────

  private parseRequest(request: Request): EdgeRequest {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    // Expected: /api/{collection} or /api/{collection}/{id}
    const collection = parts[1] || parts[0] || 'unknown';
    const id = parts[2] || undefined;

    // Detect region from edge headers
    const region =
      (request.headers.get('cf-ipcountry')) ||
      (request.headers.get('x-vercel-ip-country')) ||
      (request.headers.get('x-edge-region')) ||
      'global';

    return {
      method: request.method,
      collection,
      id,
      region,
    };
  }

  private jsonResponse(status: number, body: Record<string, unknown>, startTime: number): Response {
    return new Response(JSON.stringify({
      ...body,
      meta: {
        took: Date.now() - startTime,
        edge: true,
        kvStats: this.kv.stats(),
      },
    }), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'X-SynapseDB-Edge': 'true',
        'X-Response-Time': `${Date.now() - startTime}ms`,
      },
    });
  }

  private trackRegion(region: string): void {
    this.stats.regions.set(region, (this.stats.regions.get(region) ?? 0) + 1);
  }

  /**
   * Get edge router telemetry.
   */
  getStats() {
    return {
      ...this.stats,
      regions: Object.fromEntries(this.stats.regions),
      kv: this.kv.stats(),
      sync: this.sync.status(),
    };
  }
}
