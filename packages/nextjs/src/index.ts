import { SynapseEngine } from '@synapsedb/core';
import type { SynapseConfig } from '@synapsedb/core';

// Ensure the global object survives HMR in Next.js Edge/Node Runtimes
const globalForSynapse = globalThis as unknown as {
  synapseEngine: SynapseEngine | undefined;
};

/**
 * Ensures a singleton connection to the SynapseDB engine across Next.js reloads.
 * This prevents HMR from spawning thousands of stale database pool connections.
 *
 * @param config The SynapseDB topology configuration
 * @returns An intelligent SynapseEngine instance
 */
export async function createSynapseClient(config: SynapseConfig): Promise<SynapseEngine> {
  const engine = globalForSynapse.synapseEngine ?? new SynapseEngine(config);

  if (process.env.NODE_ENV !== 'production') {
    globalForSynapse.synapseEngine = engine;
  }

  // Idempotent start (engine will ignore subsequent starts)
  try {
    await engine.initialize();
  } catch (err: any) {
    if (err.message !== 'Engine already running') {
      throw err;
    }
  }

  return engine;
}
