// ══════════════════════════════════════════════════════════════
// SynapseDB — Professional Benchmark Suite
// Measures: Throughput, Latency (p50/p95/p99), Memory, Scaling
// ══════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto';
import { readdir, stat, readFile } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import type {
  StorageType, PluginConfig, HealthStatus, PluginCapabilities,
  CollectionManifest, QueryAST, Document, InsertResult, UpdateResult,
  DeleteResult, Logger, FilterGroup, FilterCondition,
} from '@synapsedb/core/types';
import type { IStoragePlugin } from '@synapsedb/core/plugin/contract';
import { SynapseEngine, createLogger } from '@synapsedb/core';
import { defineManifest } from '@synapsedb/sdk';
import { VectorPlugin } from '@synapsedb/plugin-vector';

// ═══ BENCHMARK INFRASTRUCTURE ═══════════════════════════════

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BG_GREEN = '\x1b[42m';
const BG_YELLOW = '\x1b[43m';
const BG_RED = '\x1b[41m';

interface LatencyStats {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  samples: number;
}

interface BenchmarkResult {
  name: string;
  category: string;
  opsPerSec: number;
  latency: LatencyStats;
  totalTimeMs: number;
  totalOps: number;
  dataSize?: number;
  mbPerSec?: number;
}

function hrNow(): bigint {
  return process.hrtime.bigint();
}

function nsToMs(ns: bigint): number {
  return Number(ns) / 1_000_000;
}

function nsToUs(ns: bigint): number {
  return Number(ns) / 1_000;
}

function computeLatencyStats(latencies: number[]): LatencyStats {
  if (latencies.length === 0) return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0, samples: 0 };

  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);

  return {
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    avg: sum / sorted.length,
    p50: sorted[Math.floor(sorted.length * 0.5)]!,
    p95: sorted[Math.floor(sorted.length * 0.95)]!,
    p99: sorted[Math.floor(sorted.length * 0.99)]!,
    samples: sorted.length,
  };
}

function formatUs(us: number): string {
  if (us < 1) return `${(us * 1000).toFixed(0)}ns`;
  if (us < 1000) return `${us.toFixed(1)}µs`;
  if (us < 1_000_000) return `${(us / 1000).toFixed(2)}ms`;
  return `${(us / 1_000_000).toFixed(2)}s`;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(2)}MB`;
  return `${(bytes / 1073741824).toFixed(2)}GB`;
}

function sparkbar(value: number, max: number, width = 20): string {
  const filled = Math.max(1, Math.round((value / max) * width));
  const empty = Math.max(0, width - filled);
  const color = value < max * 0.3 ? GREEN : value < max * 0.7 ? YELLOW : RED;
  return `${color}${'█'.repeat(filled)}${'░'.repeat(empty)}${RESET}`;
}

function gradeOps(opsPerSec: number): string {
  if (opsPerSec >= 100_000) return `${BG_GREEN}${BOLD} S+ ${RESET}`;
  if (opsPerSec >= 50_000) return `${BG_GREEN}${BOLD}  S ${RESET}`;
  if (opsPerSec >= 20_000) return `${GREEN}${BOLD}  A ${RESET}`;
  if (opsPerSec >= 10_000) return `${GREEN}  B ${RESET}`;
  if (opsPerSec >= 5_000) return `${YELLOW}  C ${RESET}`;
  if (opsPerSec >= 1_000) return `${YELLOW}  D ${RESET}`;
  return `${RED}  F ${RESET}`;
}

// ═══ IN-MEMORY PLUGINS ═════════════════════════════════════

function matchesFilters(doc: Document, group: FilterGroup): boolean {
  if (group.conditions.length === 0) return true;
  const results = group.conditions.map((c) => ('logic' in c) ? matchesFilters(doc, c) : matchesCondition(doc, c));
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
    default: return false;
  }
}

class MemSQL implements IStoragePlugin {
  readonly name = 'postgres'; readonly type: StorageType = 'sql';
  private store = new Map<string, Document[]>();
  async connect() {} async disconnect() { this.store.clear(); }
  async healthCheck(): Promise<HealthStatus> { return { healthy: true, latencyMs: 0 }; }
  async syncSchema(m: CollectionManifest) { if (!this.store.has(m.name)) this.store.set(m.name, []); }
  async insert(col: string, docs: Document[], fields: string[]): Promise<InsertResult> {
    const c = this.store.get(col) ?? []; const ids: string[] = [];
    for (const d of docs) { const f: Document = {}; for (const [k,v] of Object.entries(d)) if (fields.includes(k)||k==='id') f[k]=v; if (!f['id']) f['id']=randomUUID(); c.push(f); ids.push(String(f['id'])); }
    this.store.set(col, c); return { insertedCount: docs.length, insertedIds: ids };
  }
  async find(col: string, q: QueryAST, fields: string[]): Promise<Document[]> {
    let r = this.store.get(col) ?? [];
    if (q.filters) r = r.filter(d => matchesFilters(d, q.filters!));
    if (q.sort) r = [...r].sort((a,b) => { for (const s of q.sort!) { const av=a[s.field],bv=b[s.field]; if(av===bv)continue; const c=(av as number)<(bv as number)?-1:1; return s.direction==='ASC'?c:-c; } return 0; });
    if (q.offset) r = r.slice(q.offset); if (q.limit) r = r.slice(0, q.limit);
    return r.map(d => { const p: Document={}; for(const[k,v] of Object.entries(d)) if(fields.includes(k)||k==='id') p[k]=v; return p; });
  }
  async findOne(col: string, q: QueryAST, f: string[]) { const r = await this.find(col,{...q,limit:1},f); return r[0]??null; }
  async update(col: string, q: QueryAST, ch: Record<string,unknown>, f: string[]): Promise<UpdateResult> {
    const c = this.store.get(col)??[]; let m=0;
    for (const d of c) { if(!q.filters||matchesFilters(d,q.filters)) { for(const[k,v] of Object.entries(ch)) if(f.includes(k)) d[k]=v; m++; } }
    return { matchedCount: m, modifiedCount: m };
  }
  async delete(col: string, q: QueryAST): Promise<DeleteResult> {
    const c = this.store.get(col)??[]; const b=c.length;
    const r = c.filter(d => q.filters&&!matchesFilters(d,q.filters)); this.store.set(col,r);
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
    const c = this.store.get(col)??[]; const ids: string[]=[];
    for (const d of docs) { const f: Document={}; for(const[k,v] of Object.entries(d)) if(fields.includes(k)||k==='id') f[k]=v; c.push(f); ids.push(String(f['id']??'')); }
    this.store.set(col,c); return { insertedCount: docs.length, insertedIds: ids };
  }
  async find(col: string, q: QueryAST, fields: string[]): Promise<Document[]> {
    let r = this.store.get(col)??[];
    if (q.searchQuery) { const s=q.searchQuery.toLowerCase(); r=r.filter(d=>Object.values(d).some(v=>typeof v==='string'&&v.toLowerCase().includes(s))); }
    else if (q.filters) r = r.filter(d => matchesFilters(d,q.filters!));
    if (q.limit) r = r.slice(0, q.limit);
    return r.map(d => { const p: Document={}; for(const[k,v] of Object.entries(d)) if(fields.includes(k)||k==='id') p[k]=v; return p; });
  }
  async findOne(col: string, q: QueryAST, f: string[]) { const r = await this.find(col,{...q,limit:1},f); return r[0]??null; }
  async update(col: string, q: QueryAST, ch: Record<string,unknown>, f: string[]): Promise<UpdateResult> {
    const c = this.store.get(col)??[]; let m=0;
    for (const d of c) { if(!q.filters||matchesFilters(d,q.filters)) { for(const[k,v] of Object.entries(ch)) if(f.includes(k)) d[k]=v; m++; } }
    return { matchedCount: m, modifiedCount: m };
  }
  async delete(col: string, q: QueryAST): Promise<DeleteResult> {
    const c = this.store.get(col)??[]; const b=c.length;
    const r = c.filter(d => q.filters&&!matchesFilters(d,q.filters)); this.store.set(col,r);
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
    const ids: string[]=[];
    for(const d of docs) { const id=String(d['id']??''); if(!id)continue; const f: Document={}; for(const[k,v] of Object.entries(d)) if(fields.includes(k)||k==='id') f[k]=v; this.store.set(`${col}:${id}`,f); ids.push(id); }
    return { insertedCount: ids.length, insertedIds: ids };
  }
  async find(col: string, q: QueryAST): Promise<Document[]> {
    const r: Document[]=[];
    for(const[key,doc] of this.store) { if(key.startsWith(`${col}:`)) { if(!q.filters||matchesFilters(doc,q.filters)) r.push(doc); } }
    return r;
  }
  async findOne(col: string, q: QueryAST) { const r=await this.find(col,q); return r[0]??null; }
  async update(col: string, q: QueryAST, ch: Record<string,unknown>, f: string[]): Promise<UpdateResult> {
    let m=0;
    for(const[key,doc] of this.store) { if(key.startsWith(`${col}:`)) { if(!q.filters||matchesFilters(doc,q.filters)) { for(const[k,v] of Object.entries(ch)) if(f.includes(k)) doc[k]=v; m++; } } }
    return { matchedCount: m, modifiedCount: m };
  }
  async delete(col: string, q: QueryAST): Promise<DeleteResult> {
    let d=0;
    for(const[key,doc] of this.store) { if(key.startsWith(`${col}:`)&&(!q.filters||matchesFilters(doc,q.filters))) { this.store.delete(key); d++; } }
    return { deletedCount: d };
  }
  capabilities(): PluginCapabilities { return { supportsTransactions:false,supportsFullTextSearch:false,supportsVectorSearch:false,supportsNestedDocuments:false,supportsTTL:true,supportsIndexes:false,supportsUniqueConstraints:false }; }
}

// ═══ ENGINE FACTORY ═════════════════════════════════════════

async function createEngine(): Promise<SynapseEngine> {
  const engine = new SynapseEngine({ logLevel: 'error', syncEnabled: true, plugins: {} });
  const reg = (engine as any).registry;
  reg.register(new MemSQL(), {}, 100);
  reg.register(new MemNoSQL(), {}, 80);
  reg.register(new MemCache(), {}, 60);
  reg.register(new VectorPlugin(), {}, 40);
  await reg.initializeAll();
  return engine;
}

// ═══ PHOTO SCANNER ══════════════════════════════════════════

async function scanPhotos(dir: string, limit = 20): Promise<Array<{name: string; path: string; ext: string; size: number; base64: string; hash: string}>> {
  const exts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic']);
  const files: any[] = [];
  try {
    for (const entry of await readdir(dir)) {
      if (files.length >= limit) break;
      const fullPath = join(dir, entry);
      try {
        const s = await stat(fullPath);
        if (!s.isFile()) continue;
        const ext = extname(entry).toLowerCase();
        if (!exts.has(ext)) continue;
        const buffer = await readFile(fullPath);
        files.push({
          name: basename(entry), path: fullPath, ext, size: s.size,
          base64: buffer.toString('base64'),
          hash: createHash('sha256').update(buffer).digest('hex').slice(0, 16),
        });
      } catch {}
    }
  } catch {}
  return files;
}

// ═══ BENCHMARK RUNNER ═══════════════════════════════════════

async function runBenchmark(
  name: string,
  category: string,
  iterations: number,
  fn: () => Promise<void>,
  dataSize?: number,
): Promise<BenchmarkResult> {
  const latencies: number[] = [];

  // Warmup (3 iterations)
  for (let i = 0; i < 3; i++) await fn();

  const totalStart = hrNow();
  for (let i = 0; i < iterations; i++) {
    const start = hrNow();
    await fn();
    latencies.push(nsToUs(hrNow() - start));
  }
  const totalTimeMs = nsToMs(hrNow() - totalStart);

  const stats = computeLatencyStats(latencies);
  const opsPerSec = (iterations / totalTimeMs) * 1000;

  return {
    name, category, opsPerSec, latency: stats, totalTimeMs, totalOps: iterations,
    dataSize,
    mbPerSec: dataSize ? (dataSize * iterations / 1048576) / (totalTimeMs / 1000) : undefined,
  };
}

// ═══ BENCHMARK SUITES ═══════════════════════════════════════

async function benchmarkCRUD(engine: SynapseEngine, scale: number): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  const manifest = defineManifest('bench_crud', {
    id: { type: 'uuid', primary: true },
    name: { type: 'string', indexed: true },
    email: { type: 'string', unique: true },
    age: { type: 'integer', transactional: true },
    bio: { type: 'text', searchable: true },
    profile: { type: 'json', flexible: true },
    embedding: { type: 'vector', dimensions: 4 },
    session: { type: 'string', cached: true, ttl: 60 },
  });
  await engine.registerManifest(manifest);

  // Pre-seed data
  const seedDocs = Array.from({ length: scale }, (_, i) => ({
    name: `User ${i}`, email: `user${i}@bench.dev`, age: 20 + (i % 50),
    bio: `Engineer #${i} specializing in backend systems, cloud, and distributed computing.`,
    profile: { level: i % 5, tags: ['dev', 'test'] },
    embedding: [Math.random(), Math.random(), Math.random(), Math.random()],
    session: `sess_${i}`,
  }));
  const seeded = await engine.insert('bench_crud', seedDocs);
  const ids = seeded.data?.insertedIds ?? [];

  // ── INSERT (single doc) ──
  let insertCounter = scale;
  results.push(await runBenchmark('Insert (single doc)', 'WRITE', 500, async () => {
    await engine.insert('bench_crud', [{
      name: `Bench ${insertCounter}`, email: `bench${insertCounter}@test.dev`, age: 25,
      bio: 'Benchmark user for performance testing.', profile: { level: 1 },
      embedding: [0.1, 0.2, 0.3, 0.4], session: `s_${insertCounter}`,
    }]);
    insertCounter++;
  }));

  // ── INSERT (batch 50) ──
  results.push(await runBenchmark('Insert (batch×50)', 'WRITE', 100, async () => {
    const batch = Array.from({ length: 50 }, (_, i) => ({
      name: `Batch ${insertCounter + i}`, email: `batch${insertCounter + i}@test.dev`, age: 30,
      bio: 'Batch insert benchmark user.', profile: { batch: true },
      embedding: [0.5, 0.5, 0.5, 0.5], session: `sb_${insertCounter + i}`,
    }));
    await engine.insert('bench_crud', batch);
    insertCounter += 50;
  }));

  // ── FIND ONE (by indexed field) ──
  results.push(await runBenchmark('FindOne (indexed)', 'READ', 1000, async () => {
    const idx = Math.floor(Math.random() * ids.length);
    await engine.findOne('bench_crud', { email: `user${idx}@bench.dev` });
  }));

  // ── FIND ONE (by ID) ──
  results.push(await runBenchmark('FindOne (by ID)', 'READ', 1000, async () => {
    const id = ids[Math.floor(Math.random() * ids.length)];
    await engine.findOne('bench_crud', { id });
  }));

  // ── FIND ALL ──
  results.push(await runBenchmark(`Find All (${scale} docs)`, 'READ', 200, async () => {
    await engine.find('bench_crud');
  }));

  // ── FIND with filter ──
  results.push(await runBenchmark('Find (filter age>30)', 'READ', 500, async () => {
    await engine.find('bench_crud', { age: { $gt: 30 } });
  }));

  // ── FULL-TEXT SEARCH ──
  results.push(await runBenchmark('Search (full-text)', 'SEARCH', 500, async () => {
    await engine.search('bench_crud', 'distributed computing');
  }));

  // ── VECTOR SEARCH ──
  results.push(await runBenchmark('Search (vector k=5)', 'SEARCH', 500, async () => {
    await engine.search('bench_crud', undefined, {
      field: 'embedding', vector: [0.1, 0.8, 0.3, 0.7], topK: 5,
    });
  }));

  // ── UPDATE (single) ──
  results.push(await runBenchmark('Update (single)', 'WRITE', 500, async () => {
    const idx = Math.floor(Math.random() * ids.length);
    await engine.update('bench_crud', { email: `user${idx}@bench.dev` }, { age: 99, session: 'updated' });
  }));

  // ── DELETE (single) ──
  // Prepare delete targets
  const deleteDocs = Array.from({ length: 600 }, (_, i) => ({
    name: `Delete ${i}`, email: `del${i}@test.dev`, age: 0,
    bio: 'Delete target', profile: {}, embedding: [0, 0, 0, 0], session: `d_${i}`,
  }));
  await engine.insert('bench_crud', deleteDocs);
  let delIdx = 0;
  results.push(await runBenchmark('Delete (single)', 'WRITE', 500, async () => {
    await engine.delete('bench_crud', { email: `del${delIdx}@test.dev` });
    delIdx++;
  }));

  return results;
}

async function benchmarkNLQ(engine: SynapseEngine): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  const manifest = defineManifest('bench_nlq', {
    id: { type: 'uuid', primary: true },
    name: { type: 'string' },
    email: { type: 'string', unique: true },
    department: { type: 'string', indexed: true },
    salary: { type: 'float', transactional: true },
    bio: { type: 'text', searchable: true },
  });
  await engine.registerManifest(manifest);

  const empData = Array.from({ length: 100 }, (_, i) => ({
    name: `Employee ${i}`, email: `emp${i}@company.com`, department: ['Eng', 'Sales', 'Ops'][i % 3],
    salary: 50000 + Math.random() * 150000, bio: `Professional in ${['engineering', 'sales', 'operations'][i % 3]} with expertise.`,
  }));
  await engine.insert('bench_nlq', empData);

  const queries = [
    'Find all bench_nlq where email is emp0@company.com',
    'Show all bench_nlq',
    'How many bench_nlq',
    'Search bench_nlq for "engineering"',
  ];

  for (const q of queries) {
    results.push(await runBenchmark(`NLQ: "${q.slice(0, 35)}..."`, 'NLQ', 300, async () => {
      await engine.ask(q);
    }));
  }

  return results;
}

async function benchmarkAnalytics(engine: SynapseEngine): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  const manifest = defineManifest('bench_analytics', {
    id: { type: 'uuid', primary: true },
    product: { type: 'string', indexed: true },
    region: { type: 'string', indexed: true },
    amount: { type: 'float', transactional: true },
    quantity: { type: 'integer', transactional: true },
  });
  await engine.registerManifest(manifest);

  const salesData = Array.from({ length: 5000 }, (_, i) => ({
    product: ['A', 'B', 'C', 'D', 'E'][i % 5],
    region: ['NA', 'EU', 'APAC', 'LATAM'][i % 4],
    amount: 10 + Math.random() * 990,
    quantity: 1 + Math.floor(Math.random() * 20),
  }));
  await engine.insert('bench_analytics', salesData);

  // Ingest into analytics
  const analytics = engine.analytics();
  const allDocs = await engine.find('bench_analytics');
  for (const d of (allDocs.data ?? [])) analytics.ingest('bench_analytics', d);

  results.push(await runBenchmark('Analytics: COUNT', 'HTAP', 1000, async () => {
    engine.aggregate('bench_analytics', [{ type: 'COUNT', alias: 'total' }]);
  }));

  results.push(await runBenchmark('Analytics: SUM', 'HTAP', 1000, async () => {
    engine.aggregate('bench_analytics', [{ type: 'SUM', field: 'amount', alias: 'revenue' }]);
  }));

  results.push(await runBenchmark('Analytics: AVG+MIN+MAX', 'HTAP', 1000, async () => {
    engine.aggregate('bench_analytics', [
      { type: 'AVG', field: 'amount' }, { type: 'MIN', field: 'amount' }, { type: 'MAX', field: 'amount' },
    ]);
  }));

  results.push(await runBenchmark('Analytics: GROUP BY (4 groups)', 'HTAP', 500, async () => {
    engine.aggregate('bench_analytics', [
      { type: 'GROUP', field: 'region' }, { type: 'SUM', field: 'amount' }, { type: 'COUNT' },
    ]);
  }));

  results.push(await runBenchmark('Analytics: GROUP BY (5 groups)', 'HTAP', 500, async () => {
    engine.aggregate('bench_analytics', [
      { type: 'GROUP', field: 'product' }, { type: 'AVG', field: 'quantity' },
    ]);
  }));

  return results;
}

async function benchmarkEdgeSync(engine: SynapseEngine): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  const edge = engine.edge();
  edge.setOnline(false);

  results.push(await runBenchmark('Edge: localSet', 'CRDT', 2000, async () => {
    const id = randomUUID();
    edge.localSet('edge_bench', id, { name: 'Test', value: Math.random() });
  }));

  // Pre-create for reads
  for (let i = 0; i < 500; i++) {
    edge.localSet('edge_reads', `r-${i}`, { name: `Read ${i}`, active: true });
  }

  results.push(await runBenchmark('Edge: localGet', 'CRDT', 2000, async () => {
    const idx = Math.floor(Math.random() * 500);
    edge.localGet('edge_reads', `r-${idx}`);
  }));

  results.push(await runBenchmark('Edge: localDelete', 'CRDT', 1000, async () => {
    const id = randomUUID();
    edge.localSet('edge_del', id, { temp: true });
    edge.localDelete('edge_del', id);
  }));

  return results;
}

async function benchmarkColdStorage(engine: SynapseEngine): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  const archiver = engine.coldStorage();

  results.push(await runBenchmark('Archive: archiveDocument', 'ARCHIVE', 1000, async () => {
    const id = randomUUID();
    archiver.archiveDocument('cold_bench', id, { id, data: 'x'.repeat(200), ts: Date.now() });
  }));

  // Pre-archive for restores
  for (let i = 0; i < 1100; i++) {
    archiver.archiveDocument('restore_bench', `restore-${i}`, { id: `restore-${i}`, data: 'payload' });
  }
  let restoreIdx = 0;
  results.push(await runBenchmark('Archive: restore', 'ARCHIVE', 1000, async () => {
    archiver.restore('restore_bench', `restore-${restoreIdx}`);
    restoreIdx++;
  }));

  results.push(await runBenchmark('Archive: getTemperature', 'ARCHIVE', 2000, async () => {
    archiver.getTemperature('cold_bench', randomUUID());
  }));

  return results;
}

async function benchmarkRealFiles(engine: SynapseEngine): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  const photos = await scanPhotos('/Users/prudhviraj/Downloads', 15);
  if (photos.length === 0) return results;

  const manifest = defineManifest('bench_files', {
    id: { type: 'uuid', primary: true },
    filename: { type: 'string', indexed: true },
    hash: { type: 'string', unique: true },
    description: { type: 'text', searchable: true },
    metadata: { type: 'json', flexible: true },
    embedding: { type: 'vector', dimensions: 4 },
    lastViewed: { type: 'timestamp', cached: true },
  });

  const blobManifest = defineManifest('bench_blobs', {
    id: { type: 'uuid', primary: true },
    filename: { type: 'string' },
    blobData: { type: 'text', searchable: true },
    blobMeta: { type: 'json', flexible: true },
  });

  await engine.registerManifest(manifest);
  await engine.registerManifest(blobManifest);

  const totalRawBytes = photos.reduce((s, p) => s + p.size, 0);
  const totalBase64Bytes = photos.reduce((s, p) => s + p.base64.length, 0);

  // ── Insert metadata ──
  const metaDocs = photos.map(p => ({
    filename: p.name, hash: p.hash,
    description: `Photo ${p.name} (${p.ext}, ${formatBytes(p.size)})`,
    metadata: { ext: p.ext, size: p.size, path: p.path },
    embedding: [p.size / 10e6, Math.random(), Math.random(), Math.random()],
    lastViewed: new Date().toISOString(),
  }));

  results.push(await runBenchmark(`File: Insert ${photos.length} metadata`, 'FILE', 50, async () => {
    // Use unique hashes each iteration
    const docs = metaDocs.map((d, i) => ({ ...d, hash: `${d.hash}_${randomUUID().slice(0,6)}` }));
    await engine.insert('bench_files', docs);
  }, totalRawBytes));

  // ── Insert blobs ──
  const blobDocs = photos.map(p => ({
    filename: p.name, blobData: p.base64,
    blobMeta: { origSize: p.size, b64Size: p.base64.length },
  }));

  results.push(await runBenchmark(`File: Insert ${photos.length} blobs (${formatBytes(totalBase64Bytes)})`, 'FILE', 50, async () => {
    await engine.insert('bench_blobs', blobDocs);
  }, totalBase64Bytes));

  // Seed for queries
  await engine.insert('bench_files', metaDocs.map((d, i) => ({ ...d, hash: `q_${d.hash}_${i}` })));

  // ── Find file by name ──
  results.push(await runBenchmark('File: FindOne by name', 'FILE', 500, async () => {
    const p = photos[Math.floor(Math.random() * photos.length)]!;
    await engine.findOne('bench_files', { filename: p.name });
  }));

  // ── Search files ──
  results.push(await runBenchmark('File: Search "png"', 'FILE', 500, async () => {
    await engine.search('bench_files', 'png');
  }));

  return results;
}

async function benchmarkConcurrency(engine: SynapseEngine): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  const manifest = defineManifest('bench_concurrent', {
    id: { type: 'uuid', primary: true },
    key: { type: 'string', unique: true },
    value: { type: 'integer', transactional: true },
    label: { type: 'text', searchable: true },
  });
  await engine.registerManifest(manifest);

  // Seed
  const seedDocs = Array.from({ length: 200 }, (_, i) => ({
    key: `cc_${i}`, value: i, label: `Concurrent test item ${i}`,
  }));
  await engine.insert('bench_concurrent', seedDocs);

  // ── Parallel finds (10 concurrent) ──
  results.push(await runBenchmark('Parallel: 10× FindOne', 'CONCURRENCY', 200, async () => {
    await Promise.all(Array.from({ length: 10 }, (_, i) =>
      engine.findOne('bench_concurrent', { key: `cc_${i * 20}` })
    ));
  }));

  // ── Parallel mixed (insert + find + update) ──
  let mixedCounter = 10000;
  results.push(await runBenchmark('Parallel: Mixed (ins+find+upd)', 'CONCURRENCY', 200, async () => {
    await Promise.all([
      engine.insert('bench_concurrent', [{ key: `mx_${mixedCounter++}`, value: 0, label: 'mixed' }]),
      engine.find('bench_concurrent', { value: { $gt: 150 } }),
      engine.update('bench_concurrent', { key: 'cc_0' }, { value: 9999 }),
    ]);
  }));

  return results;
}

// ═══ MAIN ═══════════════════════════════════════════════════

async function main() {
  console.log('');
  console.log(`${BOLD}${CYAN}  ╔══════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}  ║                                                      ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   ⚡ SynapseDB — BENCHMARK SUITE                     ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║                                                      ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   Latency (p50/p95/p99) · Throughput · Scaling        ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   Real files · CRUD · NLQ · HTAP · CRDT · Concurrent  ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ║                                                      ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ╚══════════════════════════════════════════════════════╝${RESET}`);
  console.log('');

  const allResults: BenchmarkResult[] = [];
  const overallStart = hrNow();
  const memBefore = process.memoryUsage();

  // ── Suite 1: CRUD ──
  console.log(`${BOLD}${MAGENTA}  ▶ Suite 1: CRUD Operations (${formatNum(500)} scale)${RESET}`);
  const engine1 = await createEngine();
  allResults.push(...await benchmarkCRUD(engine1, 500));
  await engine1.shutdown();
  console.log(`${GREEN}    ✓ Done${RESET}\n`);

  // ── Suite 2: NLQ ──
  console.log(`${BOLD}${MAGENTA}  ▶ Suite 2: Natural Language Query${RESET}`);
  const engine2 = await createEngine();
  allResults.push(...await benchmarkNLQ(engine2));
  await engine2.shutdown();
  console.log(`${GREEN}    ✓ Done${RESET}\n`);

  // ── Suite 3: Analytics ──
  console.log(`${BOLD}${MAGENTA}  ▶ Suite 3: Analytics HTAP (5K rows)${RESET}`);
  const engine3 = await createEngine();
  allResults.push(...await benchmarkAnalytics(engine3));
  await engine3.shutdown();
  console.log(`${GREEN}    ✓ Done${RESET}\n`);

  // ── Suite 4: Edge Sync ──
  console.log(`${BOLD}${MAGENTA}  ▶ Suite 4: Edge Sync (CRDTs)${RESET}`);
  const engine4 = await createEngine();
  allResults.push(...await benchmarkEdgeSync(engine4));
  await engine4.shutdown();
  console.log(`${GREEN}    ✓ Done${RESET}\n`);

  // ── Suite 5: Cold Storage ──
  console.log(`${BOLD}${MAGENTA}  ▶ Suite 5: Cold Storage Archival${RESET}`);
  const engine5 = await createEngine();
  allResults.push(...await benchmarkColdStorage(engine5));
  await engine5.shutdown();
  console.log(`${GREEN}    ✓ Done${RESET}\n`);

  // ── Suite 6: Real Files ──
  console.log(`${BOLD}${MAGENTA}  ▶ Suite 6: Real File I/O (~/Downloads photos)${RESET}`);
  const engine6 = await createEngine();
  allResults.push(...await benchmarkRealFiles(engine6));
  await engine6.shutdown();
  console.log(`${GREEN}    ✓ Done${RESET}\n`);

  // ── Suite 7: Concurrency ──
  console.log(`${BOLD}${MAGENTA}  ▶ Suite 7: Concurrency${RESET}`);
  const engine7 = await createEngine();
  allResults.push(...await benchmarkConcurrency(engine7));
  await engine7.shutdown();
  console.log(`${GREEN}    ✓ Done${RESET}\n`);

  const overallTime = nsToMs(hrNow() - overallStart);
  const memAfter = process.memoryUsage();

  // ═══ FULL REPORT ══════════════════════════════════════════

  console.log(`${BOLD}${CYAN}  ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${RESET}`);
  console.log(`${BOLD}${CYAN}  ┃                              SYNAPSEDB BENCHMARK REPORT                                                   ┃${RESET}`);
  console.log(`${BOLD}${CYAN}  ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${RESET}`);
  console.log('');

  const maxOps = Math.max(...allResults.map(r => r.opsPerSec));

  // Group by category
  const categories = [...new Set(allResults.map(r => r.category))];

  for (const cat of categories) {
    const catResults = allResults.filter(r => r.category === cat);
    console.log(`${BOLD}  ── ${cat} ${'─'.repeat(90 - cat.length)}${RESET}`);
    console.log(`${DIM}  ${'Operation'.padEnd(38)}│ ops/sec    │ p50       │ p95       │ p99       │ Grade│ Throughput${RESET}`);
    console.log(`${DIM}  ${'─'.repeat(38)}┼────────────┼───────────┼───────────┼───────────┼──────┼───────────────${RESET}`);

    for (const r of catResults) {
      const name = r.name.length > 38 ? r.name.slice(0, 35) + '...' : r.name.padEnd(38);
      const ops = formatNum(r.opsPerSec).padEnd(10);
      const p50 = formatUs(r.latency.p50).padEnd(9);
      const p95 = formatUs(r.latency.p95).padEnd(9);
      const p99 = formatUs(r.latency.p99).padEnd(9);
      const grade = gradeOps(r.opsPerSec);
      const tp = sparkbar(r.opsPerSec, maxOps, 14);
      console.log(`  ${name}│ ${ops} │ ${p50} │ ${p95} │ ${p99} │${grade}│ ${tp}`);
    }
    console.log('');
  }

  // ── Summary ──
  const totalOps = allResults.reduce((s, r) => s + r.totalOps, 0);
  const avgOps = allResults.reduce((s, r) => s + r.opsPerSec, 0) / allResults.length;
  const memDelta = memAfter.heapUsed - memBefore.heapUsed;

  console.log(`${BOLD}  ── SUMMARY ${'─'.repeat(82)}${RESET}`);
  console.log('');
  console.log(`    Benchmarks run:     ${BOLD}${allResults.length}${RESET}`);
  console.log(`    Total operations:   ${BOLD}${formatNum(totalOps)}${RESET}`);
  console.log(`    Total time:         ${BOLD}${(overallTime / 1000).toFixed(2)}s${RESET}`);
  console.log(`    Avg throughput:     ${BOLD}${formatNum(avgOps)}${RESET} ops/sec`);
  console.log(`    Peak throughput:    ${BOLD}${formatNum(maxOps)}${RESET} ops/sec`);
  console.log(`    Memory delta:       ${BOLD}${formatBytes(Math.abs(memDelta))}${RESET} ${memDelta > 0 ? '↑' : '↓'}`);
  console.log(`    Heap used:          ${BOLD}${formatBytes(memAfter.heapUsed)}${RESET}`);
  console.log('');

  // Top 5 fastest
  const sorted = [...allResults].sort((a, b) => b.opsPerSec - a.opsPerSec);
  console.log(`${BOLD}  🏆 Top 5 Fastest:${RESET}`);
  for (let i = 0; i < Math.min(5, sorted.length); i++) {
    const r = sorted[i]!;
    console.log(`    ${['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i]} ${r.name.padEnd(40)} ${BOLD}${formatNum(r.opsPerSec)}${RESET} ops/sec  (p50: ${formatUs(r.latency.p50)})`);
  }
  console.log('');

  // Bottom 5 slowest
  console.log(`${BOLD}  🐢 Bottom 5 (bottlenecks):${RESET}`);
  const bottom = sorted.slice(-5).reverse();
  for (let i = 0; i < bottom.length; i++) {
    const r = bottom[i]!;
    console.log(`    ${i + 1}. ${r.name.padEnd(40)} ${YELLOW}${formatNum(r.opsPerSec)}${RESET} ops/sec  (p99: ${formatUs(r.latency.p99)})`);
  }
  console.log('');

  console.log(`${BOLD}${CYAN}  ╔══════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${CYAN}  ║   ✅ Benchmark complete — ${allResults.length} benchmarks in ${(overallTime/1000).toFixed(1)}s     ║${RESET}`);
  console.log(`${BOLD}${CYAN}  ╚══════════════════════════════════════════════════════╝${RESET}`);
  console.log('');
}

main().catch(console.error);
