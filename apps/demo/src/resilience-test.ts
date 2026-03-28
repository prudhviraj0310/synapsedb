import { SynapseEngine } from '@synapsedb/core';
import type { IStoragePlugin } from '@synapsedb/core/plugin/contract';
import type { PluginCapabilities, CollectionManifest, QueryAST, Document, InsertResult, UpdateResult, DeleteResult, HealthStatus } from '@synapsedb/core/types';
import { defineManifest } from '@synapsedb/sdk';
import { randomUUID } from 'node:crypto';

// ─── Mock Primary Data Store ────────────────────────────────

class MockSQL implements IStoragePlugin {
  readonly name = 'postgres';
  readonly type = 'sql' as const;
  
  public store = new Map<string, Document[]>();

  async connect() {}
  async disconnect() {}
  async healthCheck(): Promise<HealthStatus> { return { healthy: true, latencyMs: 0 }; }
  async syncSchema(m: CollectionManifest) { if (!this.store.has(m.name)) this.store.set(m.name, []); }
  
  async insert(col: string, docs: Document[], fields: string[]): Promise<InsertResult> {
    const c = this.store.get(col) ?? [];
    const ids: string[] = [];
    for (const d of docs) {
      const f: Document = {};
      for (const [k, v] of Object.entries(d)) if (fields.includes(k) || k === 'id') f[k] = v;
      if (!f['id']) f['id'] = randomUUID();
      c.push(f);
      ids.push(String(f['id']));
    }
    this.store.set(col, c);
    return { insertedCount: docs.length, insertedIds: ids };
  }

  async find(col: string, q: QueryAST, fields: string[]): Promise<Document[]> {
    let r = this.store.get(col) ?? [];
    // Basic filter simulation for rollback by ID
    if (q.filters && q.filters.conditions[0] && 'field' in q.filters.conditions[0] && q.filters.conditions[0].field === 'id') {
       const targetId = (q.filters.conditions[0] as { field: string; value: unknown }).value;
       if (Array.isArray(targetId)) {
           r = r.filter(d => targetId.includes(d['id']));
       } else {
           r = r.filter(d => d['id'] === targetId);
       }
    }
    return r;
  }
  
  async findOne(col: string, q: QueryAST, fields: string[]) {
    const r = await this.find(col, q, fields);
    return r[0] ?? null;
  }

  async update(col: string, q: QueryAST, ch: Record<string, unknown>, f: string[]): Promise<UpdateResult> {
    const c = this.store.get(col) ?? [];
    let m = 0;
    // VERY simple mock update
    const cond = q.filters?.conditions[0];
    const targetId = cond && 'value' in cond ? cond.value : undefined;
    for (const d of c) {
      if (!targetId || d['id'] === targetId) {
        for (const [k, v] of Object.entries(ch)) if (f.includes(k)) d[k] = v;
        m++;
      }
    }
    return { matchedCount: m, modifiedCount: m };
  }

  async delete(col: string, q: QueryAST): Promise<DeleteResult> {
    const c = this.store.get(col) ?? [];
    const cond = q.filters?.conditions[0];
    const targetId = cond && 'value' in cond ? cond.value : undefined;
    
    // Array of ids or single id
    const idsToDelete = Array.isArray(targetId) ? targetId : [targetId];
    
    const remaining = c.filter(d => !idsToDelete.includes(d['id']));
    this.store.set(col, remaining);
    return { deletedCount: c.length - remaining.length };
  }

  capabilities(): PluginCapabilities {
    return { supportsTransactions: true, supportsFullTextSearch: false, supportsVectorSearch: false, supportsNestedDocuments: false, supportsTTL: false, supportsIndexes: true, supportsUniqueConstraints: true };
  }
}

// ─── Chaos Secondary Store (Fails Randomly/On Command) ──────

class ChaosRedis implements IStoragePlugin {
  readonly name = 'redis';
  readonly type = 'cache' as const;
  
  public shouldFail = false;

  async connect() {}
  async disconnect() {}
  async healthCheck(): Promise<HealthStatus> { return { healthy: true, latencyMs: 0 }; }
  async syncSchema() {}

  private maybeCrash() {
    if (this.shouldFail) throw new Error("Connection to Redis randomly dropped (Chaos Engineering Mode)!");
  }
  
  async insert(): Promise<InsertResult> { this.maybeCrash(); return { insertedCount: 1, insertedIds: ['1'] }; }
  async find(): Promise<Document[]> { this.maybeCrash(); return []; }
  async findOne(): Promise<Document | null> { this.maybeCrash(); return null; }
  async update(): Promise<UpdateResult> { this.maybeCrash(); return { matchedCount: 1, modifiedCount: 1 }; }
  async delete(): Promise<DeleteResult> { this.maybeCrash(); return { deletedCount: 1 }; }

  capabilities(): PluginCapabilities {
    return { supportsTransactions: false, supportsFullTextSearch: false, supportsVectorSearch: false, supportsNestedDocuments: false, supportsTTL: true, supportsIndexes: false, supportsUniqueConstraints: false };
  }
}

// ─── TEST EXECUTION ───────────────────────────────────────

async function main() {
  console.log("\n🧪 STARTING SYNAPSEDB SAGA ROLLBACK TEST (STRONG CONSISTENCY)\n");

  const engine = new SynapseEngine({
    logLevel: 'error',
    topology: {
      consistency: 'STRONG',
      retries: { maxAttempts: 1, initialDelayMs: 10 } // Fail fast for testing
    },
    plugins: {} // we will inject manually
  });

  const sqlStore = new MockSQL();
  const chaosStore = new ChaosRedis();

  // Hack into the private registry to avoid the real package imports for tests
  const reg = (engine as any).registry;
  reg.register(sqlStore, {}, 100);
  reg.register(chaosStore, {}, 80);
  await reg.initializeAll();

  // Register schema
  const manifest = defineManifest('users', {
    id: { type: 'uuid', primary: true },
    name: { type: 'string', transactional: true }, // Goes to SQL
    sessionToken: { type: 'string', cached: true } // Goes to Redis
  });
  await engine.registerManifest(manifest);

  // --- TEST 1: Successful Write ---
  console.log("▶ TEST 1: Successful Insert across both stores");
  const res1 = await engine.insert('users', { id: 'u1', name: 'Alice', sessionToken: 'abc' });
  console.log(`  ✓ Primary Inserted: ${sqlStore.store.get('users')?.length === 1}`);

  // --- TEST 2: Failed Write (Triggers Saga Rollback) ---
  console.log("\n▶ TEST 2: Secondary Store Crash (Rollback expected)");
  chaosStore.shouldFail = true;
  
  try {
    await engine.insert('users', { id: 'u2', name: 'Bob', sessionToken: 'def' });
  } catch (err: unknown) {
    console.log(`  ✓ Caught anticipated error: ${(err as Error).message}`);
  }

  const docsAfterRollback = sqlStore.store.get('users') ?? [];
  const bobPresent = docsAfterRollback.some(d => d['name'] === 'Bob');
  
  if (!bobPresent && docsAfterRollback.length === 1) {
    console.log(`  ✓ SUCCESS: Bob was safely rolled back from the Primary Store! (Count: ${docsAfterRollback.length})`);
  } else {
    console.error(`  ❌ FAILED: Bob was found in the DB (Count: ${docsAfterRollback.length})`);
    process.exit(1);
  }

  console.log("\n🧪 ALL RESILIENCE TESTS PASSED.\n");
}

main().catch(console.error);
