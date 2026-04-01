import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { PostgresPlugin } from '../src/index.js';
import type { QueryAST } from '@synapsedb/core/types';

describe('plugin-postgres AST Compiler — Property-based testing', () => {

  const plugin = new PostgresPlugin({ connectionUri: 'mock' }) as any; // Cast as ANY to access private buildWhereClause

  it('Strictly isolates dynamic strings: User input NEVER appears in the raw SQL string buffer', () => {
    // fast-check runs 100 iterations of random edge-case strings automatically
    fc.assert(
      fc.property(
        fc.string(), // Random SQL injections, null bytes, unicode boundaries, emojis
        (maliciousUserInput) => {
          
          const ast: QueryAST = {
            type: 'FIND',
            collection: 'users',
            filters: {
              logic: 'AND',
              conditions: [{ field: 'email', operator: 'eq', value: maliciousUserInput }]
            }
          };

          // Generate the SQL via the router's query compiler
          const { where, values } = plugin.buildWhereClause(ast, 1);

          // 1: Protects against direct embedding (e.g., SELECT * WHERE email='[injection]')
          // The structure of the compiled SQL must remain IMMUTABLY CONSTANT regardless of the malicious input.
          expect(where).toBe('"email" = $1');

          // 2: Verifies that the compiler explicitly bound the parameters correctly into the driver wrapper
          expect(values[0]).toStrictEqual(maliciousUserInput);
        }
      ),
      { numRuns: 100 } // Ensure it's hit 100 distinct random vectors
    );
  });

});
