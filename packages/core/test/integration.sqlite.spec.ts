import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SynapseEngine } from '../src/index.js';
import type { SynapseConfig } from '../src/types.js';
import * as fs from 'fs';

/**
 * Native Integration Test (Zero Docker)
 * 
 * Uses the SQLite plugin to definitively prove that the Synapse Engine
 * compiles ASTs, builds schemas, inserts records, and queries a real database.
 */

const TEST_DB_PATH = './test-local.db';

const TEST_CONFIG: SynapseConfig = {
  host: 'localhost',
  port: 19877,
  logLevel: 'error',
  plugins: {
    sqlite: {
      type: 'sql',
      package: '@synapsedb/plugin-sqlite',
      config: {
        connectionUri: 'sqlite://local',
        options: { path: TEST_DB_PATH }
      },
    },
  },
};

describe('SynapseDB Native Execution (SQLite)', () => {
  let engine: SynapseEngine;

  beforeAll(async () => {
    // Clean up previous test runs
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);

    engine = new SynapseEngine(TEST_CONFIG);
    await engine.initialize();

    await engine.registerManifest({
      name: 'local_users',
      fields: {
        id:       { type: 'string', primary: true },
        email:    { type: 'string', unique: true, transactional: true },
        username: { type: 'string', indexed: true },
      },
    });
  });

  afterAll(async () => {
    await engine.shutdown();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  it('should physically create the local.db file', () => {
    expect(fs.existsSync(TEST_DB_PATH)).toBe(true);
  });

  it('should successfully INSERT a document natively', async () => {
    const result = await engine.insert(
      'local_users',
      [{ id: 'u_123', email: 'test@synapsedb.io', username: 'tester' }]
    );

    expect(result.success).toBe(true);
    expect(result.meta.routedTo).toContain('sqlite');
    expect(result.data.insertedCount).toBe(1);
  });

  it('should successfully FIND the inserted document natively', async () => {
    const result = await engine.find('local_users', { email: 'test@synapsedb.io' });

    expect(result.success).toBe(true);
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.data[0].id).toBe('u_123');
    expect(result.data[0].username).toBe('tester');
    expect(result.meta.took).toBeGreaterThanOrEqual(0);
  });

  it('should strictly accurately route transactional fields to SQLite', () => {
    const map = engine.getRoutingMap('local_users');
    expect(map?.fieldRoutes['email']?.store).toBe('sqlite');
  });
});
