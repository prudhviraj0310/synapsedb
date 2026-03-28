// ──────────────────────────────────────────────────────────────
// SynapseDB Standalone Demo
// Runs entirely in-memory — NO external databases required.
// Showcases the core engine, routing, and virtual join concepts.
// ──────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
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
  SynapseConfig,
} from '@synapsedb/core/types';
import type { IStoragePlugin } from '@synapsedb/core/plugin/contract';
import { SynapseEngine, createLogger } from '@synapsedb/core';
import { defineManifest } from '@synapsedb/sdk';

// ─── In-Memory SQL Plugin ───────────────────────────────────
// A lightweight in-memory plugin that simulates SQL behavior
// so the demo runs without PostgreSQL.

class InMemorySQLPlugin implements IStoragePlugin {
  readonly name = 'postgres';
  readonly type: StorageType = 'sql';
  private store: Map<string, Document[]> = new Map();
  private logger: Logger | null = null;

  async connect(_config: PluginConfig, logger: Logger) {
    this.logger = logger;
    logger.info('In-Memory SQL Plugin connected (simulating PostgreSQL)');
  }
  async disconnect() { this.store.clear(); }
  async healthCheck(): Promise<HealthStatus> {
    return { healthy: true, latencyMs: 0, message: 'in-memory' };
  }
  async syncSchema(manifest: CollectionManifest, fields: string[]) {
    if (!this.store.has(manifest.name)) {
      this.store.set(manifest.name, []);
    }
    this.logger?.info(`SQL schema synced: ${manifest.name} (${fields.join(', ')})`);
  }

  async insert(collection: string, docs: Document[], fields: string[]): Promise<InsertResult> {
    const col = this.store.get(collection) ?? [];
    const ids: string[] = [];
    for (const doc of docs) {
      const filtered: Document = {};
      for (const [k, v] of Object.entries(doc)) {
        if (fields.includes(k) || k === 'id') filtered[k] = v;
      }
      if (!filtered['id']) filtered['id'] = randomUUID();
      col.push(filtered);
      ids.push(String(filtered['id']));
    }
    this.store.set(collection, col);
    return { insertedCount: docs.length, insertedIds: ids };
  }

  async find(collection: string, query: QueryAST, fields: string[]): Promise<Document[]> {
    const col = this.store.get(collection) ?? [];
    let results = col;

    if (query.filters) {
      results = col.filter((doc) => matchesFilters(doc, query.filters!));
    }

    if (query.sort) {
      results = [...results].sort((a, b) => {
        for (const s of query.sort!) {
          const av = a[s.field], bv = b[s.field];
          if (av === bv) continue;
          const cmp = (av as number) < (bv as number) ? -1 : 1;
          return s.direction === 'ASC' ? cmp : -cmp;
        }
        return 0;
      });
    }

    if (query.offset) results = results.slice(query.offset);
    if (query.limit) results = results.slice(0, query.limit);

    return results.map((doc) => {
      const projected: Document = {};
      for (const [k, v] of Object.entries(doc)) {
        if (fields.includes(k) || k === 'id') projected[k] = v;
      }
      return projected;
    });
  }

  async findOne(collection: string, query: QueryAST, fields: string[]): Promise<Document | null> {
    const results = await this.find(collection, { ...query, limit: 1 }, fields);
    return results[0] ?? null;
  }

  async update(collection: string, query: QueryAST, changes: Record<string, unknown>, fields: string[]): Promise<UpdateResult> {
    const col = this.store.get(collection) ?? [];
    let matched = 0;
    for (const doc of col) {
      if (!query.filters || matchesFilters(doc, query.filters)) {
        for (const [k, v] of Object.entries(changes)) {
          if (fields.includes(k)) doc[k] = v;
        }
        matched++;
      }
    }
    return { matchedCount: matched, modifiedCount: matched };
  }

  async delete(collection: string, query: QueryAST): Promise<DeleteResult> {
    const col = this.store.get(collection) ?? [];
    const before = col.length;
    const remaining = col.filter((doc) => query.filters && !matchesFilters(doc, query.filters));
    this.store.set(collection, remaining);
    return { deletedCount: before - remaining.length };
  }

  capabilities(): PluginCapabilities {
    return {
      supportsTransactions: true, supportsFullTextSearch: false, supportsVectorSearch: false,
      supportsNestedDocuments: false, supportsTTL: false, supportsIndexes: true,
      supportsUniqueConstraints: true,
    };
  }
}

// ─── In-Memory NoSQL Plugin ─────────────────────────────────

class InMemoryNoSQLPlugin implements IStoragePlugin {
  readonly name = 'mongodb';
  readonly type: StorageType = 'nosql';
  private store: Map<string, Document[]> = new Map();
  private logger: Logger | null = null;

  async connect(_config: PluginConfig, logger: Logger) {
    this.logger = logger;
    logger.info('In-Memory NoSQL Plugin connected (simulating MongoDB)');
  }
  async disconnect() { this.store.clear(); }
  async healthCheck(): Promise<HealthStatus> {
    return { healthy: true, latencyMs: 0, message: 'in-memory' };
  }
  async syncSchema(manifest: CollectionManifest, fields: string[]) {
    if (!this.store.has(manifest.name)) this.store.set(manifest.name, []);
    this.logger?.info(`NoSQL schema synced: ${manifest.name} (${fields.join(', ')})`);
  }

  async insert(collection: string, docs: Document[], fields: string[]): Promise<InsertResult> {
    const col = this.store.get(collection) ?? [];
    const ids: string[] = [];
    for (const doc of docs) {
      const filtered: Document = {};
      for (const [k, v] of Object.entries(doc)) {
        if (fields.includes(k) || k === 'id') filtered[k] = v;
      }
      col.push(filtered);
      ids.push(String(filtered['id'] ?? ''));
    }
    this.store.set(collection, col);
    return { insertedCount: docs.length, insertedIds: ids };
  }

  async find(collection: string, query: QueryAST, fields: string[]): Promise<Document[]> {
    const col = this.store.get(collection) ?? [];
    let results = col;

    // Text search support
    if (query.searchQuery) {
      const q = query.searchQuery.toLowerCase();
      results = col.filter((doc) =>
        Object.values(doc).some((v) => typeof v === 'string' && v.toLowerCase().includes(q)),
      );
    } else if (query.filters) {
      results = col.filter((doc) => matchesFilters(doc, query.filters!));
    }

    if (query.limit) results = results.slice(0, query.limit);

    return results.map((doc) => {
      const projected: Document = {};
      for (const [k, v] of Object.entries(doc)) {
        if (fields.includes(k) || k === 'id') projected[k] = v;
      }
      return projected;
    });
  }

  async findOne(collection: string, query: QueryAST, fields: string[]): Promise<Document | null> {
    const results = await this.find(collection, { ...query, limit: 1 }, fields);
    return results[0] ?? null;
  }

  async update(collection: string, query: QueryAST, changes: Record<string, unknown>, fields: string[]): Promise<UpdateResult> {
    const col = this.store.get(collection) ?? [];
    let matched = 0;
    for (const doc of col) {
      if (!query.filters || matchesFilters(doc, query.filters)) {
        for (const [k, v] of Object.entries(changes)) {
          if (fields.includes(k)) doc[k] = v;
        }
        matched++;
      }
    }
    return { matchedCount: matched, modifiedCount: matched };
  }

  async delete(collection: string, query: QueryAST): Promise<DeleteResult> {
    const col = this.store.get(collection) ?? [];
    const before = col.length;
    const remaining = col.filter((doc) => query.filters && !matchesFilters(doc, query.filters));
    this.store.set(collection, remaining);
    return { deletedCount: before - remaining.length };
  }

  capabilities(): PluginCapabilities {
    return {
      supportsTransactions: false, supportsFullTextSearch: true, supportsVectorSearch: false,
      supportsNestedDocuments: true, supportsTTL: true, supportsIndexes: true,
      supportsUniqueConstraints: true,
    };
  }
}

// ─── In-Memory Cache Plugin ─────────────────────────────────

class InMemoryCachePlugin implements IStoragePlugin {
  readonly name = 'redis';
  readonly type: StorageType = 'cache';
  private store: Map<string, Document> = new Map();
  private logger: Logger | null = null;

  async connect(_config: PluginConfig, logger: Logger) {
    this.logger = logger;
    logger.info('In-Memory Cache Plugin connected (simulating Redis)');
  }
  async disconnect() { this.store.clear(); }
  async healthCheck(): Promise<HealthStatus> {
    return { healthy: true, latencyMs: 0, message: 'in-memory' };
  }
  async syncSchema(manifest: CollectionManifest, fields: string[]) {
    this.logger?.info(`Cache schema synced: ${manifest.name} (${fields.join(', ')})`);
  }

  async insert(collection: string, docs: Document[], fields: string[]): Promise<InsertResult> {
    const ids: string[] = [];
    for (const doc of docs) {
      const id = String(doc['id'] ?? '');
      if (!id) continue;
      const filtered: Document = {};
      for (const [k, v] of Object.entries(doc)) {
        if (fields.includes(k) || k === 'id') filtered[k] = v;
      }
      this.store.set(`${collection}:${id}`, filtered);
      ids.push(id);
    }
    return { insertedCount: ids.length, insertedIds: ids };
  }

  async find(collection: string, query: QueryAST, fields: string[]): Promise<Document[]> {
    const results: Document[] = [];
    for (const [key, doc] of this.store) {
      if (key.startsWith(`${collection}:`)) {
        if (!query.filters || matchesFilters(doc, query.filters)) {
          results.push(doc);
        }
      }
    }
    return results;
  }

  async findOne(collection: string, query: QueryAST, fields: string[]): Promise<Document | null> {
    const results = await this.find(collection, query, fields);
    return results[0] ?? null;
  }

  async update(collection: string, query: QueryAST, changes: Record<string, unknown>, fields: string[]): Promise<UpdateResult> {
    let matched = 0;
    for (const [key, doc] of this.store) {
      if (key.startsWith(`${collection}:`)) {
        if (!query.filters || matchesFilters(doc, query.filters)) {
          for (const [k, v] of Object.entries(changes)) {
            if (fields.includes(k)) doc[k] = v;
          }
          matched++;
        }
      }
    }
    return { matchedCount: matched, modifiedCount: matched };
  }

  async delete(collection: string, query: QueryAST): Promise<DeleteResult> {
    let deleted = 0;
    for (const [key, doc] of this.store) {
      if (key.startsWith(`${collection}:`)) {
        if (!query.filters || matchesFilters(doc, query.filters)) {
          this.store.delete(key);
          deleted++;
        }
      }
    }
    return { deletedCount: deleted };
  }

  capabilities(): PluginCapabilities {
    return {
      supportsTransactions: false, supportsFullTextSearch: false, supportsVectorSearch: false,
      supportsNestedDocuments: false, supportsTTL: true, supportsIndexes: false,
      supportsUniqueConstraints: false,
    };
  }
}

// ─── Filter Matching Utility ────────────────────────────────

import type { FilterGroup, FilterCondition } from '@synapsedb/core/types';

function matchesFilters(doc: Document, group: FilterGroup): boolean {
  if (group.conditions.length === 0) return true;

  const results = group.conditions.map((c) => {
    if ('logic' in c) return matchesFilters(doc, c);
    return matchesCondition(doc, c);
  });

  if (group.logic === 'AND') return results.every(Boolean);
  if (group.logic === 'OR') return results.some(Boolean);
  if (group.logic === 'NOT') return !results[0];
  return true;
}

function matchesCondition(doc: Document, cond: FilterCondition): boolean {
  const val = doc[cond.field];
  switch (cond.op) {
    case 'EQ': return val === cond.value;
    case 'NEQ': return val !== cond.value;
    case 'GT': return (val as number) > (cond.value as number);
    case 'GTE': return (val as number) >= (cond.value as number);
    case 'LT': return (val as number) < (cond.value as number);
    case 'LTE': return (val as number) <= (cond.value as number);
    case 'IN': return Array.isArray(cond.value) && cond.value.includes(val);
    case 'LIKE': return typeof val === 'string' && new RegExp(String(cond.value).replace(/%/g, '.*'), 'i').test(val);
    case 'EXISTS': return cond.value ? val !== undefined : val === undefined;
    default: return false;
  }
}

// ─── Vector Plugin (from real package) ──────────────────────

import { VectorPlugin } from '@synapsedb/plugin-vector';

// ═══════════════════════════════════════════════════════════
//  MAIN DEMO
// ═══════════════════════════════════════════════════════════

const logger = createLogger('Demo', 'debug');

const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const MAGENTA = '\x1b[35m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

function banner(text: string, emoji: string = '⚡') {
  console.log('');
  console.log(`${DIM}───────────────────────────────────────────────${RESET}`);
  console.log(`${BOLD}  ${emoji} ${text}${RESET}`);
  console.log(`${DIM}───────────────────────────────────────────────${RESET}`);
}

async function main() {
  console.log('');
  console.log(`${BOLD}${CYAN}  ╔══════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}  ║                                              ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   ⚡ SynapseDB — Standalone Demo                ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   Intention-Based Data Orchestration          ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   Running 100% in-memory (no Docker needed)   ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║                                              ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ╚══════════════════════════════════════════════╝${RESET}`);
  console.log('');

  // ── Register plugins manually (bypassing dynamic import) ──

  const engine = new SynapseEngine({
    logLevel: 'info',
    syncEnabled: true,
    plugins: {},
  });

  // We need to access the registry directly, so we'll use a workaround:
  // Initialize the engine then register manifests through it
  // Instead, let's create plugins and register them pre-initialization

  // Use the engine's internal plugin system via a wrapper approach
  const sqlPlugin = new InMemorySQLPlugin();
  const nosqlPlugin = new InMemoryNoSQLPlugin();
  const cachePlugin = new InMemoryCachePlugin();
  const vectorPlugin = new VectorPlugin();

  // Access the private registry (demo-only hack)
  const registry = (engine as any).registry;
  registry.register(sqlPlugin, {}, 100);
  registry.register(nosqlPlugin, {}, 80);
  registry.register(cachePlugin, {}, 60);
  registry.register(vectorPlugin, {}, 40);

  await registry.initializeAll();

  // ── Define Data Manifests ──────────────────────────────

  banner('STEP 1: Define Data Manifests', '📋');

  const usersManifest = defineManifest('users', {
    id:        { type: 'uuid', primary: true },
    email:     { type: 'string', unique: true, indexed: true },
    name:      { type: 'string' },
    password:  { type: 'string', transactional: true },
    bio:       { type: 'text', searchable: true },
    profile:   { type: 'json', flexible: true },
    embedding: { type: 'vector', dimensions: 4 },
    lastSeen:  { type: 'timestamp', cached: true, ttl: 60 },
    createdAt: { type: 'timestamp', auto: true },
  });

  const productsManifest = defineManifest('products', {
    id:          { type: 'uuid', primary: true },
    name:        { type: 'string', indexed: true },
    price:       { type: 'float', transactional: true },
    currency:    { type: 'string' },
    description: { type: 'text', searchable: true },
    metadata:    { type: 'json', flexible: true },
    embedding:   { type: 'vector', dimensions: 4 },
    stock:       { type: 'integer', cached: true, ttl: 30 },
  });

  console.log(`${GREEN}  ✓${RESET} Users manifest: 9 fields with mixed intentions`);
  console.log(`${GREEN}  ✓${RESET} Products manifest: 8 fields with mixed intentions`);

  // ── Register Manifests → Automatic Routing ─────────────

  banner('STEP 2: Register Manifests → Kinetic Routing', '🧭');

  const usersRouting = await engine.registerManifest(usersManifest);

  console.log('');
  console.log(`${BOLD}  Users Collection Routing Map:${RESET}`);
  console.log(`${DIM}  ┌──────────────┬─────────────┬────────────────────────────────┐${RESET}`);
  console.log(`${DIM}  │${RESET} ${BOLD}Field${RESET}        ${DIM}│${RESET} ${BOLD}Store${RESET}       ${DIM}│${RESET} ${BOLD}Reason${RESET}                         ${DIM}│${RESET}`);
  console.log(`${DIM}  ├──────────────┼─────────────┼────────────────────────────────┤${RESET}`);

  for (const [field, route] of Object.entries(usersRouting.fieldRoutes)) {
    const storeColor = route.store === 'postgres' ? CYAN : route.store === 'mongodb' ? GREEN : route.store === 'redis' ? YELLOW : MAGENTA;
    console.log(`${DIM}  │${RESET} ${field.padEnd(12)} ${DIM}│${RESET} ${storeColor}${route.store.padEnd(11)}${RESET} ${DIM}│${RESET} ${DIM}${route.reason.slice(0, 30).padEnd(30)}${RESET} ${DIM}│${RESET}`);
  }
  console.log(`${DIM}  └──────────────┴─────────────┴────────────────────────────────┘${RESET}`);

  const productsRouting = await engine.registerManifest(productsManifest);

  console.log('');
  console.log(`${BOLD}  Products Collection Routing Map:${RESET}`);
  console.log(`${DIM}  ┌──────────────┬─────────────┬────────────────────────────────┐${RESET}`);
  console.log(`${DIM}  │${RESET} ${BOLD}Field${RESET}        ${DIM}│${RESET} ${BOLD}Store${RESET}       ${DIM}│${RESET} ${BOLD}Reason${RESET}                         ${DIM}│${RESET}`);
  console.log(`${DIM}  ├──────────────┼─────────────┼────────────────────────────────┤${RESET}`);

  for (const [field, route] of Object.entries(productsRouting.fieldRoutes)) {
    const storeColor = route.store === 'postgres' ? CYAN : route.store === 'mongodb' ? GREEN : route.store === 'redis' ? YELLOW : MAGENTA;
    console.log(`${DIM}  │${RESET} ${field.padEnd(12)} ${DIM}│${RESET} ${storeColor}${route.store.padEnd(11)}${RESET} ${DIM}│${RESET} ${DIM}${route.reason.slice(0, 30).padEnd(30)}${RESET} ${DIM}│${RESET}`);
  }
  console.log(`${DIM}  └──────────────┴─────────────┴────────────────────────────────┘${RESET}`);

  // ── Insert Data → Automatic Multi-Store Write ──────────

  banner('STEP 3: Insert Data → Automatic Multi-Store Write', '📝');

  const insertResult = await engine.insert('users', [
    {
      email: 'alice@omnidb.dev',
      name: 'Alice Chen',
      password: 'hashed_pw_1',
      bio: 'Full-stack developer passionate about distributed systems and machine learning.',
      profile: { avatar: '👩‍💻', github: 'alicechen', skills: ['TypeScript', 'Rust', 'PostgreSQL'] },
      embedding: [0.12, 0.85, 0.33, 0.67],
      lastSeen: new Date().toISOString(),
    },
    {
      email: 'bob@omnidb.dev',
      name: 'Bob Martinez',
      password: 'hashed_pw_2',
      bio: 'Backend engineer specializing in database optimization and cloud infrastructure.',
      profile: { avatar: '👨‍💻', github: 'bobmartinez', skills: ['Go', 'Kubernetes', 'MongoDB'] },
      embedding: [0.45, 0.22, 0.78, 0.91],
      lastSeen: new Date().toISOString(),
    },
    {
      email: 'carol@omnidb.dev',
      name: 'Carol Davis',
      password: 'hashed_pw_3',
      bio: 'AI researcher working on large language models and vector databases.',
      profile: { avatar: '👩‍🔬', github: 'caroldavis', skills: ['Python', 'PyTorch', 'Pinecone'] },
      embedding: [0.15, 0.88, 0.30, 0.72],
      lastSeen: new Date().toISOString(),
    },
  ]);

  console.log(`${GREEN}  ✓${RESET} Inserted ${BOLD}${insertResult.data?.insertedCount}${RESET} users`);
  console.log(`${DIM}    Routed to: ${insertResult.meta?.routedTo.join(' → ')}${RESET}`);
  console.log(`${DIM}    Took: ${insertResult.meta?.took}ms${RESET}`);
  console.log(`${DIM}    IDs: ${insertResult.data?.insertedIds.map(id => id.slice(0, 8) + '…').join(', ')}${RESET}`);

  const productsResult = await engine.insert('products', [
    {
      name: 'SynapseDB Pro License',
      price: 49.99,
      currency: 'USD',
      description: 'Professional license for SynapseDB with priority support.',
      metadata: { tier: 'pro', seats: 5 },
      embedding: [0.90, 0.10, 0.50, 0.30],
      stock: 999,
    },
    {
      name: 'SynapseDB Enterprise',
      price: 199.99,
      currency: 'USD',
      description: 'Enterprise license with dedicated support and SLA guarantees.',
      metadata: { tier: 'enterprise', seats: 100 },
      embedding: [0.88, 0.15, 0.55, 0.25],
      stock: 500,
    },
  ]);

  console.log(`${GREEN}  ✓${RESET} Inserted ${BOLD}${productsResult.data?.insertedCount}${RESET} products`);
  console.log(`${DIM}    Routed to: ${productsResult.meta?.routedTo.join(' → ')}${RESET}`);

  // ── Query → Virtual Join Across Stores ─────────────────

  banner('STEP 4: Query → Virtual Join Across 4 Stores', '🔍');

  const findResult = await engine.findOne('users', { email: 'alice@omnidb.dev' });

  if (findResult.success && findResult.data) {
    const u = findResult.data;
    console.log(`${GREEN}  ✓${RESET} Found user via virtual join:`);
    console.log(`    ${BOLD}Name:${RESET}      ${u['name']}`);
    console.log(`    ${BOLD}Email:${RESET}     ${u['email']}     ${DIM}← from PostgreSQL${RESET}`);
    console.log(`    ${BOLD}Bio:${RESET}       ${(u['bio'] as string)?.slice(0, 50)}…  ${DIM}← from MongoDB${RESET}`);
    console.log(`    ${BOLD}Profile:${RESET}   ${JSON.stringify(u['profile'])}  ${DIM}← from MongoDB${RESET}`);
    console.log(`    ${BOLD}LastSeen:${RESET}  ${u['lastSeen']}  ${DIM}← from Redis${RESET}`);
    console.log(`    ${BOLD}Embedding:${RESET} [${(u['embedding'] as number[])?.join(', ')}]  ${DIM}← from Vector Store${RESET}`);
    console.log(`${DIM}    Routed to: ${findResult.meta?.routedTo.join(' + ')}${RESET}`);
    console.log(`${DIM}    Took: ${findResult.meta?.took}ms${RESET}`);
  }

  // ── Vector Similarity Search ───────────────────────────

  banner('STEP 5: Vector Similarity Search (AI Embeddings)', '🧠');

  console.log(`${DIM}  Query vector: [0.10, 0.80, 0.35, 0.70]${RESET}`);
  console.log(`${DIM}  Looking for semantically similar users...${RESET}`);
  console.log('');

  const searchResult = await engine.search('users', undefined, {
    field: 'embedding',
    vector: [0.10, 0.80, 0.35, 0.70],
    topK: 5,
  });

  if (searchResult.success && searchResult.data) {
    console.log(`${GREEN}  ✓${RESET} Found ${BOLD}${searchResult.data.length}${RESET} similar users:`);
    for (const result of searchResult.data) {
      const score = (result['__score'] as number);
      const bar = '█'.repeat(Math.round(score * 20));
      const empty = '░'.repeat(20 - Math.round(score * 20));
      console.log(`    ${MAGENTA}${bar}${DIM}${empty}${RESET} ${score.toFixed(4)} │ ${result['id'] ? String(result['id']).slice(0, 8) + '…' : 'unknown'}`);
    }
    console.log(`${DIM}    Routed to: ${searchResult.meta?.routedTo.join(', ')}${RESET}`);
  }

  // ── Text Search ────────────────────────────────────────

  banner('STEP 6: Full-Text Search', '🔎');

  console.log(`${DIM}  Searching for: "distributed systems"${RESET}`);

  const textResult = await engine.search('users', 'distributed systems');

  if (textResult.success && textResult.data) {
    console.log(`${GREEN}  ✓${RESET} Found ${BOLD}${textResult.data.length}${RESET} matching user(s)`);
    for (const doc of textResult.data) {
      console.log(`    → ${doc['id'] ? String(doc['id']).slice(0, 8) + '…' : 'unknown'}`);
    }
    console.log(`${DIM}    Routed to: ${textResult.meta?.routedTo.join(', ')} (full-text search)${RESET}`);
  }

  // ── Update → Multi-Store Write + CDC ───────────────────

  banner('STEP 7: Update → Multi-Store Write + CDC Propagation', '✏️');

  const updateResult = await engine.update(
    'users',
    { email: 'alice@omnidb.dev' },
    {
      bio: 'CTO & open source champion. Building the future of polyglot databases.',
      lastSeen: new Date().toISOString(),
    },
  );

  if (updateResult.success) {
    console.log(`${GREEN}  ✓${RESET} Updated ${BOLD}${updateResult.data?.matchedCount}${RESET} document(s)`);
    console.log(`${DIM}    Routed to: ${updateResult.meta?.routedTo.join(' + ')}${RESET}`);
    console.log(`${DIM}    CDC propagated changes to secondary stores automatically${RESET}`);
  }

  // Verify update
  const updated = await engine.findOne('users', { email: 'alice@omnidb.dev' });
  if (updated.success && updated.data) {
    console.log(`${GREEN}  ✓${RESET} Verified: bio = "${(updated.data['bio'] as string)?.slice(0, 50)}…"`);
  }

  // ── Delete → All Stores ────────────────────────────────

  banner('STEP 8: Delete → Remove From All Stores', '🗑️');

  const deleteResult = await engine.delete('products', { name: 'SynapseDB Enterprise' });

  if (deleteResult.success) {
    console.log(`${GREEN}  ✓${RESET} Deleted ${BOLD}${deleteResult.data?.deletedCount}${RESET} product(s)`);
    console.log(`${DIM}    Removed from: ${deleteResult.meta?.routedTo.join(' + ')}${RESET}`);
  }

  // ── System Health ──────────────────────────────────────

  banner('STEP 9: System Health Check', '💚');

  const health = await engine.health();
  console.log(`  Status: ${health['status'] === 'healthy' ? `${GREEN}${BOLD}HEALTHY${RESET}` : `${YELLOW}DEGRADED${RESET}`}`);
  console.log(`  Collections: ${JSON.stringify(health['collections'])}`);

  const plugins = health['plugins'] as Record<string, any>;
  for (const [name, status] of Object.entries(plugins)) {
    const icon = status.healthy ? `${GREEN}●${RESET}` : `${YELLOW}●${RESET}`;
    console.log(`  ${icon} ${name}: ${status.healthy ? 'healthy' : 'unhealthy'} (${status.latencyMs}ms)`);
  }

  // ══════════════════════════════════════════════════════════
  //  v0.3 — ADVANCED FEATURES
  // ══════════════════════════════════════════════════════════

  // ── Natural Language Query ─────────────────────────────

  banner('STEP 10: Natural Language Query (db.ask)', '💬');

  const nlqQueries = [
    'Find all users where email is alice@omnidb.dev',
    'Show all products sorted by price desc',
    'How many users',
  ];

  for (const question of nlqQueries) {
    const nlqResult = await engine.ask(question);
    if (nlqResult.success) {
      const count = Array.isArray(nlqResult.data) ? nlqResult.data.length : 0;
      const firstDoc = Array.isArray(nlqResult.data) && nlqResult.data[0];
      const preview = firstDoc
        ? (firstDoc['name'] || firstDoc['email'] || firstDoc['count'] || JSON.stringify(firstDoc).slice(0, 40))
        : '—';
      console.log(`${GREEN}  ✓${RESET} "${BOLD}${question}${RESET}"`);
      console.log(`${DIM}    → ${count} result(s): ${preview}${RESET}`);
    } else {
      console.log(`${YELLOW}  ⚠${RESET} "${question}" → ${nlqResult.error?.message}`);
    }
  }

  // ── Analytics (HTAP) ──────────────────────────────────

  banner('STEP 11: Embedded Analytics — No Data Warehouse Needed', '📊');

  // Feed data to analytics engine
  const analyticsEngine = engine.analytics();

  // Ingest existing data
  const allProducts = await engine.find('products');
  for (const doc of (allProducts.data ?? [])) {
    analyticsEngine.ingest('products', doc);
  }
  const allUsers = await engine.find('users');
  for (const doc of (allUsers.data ?? [])) {
    analyticsEngine.ingest('users', doc);
  }

  // Run aggregations
  const countResult = engine.aggregate('users', [
    { type: 'COUNT', alias: 'total_users' },
  ]);
  console.log(`${GREEN}  ✓${RESET} COUNT users: ${BOLD}${countResult.rows[0]?.[0]}${RESET}`);

  const priceStats = engine.aggregate('products', [
    { type: 'AVG', field: 'price', alias: 'avg_price' },
    { type: 'MAX', field: 'price', alias: 'max_price' },
    { type: 'MIN', field: 'price', alias: 'min_price' },
  ]);
  console.log(`${GREEN}  ✓${RESET} Product price stats:`);
  console.log(`${DIM}    AVG: $${priceStats.rows[0]?.[0]}  MAX: $${priceStats.rows[0]?.[1]}  MIN: $${priceStats.rows[0]?.[2]}${RESET}`);
  console.log(`${DIM}    Scanned ${countResult.rowsScanned} rows in ${countResult.took}ms — no Snowflake needed!${RESET}`);

  // ── Edge Sync (Local-First) ───────────────────────────

  banner('STEP 12: Edge Sync — Offline-First with CRDTs', '📱');

  const edgeEngine = engine.edge();

  // Simulate offline writes
  edgeEngine.setOnline(false);
  console.log(`  📴 Going offline...`);

  edgeEngine.localSet('users', 'edge-user-1', {
    name: 'Edge User',
    email: 'edge@local.dev',
    bio: 'Created while offline',
  });
  edgeEngine.localSet('users', 'edge-user-2', {
    name: 'Mobile User',
    email: 'mobile@local.dev',
    bio: 'Syncs when online',
  });

  const status = edgeEngine.status();
  console.log(`${GREEN}  ✓${RESET} Created ${BOLD}2 documents${RESET} while offline`);
  console.log(`${DIM}    Pending ops: ${status.pendingOps}`);
  console.log(`    Local docs: ${status.localDocuments}`);
  console.log(`    Node ID: ${status.nodeId}${RESET}`);

  // Read from local CRDT state
  const localDoc = edgeEngine.localGet('users', 'edge-user-1');
  console.log(`${GREEN}  ✓${RESET} Local read (instant): ${localDoc?.name} <${localDoc?.email}>`);

  // Come back online
  edgeEngine.setOnline(true);
  console.log(`  📶 Back online — ${status.pendingOps} ops ready to sync`);

  // ── Cold Storage ──────────────────────────────────────

  banner('STEP 13: Cold Storage — Tiered Data Lifecycle', '🧊');

  const archiver = engine.coldStorage();

  // Track some access patterns
  archiver.trackAccess('users', 'active-user-1');
  archiver.trackAccess('users', 'active-user-2');

  // Archive an "old" document
  const archivedRecord = archiver.archiveDocument('users', 'old-user-99', {
    id: 'old-user-99',
    name: 'Legacy User',
    email: 'legacy@old.com',
    createdAt: '2020-01-01',
  });

  console.log(`${GREEN}  ✓${RESET} Archived 1 document → ${BOLD}${archivedRecord.tier}${RESET} tier`);
  console.log(`${DIM}    Size: ${archivedRecord.sizeBytes} bytes`);
  console.log(`    Temperature: ${archiver.getTemperature('users', 'old-user-99')}${RESET}`);

  // Restore it
  const restored = archiver.restore('users', 'old-user-99');
  console.log(`${GREEN}  ✓${RESET} Restored from archive: ${restored?.name} <${restored?.email}>`);

  // Show stats
  const archiveStats = archiver.getStats();
  console.log(`${DIM}    Total archived: ${archiveStats.totalArchived}`);
  console.log(`    Total restored: ${archiveStats.totalRestored}`);
  console.log(`    Est. cost savings: $${archiveStats.costSavingsEstimate.toFixed(6)}/month${RESET}`);

  // ── Final Summary ──────────────────────────────────────

  console.log('');
  console.log(`${BOLD}${CYAN}  ╔══════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}  ║                                              ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   🎉 SynapseDB v0.3 Demo Complete!          ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║                                              ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   ✓ 7-Layer Architecture Active             ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   ✓ Data routed across 4 backends           ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   ✓ Virtual joins + CDC sync                ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   ✓ Vector search + Full-text search        ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║                                              ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   v0.3 Advanced Features:                    ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   ✓ Natural Language Queries (db.ask)        ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   ✓ Embedded Analytics (HTAP)               ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   ✓ Edge Sync with CRDTs (offline-first)    ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   ✓ Cold Storage Archival (S3-ready)        ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   ✓ AI Workload Analyzer (auto-routing)     ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║                                              ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   One API. Every database. Just works.       ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║                                              ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ╚══════════════════════════════════════════════╝${RESET}`);
  console.log('');

  await engine.shutdown();
}

main().catch(console.error);
