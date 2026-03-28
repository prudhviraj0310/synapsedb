// ──────────────────────────────────────────────────────────────
// SynapseDB SDK — Client
// The main entry point for developers using SynapseDB.
// ──────────────────────────────────────────────────────────────

import type { SynapseDBClientConfig, CollectionManifest, ApiResponse } from './types.js';
import { Collection } from './collection.js';

/**
 * SynapseDB — The Universal Database Client
 *
 * Connect to a SynapseDB Engine and interact with your data
 * using a single, unified API. Under the hood, SynapseDB routes
 * your data to the optimal storage backends automatically.
 *
 * @example
 * ```typescript
 * import { SynapseDB, defineManifest } from '@synapsedb/sdk';
 *
 * const db = new SynapseDB({
 *   endpoint: 'http://localhost:9876',
 *   apiKey: 'your-api-key',
 * });
 *
 * // Define your data model
 * const users = defineManifest('users', {
 *   id:    { type: 'uuid', primary: true },
 *   email: { type: 'string', unique: true },
 *   name:  { type: 'string' },
 *   bio:   { type: 'text', searchable: true },
 * });
 *
 * // Register it
 * await db.register(users);
 *
 * // Use it — feels like one database
 * await db.users.insert({ email: 'hello@world.com', name: 'World' });
 * const user = await db.users.findOne({ email: 'hello@world.com' });
 * ```
 */
export class SynapseDB {
  private config: SynapseDBClientConfig;
  private collections: Map<string, Collection> = new Map();
  private baseUrl: string;

  // Dynamic collection accessor
  [key: string]: unknown;

  constructor(config: SynapseDBClientConfig) {
    this.config = config;
    this.baseUrl = config.endpoint.replace(/\/+$/, '') + '/api/v1';

    // Return a Proxy so `db.users` works dynamically
    return new Proxy(this, {
      get(target, prop: string | symbol) {
        if (typeof prop === 'symbol') {
          return Reflect.get(target, prop);
        }

        // Known method/property
        if (prop in target) {
          return Reflect.get(target, prop);
        }

        // Dynamic collection accessor
        const collection = target.collections.get(prop);
        if (collection) {
          return collection;
        }

        // Auto-create collection proxy (lazy registration)
        const newCollection = new Collection(prop, target.request.bind(target));
        target.collections.set(prop, newCollection);
        return newCollection;
      },
    });
  }

  /**
   * Register a data manifest with the SynapseDB Engine.
   * This tells the engine how to route your data.
   */
  async register(manifest: CollectionManifest): Promise<void> {
    const response = await this.request('POST', '/manifest', manifest);

    if (!response.success) {
      throw new Error(
        `Failed to register manifest "${manifest.name}": ${response.error?.message}`,
      );
    }

    // Create collection proxy
    const collection = new Collection(manifest.name, this.request.bind(this));
    this.collections.set(manifest.name, collection);
  }

  /**
   * Check the health of the SynapseDB Engine.
   */
  async health(): Promise<Record<string, unknown>> {
    const response = await this.request('GET', '/health');
    return response as unknown as Record<string, unknown>;
  }

  /**
   * Get routing and observability metrics.
   */
  async metrics(): Promise<Record<string, unknown>> {
    const response = await this.request('GET', '/metrics');
    return (response as ApiResponse).data as Record<string, unknown>;
  }

  /**
   * Trigger a manual CDC sync (propagates pending changes).
   */
  async sync(): Promise<void> {
    // Sync is event-driven, this is a no-op hint to the engine
    this.request('POST', '/sync').catch(() => {
      // Sync endpoint may not exist yet — that's fine
    });
  }

  /**
   * Get a collection accessor by name.
   */
  collection(name: string): Collection {
    let col = this.collections.get(name);
    if (!col) {
      col = new Collection(name, this.request.bind(this));
      this.collections.set(name, col);
    }
    return col;
  }

  // ─── HTTP Client ────────────────────────────────────────

  private async request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResponse> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['X-API-Key'] = this.config.apiKey;
    }

    const fetchOptions: RequestInit = {
      method,
      headers,
    };

    if (body && method !== 'GET') {
      fetchOptions.body = JSON.stringify(body);
    }

    const controller = new AbortController();
    const timeout = this.config.timeout ?? 30000;
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    fetchOptions.signal = controller.signal;

    try {
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);

      const data = await response.json() as ApiResponse;

      if (!response.ok && !data.error) {
        return {
          success: false,
          error: {
            code: `HTTP_${response.status}`,
            message: response.statusText,
          },
        };
      }

      return data;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        return {
          success: false,
          error: {
            code: 'TIMEOUT',
            message: `Request timed out after ${timeout}ms`,
          },
        };
      }

      return {
        success: false,
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}

/** @deprecated Use SynapseDB instead */
export const OmniDB = SynapseDB;
