// ──────────────────────────────────────────────────────────────
// SynapseDB — Core Engine
// The central orchestrator that ties all 7 layers together.
// ──────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import type {
  SynapseConfig,
  CollectionManifest,
  CollectionRoutingMap,
  QueryAST,
  Document,
  InsertResult,
  UpdateResult,
  DeleteResult,
  ChangeEvent,
  ApiResponse,
  Logger,
} from './types.js';
import { PluginRegistry, HealthMonitor } from './plugin/index.js';
import { buildQueryAST } from './compiler/index.js';
import { analyzeManifest, getFieldsForStore, getPrimaryKeyField } from './router/index.js';
import { buildExecutionPlan } from './router/plan.js';
import { parallelFetch, mergeResults, projectFields, normalizeDocuments, sortDocuments, applyPagination } from './joiner/index.js';
import { EventBus, Propagator, LockManager } from './sync/index.js';
import { createLogger } from './logger.js';

// Layer 4 — New Components
import { FeatureBridge } from './bridge/index.js';
import { detectDatabase, detectDatabases } from './detector/index.js';
import type { DetectedDatabase } from './detector/index.js';

// Layer 5 — Middleware
import { QueryCache } from './middleware/cache.js';
import { SchemaMigrator } from './middleware/migrations.js';
import { MetricsCollector } from './middleware/observability.js';
import type { OperationType, SystemMetrics } from './middleware/observability.js';

// v0.3 — Advanced Features
import { WorkloadAnalyzer } from './intelligence/analyzer.js';
import { NaturalLanguageQuery } from './intelligence/nlq.js';
import type { NLQResult } from './intelligence/nlq.js';
import { AnalyticsEngine } from './analytics/engine.js';
import type { AggregateOp, AnalyticsResult } from './analytics/engine.js';
import { ColdStorageArchiver } from './storage/archiver.js';
import { EdgeSyncEngine } from './sync/edge-sync.js';

// v0.4 — Resilience
import { CircuitBreaker, RetryManager, DeadLetterQueue, IdempotencyStore } from './resilience/index.js';
import { WriteBuffer } from './middleware/write-buffer.js';

// v0.5 — Data OS
import { CDCAnalyticsBridge } from './analytics/cdc-analytics-bridge.js';
import { EdgeKVStore } from './edge/edge-kv.js';
import { EdgeRouter } from './edge/edge-router.js';
import type { OriginFetcher } from './edge/edge-router.js';

/**
 * SynapseEngine — The Brain (Layer 4)
 *
 * The central orchestrator for the 7-layer architecture:
 *
 * L1: Client Apps → connect via SDK/REST
 * L2: Unified API → db.find(), db.insert(), db.sync()
 * L3: Query Engine → Compiler + Planner
 * L4: Core Engine → DB Detector + Feature Bridge + Sync Engine (this class)
 * L5: Middleware → Cache + Migrations + Observability
 * L6: Driver Adapters → Plugin system
 * L7: Connected DBs → PostgreSQL, MongoDB, Redis, Vector, etc.
 */
export class SynapseEngine {
  private config: SynapseConfig;
  private logger: Logger;
  private registry: PluginRegistry;
  private healthMonitor: HealthMonitor;
  private eventBus: EventBus;
  private propagator: Propagator;

  // Layer 4 — Core Engine
  private bridge: FeatureBridge;

  // Layer 5 — Middleware
  private cache: QueryCache;
  private migrator: SchemaMigrator;
  private metrics: MetricsCollector;
  private writeBuffer: WriteBuffer;

  // v0.3 — Advanced Features
  private analyzer: WorkloadAnalyzer;
  private nlq: NaturalLanguageQuery;
  private analyticsEngine: AnalyticsEngine;
  private archiver: ColdStorageArchiver;
  private edgeSync: EdgeSyncEngine;

  // v0.5 — Data OS
  private cdcBridge: CDCAnalyticsBridge;
  private edgeKV: EdgeKVStore;
  private _edgeRouter: EdgeRouter;

  // v0.4 — Resilience
  // v0.4 — Resilience & Synchronization
  private retryManager: RetryManager;
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private dlq: DeadLetterQueue;
  private idempotency: IdempotencyStore;
  private locks: LockManager;

  private manifests: Map<string, CollectionManifest> = new Map();
  private routingMaps: Map<string, CollectionRoutingMap> = new Map();

  constructor(config: SynapseConfig) {
    this.config = config;
    this.logger = createLogger('Engine', config.logLevel ?? 'info');

    this.registry = new PluginRegistry(createLogger('Registry', config.logLevel));
    this.healthMonitor = new HealthMonitor(
      this.registry,
      createLogger('Health', config.logLevel),
    );
    this.eventBus = new EventBus(createLogger('EventBus', config.logLevel));
    this.propagator = new Propagator(
      this.registry,
      this.eventBus,
      createLogger('Propagator', config.logLevel),
    );

    // Layer 4
    this.bridge = new FeatureBridge(
      this.registry,
      createLogger('Bridge', config.logLevel),
    );

    // Layer 5
    this.cache = new QueryCache(
      {
        enabled: config.cache?.enabled ?? true,
        maxSize: config.cache?.maxSize ?? 1000,
        defaultTTL: config.cache?.defaultTTL ?? 30_000,
      },
      createLogger('Cache', config.logLevel),
    );
    this.migrator = new SchemaMigrator(createLogger('Migrator', config.logLevel));
    this.metrics = new MetricsCollector(createLogger('Metrics', config.logLevel));

    // v0.3 — Advanced Features
    this.analyzer = new WorkloadAnalyzer(
      config.intelligence ?? {},
      createLogger('AI', config.logLevel),
      (rec) => this.handleTuningRecommendation(rec)
    );
    this.nlq = new NaturalLanguageQuery(this.manifests, createLogger('NLQ', config.logLevel));
    this.analyticsEngine = new AnalyticsEngine(createLogger('Analytics', config.logLevel));
    this.archiver = new ColdStorageArchiver(
      config.archiver ?? {},
      createLogger('Archiver', config.logLevel),
    );
    this.edgeSync = new EdgeSyncEngine(
      config.edgeSync ?? {},
      createLogger('EdgeSync', config.logLevel),
    );

    // v0.4 — Resilience
    this.retryManager = new RetryManager(
      config.topology?.retries?.maxAttempts ?? 3,
      config.topology?.retries?.initialDelayMs ?? 100,
      createLogger('RetryManager', config.logLevel),
    );
    this.dlq = new DeadLetterQueue(createLogger('DLQ', config.logLevel));
    this.idempotency = new IdempotencyStore();
    this.locks = new LockManager(createLogger('Locks', config.logLevel));

    // v0.5 — Data OS
    this.cdcBridge = new CDCAnalyticsBridge(
      this.analyticsEngine,
      createLogger('ZeroETL', config.logLevel),
    );
    this.edgeKV = new EdgeKVStore(createLogger('EdgeKV', config.logLevel));
    this._edgeRouter = new EdgeRouter(
      this.edgeKV,
      this.edgeSync,
      createLogger('EdgeRouter', config.logLevel),
    );

    this.writeBuffer = new WriteBuffer(
      { enabled: true, flushIntervalMs: 5000 },
      createLogger('WriteBuffer', config.logLevel)
    );

    this.writeBuffer.setFlushHandler(async (collection, updates) => {
      const promises = [];
      const plugin = this.registry.getByType('sql')[0] ?? this.registry.getByType('nosql')[0];
      if (!plugin) return;
      
      const pk = getPrimaryKeyField(this.getCollectionContext(collection).manifest);
      const fields = this.getStoreFields(this.getCollectionContext(collection).routingMap, plugin.name, pk);
      
      for (const [id, payload] of updates.entries()) {
        const queryAst = buildQueryAST({ type: 'UPDATE', collection, query: { [pk]: id }, updates: payload });
        promises.push(
          this.executeWithResilience(plugin.name, async () => {
             await plugin.update(
               collection, 
               queryAst, 
               payload,
               fields
             );
          })
        );
      }
      await Promise.allSettled(promises);
    });
  }

  private autoCachedCollections = new Set<string>();

  private handleTuningRecommendation(rec: any) {
    if (rec.type === 'PROMOTE_TO_CACHE') {
      if (!this.autoCachedCollections.has(rec.collection)) {
        this.logger.warn(`🚀 Auto-Tuner: Promoting ${rec.collection} to Redis Cache due to read spike on ${rec.field}`);
        this.autoCachedCollections.add(rec.collection);
      }
    } else if (rec.type === 'ENABLE_WRITE_BUFFER') {
      this.logger.warn(`🛡️  Auto-Tuner: Write Storm Detected on ${rec.collection}.${rec.field}. Enabling Write-Behind Buffer.`);
      this.writeBuffer.activateForCollection(rec.collection);
    }
  }

  // ─── Lifecycle ──────────────────────────────────────────

  /**
   * Initialize the engine: register and connect all plugins.
   * Also handles auto-connect via DB Detector if `connections` is set.
   */
  async initialize(): Promise<void> {
    this.logger.info('SynapseDB Engine initializing...');

    // Auto-detect databases from connection URIs
    if (this.config.connections && this.config.connections.length > 0) {
      await this.autoConnect(this.config.connections);
    }

    // Register plugins from explicit config
    for (const [name, pluginConfig] of Object.entries(this.config.plugins)) {
      try {
        // Dynamic import of plugin
        const mod = await import(pluginConfig.package);
        const factory = mod.default ?? mod.createPlugin ?? mod;
        const plugin = typeof factory === 'function' ? factory() : factory;

        // Override the plugin name if needed
        if (plugin.name !== name) {
          Object.defineProperty(plugin, 'name', { value: name, writable: false });
        }

        this.registry.register(plugin, pluginConfig.config, pluginConfig.priority ?? 0);
      } catch (error) {
        this.logger.error(`Failed to load plugin "${name}" from "${pluginConfig.package}"`, error);
        throw error;
      }
    }

    // Initialize all plugins
    await this.registry.initializeAll();

    // Create circuit breakers for all registered plugins
    for (const pluginName of this.registry.getNames()) {
      this.circuitBreakers.set(
        pluginName,
        new CircuitBreaker(
          pluginName,
          this.config.topology?.circuitBreaker?.failureThreshold ?? 5,
          this.config.topology?.circuitBreaker?.resetTimeoutMs ?? 30000,
          createLogger(`CircuitBreaker:${pluginName}`, this.config.logLevel)
        )
      );
    }

    // Refresh feature bridge cache
    this.bridge.invalidateCache();

    // Start health monitoring
    this.healthMonitor.start();

    // v0.5 — Zero-ETL: Wire CDC EventBus → AnalyticsEngine
    this.cdcBridge.attach(this.eventBus);

    // v0.5 — Edge Fabric: Wire origin fetcher
    this._edgeRouter.setOrigin({
      find: async (col, q) => {
        const res = await this.find(col, q);
        return res.data ?? [];
      },
      findOne: async (col, q) => {
        const res = await this.findOne(col, q);
        return res.data ?? null;
      },
      insert: async (col, docs) => {
        const res = await this.insert(col, docs);
        return { insertedCount: res.data?.insertedCount ?? 0, insertedIds: res.data?.insertedIds ?? [] };
      },
      update: async (col, q, u) => {
        const res = await this.update(col, q, u);
        return { matchedCount: res.data?.matchedCount ?? 0, modifiedCount: res.data?.modifiedCount ?? 0 };
      },
    });

    this.logger.info(`SynapseDB Engine initialized with ${this.registry.size} plugins ✓`);
    this.logger.info('🔗 Zero-ETL Analytics Bridge: ACTIVE');
    this.logger.info('🌍 Edge-Native Data Fabric: ACTIVE');
  }

  /**
   * Auto-connect to databases by detecting their type from URIs.
   * Uses the DB Detector (Layer 4) to fingerprint each connection.
   */
  async autoConnect(uris: string[]): Promise<DetectedDatabase[]> {
    this.logger.info(`DB Detector: auto-connecting ${uris.length} database(s)...`);
    const detected: DetectedDatabase[] = [];

    const dbMap = detectDatabases(uris);

    for (const [driverName, db] of dbMap) {
      this.logger.info(`  Detected: ${db.driver} (${db.type}) → ${db.reason}`);

      // Add to plugins config if not already present
      if (!this.config.plugins[driverName]) {
        this.config.plugins[driverName] = {
          type: db.type,
          package: db.package,
          config: db.config,
          priority: db.type === 'sql' ? 100 : db.type === 'nosql' ? 80 : db.type === 'cache' ? 60 : 40,
        };
      }

      detected.push(db);
    }

    return detected;
  }

  /**
   * Gracefully shutdown the engine.
   */
  async shutdown(): Promise<void> {
    this.logger.info('SynapseDB Engine shutting down...');

    this.healthMonitor.stop();
    this.propagator.shutdown();
    this.eventBus.clear();
    this.cache.clear();
    await this.registry.shutdownAll();

    this.logger.info('SynapseDB Engine shutdown complete');
  }

  // ─── Resilience Wrapper ─────────────────────────────────

  /**
   * Executes a plugin action through its defined CircuitBreaker and RetryManager.
   * Each attempt is subject to a configurable timeout (default 5s).
   */
  private async executeWithResilience<T>(pluginName: string, action: () => Promise<T>): Promise<T> {
    const timeoutMs = this.config.topology?.retries?.timeoutMs ?? 5000;
    const cb = this.circuitBreakers.get(pluginName);
    if (!cb) return this.retryManager.execute(pluginName, timeoutMs, action);

    return cb.execute(() => this.retryManager.execute(pluginName, timeoutMs, action));
  }

  // ─── Manifest Registration ──────────────────────────────

  /**
   * Register a data manifest.
   * Analyzes the manifest, builds the routing map, runs migrations, and syncs schemas.
   */
  async registerManifest(manifest: CollectionManifest): Promise<CollectionRoutingMap> {
    this.logger.info(`Registering manifest: ${manifest.name}`);

    // Layer 5: Schema migration diff
    const migrationOps = this.migrator.diff(manifest);
    this.migrator.record(manifest, migrationOps);

    // Analyze and build routing map
    const routingMap = analyzeManifest(manifest, this.registry);

    this.manifests.set(manifest.name, manifest);
    this.routingMaps.set(manifest.name, routingMap);

    // Sync schema to all involved stores
    for (const storeName of routingMap.involvedStores) {
      const plugin = this.registry.get(storeName);
      const fields = getFieldsForStore(routingMap, storeName);

      // Always include primary key
      const pk = getPrimaryKeyField(manifest);
      if (!fields.includes(pk)) {
        fields.unshift(pk);
      }

      await plugin.syncSchema(manifest, fields);
    }

    // Register for CDC propagation
    if (this.config.syncEnabled !== false) {
      this.propagator.register(manifest, routingMap);
    }

    this.logger.info(
      `Manifest "${manifest.name}" registered → stores: ${routingMap.involvedStores.join(', ')}`,
    );

    // Log routing decisions
    for (const [field, route] of Object.entries(routingMap.fieldRoutes)) {
      this.logger.debug(`  ${field} → ${route.store} (${route.reason})`);
    }

    return routingMap;
  }

  // ─── CRUD Operations ───────────────────────────────────

  /**
   * Insert documents into a collection.
   */
  async insert(
    collection: string, 
    docs: Document | Document[],
    context?: import('./types.js').OperationContext
  ): Promise<ApiResponse<InsertResult>> {
    const startTime = Date.now();
    const docsArray = Array.isArray(docs) ? docs : [docs];

    // ── Idempotency Check ──
    if (context?.operationId) {
      const cached = this.idempotency.get(context.operationId);
      if (cached) {
        this.logger.debug(`Idempotency hit! Returning cached result for operation ${context.operationId}`);
        return cached as ApiResponse<InsertResult>;
      }
    }

    try {
      const { manifest, routingMap } = this.getCollectionContext(collection);
      const pk = getPrimaryKeyField(manifest);

      // Auto-generate IDs if not present
      for (const doc of docsArray) {
        if (!doc[pk]) {
          doc[pk] = randomUUID();
        }
      }

      // Execute: primary store first (must be sequential to get IDs)
      const primaryStore = routingMap.primaryStore;
      const primaryPlugin = this.registry.get(primaryStore);
      const primaryFields = this.getStoreFields(routingMap, primaryStore, pk);

      const primaryResult = await this.executeWithResilience(primaryStore, () =>
        primaryPlugin.insert(collection, docsArray, primaryFields)
      );
      const finalIds = primaryResult.insertedIds;

      // ──── OPTIMIZATION: Parallel secondary writes ────
      const secondaryStores = routingMap.involvedStores.filter(s => s !== primaryStore);
      const consistency = this.config.topology?.consistency ?? 'EVENTUAL';

      if (secondaryStores.length > 0) {
        // Pre-compute docs with IDs once (avoid per-store map)
        const docsWithIds = docsArray.map((doc, i) => ({
          ...doc,
          [pk]: finalIds[i] ?? doc[pk],
        }));

        // Fire all secondary inserts in parallel
        const secondaryPromises = secondaryStores.map(storeName => {
          const plugin = this.registry.get(storeName);
          const fields = this.getStoreFields(routingMap, storeName, pk);
          return this.executeWithResilience(storeName, () => plugin.insert(collection, docsWithIds, fields));
        });

        if (consistency === 'STRONG') {
          try {
            await Promise.all(secondaryPromises);
          } catch (err) {
            this.logger.error(`STRONG consistency failed on secondary store during insert! Rolling back ${primaryStore}...`);
            // Rollback: delete what was inserted in the primary store
            await this.executeWithResilience(primaryStore, () =>
              primaryPlugin.delete(
                collection,
                buildQueryAST({
                  type: 'DELETE',
                  collection,
                  query: { [pk]: { $in: finalIds } },
                })
              )
            );
            throw new Error(`Write failed across secondary stores, rolled back primary. Caused by: ${err}`);
          }
        } else {
          // Eventual consistency: fire and forget failed syncs
          Promise.allSettled(secondaryPromises).then((results) => {
            results.forEach((res, i) => {
               if (res.status === 'rejected') {
                 this.dlq.add({
                   id: randomUUID(),
                   storeName: secondaryStores[i]!,
                   collection,
                   operation: 'INSERT',
                   payload: docsWithIds,
                   timestamp: Date.now(),
                   error: String(res.reason),
                 });
               }
            });
          });
        }
      }

      // ──── OPTIMIZATION: Fire-and-forget CDC ────
      // CDC events are non-blocking — they don't delay the response
      if (this.eventBus) {
        const now = Date.now();
        for (let i = 0; i < docsArray.length; i++) {
          this.eventBus.emit({
            id: randomUUID(),
            timestamp: now,
            collection,
            operation: 'INSERT',
            primaryKey: String(finalIds[i] ?? docsArray[i]![pk]),
            document: docsArray[i],
            sourcePlugin: primaryStore,
          }).catch(() => {});
        }
      }

      // Layer 5: Invalidate cache & record metrics
      this.cache.invalidateCollection(collection);
      this.metrics.record(collection, 'insert', Date.now() - startTime, routingMap.involvedStores, true);

      const response: ApiResponse<InsertResult> = {
        success: true,
        data: {
          insertedCount: primaryResult.insertedCount,
          insertedIds: finalIds,
        },
        meta: {
          took: Date.now() - startTime,
          routedTo: routingMap.involvedStores,
          operationId: context?.operationId
        },
      };

      if (context?.operationId) {
        this.idempotency.set(context.operationId, response);
      }

      return response;
    } catch (error) {
      this.metrics.record(collection, 'insert', Date.now() - startTime, [], false);
      return this.errorResponse(error, startTime);
    }
  }

  /**
   * Find documents in a collection.
   */
  async find(
    collection: string,
    query: Record<string, unknown> = {},
    options: {
      projection?: string[];
      sort?: Record<string, number>;
      limit?: number;
      offset?: number;
    } = {},
  ): Promise<ApiResponse<Document[]>> {
    const startTime = Date.now();

    try {
      const { manifest, routingMap } = this.getCollectionContext(collection);
      const pk = getPrimaryKeyField(manifest);

      // Layer 5: Check cache
      const cacheKey = QueryCache.buildKey(collection, query, options.projection);
      const cached = this.cache.get<Document[]>(cacheKey);
      if (cached) {
        this.metrics.record(collection, 'find', Date.now() - startTime, ['cache'], true);
        return {
          success: true,
          data: cached,
          meta: { took: Date.now() - startTime, routedTo: ['cache'] },
        };
      }

      const ast = buildQueryAST({
        type: 'FIND',
        collection,
        query,
        projection: options.projection,
        sort: options.sort,
        limit: options.limit,
        offset: options.offset,
      });

      const plan = buildExecutionPlan(ast, manifest, routingMap);

      if (!plan.requiresJoin) {
        // Simple case: single store
        const store = plan.operations[0]?.plugin ?? routingMap.primaryStore;
        const plugin = this.registry.get(store);
        const fields = this.getStoreFields(routingMap, store, pk);

        const results = await plugin.find(collection, ast, fields);
        const normalized = normalizeDocuments(results);
        const projected = projectFields(normalized, options.projection, pk);

        // Layer 5: Cache result
        this.cache.set(cacheKey, projected);
        this.metrics.record(collection, 'find', Date.now() - startTime, [store], true);

        return {
          success: true,
          data: projected,
          meta: {
            took: Date.now() - startTime,
            routedTo: [store],
          },
        };
      }

      // Multi-store: query primary first → get IDs → query secondaries by ID
      const primaryPlugin = this.registry.get(routingMap.primaryStore);
      const primaryFields = this.getStoreFields(routingMap, routingMap.primaryStore, pk);

      const primaryResults = await primaryPlugin.find(collection, ast, primaryFields);

      if (primaryResults.length === 0) {
        this.cache.set(cacheKey, []);
        this.metrics.record(collection, 'find', Date.now() - startTime, [routingMap.primaryStore], true);
        return {
          success: true,
          data: [],
          meta: { took: Date.now() - startTime, routedTo: [routingMap.primaryStore] },
        };
      }

      // Extract IDs from primary results
      const ids = primaryResults.map((doc) => doc[pk] ?? doc['id']).filter(Boolean);

      // Build ID-based query for secondary stores
      const idQuery = buildQueryAST({
        type: 'FIND',
        collection,
        query: ids.length === 1 ? { [pk]: ids[0] } : { [pk]: { $in: ids } },
      });

      // Parallel fetch from secondary stores using ID-based query
      const secondaryStores = routingMap.involvedStores.filter(
        (s) => s !== routingMap.primaryStore,
      );

      const fetchQueries = secondaryStores.map((storeName) => ({
        plugin: this.registry.get(storeName),
        query: idQuery,
        fields: this.getStoreFields(routingMap, storeName, pk),
      }));

      const secondaryResults = await parallelFetch(fetchQueries, this.logger);

      // Merge: start with primary, layer on secondary data
      const allResults = [
        {
          plugin: routingMap.primaryStore,
          documents: primaryResults,
          fields: primaryFields,
          latencyMs: 0,
        },
        ...secondaryResults,
      ];

      let merged = mergeResults(allResults, pk, routingMap.primaryStore);
      merged = normalizeDocuments(merged);

      // Post-merge operations
      if (options.sort) {
        const sortSpecs = Object.entries(options.sort).map(([field, dir]) => ({
          field,
          direction: (dir === -1 ? 'DESC' : 'ASC') as 'ASC' | 'DESC',
        }));
        merged = sortDocuments(merged, sortSpecs);
      }

      merged = applyPagination(merged, options.limit, options.offset);
      merged = projectFields(merged, options.projection, pk);

      // Layer 5: Cache & metrics
      this.cache.set(cacheKey, merged);
      this.metrics.record(collection, 'find', Date.now() - startTime, routingMap.involvedStores, true);

      return {
        success: true,
        data: merged,
        meta: {
          took: Date.now() - startTime,
          routedTo: routingMap.involvedStores,
        },
      };
    } catch (error) {
      this.metrics.record(collection, 'find', Date.now() - startTime, [], false);
      return this.errorResponse(error, startTime);
    }
  }

  /**
   * Find a single document.
   */
  async findOne(
    collection: string,
    query: Record<string, unknown> = {},
    options: { projection?: string[] } = {},
  ): Promise<ApiResponse<Document | null>> {
    const result = await this.find(collection, query, {
      ...options,
      limit: 1,
    });

    if (!result.success) {
      return { ...result, data: null };
    }

    return {
      ...result,
      data: result.data?.[0] ?? null,
    };
  }

  /**
   * Update documents in a collection.
   */
  async update(
    collection: string,
    query: Record<string, unknown>,
    updates: Record<string, unknown>,
    context?: import('./types.js').OperationContext
  ): Promise<ApiResponse<UpdateResult>> {
    const startTime = Date.now();

    // ── Idempotency Check ──
    if (context?.operationId) {
      const cached = this.idempotency.get(context.operationId);
      if (cached) {
        this.logger.debug(`Idempotency hit! Returning cached result for operation ${context.operationId}`);
        return cached as ApiResponse<UpdateResult>;
      }
    }

    try {
      const { manifest, routingMap } = this.getCollectionContext(collection);
      const pk = getPrimaryKeyField(manifest);

      const ast = buildQueryAST({
        type: 'UPDATE',
        collection,
        query,
        updates,
      });

      // ──── OPTIMIZATION: Fast-path for PK-targeted queries ────
      // If the query targets the primary key or a unique indexed field,
      // we can resolve IDs directly from the primary store without a
      // full multi-store virtual join.
      const queryKeys = Object.keys(query);
      const isPkQuery = queryKeys.length === 1 && (queryKeys[0] === pk || queryKeys[0] === 'id');

      let matchedIds: string[];
      let existingDocs: Document[];

      if (isPkQuery) {
        // Fast path: resolve IDs from query directly, skip full find()
        const pkValue = String(query[queryKeys[0]!]);
        matchedIds = [pkValue];

        // Lightweight primary-only lookup for CDC pre-image (non-blocking)
        const primaryPlugin = this.registry.get(routingMap.primaryStore);
        const primaryFields = this.getStoreFields(routingMap, routingMap.primaryStore, pk);
        const doc = await primaryPlugin.findOne(collection, ast, primaryFields);
        existingDocs = doc ? [doc] : [];

        if (existingDocs.length === 0) {
          this.metrics.record(collection, 'update', Date.now() - startTime, [], true);
          return {
            success: true,
            data: { matchedCount: 0, modifiedCount: 0 },
            meta: { took: Date.now() - startTime, routedTo: [] },
          };
        }
      } else {
        // Standard path: need full find() to resolve which documents match
        const findResult = await this.find(collection, query);
        existingDocs = findResult.data ?? [];

        if (existingDocs.length === 0) {
          this.metrics.record(collection, 'update', Date.now() - startTime, [], true);
          return {
            success: true,
            data: { matchedCount: 0, modifiedCount: 0 },
            meta: { took: Date.now() - startTime, routedTo: [] },
          };
        }

        matchedIds = [...new Set(
          existingDocs.map((doc) => String(doc[pk] ?? doc['id'])).filter(Boolean),
        )];
      }

      // Build an ID-based AST for secondary stores
      const idBasedAst = buildQueryAST({
        type: 'UPDATE',
        collection,
        query: matchedIds.length === 1
          ? { [pk]: matchedIds[0] }
          : { [pk]: { $in: matchedIds } },
        updates,
      });

      // ──── OPTIMIZATION: Write Buffer ────
      // If Auto-Tuner detected a write storm, we intercept and aggregate in-memory
      if (this.writeBuffer) {
        let intercepted = 0;
        for (const id of matchedIds) {
          if (this.writeBuffer.interceptUpdate(collection, id, updates)) {
            intercepted++;
          }
        }
        if (intercepted > 0 && intercepted === matchedIds.length) {
          this.metrics.record(collection, 'update', Date.now() - startTime, ['memory-buffer'], true);
          return {
            success: true,
            data: { matchedCount: matchedIds.length, modifiedCount: matchedIds.length },
            meta: { took: Date.now() - startTime, routedTo: ['memory-buffer'] },
          };
        }
      }

      // ──── OPTIMIZATION: Pre-compute per-store work, then fire in parallel ────
      const storeOps: Array<{ storeName: string; promise: Promise<UpdateResult> }> = [];
      const primaryStore = routingMap.primaryStore;
      const consistency = this.config.topology?.consistency ?? 'EVENTUAL';

      // ── Distributed Locking ──
      const acquiredLocks: { id: string, token: string }[] = [];
      try {
        for (const id of matchedIds) {
          const token = await this.locks.acquire(`${collection}:${id}`);
          if (!token) throw new Error(`Concurrent modification block: Document ${collection}:${id} is locked.`);
          acquiredLocks.push({ id, token });
        }

        for (const storeName of routingMap.involvedStores) {
          const plugin = this.registry.get(storeName);
          const fields = this.getStoreFields(routingMap, storeName, pk);

          // Filter updates to only include fields this store owns
          const storeUpdates: Record<string, unknown> = {};
          for (const [field, value] of Object.entries(updates)) {
            if (fields.includes(field)) {
              storeUpdates[field] = value;
            }
          }

          if (Object.keys(storeUpdates).length === 0) continue;

          const queryAst = storeName === routingMap.primaryStore ? ast : idBasedAst;
          storeOps.push({
            storeName,
            promise: this.executeWithResilience(storeName, () => plugin.update(collection, queryAst, storeUpdates, fields)),
          });
        }

        // Fire all store updates in parallel
        const results = await Promise.allSettled(storeOps.map(op => op.promise));

        if (consistency === 'STRONG') {
          const failures = storeOps.filter((_, i) => results[i]!.status === 'rejected');
          const primarySuccess = results.some((_, i) => storeOps[i]!.storeName === primaryStore && results[i]!.status === 'fulfilled');

          if (failures.length > 0 && primarySuccess) {
            this.logger.error(`STRONG consistency failed during update! Reverting ${primaryStore} to pre-images...`);
            // Saga Rollback: update primary back to the pre-image
            for (const doc of existingDocs) {
              const primaryPlugin = this.registry.get(primaryStore);
              const pkValue = doc[pk] ?? doc['id'];
              const revertAst = buildQueryAST({ type: 'UPDATE', collection, query: { [pk]: pkValue }, updates: doc });
              await this.executeWithResilience(primaryStore, () => primaryPlugin.update(collection, revertAst, doc, this.getStoreFields(routingMap, primaryStore, pk)));
            }
            throw new Error('Update failed across secondary stores, rolled back primary updates based on pre-images.');
          }
        } else {
          // Eventual consistency: log failures for DLQ processing
          results.forEach((res, i) => {
            if (res.status === 'rejected') {
              this.dlq.add({
                id: randomUUID(),
                storeName: storeOps[i]!.storeName,
                collection,
                operation: 'UPDATE',
                payload: updates,
                timestamp: Date.now(),
                error: String(res.reason),
              });
            }
          });
        }

        const updatedStores = storeOps
          .filter((_, i) => results[i]!.status === 'fulfilled')
          .map(op => op.storeName);

        const totalMatched = matchedIds.length;
        const totalModified = updatedStores.length > 0 ? matchedIds.length : 0;

        // ──── OPTIMIZATION: Fire-and-forget CDC ────
        const now = Date.now();
        const changedKeys = Object.keys(updates);
        for (const doc of existingDocs) {
          this.eventBus.emit({
            id: randomUUID(),
            timestamp: now,
            collection,
            operation: 'UPDATE',
            primaryKey: String(doc[pk] ?? doc['id']),
            document: { ...doc, ...updates },
            previousDocument: doc,
            changedFields: changedKeys,
            sourcePlugin: routingMap.primaryStore,
          }).catch(() => {});
        }

        // Layer 5: Invalidate cache & record metrics
        this.cache.invalidateCollection(collection);
        this.metrics.record(collection, 'update', Date.now() - startTime, updatedStores, true);

        const response: ApiResponse<UpdateResult> = {
          success: true,
          data: {
            matchedCount: totalMatched,
            modifiedCount: totalModified,
          },
          meta: {
            took: Date.now() - startTime,
            routedTo: updatedStores,
            operationId: context?.operationId
          },
        };

        if (context?.operationId) {
          this.idempotency.set(context.operationId, response);
        }

        return response;
      } finally {
        for (const lock of acquiredLocks) {
          await this.locks.release(`${collection}:${lock.id}`, lock.token);
        }
      }
    } catch (error) {
      this.metrics.record(collection, 'update', Date.now() - startTime, [], false);
      return this.errorResponse(error, startTime);
    }
  }

  /**
   * Delete documents from a collection.
   */
  async delete(
    collection: string,
    query: Record<string, unknown>,
    context?: import('./types.js').OperationContext
  ): Promise<ApiResponse<DeleteResult>> {
    const startTime = Date.now();

    // ── Idempotency Check ──
    if (context?.operationId) {
      const cached = this.idempotency.get(context.operationId);
      if (cached) {
        this.logger.debug(`Idempotency hit! Returning cached result for operation ${context.operationId}`);
        return cached as ApiResponse<DeleteResult>;
      }
    }

    try {
      const { manifest, routingMap } = this.getCollectionContext(collection);
      const pk = getPrimaryKeyField(manifest);

      const ast = buildQueryAST({
        type: 'DELETE',
        collection,
        query,
      });

      // ──── OPTIMIZATION: Launch find + deletes concurrently ────
      const queryKeys = Object.keys(query);
      const isPkQuery = queryKeys.length === 1 && (queryKeys[0] === pk || queryKeys[0] === 'id');
      const consistency = this.config.topology?.consistency ?? 'EVENTUAL';
      
      let cdcDocsPromise: Promise<Document[]>;
      if (isPkQuery) {
        const primaryPlugin = this.registry.get(routingMap.primaryStore);
        const primaryFields = this.getStoreFields(routingMap, routingMap.primaryStore, pk);
        cdcDocsPromise = this.executeWithResilience(routingMap.primaryStore, () => primaryPlugin.findOne(collection, ast, primaryFields))
          .then(doc => doc ? [doc] : [])
          .catch(() => []);
      } else {
        cdcDocsPromise = this.find(collection, query)
          .then(r => r.data ?? [])
          .catch(() => []);
      }

      // Resolve pre-images first to guarantee rollback safety AND know which records to lock
      const existingDocs = await cdcDocsPromise;
      if (existingDocs.length === 0) {
        this.metrics.record(collection, 'delete', Date.now() - startTime, [], true);
        return { success: true, data: { deletedCount: 0 }, meta: { took: Date.now() - startTime, routedTo: [] } };
      }

      const matchedIds = existingDocs.map(doc => String(doc[pk] ?? doc['id'])).filter(Boolean);

      // ── Distributed Locking ──
      const acquiredLocks: { id: string, token: string }[] = [];
      try {
        for (const id of matchedIds) {
          const token = await this.locks.acquire(`${collection}:${id}`);
          if (!token) throw new Error(`Concurrent modification block: Document ${collection}:${id} is locked.`);
          acquiredLocks.push({ id, token });
        }

        const storeOps = routingMap.involvedStores.map(storeName => {
          const plugin = this.registry.get(storeName);
          return {
            storeName,
            promise: this.executeWithResilience(storeName, () => plugin.delete(collection, ast))
          };
        });

        const deleteResults = await Promise.allSettled(storeOps.map(op => op.promise));
        
        if (consistency === 'STRONG') {
          const failures = storeOps.filter((_, i) => deleteResults[i]!.status === 'rejected');
          const primarySuccess = deleteResults.some((_, i) => storeOps[i]!.storeName === routingMap.primaryStore && deleteResults[i]!.status === 'fulfilled');

          if (failures.length > 0 && primarySuccess) {
            this.logger.error(`STRONG consistency failed during delete! Restoring docs in ${routingMap.primaryStore}...`);
            // Saga Rollback: re-insert deleted documents
            const primaryPlugin = this.registry.get(routingMap.primaryStore);
            const fields = this.getStoreFields(routingMap, routingMap.primaryStore, pk);
            await this.executeWithResilience(routingMap.primaryStore, () => primaryPlugin.insert(collection, existingDocs, fields));
            throw new Error('Delete failed across secondary stores, restored primary updates based on pre-images.');
          }
        } else {
          // Eventual consistency: log failures for DLQ processing
          deleteResults.forEach((res, i) => {
            if (res.status === 'rejected') {
               this.dlq.add({
                 id: randomUUID(),
                 storeName: storeOps[i]!.storeName,
                 collection,
                 operation: 'DELETE',
                 payload: { query },
                 timestamp: Date.now(),
                 error: String(res.reason),
               });
            }
          });
        }
        
        const primaryIndex = storeOps.findIndex(op => op.storeName === routingMap.primaryStore);
        const primaryRes = primaryIndex >= 0 ? deleteResults[primaryIndex] : undefined;
        const totalDeleted = primaryRes?.status === 'fulfilled' ? primaryRes.value.deletedCount : 0;

        // ──── OPTIMIZATION: Fire-and-forget CDC ────
        const now = Date.now();
        for (const doc of existingDocs) {
          this.eventBus.emit({
            id: randomUUID(),
            timestamp: now,
            collection,
            operation: 'DELETE',
            primaryKey: String(doc[pk] ?? doc['id']),
            document: doc,
            sourcePlugin: routingMap.primaryStore,
          }).catch(() => {});
        }

        // Layer 5: Invalidate cache & record metrics
        this.cache.invalidateCollection(collection);
        this.metrics.record(collection, 'delete', Date.now() - startTime, routingMap.involvedStores, true);

        const response: ApiResponse<DeleteResult> = {
          success: true,
          data: { deletedCount: totalDeleted },
          meta: {
            took: Date.now() - startTime,
            routedTo: routingMap.involvedStores,
            operationId: context?.operationId
          },
        };

        if (context?.operationId) {
          this.idempotency.set(context.operationId, response);
        }

        return response;
      } finally {
        for (const lock of acquiredLocks) {
          await this.locks.release(`${collection}:${lock.id}`, lock.token);
        }
      }
    } catch (error) {
      this.metrics.record(collection, 'delete', Date.now() - startTime, [], false);
      return this.errorResponse(error, startTime);
    }
  }

  /**
   * Semantic / text search.
   */
  async search(
    collection: string,
    searchQuery?: string,
    vectorQuery?: {
      field: string;
      vector: number[];
      topK?: number;
      threshold?: number;
    },
  ): Promise<ApiResponse<Document[]>> {
    const startTime = Date.now();

    try {
      const { manifest, routingMap } = this.getCollectionContext(collection);
      const pk = getPrimaryKeyField(manifest);

      const ast = buildQueryAST({
        type: 'SEARCH',
        collection,
        searchQuery,
        vectorQuery: vectorQuery ? {
          field: vectorQuery.field,
          vector: vectorQuery.vector,
          topK: vectorQuery.topK ?? 10,
          threshold: vectorQuery.threshold,
        } : undefined,
      });

      // Determine which store handles the search
      if (vectorQuery) {
        // Vector search → vector plugin
        const vectorPlugins = this.registry.getByType('vector');
        if (vectorPlugins.length === 0) {
          throw new Error('No vector plugin registered for similarity search');
        }

        const vectorPlugin = vectorPlugins[0]!;
        const results = await vectorPlugin.find(collection, ast, []);
        const normalized = normalizeDocuments(results);

        this.metrics.record(collection, 'search', Date.now() - startTime, [vectorPlugin.name], true);

        return {
          success: true,
          data: normalized,
          meta: {
            took: Date.now() - startTime,
            routedTo: [vectorPlugin.name],
          },
        };
      }

      if (searchQuery) {
        // Text search → NoSQL/search plugin
        const nosqlPlugins = this.registry.getByType('nosql');
        if (nosqlPlugins.length === 0) {
          throw new Error('No NoSQL plugin registered for text search');
        }

        const searchPlugin = nosqlPlugins[0]!;
        const fields = this.getStoreFields(routingMap, searchPlugin.name, pk);
        const results = await searchPlugin.find(collection, ast, fields);
        const normalized = normalizeDocuments(results);

        this.metrics.record(collection, 'search', Date.now() - startTime, [searchPlugin.name], true);

        return {
          success: true,
          data: normalized,
          meta: {
            took: Date.now() - startTime,
            routedTo: [searchPlugin.name],
          },
        };
      }

      throw new Error('Search requires either searchQuery or vectorQuery');
    } catch (error) {
      this.metrics.record(collection, 'search', Date.now() - startTime, [], false);
      return this.errorResponse(error, startTime);
    }
  }

  // ─── Status & Introspection ─────────────────────────────

  /**
   * Get system health status (Production Observability).
   */
  async health(): Promise<Record<string, unknown>> {
    const pluginHealth = await this.registry.healthCheckAll();

    // Build circuit breaker state snapshot
    const circuitBreakers: Record<string, string> = {};
    for (const [name, cb] of this.circuitBreakers) {
      circuitBreakers[name] = cb.getState();
    }

    return {
      status: this.healthMonitor.isSystemHealthy() ? 'healthy' : 'degraded',
      engine: 'SynapseDB',
      version: '0.5.0',
      plugins: pluginHealth,
      circuitBreakers,
      dlqPending: this.dlq.getPending().length,
      collections: [...this.manifests.keys()],
      sync: this.eventBus.stats(),
      cache: this.cache.stats(),
    };
  }

  /**
   * Get production-grade metrics snapshot for /metrics endpoint.
   */
  systemMetrics(): SystemMetrics {
    return this.metrics.snapshot();
  }

  /**
   * Expose circuit breaker state per plugin (for observability dashboards).
   */
  getCircuitBreakerStates(): Record<string, string> {
    const states: Record<string, string> = {};
    for (const [name, cb] of this.circuitBreakers) {
      states[name] = cb.getState();
    }
    return states;
  }

  /**
   * Access the Dead Letter Queue for replay or inspection.
   */
  getDLQ() {
    return this.dlq;
  }

  /**
   * Get the Feature Bridge (Layer 4) for introspection.
   */
  featureBridge(): FeatureBridge {
    return this.bridge;
  }

  /**
   * Get schema migration history.
   */
  migrationHistory(collection?: string) {
    return this.migrator.getHistory(collection);
  }

  /**
   * Get routing map for a collection.
   */
  getRoutingMap(collection: string): CollectionRoutingMap | undefined {
    return this.routingMaps.get(collection);
  }

  /**
   * Get all registered manifests.
   */
  getManifests(): CollectionManifest[] {
    return [...this.manifests.values()];
  }

  // ─── v0.3 Advanced Features ──────────────────────────────

  /**
   * Natural Language Query — ask questions in plain English.
   *
   * @example
   * ```typescript
   * const result = await engine.ask('Find all users where email is alice@test.com');
   * const result = await engine.ask('Show me products cheaper than $50');
   * const result = await engine.ask('How many users are there?');
   * ```
   */
  async ask(question: string): Promise<ApiResponse<Document[]>> {
    const startTime = Date.now();

    try {
      const parsed = this.nlq.ask(question);

      this.logger.info(
        `NLQ: "${question}" → ${parsed.operation} on "${parsed.collection}" (confidence: ${parsed.confidence})`,
      );

      if (parsed.operation === 'search') {
        const searchTerm = parsed.explanation.match(/"([^"]+)"/)?.[1];
        return await this.search(parsed.collection, searchTerm);
      }

      if (parsed.operation === 'count') {
        const findResult = await this.find(parsed.collection, parsed.query);
        return {
          success: true,
          data: [{ count: findResult.data?.length ?? 0 }],
          meta: {
            took: Date.now() - startTime,
            routedTo: findResult.meta?.routedTo ?? [],
          },
        };
      }

      return await this.find(parsed.collection, parsed.query, parsed.options);
    } catch (error) {
      return this.errorResponse(error, startTime);
    }
  }

  /**
   * Run an analytical aggregation (HTAP — no data warehouse needed).
   *
   * @example
   * ```typescript
   * // Total revenue
   * const result = engine.aggregate('orders', [
   *   { type: 'SUM', field: 'amount', alias: 'revenue' }
   * ]);
   *
   * // Average price by category
   * const result = engine.aggregate('products', [
   *   { type: 'GROUP', field: 'category' },
   *   { type: 'AVG', field: 'price', alias: 'avg_price' }
   * ]);
   * ```
   */
  aggregate(
    collection: string,
    ops: AggregateOp[],
    filter?: Record<string, unknown>,
  ): AnalyticsResult {
    return this.analyticsEngine.aggregate(collection, ops, filter);
  }

  /**
   * Get AI-powered routing recommendations based on access patterns.
   */
  getRecommendations(collection?: string) {
    return this.analyzer.getRecommendations(collection);
  }

  /**
   * Get the field access heatmap (hot/warm/cold/frozen).
   */
  heatmap() {
    return this.analyzer.heatmap();
  }

  /**
   * Get the analytics engine for direct columnar queries.
   */
  analytics(): AnalyticsEngine {
    return this.analyticsEngine;
  }

  /**
   * Get the cold storage archiver.
   */
  coldStorage(): ColdStorageArchiver {
    return this.archiver;
  }

  /**
   * Get the edge sync engine.
   */
  edge(): EdgeSyncEngine {
    return this.edgeSync;
  }

  /**
   * Get the Zero-ETL CDC Analytics Bridge.
   */
  zeroETL(): CDCAnalyticsBridge {
    return this.cdcBridge;
  }

  /**
   * Get the Edge Router for global data fabric.
   */
  edgeRouter(): EdgeRouter {
    return this._edgeRouter;
  }

  /**
   * Get the Edge KV cache.
   */
  edgeCache(): EdgeKVStore {
    return this.edgeKV;
  }

  // ─── Private Helpers ─────────────────────────────────────

  private getCollectionContext(collection: string) {
    const manifest = this.manifests.get(collection);
    if (!manifest) {
      throw new Error(`Collection "${collection}" is not registered. Call registerManifest() first.`);
    }

    const routingMap = this.routingMaps.get(collection);
    if (!routingMap) {
      throw new Error(`No routing map for collection: ${collection}`);
    }

    return { manifest, routingMap };
  }

  private getStoreFields(
    routingMap: CollectionRoutingMap,
    storeName: string,
    pk: string,
  ): string[] {
    const fields = getFieldsForStore(routingMap, storeName);
    if (!fields.includes(pk)) {
      fields.unshift(pk);
    }
    return fields;
  }

  private errorResponse<T>(error: unknown, startTime: number): ApiResponse<T> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error('Operation failed:', message);

    return {
      success: false,
      error: {
        code: 'OPERATION_FAILED',
        message,
      },
      meta: {
        took: Date.now() - startTime,
        routedTo: [],
      },
    };
  }
}

/** @deprecated Use SynapseEngine instead */
export const OmniDBEngine = SynapseEngine;
