// ══════════════════════════════════════════════════════════════
// SynapseDB — Real-World Stress Tests
// Tests every layer with production-like scenarios.
// ══════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto';
import type {
  StorageType, PluginConfig, HealthStatus, PluginCapabilities,
  CollectionManifest, QueryAST, Document, InsertResult, UpdateResult,
  DeleteResult, Logger, FilterGroup, FilterCondition,
} from '@synapsedb/core/types';
import type { IStoragePlugin } from '@synapsedb/core/plugin/contract';
import { SynapseEngine, createLogger } from '@synapsedb/core';
import { defineManifest } from '@synapsedb/sdk';
import { VectorPlugin } from '@synapsedb/plugin-vector';

// ═══ TEST INFRASTRUCTURE ════════════════════════════════════

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

let totalTests = 0;
let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, testName: string, details?: string) {
  totalTests++;
  if (condition) {
    passed++;
    console.log(`  ${GREEN}✓${RESET} ${testName}`);
  } else {
    failed++;
    const msg = `${testName}${details ? ` — ${details}` : ''}`;
    failures.push(msg);
    console.log(`  ${RED}✗${RESET} ${msg}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, testName: string) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  assert(pass, testName, pass ? undefined : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertGreater(actual: number, min: number, testName: string) {
  assert(actual > min, testName, `expected > ${min}, got ${actual}`);
}

function section(name: string, emoji = '🧪') {
  console.log(`\n${DIM}═══════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  ${emoji} ${name}${RESET}`);
  console.log(`${DIM}═══════════════════════════════════════════════${RESET}`);
}

// ═══ IN-MEMORY PLUGINS (reusable) ═══════════════════════════

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

class MemSQL implements IStoragePlugin {
  readonly name = 'postgres'; readonly type: StorageType = 'sql';
  private store = new Map<string, Document[]>();
  async connect(_c: PluginConfig, _l: Logger) {}
  async disconnect() { this.store.clear(); }
  async healthCheck(): Promise<HealthStatus> { return { healthy: true, latencyMs: 0 }; }
  async syncSchema(m: CollectionManifest, f: string[]) { if (!this.store.has(m.name)) this.store.set(m.name, []); }
  async insert(col: string, docs: Document[], fields: string[]): Promise<InsertResult> {
    const c = this.store.get(col) ?? []; const ids: string[] = [];
    for (const d of docs) {
      const f: Document = {}; for (const [k,v] of Object.entries(d)) if (fields.includes(k)||k==='id') f[k]=v;
      if (!f['id']) f['id'] = randomUUID(); c.push(f); ids.push(String(f['id']));
    }
    this.store.set(col, c); return { insertedCount: docs.length, insertedIds: ids };
  }
  async find(col: string, q: QueryAST, fields: string[]): Promise<Document[]> {
    let r = this.store.get(col) ?? [];
    if (q.filters) r = r.filter(d => matchesFilters(d, q.filters!));
    if (q.sort) r = [...r].sort((a,b) => { for (const s of q.sort!) { const av=a[s.field], bv=b[s.field]; if (av===bv) continue; const c = (av as number)<(bv as number)?-1:1; return s.direction==='ASC'?c:-c; } return 0; });
    if (q.offset) r = r.slice(q.offset);
    if (q.limit) r = r.slice(0, q.limit);
    return r.map(d => { const p: Document = {}; for (const [k,v] of Object.entries(d)) if (fields.includes(k)||k==='id') p[k]=v; return p; });
  }
  async findOne(col: string, q: QueryAST, f: string[]) { const r = await this.find(col,{...q,limit:1},f); return r[0]??null; }
  async update(col: string, q: QueryAST, ch: Record<string,unknown>, f: string[]): Promise<UpdateResult> {
    const c = this.store.get(col)??[]; let m=0;
    for (const d of c) { if (!q.filters||matchesFilters(d,q.filters)) { for (const[k,v] of Object.entries(ch)) if(f.includes(k)) d[k]=v; m++; } }
    return { matchedCount: m, modifiedCount: m };
  }
  async delete(col: string, q: QueryAST): Promise<DeleteResult> {
    const c = this.store.get(col)??[]; const b=c.length;
    const r = c.filter(d => q.filters && !matchesFilters(d, q.filters)); this.store.set(col,r);
    return { deletedCount: b-r.length };
  }
  capabilities(): PluginCapabilities { return { supportsTransactions:true,supportsFullTextSearch:false,supportsVectorSearch:false,supportsNestedDocuments:false,supportsTTL:false,supportsIndexes:true,supportsUniqueConstraints:true }; }
}

class MemNoSQL implements IStoragePlugin {
  readonly name = 'mongodb'; readonly type: StorageType = 'nosql';
  private store = new Map<string, Document[]>();
  async connect() {} async disconnect() { this.store.clear(); }
  async healthCheck(): Promise<HealthStatus> { return { healthy: true, latencyMs: 0 }; }
  async syncSchema(m: CollectionManifest) { if (!this.store.has(m.name)) this.store.set(m.name, []); }
  async insert(col: string, docs: Document[], fields: string[]): Promise<InsertResult> {
    const c = this.store.get(col)??[]; const ids: string[] = [];
    for (const d of docs) { const f: Document = {}; for (const[k,v] of Object.entries(d)) if(fields.includes(k)||k==='id') f[k]=v; c.push(f); ids.push(String(f['id']??'')); }
    this.store.set(col, c); return { insertedCount: docs.length, insertedIds: ids };
  }
  async find(col: string, q: QueryAST, fields: string[]): Promise<Document[]> {
    let r = this.store.get(col)??[];
    if (q.searchQuery) { const s = q.searchQuery.toLowerCase(); r = r.filter(d => Object.values(d).some(v => typeof v==='string'&&v.toLowerCase().includes(s))); }
    else if (q.filters) r = r.filter(d => matchesFilters(d, q.filters!));
    if (q.limit) r = r.slice(0, q.limit);
    return r.map(d => { const p: Document={}; for(const[k,v] of Object.entries(d)) if(fields.includes(k)||k==='id') p[k]=v; return p; });
  }
  async findOne(col: string, q: QueryAST, f: string[]) { const r = await this.find(col,{...q,limit:1},f); return r[0]??null; }
  async update(col: string, q: QueryAST, ch: Record<string,unknown>, f: string[]): Promise<UpdateResult> {
    const c = this.store.get(col)??[]; let m=0;
    for (const d of c) { if (!q.filters||matchesFilters(d,q.filters)) { for(const[k,v] of Object.entries(ch)) if(f.includes(k)) d[k]=v; m++; } }
    return { matchedCount: m, modifiedCount: m };
  }
  async delete(col: string, q: QueryAST): Promise<DeleteResult> {
    const c = this.store.get(col)??[]; const b=c.length;
    const r = c.filter(d => q.filters && !matchesFilters(d, q.filters)); this.store.set(col,r);
    return { deletedCount: b-r.length };
  }
  capabilities(): PluginCapabilities { return { supportsTransactions:false,supportsFullTextSearch:true,supportsVectorSearch:false,supportsNestedDocuments:true,supportsTTL:true,supportsIndexes:true,supportsUniqueConstraints:true }; }
}

class MemCache implements IStoragePlugin {
  readonly name = 'redis'; readonly type: StorageType = 'cache';
  private store = new Map<string, Document>();
  async connect() {} async disconnect() { this.store.clear(); }
  async healthCheck(): Promise<HealthStatus> { return { healthy: true, latencyMs: 0 }; }
  async syncSchema() {}
  async insert(col: string, docs: Document[], fields: string[]): Promise<InsertResult> {
    const ids: string[] = [];
    for (const d of docs) { const id=String(d['id']??''); if(!id) continue; const f: Document={}; for(const[k,v] of Object.entries(d)) if(fields.includes(k)||k==='id') f[k]=v; this.store.set(`${col}:${id}`,f); ids.push(id); }
    return { insertedCount: ids.length, insertedIds: ids };
  }
  async find(col: string, q: QueryAST): Promise<Document[]> {
    const r: Document[] = [];
    for (const [key,doc] of this.store) { if (key.startsWith(`${col}:`)) { if (!q.filters||matchesFilters(doc,q.filters)) r.push(doc); } }
    return r;
  }
  async findOne(col: string, q: QueryAST) { const r = await this.find(col,q); return r[0]??null; }
  async update(col: string, q: QueryAST, ch: Record<string,unknown>, f: string[]): Promise<UpdateResult> {
    let m=0;
    for (const [key,doc] of this.store) { if (key.startsWith(`${col}:`)) { if (!q.filters||matchesFilters(doc,q.filters)) { for(const[k,v] of Object.entries(ch)) if(f.includes(k)) doc[k]=v; m++; } } }
    return { matchedCount: m, modifiedCount: m };
  }
  async delete(col: string, q: QueryAST): Promise<DeleteResult> {
    let d=0;
    for (const [key,doc] of this.store) { if (key.startsWith(`${col}:`)&&(!q.filters||matchesFilters(doc,q.filters))) { this.store.delete(key); d++; } }
    return { deletedCount: d };
  }
  capabilities(): PluginCapabilities { return { supportsTransactions:false,supportsFullTextSearch:false,supportsVectorSearch:false,supportsNestedDocuments:false,supportsTTL:true,supportsIndexes:false,supportsUniqueConstraints:false }; }
}

// ═══ ENGINE FACTORY ═════════════════════════════════════════

async function createTestEngine(): Promise<SynapseEngine> {
  const engine = new SynapseEngine({ logLevel: 'warn', syncEnabled: true, plugins: {} });
  const reg = (engine as any).registry;
  reg.register(new MemSQL(), {}, 100);
  reg.register(new MemNoSQL(), {}, 80);
  reg.register(new MemCache(), {}, 60);
  reg.register(new VectorPlugin(), {}, 40);
  await reg.initializeAll();
  return engine;
}

// ═══ TEST SUITES ════════════════════════════════════════════

async function testEcommerce() {
  section('TEST 1: E-Commerce Platform', '🛒');
  const engine = await createTestEngine();

  // Define realistic e-commerce manifests
  const products = defineManifest('products', {
    id: { type: 'uuid', primary: true },
    name: { type: 'string', indexed: true },
    price: { type: 'float', transactional: true },
    category: { type: 'string', indexed: true },
    description: { type: 'text', searchable: true },
    metadata: { type: 'json', flexible: true },
    embedding: { type: 'vector', dimensions: 4 },
    stockCount: { type: 'integer', cached: true, ttl: 30 },
  });

  const orders = defineManifest('orders', {
    id: { type: 'uuid', primary: true },
    userId: { type: 'string', indexed: true },
    total: { type: 'float', transactional: true },
    status: { type: 'string', indexed: true },
    items: { type: 'json', flexible: true },
    notes: { type: 'text', searchable: true },
  });

  const customers = defineManifest('customers', {
    id: { type: 'uuid', primary: true },
    email: { type: 'string', unique: true },
    name: { type: 'string' },
    bio: { type: 'text', searchable: true },
    preferences: { type: 'json', flexible: true },
    embedding: { type: 'vector', dimensions: 4 },
    lastActive: { type: 'timestamp', cached: true },
  });

  await engine.registerManifest(products);
  await engine.registerManifest(orders);
  await engine.registerManifest(customers);

  // ── Insert 50 products ──
  const productData = Array.from({ length: 50 }, (_, i) => ({
    name: `Product ${i + 1}`,
    price: Math.round((5 + Math.random() * 495) * 100) / 100,
    category: ['Electronics', 'Books', 'Clothing', 'Food', 'Toys'][i % 5],
    description: `High quality ${['electronics', 'book', 'clothing', 'food', 'toy'][i % 5]} item. Best in class.`,
    metadata: { weight: Math.round(Math.random() * 10 * 100) / 100, color: ['Red', 'Blue', 'Green'][i % 3] },
    embedding: [Math.random(), Math.random(), Math.random(), Math.random()],
    stockCount: Math.floor(Math.random() * 1000),
  }));

  const insertResult = await engine.insert('products', productData);
  assert(insertResult.success, 'Insert 50 products');
  assertEqual(insertResult.data?.insertedCount, 50, 'All 50 products inserted');

  // ── Insert 20 customers ──
  const customerData = Array.from({ length: 20 }, (_, i) => ({
    email: `customer${i + 1}@shop.com`,
    name: `Customer ${i + 1}`,
    bio: `Loves shopping for ${['electronics', 'books', 'clothes', 'food', 'toys'][i % 5]}. Expert buyer.`,
    preferences: { theme: i % 2 === 0 ? 'dark' : 'light', newsletter: i % 3 === 0 },
    embedding: [Math.random(), Math.random(), Math.random(), Math.random()],
    lastActive: new Date().toISOString(),
  }));

  const custResult = await engine.insert('customers', customerData);
  assert(custResult.success, 'Insert 20 customers');
  assertEqual(custResult.data?.insertedCount, 20, 'All 20 customers inserted');

  // ── Insert 100 orders ──
  const orderIds = custResult.data?.insertedIds ?? [];
  const orderData = Array.from({ length: 100 }, (_, i) => ({
    userId: orderIds[i % orderIds.length],
    total: Math.round((10 + Math.random() * 990) * 100) / 100,
    status: ['pending', 'shipped', 'delivered', 'cancelled'][i % 4],
    items: { productCount: 1 + Math.floor(Math.random() * 5), discount: i % 10 === 0 ? 0.1 : 0 },
    notes: i % 5 === 0 ? 'Urgent delivery needed for this high-priority order' : 'Standard shipping',
  }));

  const orderResult = await engine.insert('orders', orderData);
  assert(orderResult.success, 'Insert 100 orders');
  assertEqual(orderResult.data?.insertedCount, 100, 'All 100 orders inserted');

  // ── Query: Find by scalar ──
  const findByEmail = await engine.findOne('customers', { email: 'customer1@shop.com' });
  assert(findByEmail.success && findByEmail.data !== null, 'Find customer by email');
  assertEqual(findByEmail.data?.['name'], 'Customer 1', 'Correct customer name returned');

  // ── Query: Find with virtual join ──
  const allCustomers = await engine.find('customers');
  assert(allCustomers.success, 'Find all customers');
  assertEqual(allCustomers.data?.length, 20, 'All 20 customers returned via virtual join');

  // ── Test: Virtual join contains fields from all stores ──
  const firstCustomer = allCustomers.data?.[0];
  assert(firstCustomer?.['email'] !== undefined, 'Virtual join has email (from SQL)');
  assert(firstCustomer?.['bio'] !== undefined, 'Virtual join has bio (from NoSQL)');
  assert(firstCustomer?.['lastActive'] !== undefined, 'Virtual join has lastActive (from Cache)');

  // ── Query: Find with comparison ──
  const expensive = await engine.find('products', { price: { $gt: 400 } });
  assert(expensive.success, 'Find expensive products (price > $400)');
  if (expensive.data) {
    for (const p of expensive.data) {
      assert((p['price'] as number) > 400, `Product "${p['name']}" price ${p['price']} > 400`);
    }
  }

  // ── Full-text search ──
  const searchResults = await engine.search('orders', 'urgent');
  assert(searchResults.success, 'Full-text search for "urgent" in orders');
  assertGreater(searchResults.data?.length ?? 0, 0, 'Found orders with "urgent"');

  // ── Update across stores ──
  const updateResult = await engine.update(
    'customers',
    { email: 'customer1@shop.com' },
    { bio: 'VIP customer — top spender 2026', lastActive: new Date().toISOString() },
  );
  assert(updateResult.success, 'Update customer bio + lastActive across stores');
  assertEqual(updateResult.data?.matchedCount, 1, 'Matched exactly 1 customer');

  // Verify update applied
  const updatedCustomer = await engine.findOne('customers', { email: 'customer1@shop.com' });
  assertEqual(updatedCustomer.data?.['bio'], 'VIP customer — top spender 2026', 'Bio updated in NoSQL store');

  // ── Delete ──
  const deleteResult = await engine.delete('products', { name: 'Product 50' });
  assert(deleteResult.success, 'Delete product by name');
  assertEqual(deleteResult.data?.deletedCount, 1, 'Deleted exactly 1 product');

  // Verify deleted
  const afterDelete = await engine.find('products');
  assertEqual(afterDelete.data?.length, 49, '49 products remaining after delete');

  // ── Vector similarity search ──
  const target = productData[0]!.embedding;
  const similar = await engine.search('products', undefined, {
    field: 'embedding', vector: target, topK: 5,
  });
  assert(similar.success, 'Vector similarity search');
  assertGreater(similar.data?.length ?? 0, 0, 'Found similar products');

  await engine.shutdown();
}

async function testSocialMedia() {
  section('TEST 2: Social Media Platform', '📱');
  const engine = await createTestEngine();

  const posts = defineManifest('posts', {
    id: { type: 'uuid', primary: true },
    authorId: { type: 'string', indexed: true },
    title: { type: 'string' },
    content: { type: 'text', searchable: true },
    tags: { type: 'json', flexible: true },
    embedding: { type: 'vector', dimensions: 4 },
    viewCount: { type: 'integer', cached: true, ttl: 10 },
    createdAt: { type: 'timestamp' },
  });

  const users = defineManifest('users', {
    id: { type: 'uuid', primary: true },
    username: { type: 'string', unique: true },
    displayName: { type: 'string' },
    bio: { type: 'text', searchable: true },
    settings: { type: 'json', flexible: true },
    sessionToken: { type: 'string', cached: true, ttl: 3600 },
  });

  await engine.registerManifest(posts);
  await engine.registerManifest(users);

  // ── Insert users ──
  const userData = Array.from({ length: 30 }, (_, i) => ({
    username: `user_${i + 1}`,
    displayName: `User ${i + 1}`,
    bio: `Tech enthusiast and ${['AI researcher', 'full-stack developer', 'data scientist', 'designer', 'product manager'][i % 5]}. Loves ${['machine learning', 'distributed systems', 'web3', 'cloud computing', 'open source'][i % 5]}.`,
    settings: { darkMode: i % 2 === 0, notifications: true, language: 'en' },
    sessionToken: `sess_${randomUUID().slice(0, 8)}`,
  }));

  const usersResult = await engine.insert('users', userData);
  assert(usersResult.success, 'Insert 30 social media users');
  assertEqual(usersResult.data?.insertedCount, 30, 'All 30 users created');

  // ── Insert posts ──
  const userIds = usersResult.data?.insertedIds ?? [];
  const postData = Array.from({ length: 200 }, (_, i) => ({
    authorId: userIds[i % userIds.length],
    title: `Post #${i + 1}: ${['Building with AI', 'Cloud Architecture Tips', 'Open Source Love', 'Startup Journey', 'Code Review Best Practices'][i % 5]}`,
    content: `This is a detailed post about ${['artificial intelligence and machine learning breakthroughs', 'scaling distributed systems to millions of users', 'the future of open source software', 'building startups from zero to one', 'modern code review practices and tooling'][i % 5]}. It explores the latest trends and provides actionable insights for engineers.`,
    tags: { topics: [['AI', 'ML'], ['Cloud', 'DevOps'], ['OSS', 'Community'], ['Startup', 'Business'], ['Code', 'Engineering']][i % 5] },
    embedding: [Math.random(), Math.random(), Math.random(), Math.random()],
    viewCount: Math.floor(Math.random() * 10000),
    createdAt: new Date(Date.now() - i * 3600000).toISOString(),
  }));

  const postsResult = await engine.insert('posts', postData);
  assert(postsResult.success, 'Insert 200 social media posts');
  assertEqual(postsResult.data?.insertedCount, 200, 'All 200 posts created');

  // ── Find user by username ──
  const user5 = await engine.findOne('users', { username: 'user_5' });
  assert(user5.success && user5.data !== null, 'Find user by username');
  assertEqual(user5.data?.['displayName'], 'User 5', 'Correct user returned');

  // ── Find user posts ──
  const user1Posts = await engine.find('posts', { authorId: userIds[0] });
  assert(user1Posts.success, 'Find all posts by user 1');
  assertGreater(user1Posts.data?.length ?? 0, 0, 'User 1 has posts');

  // ── Search posts ──
  const aiPosts = await engine.search('posts', 'artificial intelligence');
  assert(aiPosts.success, 'Search posts for "artificial intelligence"');
  assertGreater(aiPosts.data?.length ?? 0, 0, 'Found AI-related posts');

  // ── Search users ──
  const devUsers = await engine.search('users', 'distributed systems');
  assert(devUsers.success, 'Search users for "distributed systems"');
  assertGreater(devUsers.data?.length ?? 0, 0, 'Found users interested in distributed systems');

  // ── Update view count (cache store) ──
  const firstPost = user1Posts.data?.[0];
  if (firstPost) {
    const viewUpdate = await engine.update(
      'posts',
      { id: firstPost['id'] },
      { viewCount: 99999 },
    );
    assert(viewUpdate.success, 'Update post view count in cache store');
    assertEqual(viewUpdate.data?.matchedCount, 1, 'Matched 1 post for view update');
  }

  // ── Rapid-fire updates (simulating real-time activity) ──
  let rapidSuccess = 0;
  for (let i = 0; i < 10; i++) {
    const r = await engine.update(
      'users',
      { username: `user_${i + 1}` },
      { sessionToken: `sess_new_${randomUUID().slice(0, 8)}` },
    );
    if (r.success && (r.data?.matchedCount ?? 0) > 0) rapidSuccess++;
  }
  assertEqual(rapidSuccess, 10, '10 rapid session token updates all succeeded');

  // ── Delete user and their cascade effect ──
  const delUser = await engine.delete('users', { username: 'user_30' });
  assert(delUser.success, 'Delete user user_30');
  assertEqual(delUser.data?.deletedCount, 1, 'One user deleted');

  const remainingUsers = await engine.find('users');
  assertEqual(remainingUsers.data?.length, 29, '29 users remaining after delete');

  await engine.shutdown();
}

async function testSaaSMultiTenant() {
  section('TEST 3: SaaS Multi-Tenant Platform', '🏢');
  const engine = await createTestEngine();

  const tenants = defineManifest('tenants', {
    id: { type: 'uuid', primary: true },
    name: { type: 'string', unique: true },
    plan: { type: 'string', indexed: true },
    billing: { type: 'json', flexible: true },
    apiKey: { type: 'string', cached: true, ttl: 3600 },
  });

  const apiLogs = defineManifest('api_logs', {
    id: { type: 'uuid', primary: true },
    tenantId: { type: 'string', indexed: true },
    endpoint: { type: 'string' },
    method: { type: 'string' },
    statusCode: { type: 'integer' },
    latencyMs: { type: 'float', transactional: true },
    body: { type: 'text', searchable: true },
    metadata: { type: 'json', flexible: true },
  });

  await engine.registerManifest(tenants);
  await engine.registerManifest(apiLogs);

  // ── Insert tenants ──
  const tenantData = [
    { name: 'Acme Corp', plan: 'enterprise', billing: { mrr: 5000, currency: 'USD' }, apiKey: 'ak_acme_123' },
    { name: 'StartupX', plan: 'starter', billing: { mrr: 49, currency: 'USD' }, apiKey: 'ak_startx_456' },
    { name: 'BigCo', plan: 'enterprise', billing: { mrr: 15000, currency: 'EUR' }, apiKey: 'ak_bigco_789' },
    { name: 'FreeTier Inc', plan: 'free', billing: { mrr: 0, currency: 'USD' }, apiKey: 'ak_free_000' },
    { name: 'MidSize LLC', plan: 'pro', billing: { mrr: 299, currency: 'USD' }, apiKey: 'ak_mid_111' },
  ];

  const tenantResult = await engine.insert('tenants', tenantData);
  assert(tenantResult.success, 'Insert 5 tenants');
  assertEqual(tenantResult.data?.insertedCount, 5, 'All 5 tenants created');

  const tenantIds = tenantResult.data?.insertedIds ?? [];

  // ── High-volume API log simulation (500 logs) ──
  const logData = Array.from({ length: 500 }, (_, i) => ({
    tenantId: tenantIds[i % tenantIds.length],
    endpoint: ['/api/users', '/api/products', '/api/orders', '/api/analytics', '/api/webhooks'][i % 5],
    method: ['GET', 'POST', 'PUT', 'DELETE'][i % 4],
    statusCode: [200, 200, 200, 201, 400, 401, 500][i % 7],
    latencyMs: Math.round(Math.random() * 500 * 100) / 100,
    body: i % 10 === 0 ? 'Error: timeout while connecting to upstream service' : 'OK',
    metadata: { ip: `192.168.1.${i % 255}`, userAgent: 'SynapseDB-SDK/1.0' },
  }));

  const logResult = await engine.insert('api_logs', logData);
  assert(logResult.success, 'Insert 500 API logs');
  assertEqual(logResult.data?.insertedCount, 500, 'All 500 logs inserted');

  // ── Find tenant by name ──
  const acme = await engine.findOne('tenants', { name: 'Acme Corp' });
  assert(acme.success && acme.data !== null, 'Find tenant "Acme Corp"');
  assertEqual(acme.data?.['plan'], 'enterprise', 'Acme Corp is on enterprise plan');

  // ── Find logs by tenant ──
  const acmeLogs = await engine.find('api_logs', { tenantId: tenantIds[0] });
  assert(acmeLogs.success, 'Find all API logs for Acme Corp');
  assertEqual(acmeLogs.data?.length, 100, 'Acme Corp has 100 API logs (500/5 tenants)');

  // ── Search error logs ──
  const errorLogs = await engine.search('api_logs', 'timeout');
  assert(errorLogs.success, 'Search API logs for "timeout"');
  assertGreater(errorLogs.data?.length ?? 0, 0, 'Found timeout error logs');

  // ── Update tenant plan ──
  const upgrade = await engine.update('tenants', { name: 'StartupX' }, { plan: 'pro', apiKey: 'ak_startx_upgraded' });
  assert(upgrade.success, 'Upgrade StartupX from starter to pro');
  assertEqual(upgrade.data?.matchedCount, 1, 'Matched StartupX for upgrade');

  // Verify upgrade
  const upgraded = await engine.findOne('tenants', { name: 'StartupX' });
  assertEqual(upgraded.data?.['plan'], 'pro', 'StartupX plan changed to pro');

  // ── Delete free tier tenant ──
  const delFree = await engine.delete('tenants', { name: 'FreeTier Inc' });
  assertEqual(delFree.data?.deletedCount, 1, 'Deleted free tier tenant');

  await engine.shutdown();
}

async function testNLQRealWorld() {
  section('TEST 4: Natural Language Query (Real Questions)', '💬');
  const engine = await createTestEngine();

  const employees = defineManifest('employees', {
    id: { type: 'uuid', primary: true },
    name: { type: 'string' },
    email: { type: 'string', unique: true },
    department: { type: 'string', indexed: true },
    salary: { type: 'float', transactional: true },
    bio: { type: 'text', searchable: true },
    lastLogin: { type: 'timestamp', cached: true },
  });

  await engine.registerManifest(employees);

  const empData = [
    { name: 'Alice Johnson', email: 'alice@company.com', department: 'Engineering', salary: 150000, bio: 'Senior backend engineer specializing in distributed systems and Kubernetes.', lastLogin: new Date().toISOString() },
    { name: 'Bob Smith', email: 'bob@company.com', department: 'Marketing', salary: 95000, bio: 'Digital marketing lead focusing on growth hacking and content strategy.', lastLogin: new Date().toISOString() },
    { name: 'Charlie Wang', email: 'charlie@company.com', department: 'Engineering', salary: 180000, bio: 'Staff engineer and tech lead for infrastructure platform.', lastLogin: new Date().toISOString() },
    { name: 'Diana Ross', email: 'diana@company.com', department: 'Sales', salary: 120000, bio: 'VP of Sales managing enterprise accounts globally.', lastLogin: new Date().toISOString() },
    { name: 'Eve Martinez', email: 'eve@company.com', department: 'Engineering', salary: 130000, bio: 'Frontend engineer building React and TypeScript applications.', lastLogin: new Date().toISOString() },
  ];

  await engine.insert('employees', empData);

  // Test NLQ queries
  const q1 = await engine.ask('Find all employees where email is alice@company.com');
  assert(q1.success, 'NLQ: Find employee by email');
  assertEqual(q1.data?.length, 1, 'NLQ: Found exactly 1 employee');
  assertEqual(q1.data?.[0]?.['name'], 'Alice Johnson', 'NLQ: Correct employee found');

  const q2 = await engine.ask('How many employees');
  assert(q2.success, 'NLQ: Count employees');
  assertEqual(q2.data?.[0]?.['count'], 5, 'NLQ: Counted 5 employees');

  const q3 = await engine.ask('Show all employees');
  assert(q3.success, 'NLQ: Show all employees');
  assertEqual(q3.data?.length, 5, 'NLQ: Returned all 5 employees');

  const q4 = await engine.ask('Search employees for "distributed systems"');
  assert(q4.success, 'NLQ: Search for "distributed systems"');
  assertGreater(q4.data?.length ?? 0, 0, 'NLQ: Found employees matching search');

  await engine.shutdown();
}

async function testAnalytics() {
  section('TEST 5: Embedded Analytics (HTAP)', '📊');
  const engine = await createTestEngine();

  const sales = defineManifest('sales', {
    id: { type: 'uuid', primary: true },
    product: { type: 'string', indexed: true },
    region: { type: 'string', indexed: true },
    amount: { type: 'float', transactional: true },
    quantity: { type: 'integer', transactional: true },
    channel: { type: 'string' },
  });

  await engine.registerManifest(sales);

  // Insert 1000 sales
  const regions = ['North America', 'Europe', 'Asia', 'Latin America'];
  const products = ['Widget Pro', 'Gadget X', 'Gizmo Z', 'Doohickey', 'Thingamajig'];
  const channels = ['online', 'retail', 'wholesale', 'partner'];

  const salesData = Array.from({ length: 1000 }, (_, i) => ({
    product: products[i % products.length],
    region: regions[i % regions.length],
    amount: Math.round((10 + Math.random() * 990) * 100) / 100,
    quantity: 1 + Math.floor(Math.random() * 20),
    channel: channels[i % channels.length],
  }));

  await engine.insert('sales', salesData);

  // Feed into analytics engine
  const analytics = engine.analytics();
  const allSales = await engine.find('sales');
  for (const doc of (allSales.data ?? [])) {
    analytics.ingest('sales', doc);
  }

  // ── COUNT ──
  const countResult = engine.aggregate('sales', [{ type: 'COUNT', alias: 'total' }]);
  assertEqual(countResult.rows[0]?.[0], 1000, 'Analytics: COUNT = 1000 sales');

  // ── SUM ──
  const sumResult = engine.aggregate('sales', [{ type: 'SUM', field: 'amount', alias: 'revenue' }]);
  assertGreater(sumResult.rows[0]?.[0] as number, 0, 'Analytics: SUM revenue > 0');

  // ── AVG ──
  const avgResult = engine.aggregate('sales', [{ type: 'AVG', field: 'amount', alias: 'avg_sale' }]);
  assertGreater(avgResult.rows[0]?.[0] as number, 0, 'Analytics: AVG sale amount > 0');

  // ── MIN/MAX ──
  const minMaxResult = engine.aggregate('sales', [
    { type: 'MIN', field: 'amount', alias: 'min_sale' },
    { type: 'MAX', field: 'amount', alias: 'max_sale' },
  ]);
  assert(
    (minMaxResult.rows[0]?.[0] as number) < (minMaxResult.rows[0]?.[1] as number),
    'Analytics: MIN < MAX',
  );

  // ── GROUP BY ──
  const byRegion = engine.aggregate('sales', [
    { type: 'GROUP', field: 'region' },
    { type: 'COUNT', alias: 'count' },
    { type: 'SUM', field: 'amount', alias: 'revenue' },
  ]);
  assertEqual(byRegion.rows.length, 4, 'Analytics: GROUP BY region → 4 groups');
  for (const row of byRegion.rows) {
    assertGreater(row[1] as number, 0, `Analytics: ${row[0]} has ${row[1]} sales`);
    assertGreater(row[2] as number, 0, `Analytics: ${row[0]} revenue > 0`);
  }

  // ── GROUP BY product ──
  const byProduct = engine.aggregate('sales', [
    { type: 'GROUP', field: 'product' },
    { type: 'AVG', field: 'amount', alias: 'avg_price' },
  ]);
  assertEqual(byProduct.rows.length, 5, 'Analytics: GROUP BY product → 5 groups');

  // ── Scan with filter ──
  const scanResult = analytics.scan('sales', ['product', 'amount'], { region: 'Europe' }, 10);
  assert(scanResult.rows.length <= 10, 'Analytics: Scan limited to 10 rows');
  assertEqual(scanResult.columns.length, 2, 'Analytics: Scan returns 2 columns');

  await engine.shutdown();
}

async function testEdgeSync() {
  section('TEST 6: Edge Sync & Offline-First (CRDTs)', '📱');
  const engine = await createTestEngine();

  const tasks = defineManifest('tasks', {
    id: { type: 'uuid', primary: true },
    title: { type: 'string' },
    completed: { type: 'boolean' },
    priority: { type: 'string', indexed: true },
    description: { type: 'text', searchable: true },
  });

  await engine.registerManifest(tasks);
  const edge = engine.edge();

  // ── Offline write + read ──
  edge.setOnline(false);

  edge.localSet('tasks', 'task-1', { title: 'Buy groceries', completed: false, priority: 'high' });
  edge.localSet('tasks', 'task-2', { title: 'Write report', completed: false, priority: 'medium' });
  edge.localSet('tasks', 'task-3', { title: 'Call dentist', completed: true, priority: 'low' });

  const status1 = edge.status();
  assertEqual(status1.isOnline, false, 'Edge: Confirmed offline');
  assertEqual(status1.pendingOps, 3, 'Edge: 3 ops queued while offline');
  assertEqual(status1.localDocuments, 3, 'Edge: 3 local documents');

  // ── Read while offline (instant) ──
  const task1 = edge.localGet('tasks', 'task-1');
  assert(task1 !== null, 'Edge: Read task-1 while offline');
  assertEqual(task1?.title, 'Buy groceries', 'Edge: Correct title');
  assertEqual(task1?.completed, false, 'Edge: Correct completed status');

  // ── Update while offline ──
  edge.localSet('tasks', 'task-1', { title: 'Buy groceries', completed: true, priority: 'high' });
  const updated = edge.localGet('tasks', 'task-1');
  assertEqual(updated?.completed, true, 'Edge: Task updated locally');

  // ── Delete while offline ──
  edge.localDelete('tasks', 'task-3');
  const deleted = edge.localGet('tasks', 'task-3');
  assertEqual(deleted, null, 'Edge: Deleted task is null');

  // ── Go online + verify queue ──
  edge.setOnline(true);
  const status2 = edge.status();
  assertEqual(status2.isOnline, true, 'Edge: Confirmed online');
  assertEqual(status2.pendingOps, 5, 'Edge: 5 total ops (3 create + 1 update + 1 delete)');

  await engine.shutdown();
}

async function testColdStorage() {
  section('TEST 7: Cold Storage Archival', '🧊');
  const engine = await createTestEngine();

  const logs = defineManifest('sys_logs', {
    id: { type: 'uuid', primary: true },
    level: { type: 'string', indexed: true },
    message: { type: 'text', searchable: true },
    timestamp: { type: 'timestamp' },
  });

  await engine.registerManifest(logs);
  const archiver = engine.coldStorage();

  // ── Archive documents ──
  const docs = Array.from({ length: 10 }, (_, i) => ({
    id: `log-${i}`,
    level: ['INFO', 'WARN', 'ERROR'][i % 3],
    message: `System event #${i}: ${['started', 'warning detected', 'error occurred'][i % 3]}`,
    timestamp: new Date(Date.now() - i * 86400000).toISOString(),
  }));

  for (const doc of docs) {
    archiver.archiveDocument('sys_logs', doc.id, doc);
  }

  // ── Verify archive ──
  const stats = archiver.getStats();
  assertEqual(stats.totalArchived, 10, 'Cold Storage: 10 documents archived');

  // ── Check temperature ──
  const temp = archiver.getTemperature('sys_logs', 'log-0');
  assertEqual(temp, 'archived', 'Cold Storage: Archived doc temperature is "archived"');

  // ── Restore ──
  const restored = archiver.restore('sys_logs', 'log-0');
  assert(restored !== null, 'Cold Storage: Restored document successfully');
  assertEqual(restored?.['level'], 'INFO', 'Cold Storage: Restored correct data');

  const tempAfter = archiver.getTemperature('sys_logs', 'log-0');
  assertEqual(tempAfter, 'hot', 'Cold Storage: Restored doc temperature is now "hot"');

  // ── Peek without restoring ──
  const peeked = archiver.peek('sys_logs', 'log-1');
  assert(peeked !== null, 'Cold Storage: Peek returns archived record');
  assertEqual(peeked?.tier, 'warm', 'Cold Storage: Tier is "warm"');

  // ── Batch archive ──
  const batchDocs = Array.from({ length: 5 }, (_, i) => ({
    id: `batch-${i}`,
    document: { id: `batch-${i}`, level: 'DEBUG', message: `Batch item ${i}` },
  }));

  const manifest = archiver.archiveBatch('sys_logs', batchDocs);
  assertEqual(manifest.recordCount, 5, 'Cold Storage: Batch archived 5 documents');
  assert(manifest.path.includes('sys_logs'), 'Cold Storage: Manifest path includes collection');

  const finalStats = archiver.getStats();
  assertEqual(finalStats.totalArchived, 15, 'Cold Storage: Total 15 archived (10+5)');
  assertEqual(finalStats.totalRestored, 1, 'Cold Storage: 1 restored');

  await engine.shutdown();
}

async function testEdgeCases() {
  section('TEST 8: Edge Cases & Error Handling', '⚠️');
  const engine = await createTestEngine();

  const items = defineManifest('items', {
    id: { type: 'uuid', primary: true },
    name: { type: 'string' },
    value: { type: 'float', transactional: true },
    description: { type: 'text', searchable: true },
    data: { type: 'json', flexible: true },
    ttlField: { type: 'string', cached: true },
  });

  await engine.registerManifest(items);

  // ── Empty collection queries ──
  const emptyFind = await engine.find('items');
  assert(emptyFind.success, 'Edge: Find on empty collection succeeds');
  assertEqual(emptyFind.data?.length, 0, 'Edge: Empty collection returns 0 docs');

  // ── Insert empty array ──
  const emptyInsert = await engine.insert('items', []);
  assert(emptyInsert.success, 'Edge: Insert empty array succeeds');

  // ── Unregistered collection ──
  const badFind = await engine.find('nonexistent');
  assert(!badFind.success, 'Edge: Find on unregistered collection fails');
  assert(badFind.error?.message?.includes('not registered') ?? false, 'Edge: Error message mentions "not registered"');

  // ── Insert single doc ──
  const single = await engine.insert('items', [
    { name: 'Lone Item', value: 42.0, description: 'The answer to everything', data: { nested: { deep: true } }, ttlField: 'cached' },
  ]);
  assert(single.success, 'Edge: Insert single document');
  assertEqual(single.data?.insertedCount, 1, 'Edge: Inserted 1');

  // ── Find by exact value ──
  const exact = await engine.findOne('items', { name: 'Lone Item' });
  assert(exact.success && exact.data !== null, 'Edge: Find by exact string');
  assertEqual(exact.data?.['value'], 42.0, 'Edge: Correct numeric value');

  // ── Update non-existent document ──
  const badUpdate = await engine.update('items', { name: 'Does Not Exist' }, { value: 0 });
  assert(badUpdate.success, 'Edge: Update non-existent returns success');
  assertEqual(badUpdate.data?.matchedCount, 0, 'Edge: Matched 0 for non-existent');

  // ── Delete non-existent ──
  const badDelete = await engine.delete('items', { name: 'Nope' });
  assert(badDelete.success, 'Edge: Delete non-existent returns success');
  assertEqual(badDelete.data?.deletedCount, 0, 'Edge: Deleted 0 for non-existent');

  // ── Large batch insert ──
  const largeBatch = Array.from({ length: 500 }, (_, i) => ({
    name: `Batch Item ${i}`,
    value: i * 1.5,
    description: `Batch description for item number ${i}`,
    data: { index: i, batch: true },
    ttlField: `batch_${i}`,
  }));

  const batchResult = await engine.insert('items', largeBatch);
  assert(batchResult.success, 'Edge: Insert 500 items in batch');
  assertEqual(batchResult.data?.insertedCount, 500, 'Edge: All 500 items inserted');

  // ── Verify large dataset query ──
  const allItems = await engine.find('items');
  assertEqual(allItems.data?.length, 501, 'Edge: 501 total items (1 + 500)');

  // ── Update multiple matching documents ──
  const multiUpdate = await engine.update(
    'items',
    { name: 'Batch Item 0' },
    { value: 9999 },
  );
  assert(multiUpdate.success, 'Edge: Update specific batch item');

  await engine.shutdown();
}

async function testConcurrency() {
  section('TEST 9: Concurrent Operations', '⚡');
  const engine = await createTestEngine();

  const counters = defineManifest('counters', {
    id: { type: 'uuid', primary: true },
    name: { type: 'string', unique: true },
    value: { type: 'integer', transactional: true },
    label: { type: 'text', searchable: true },
  });

  await engine.registerManifest(counters);

  // ── Parallel inserts ──
  const insertPromises = Array.from({ length: 20 }, (_, i) =>
    engine.insert('counters', [
      { name: `counter_${i}`, value: 0, label: `Counter number ${i}` },
    ]),
  );

  const insertResults = await Promise.all(insertPromises);
  const allInserted = insertResults.every((r) => r.success);
  assert(allInserted, 'Concurrent: 20 parallel inserts all succeeded');

  // ── Parallel finds ──
  const findPromises = Array.from({ length: 20 }, (_, i) =>
    engine.findOne('counters', { name: `counter_${i}` }),
  );

  const findResults = await Promise.all(findPromises);
  const allFound = findResults.every((r) => r.success && r.data !== null);
  assert(allFound, 'Concurrent: 20 parallel finds all succeeded');

  // ── Parallel updates ──
  const updatePromises = Array.from({ length: 20 }, (_, i) =>
    engine.update('counters', { name: `counter_${i}` }, { value: i * 10 }),
  );

  const updateResults = await Promise.all(updatePromises);
  const allUpdated = updateResults.every((r) => r.success);
  assert(allUpdated, 'Concurrent: 20 parallel updates all succeeded');

  // ── Parallel mixed operations ──
  const mixedPromises = [
    engine.insert('counters', [{ name: 'concurrent_new', value: 999, label: 'New concurrent' }]),
    engine.find('counters'),
    engine.findOne('counters', { name: 'counter_0' }),
    engine.update('counters', { name: 'counter_1' }, { value: 1111 }),
    engine.search('counters', 'Counter number'),
  ];

  const mixedResults = await Promise.all(mixedPromises);
  const allMixed = mixedResults.every((r) => r.success);
  assert(allMixed, 'Concurrent: Mixed parallel ops all succeeded');

  await engine.shutdown();
}

// ═══ MAIN — RUN ALL TESTS ══════════════════════════════════

async function main() {
  console.log('');
  console.log(`${BOLD}${CYAN}  ╔══════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}  ║                                                  ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   🔥 SynapseDB — Real-World Stress Tests         ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   Testing every layer with production scenarios   ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║                                                  ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ╚══════════════════════════════════════════════════╝${RESET}`);

  const startTime = Date.now();

  await testEcommerce();
  await testSocialMedia();
  await testSaaSMultiTenant();
  await testNLQRealWorld();
  await testAnalytics();
  await testEdgeSync();
  await testColdStorage();
  await testEdgeCases();
  await testConcurrency();

  const elapsed = Date.now() - startTime;

  // ═══ FINAL REPORT ═════════════════════════════════════════

  console.log('');
  console.log(`${DIM}═══════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  📋 TEST REPORT${RESET}`);
  console.log(`${DIM}═══════════════════════════════════════════════${RESET}`);
  console.log('');
  console.log(`  Total:   ${BOLD}${totalTests}${RESET} tests`);
  console.log(`  Passed:  ${GREEN}${BOLD}${passed}${RESET}`);
  console.log(`  Failed:  ${failed > 0 ? `${RED}${BOLD}${failed}${RESET}` : `${GREEN}${BOLD}0${RESET}`}`);
  console.log(`  Time:    ${BOLD}${elapsed}ms${RESET}`);
  console.log('');

  if (failures.length > 0) {
    console.log(`${RED}  ── FAILURES ──${RESET}`);
    for (const f of failures) {
      console.log(`  ${RED}✗${RESET} ${f}`);
    }
    console.log('');
  }

  const pct = Math.round((passed / totalTests) * 100);

  if (failed === 0) {
    console.log(`${GREEN}${BOLD}  ✅ ALL ${totalTests} TESTS PASSED (${elapsed}ms)${RESET}`);
    console.log('');
    console.log(`${BOLD}${CYAN}  ╔══════════════════════════════════════════════════╗${RESET}`);
    console.log(`${BOLD}${CYAN}  ║                                                  ║${RESET}`);
    console.log(`${BOLD}${CYAN}  ║   SynapseDB stress-tested with:                  ║${RESET}`);
    console.log(`${BOLD}${CYAN}  ║   • 50 products, 20 customers, 100 orders        ║${RESET}`);
    console.log(`${BOLD}${CYAN}  ║   • 30 users, 200 posts (social media)           ║${RESET}`);
    console.log(`${BOLD}${CYAN}  ║   • 5 tenants, 500 API logs (SaaS)               ║${RESET}`);
    console.log(`${BOLD}${CYAN}  ║   • 1000 sales records (analytics)               ║${RESET}`);
    console.log(`${BOLD}${CYAN}  ║   • 500 batch items (edge cases)                 ║${RESET}`);
    console.log(`${BOLD}${CYAN}  ║   • 20+ concurrent parallel operations           ║${RESET}`);
    console.log(`${BOLD}${CYAN}  ║   • NLQ, Edge Sync, Cold Storage, HTAP           ║${RESET}`);
    console.log(`${BOLD}${CYAN}  ║                                                  ║${RESET}`);
    console.log(`${BOLD}${CYAN}  ║   Total data: ~2,400 documents across 4 stores   ║${RESET}`);
    console.log(`${BOLD}${CYAN}  ║                                                  ║${RESET}`);
    console.log(`${BOLD}${CYAN}  ╚══════════════════════════════════════════════════╝${RESET}`);
  } else {
    console.log(`${RED}${BOLD}  ❌ ${failed} TEST(S) FAILED (${pct}% pass rate)${RESET}`);
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`${RED}FATAL:${RESET}`, err);
  process.exit(1);
});
