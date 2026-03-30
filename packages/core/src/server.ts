// ──────────────────────────────────────────────────────────────
// SynapseDB — Fastify Server
// HTTP API layer exposing the SynapseDB Engine (Layer 2).
// ──────────────────────────────────────────────────────────────

import Fastify from 'fastify';
import type { SynapseConfig, CollectionManifest } from './types.js';
import { SynapseEngine } from './engine.js';
import { createLogger } from './logger.js';
import { TelemetryBridge } from './telemetry/index.js';

const logger = createLogger('Server');

/**
 * Create and configure the SynapseDB HTTP server.
 */
export async function createServer(config: SynapseConfig) {
  const engine = new SynapseEngine(config);

  const app = Fastify({
    logger: false, // We use our own logger
  });

  // ─── Auth Middleware (Layer 5) ─────────────────────────────

  if (config.apiKey) {
    app.addHook('onRequest', async (request, reply) => {
      // Skip auth for health endpoint
      if (request.url === '/api/v1/health') return;

      const authHeader = request.headers['authorization'];
      const apiKey = request.headers['x-api-key'] as string | undefined;

      const providedKey = apiKey ??
        (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);

      if (providedKey !== config.apiKey) {
        reply.code(401).send({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Invalid API key' },
        });
      }
    });
  }

  // ─── Health Endpoint ──────────────────────────────────────

  app.get('/api/v1/health', async () => {
    return await engine.health();
  });

  // ─── Manifest Registration ────────────────────────────────

  app.post('/api/v1/manifest', async (request) => {
    const manifest = request.body as CollectionManifest;
    const routingMap = await engine.registerManifest(manifest);

    return {
      success: true,
      data: {
        collection: manifest.name,
        routing: routingMap,
      },
    };
  });

  // ─── CRUD Endpoints ──────────────────────────────────────

  // Insert
  app.post<{ Params: { collection: string } }>(
    '/api/v1/:collection/insert',
    async (request) => {
      const { collection } = request.params;
      const body = request.body as { documents: Record<string, unknown>[] };
      return await engine.insert(collection, body.documents ?? [body]);
    },
  );

  // Find
  app.post<{ Params: { collection: string } }>(
    '/api/v1/:collection/find',
    async (request) => {
      const { collection } = request.params;
      const body = request.body as {
        query?: Record<string, unknown>;
        projection?: string[];
        sort?: Record<string, number>;
        limit?: number;
        offset?: number;
      };

      return await engine.find(collection, body.query, {
        projection: body.projection,
        sort: body.sort,
        limit: body.limit,
        offset: body.offset,
      });
    },
  );

  // Find One
  app.post<{ Params: { collection: string } }>(
    '/api/v1/:collection/findOne',
    async (request) => {
      const { collection } = request.params;
      const body = request.body as {
        query?: Record<string, unknown>;
        projection?: string[];
      };

      return await engine.findOne(collection, body.query, {
        projection: body.projection,
      });
    },
  );

  // Update
  app.patch<{ Params: { collection: string } }>(
    '/api/v1/:collection/update',
    async (request) => {
      const { collection } = request.params;
      const body = request.body as {
        query: Record<string, unknown>;
        updates: Record<string, unknown>;
      };

      return await engine.update(collection, body.query, body.updates);
    },
  );

  // Delete
  app.delete<{ Params: { collection: string } }>(
    '/api/v1/:collection/delete',
    async (request) => {
      const { collection } = request.params;
      const body = request.body as {
        query: Record<string, unknown>;
      };

      return await engine.delete(collection, body.query);
    },
  );

  // Search
  app.post<{ Params: { collection: string } }>(
    '/api/v1/:collection/search',
    async (request) => {
      const { collection } = request.params;
      const body = request.body as {
        searchQuery?: string;
        vectorQuery?: {
          field: string;
          vector: number[];
          topK?: number;
          threshold?: number;
        };
      };

      return await engine.search(collection, body.searchQuery, body.vectorQuery);
    },
  );

  // ─── Enhanced Metrics (Layer 5 — Observability) ───────────

  app.get('/api/v1/metrics', async () => {
    const manifests = engine.getManifests();
    const routingMaps = manifests.map((m) => ({
      collection: m.name,
      routing: engine.getRoutingMap(m.name),
    }));

    return {
      success: true,
      data: {
        collections: manifests.length,
        routing: routingMaps,
        system: engine.systemMetrics(),
        bridge: engine.featureBridge().matrix(),
      },
    };
  });

  // ─── Migrations Endpoint ──────────────────────────────────

  app.get('/api/v1/migrations', async () => {
    return {
      success: true,
      data: engine.migrationHistory(),
    };
  });

  // ─── v0.3 — Natural Language Query ────────────────────────

  app.post('/api/v1/ask', async (request) => {
    const body = request.body as { question: string };
    return await engine.ask(body.question);
  });

  // ─── v0.3 — Analytics (HTAP) ─────────────────────────────

  app.post<{ Params: { collection: string } }>(
    '/api/v1/:collection/aggregate',
    async (request) => {
      const { collection } = request.params;
      const body = request.body as {
        ops: Array<{ type: string; field?: string; alias?: string }>;
        filter?: Record<string, unknown>;
      };

      return {
        success: true,
        data: engine.aggregate(collection, body.ops as any, body.filter),
      };
    },
  );

  // ─── v0.3 — AI Recommendations ───────────────────────────

  app.get('/api/v1/recommendations', async () => {
    return {
      success: true,
      data: {
        recommendations: engine.getRecommendations(),
        heatmap: engine.heatmap(),
      },
    };
  });

  // ─── v0.3 — Cold Storage ─────────────────────────────────

  app.get('/api/v1/archive/stats', async () => {
    return {
      success: true,
      data: engine.coldStorage().getStats(),
    };
  });

  // ─── v0.3 — Edge Sync Status ─────────────────────────────

  app.get('/api/v1/edge/status', async () => {
    return {
      success: true,
      data: engine.edge().status(),
    };
  });

  return { app, engine, telemetry: new TelemetryBridge(engine) };
}

/**
 * Start the SynapseDB server.
 */
export async function startServer(config: SynapseConfig): Promise<void> {
  const { app, engine, telemetry } = await createServer(config);

  // Initialize engine
  await engine.initialize();

  const host = config.host ?? '0.0.0.0';
  const port = config.port ?? 9876;

  await app.listen({ host, port });

  // Attach telemetry WebSocket bridge to the raw HTTP server
  telemetry.attach(app.server);

  logger.info(`
  ╔══════════════════════════════════════════╗
  ║                                          ║
  ║   ⚡ SynapseDB Engine v0.2.0            ║
  ║   🌐 http://${host}:${port}              ║
  ║   📡 API: /api/v1                        ║
  ║   🧠 7-Layer Architecture Active         ║
  ║                                          ║
  ╚══════════════════════════════════════════╝
  `);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    telemetry.shutdown();
    await app.close();
    await engine.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
