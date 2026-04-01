import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import createPostgresPlugin, { PostgresPlugin } from '../src/index.js';
import type { QueryAST } from '@synapsedb/core/types';

import { execSync } from 'child_process';

const hasDocker = () => {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const runIfDocker = hasDocker() ? describe : describe.skip;

runIfDocker('plugin-postgres — ephemeral testcontainers execution', () => {
  let container: any;
  let plugin: PostgresPlugin;

  beforeAll(async () => {
    // Spin up an isolated PostgreSQL database dynamically
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    
    // Connect plugin to the ephemeral mapped port
    plugin = createPostgresPlugin({ 
      connectionUri: container.getConnectionUri() 
    }) as PostgresPlugin;

    await plugin.connect({
      connectionUri: container.getConnectionUri()
    }, console as any);

    // Sync schema
    await plugin.syncSchema(
      { name: 'test_users', fields: { id: { type: 'string', primary: true }, email: { type: 'string' } } },
      {}
    );
  }, 60000); // Allow up to 60s for Docker to pull and start

  afterAll(async () => {
    await plugin?.disconnect();
    if (container) await container.stop();
  });

  it('inserts and finds a document reliably via AST', async () => {
    // 1. Insert
    const inserted = await plugin.insert('test_users', [{ id: '1', email: 'test@synapse.io' }], ['id', 'email']);
    expect(inserted.insertedCount).toBe(1);

    // 2. Find
    const ast: QueryAST = {
      type: 'FIND',
      collection: 'test_users',
      filters: { logic: 'AND', conditions: [{ field: 'email', operator: 'eq', value: 'test@synapse.io' }] }
    };
    
    const results = await plugin.find('test_users', ast, ['id', 'email']);
    expect(results).toHaveLength(1);
    expect(results[0].email).toBe('test@synapse.io');
  });

  it('properly generates IS NULL logic', async () => {
    await plugin.insert('test_users', [{ id: '2', email: null }], ['id', 'email']);
    
    const ast: QueryAST = {
      type: 'FIND',
      collection: 'test_users',
      filters: { logic: 'AND', conditions: [{ field: 'email', operator: 'eq', value: null }] }
    };

    const results = await plugin.find('test_users', ast, ['id', 'email']);
    const record = results.find(r => r.id === '2');
    expect(record).toBeDefined();
    expect(record?.email).toBeNull();
  });
});
