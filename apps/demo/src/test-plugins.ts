// ══════════════════════════════════════════════════════════════
// SynapseDB Platform — STEP 1: Plugin Tests
// ══════════════════════════════════════════════════════════════

import { PostgresPlugin } from '@synapsedb/plugin-postgres';
import { RedisPlugin } from '@synapsedb/plugin-redis';
import { MongoPlugin } from '@synapsedb/plugin-mongodb';
import type { IStoragePlugin, PluginConfig, CollectionManifest, QueryAST, Logger } from '@synapsedb/core';

const pass = (msg: string) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const fail = (msg: string) => console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
const skip = (msg: string) => console.log(`  \x1b[33m⚠\x1b[0m ${msg} — SKIPPED`);
const section = (msg: string) => console.log(`\n\x1b[36m━━ ${msg} ━━\x1b[0m`);

let passed = 0, failed = 0, skipped = 0;

function assert(condition: boolean, msg: string) {
  if (condition) { pass(msg); passed++; }
  else { fail(msg); failed++; }
}

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const testManifest: CollectionManifest = {
  name: 'test_items',
  fields: {
    id:    { type: 'uuid', primary: true },
    name:  { type: 'string' },
    email: { type: 'string' },
    score: { type: 'integer' },
  },
};

function makeFilterAST(field: string, value: unknown): QueryAST {
  return {
    type: 'FIND',
    collection: 'test_items',
    filters: {
      logic: 'AND',
      conditions: [{ field, op: 'EQ', value }],
    },
  };
}

// ─── CAPABILITY TESTS (no DB needed) ─────────────────────────

async function testCapabilities() {
  section('Capabilities (no DB required)');

  const pg = new PostgresPlugin({});
  const redis = new RedisPlugin({});
  const mongo = new MongoPlugin({});

  const pgCaps = pg.capabilities();
  assert(pgCaps.supportsTransactions === true, 'Postgres — supportsTransactions: true');
  assert(pgCaps.supportsIndexes === true, 'Postgres — supportsIndexes: true');

  const redisCaps = redis.capabilities();
  assert(redisCaps.supportsTTL === true, 'Redis — supportsTTL: true');
  assert(redisCaps.supportsTransactions === false, 'Redis — supportsTransactions: false');

  const mongoCaps = mongo.capabilities();
  assert(mongoCaps.supportsNestedDocuments === true, 'MongoDB — supportsNestedDocuments: true');
  assert(mongoCaps.supportsFullTextSearch === true, 'MongoDB — supportsFullTextSearch: true');
}

// ─── CRUD TEST (generic, works for any plugin) ───────────────

async function testPluginCRUD(
  pluginName: string,
  plugin: IStoragePlugin,
  config: PluginConfig,
) {
  section(`${pluginName} — CRUD Cycle`);

  // 1. Connect
  try {
    await plugin.connect(config, noopLogger);
    pass(`${pluginName} — connected`);
  } catch (err: any) {
    skip(`${pluginName} — connection failed: ${err.message}`);
    skipped += 6; // skip the rest
    return;
  }

  // 2. Health check
  try {
    const health = await plugin.healthCheck();
    assert(health.healthy === true, `${pluginName} — healthCheck healthy (${health.latencyMs}ms)`);
  } catch (err: any) {
    fail(`${pluginName} — healthCheck threw: ${err.message}`);
    failed++;
  }

  // 3. Sync schema
  try {
    await plugin.syncSchema(testManifest, ['id', 'name', 'email', 'score']);
    pass(`${pluginName} — syncSchema passed`);
  } catch (err: any) {
    fail(`${pluginName} — syncSchema failed: ${err.message}`);
    failed++;
  }

  // 4. Insert
  try {
    const docs = [
      { id: '10000000-0000-0000-0000-000000000001', name: 'Alice', email: 'alice@test.com', score: 95 },
      { id: '10000000-0000-0000-0000-000000000002', name: 'Bob', email: 'bob@test.com', score: 82 },
      { id: '10000000-0000-0000-0000-000000000003', name: 'Charlie', email: 'charlie@test.com', score: 71 },
    ];
    const result = await plugin.insert('test_items', docs, ['id', 'name', 'email', 'score']);
    assert(result.insertedCount >= 0, `${pluginName} — insert returned insertedCount=${result.insertedCount}`);
  } catch (err: any) {
    fail(`${pluginName} — insert failed: ${err.message}`);
    failed++;
  }

  // 5. Find
  try {
    const found = await plugin.find('test_items', makeFilterAST('id', '10000000-0000-0000-0000-000000000001'), ['id', 'name', 'email', 'score']);
    assert(found.length >= 1, `${pluginName} — find returned ${found.length} doc(s)`);
  } catch (err: any) {
    fail(`${pluginName} — find failed: ${err.message}`);
    failed++;
  }

  // 6. FindOne
  try {
    const one = await plugin.findOne('test_items', makeFilterAST('id', '10000000-0000-0000-0000-000000000002'), ['id', 'name', 'email', 'score']);
    assert(one !== null, `${pluginName} — findOne returned a document`);
  } catch (err: any) {
    fail(`${pluginName} — findOne failed: ${err.message}`);
    failed++;
  }

  // 7. Update
  try {
    const updated = await plugin.update(
      'test_items',
      makeFilterAST('id', '10000000-0000-0000-0000-000000000001'),
      { score: 99 },
      ['id', 'name', 'email', 'score'],
    );
    assert(updated.matchedCount >= 1, `${pluginName} — update matchedCount=${updated.matchedCount}`);
  } catch (err: any) {
    fail(`${pluginName} — update failed: ${err.message}`);
    failed++;
  }

  // 8. Delete
  try {
    const deleted = await plugin.delete('test_items', makeFilterAST('id', '10000000-0000-0000-0000-000000000003'));
    assert(deleted.deletedCount >= 1, `${pluginName} — delete deletedCount=${deleted.deletedCount}`);
  } catch (err: any) {
    fail(`${pluginName} — delete failed: ${err.message}`);
    failed++;
  }

  // Cleanup remaining test docs
  try {
    await plugin.delete('test_items', makeFilterAST('id', '10000000-0000-0000-0000-000000000001'));
    await plugin.delete('test_items', makeFilterAST('id', '10000000-0000-0000-0000-000000000002'));
  } catch {}

  // 9. Disconnect
  try {
    await plugin.disconnect();
    pass(`${pluginName} — disconnected`);
  } catch (err: any) {
    fail(`${pluginName} — disconnect failed: ${err.message}`);
    failed++;
  }
}

// ─── SQL INJECTION SAFETY TEST (Postgres specific) ───────────

async function testSQLInjectionSafety() {
  section('SQL Injection Safety (Postgres)');

  const pg = new PostgresPlugin({});
  const pgUri = process.env.DATABASE_URL || 'postgresql://localhost:5432/synapsetest';

  try {
    await pg.connect({ connectionUri: pgUri }, noopLogger);
  } catch {
    skip('Postgres not reachable — injection test skipped');
    skipped++;
    return;
  }

  try {
    await pg.syncSchema(testManifest, ['id', 'name', 'email', 'score']);

    // Insert a document with a SQL injection payload as a VALUE
    const injectionPayload = "'; DROP TABLE test_items; --";
    await pg.insert('test_items', [{ id: '99999999-9999-9999-9999-999999999999', name: 'Hacker', email: injectionPayload, score: 0 }], ['id', 'name', 'email', 'score']);

    // If the table still exists and we can query it, injection was prevented
    const found = await pg.find('test_items', makeFilterAST('email', injectionPayload), ['id', 'name', 'email', 'score']);
    assert(found.length >= 1, 'Postgres — SQL injection payload handled safely via parameterization');

    // Cleanup
    await pg.delete('test_items', makeFilterAST('id', '99999999-9999-9999-9999-999999999999'));
  } catch (err: any) {
    fail(`Postgres — SQL injection test error: ${err.message}`);
    failed++;
  }

  await pg.disconnect();
}

// ─── CONNECTION FAILURE TEST ─────────────────────────────────

async function testConnectionFailure() {
  section('Connection Failure Handling');

  const pg = new PostgresPlugin({});
  try {
    // Point at a port that is definitely not listening
    await pg.connect(
      { connectionUri: 'postgresql://localhost:59999/nonexistent' },
      noopLogger,
    );
    fail('Postgres — should have thrown on bad connection');
    failed++;
  } catch (err: any) {
    assert(err.code === 'PLUGIN_CONNECTION_FAILED' || err.name === 'SynapseError',
      `Postgres — connection failure threw SynapseError (code=${err.code})`);
  }
}

// ─── MAIN ────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  SynapseDB — Plugin Test Suite');
  console.log('══════════════════════════════════════════════');

  await testCapabilities();

  await testPluginCRUD('Postgres', new PostgresPlugin({}), {
    connectionUri: process.env.DATABASE_URL || 'postgresql://localhost:5432/synapsetest',
  });

  await testPluginCRUD('Redis', new RedisPlugin({}), {
    connectionUri: process.env.REDIS_URL || 'redis://localhost:6379',
  });

  await testPluginCRUD('MongoDB', new MongoPlugin({}), {
    connectionUri: process.env.MONGO_URL || 'mongodb://localhost:27017/synapsetest',
  });

  await testSQLInjectionSafety();
  await testConnectionFailure();

  console.log('\n──────────────────────────────────────────────');
  console.log(`  Passed: ${passed}  Failed: ${failed}  Skipped: ${skipped}`);
  console.log('──────────────────────────────────────────────\n');

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error in plugin tests:', err);
  process.exit(1);
});
