// ──────────────────────────────────────────────────────────────
// SynapseDB Demo — E-Commerce Application
// Showcases multi-store routing, virtual joins, and CDC sync.
// ──────────────────────────────────────────────────────────────

import { SynapseEngine, createLogger } from '@synapsedb/core';
import { defineManifest } from '@synapsedb/sdk';
import type { SynapseConfig } from '@synapsedb/core';

const logger = createLogger('Demo', 'debug');

// ─── Data Manifests ─────────────────────────────────────────

/**
 * Users — Mixed storage across SQL, NoSQL, Cache, and Vector
 *
 * Routing breakdown:
 * - id, email, password     → PostgreSQL (transactional, unique)
 * - name                    → PostgreSQL (default primary)
 * - bio                     → MongoDB (searchable text)
 * - profile                 → MongoDB (flexible JSON)
 * - embedding               → Vector Store (semantic search)
 * - lastSeen                → Redis (cached with TTL)
 * - createdAt               → PostgreSQL (auto timestamp)
 */
const usersManifest = defineManifest('users', {
  id:        { type: 'uuid', primary: true },
  email:     { type: 'string', unique: true, indexed: true },
  name:      { type: 'string' },
  password:  { type: 'string', transactional: true },
  bio:       { type: 'text', searchable: true },
  profile:   { type: 'json', flexible: true },
  embedding: { type: 'vector', dimensions: 4 },  // Small for demo
  lastSeen:  { type: 'timestamp', cached: true, ttl: 60 },
  createdAt: { type: 'timestamp', auto: true },
});

/**
 * Products — SQL for pricing, Vector for similarity
 */
const productsManifest = defineManifest('products', {
  id:          { type: 'uuid', primary: true },
  name:        { type: 'string', indexed: true },
  price:       { type: 'float', transactional: true },
  currency:    { type: 'string' },
  description: { type: 'text', searchable: true },
  metadata:    { type: 'json', flexible: true },
  embedding:   { type: 'vector', dimensions: 4 },
  stock:       { type: 'integer', cached: true, ttl: 30 },
  createdAt:   { type: 'timestamp', auto: true },
});

// ─── Engine Configuration ───────────────────────────────────

const config: SynapseConfig = {
  host: '0.0.0.0',
  port: 9876,
  apiKey: 'demo-key-2024',
  logLevel: 'debug',
  syncEnabled: true,
  plugins: {
    postgres: {
      type: 'sql',
      package: '@synapsedb/plugin-postgres',
      config: {
        connectionUri: process.env['DATABASE_URL'] ?? 'postgresql://omnidb:omnidb@localhost:5432/omnidb',
      },
      priority: 100,
    },
    mongodb: {
      type: 'nosql',
      package: '@synapsedb/plugin-mongodb',
      config: {
        connectionUri: process.env['MONGO_URL'] ?? 'mongodb://localhost:27017',
        database: 'omnidb',
      },
      priority: 80,
    },
    redis: {
      type: 'cache',
      package: '@synapsedb/plugin-redis',
      config: {
        connectionUri: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
        options: { defaultTTL: 3600 },
      },
      priority: 60,
    },
    vector: {
      type: 'vector',
      package: '@synapsedb/plugin-vector',
      config: {},
      priority: 40,
    },
  },
};

// ─── Main ───────────────────────────────────────────────────

async function main() {
  logger.info('🚀 Starting SynapseDB Demo...');

  const engine = new SynapseEngine(config);

  try {
    // Initialize engine & all plugins
    await engine.initialize();

    // Register data manifests
    const usersRouting = await engine.registerManifest(usersManifest);
    const productsRouting = await engine.registerManifest(productsManifest);

    logger.info('');
    logger.info('📊 Routing Maps:');
    logger.info('─────────────────────────────────────');

    for (const [field, route] of Object.entries(usersRouting.fieldRoutes)) {
      logger.info(`  users.${field} → ${route.store} (${route.reason})`);
    }

    logger.info('');

    for (const [field, route] of Object.entries(productsRouting.fieldRoutes)) {
      logger.info(`  products.${field} → ${route.store} (${route.reason})`);
    }

    logger.info('');
    logger.info('─────────────────────────────────────');

    // ── Demo: Insert Users ──────────────────────────────

    logger.info('');
    logger.info('📝 Inserting users...');

    const insertResult = await engine.insert('users', [
      {
        email: 'alice@omnidb.dev',
        name: 'Alice Chen',
        password: 'hashed_password_1',
        bio: 'Full-stack developer passionate about distributed systems and machine learning.',
        profile: {
          avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=alice',
          github: 'alicechen',
          skills: ['TypeScript', 'Rust', 'PostgreSQL'],
        },
        embedding: [0.12, 0.85, 0.33, 0.67],
        lastSeen: new Date().toISOString(),
      },
      {
        email: 'bob@omnidb.dev',
        name: 'Bob Martinez',
        password: 'hashed_password_2',
        bio: 'Backend engineer specializing in database optimization and cloud infrastructure.',
        profile: {
          avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=bob',
          github: 'bobmartinez',
          skills: ['Go', 'Kubernetes', 'MongoDB'],
        },
        embedding: [0.45, 0.22, 0.78, 0.91],
        lastSeen: new Date().toISOString(),
      },
    ]);

    if (insertResult.success) {
      logger.info(`  ✓ Inserted ${insertResult.data?.insertedCount} users`);
      logger.info(`  IDs: ${insertResult.data?.insertedIds.join(', ')}`);
      logger.info(`  Routed to: ${insertResult.meta?.routedTo.join(', ')}`);
      logger.info(`  Took: ${insertResult.meta?.took}ms`);
    }

    // ── Demo: Insert Products ────────────────────────────

    logger.info('');
    logger.info('📝 Inserting products...');

    const productsResult = await engine.insert('products', [
      {
        name: 'SynapseDB Pro License',
        price: 49.99,
        currency: 'USD',
        description: 'Professional license for SynapseDB with priority support and advanced features.',
        metadata: { tier: 'pro', seats: 5, features: ['CDC', 'Vector Search', 'Multi-tenant'] },
        embedding: [0.90, 0.10, 0.50, 0.30],
        stock: 999,
      },
      {
        name: 'SynapseDB Enterprise',
        price: 199.99,
        currency: 'USD',
        description: 'Enterprise license with dedicated support, custom plugins, and SLA guarantees.',
        metadata: { tier: 'enterprise', seats: 100, features: ['All Pro', 'Custom Plugins', 'SLA'] },
        embedding: [0.88, 0.15, 0.55, 0.25],
        stock: 500,
      },
    ]);

    if (productsResult.success) {
      logger.info(`  ✓ Inserted ${productsResult.data?.insertedCount} products`);
    }

    // ── Demo: Query Users (Virtual Join) ─────────────────

    logger.info('');
    logger.info('🔍 Finding user by email (virtual join across stores)...');

    const findResult = await engine.findOne('users', { email: 'alice@omnidb.dev' });

    if (findResult.success && findResult.data) {
      logger.info('  ✓ Found user:');
      logger.info(`    Name: ${findResult.data['name']}`);
      logger.info(`    Email: ${findResult.data['email']}`);
      logger.info(`    Bio: ${findResult.data['bio']}`);
      logger.info(`    Profile: ${JSON.stringify(findResult.data['profile'])}`);
      logger.info(`    Routed to: ${findResult.meta?.routedTo.join(', ')}`);
      logger.info(`    Took: ${findResult.meta?.took}ms`);
    }

    // ── Demo: Vector Search ──────────────────────────────

    logger.info('');
    logger.info('🧠 Vector similarity search (finding similar users)...');

    const searchResult = await engine.search('users', undefined, {
      field: 'embedding',
      vector: [0.10, 0.80, 0.35, 0.70],
      topK: 5,
    });

    if (searchResult.success && searchResult.data) {
      logger.info(`  ✓ Found ${searchResult.data.length} similar users:`);
      for (const result of searchResult.data) {
        logger.info(`    - Score: ${(result['__score'] as number)?.toFixed(4)} | ID: ${result['id']}`);
      }
    }

    // ── Demo: Update ─────────────────────────────────────

    logger.info('');
    logger.info('✏️ Updating user bio and profile...');

    const updateResult = await engine.update(
      'users',
      { email: 'alice@omnidb.dev' },
      {
        bio: 'Full-stack developer & open source maintainer. Building the future of data.',
        lastSeen: new Date().toISOString(),
      },
    );

    if (updateResult.success) {
      logger.info(`  ✓ Matched: ${updateResult.data?.matchedCount}, Modified: ${updateResult.data?.modifiedCount}`);
    }

    // ── Demo: Health Check ───────────────────────────────

    logger.info('');
    logger.info('💚 System health:');

    const health = await engine.health();
    logger.info(`  Status: ${health['status']}`);
    logger.info(`  Collections: ${JSON.stringify(health['collections'])}`);

    // ─────────────────────────────────────────────────────

    logger.info('');
    logger.info('═══════════════════════════════════════');
    logger.info('  🎉 SynapseDB Demo Complete!');
    logger.info('  All operations routed automatically');
    logger.info('  across SQL, NoSQL, Cache & Vector');
    logger.info('═══════════════════════════════════════');
    logger.info('');

    // Graceful shutdown
    await engine.shutdown();

  } catch (error) {
    logger.error('Demo failed:', error);
    await engine.shutdown();
    process.exit(1);
  }
}

main();
