// ──────────────────────────────────────────────────────────────
// SynapseDB — Plugin Registry
// Manages plugin lifecycle: registration, initialization, and lookup.
// ──────────────────────────────────────────────────────────────

import type { IStoragePlugin } from './contract.js';
import type { PluginConfig, Logger, HealthStatus } from '../types.js';

/**
 * Registered plugin entry with its configuration.
 */
interface RegisteredPlugin {
  plugin: IStoragePlugin;
  config: PluginConfig;
  initialized: boolean;
  priority: number;
}

/**
 * PluginRegistry — Central registry for all storage plugins.
 *
 * Manages the full lifecycle:
 * 1. Registration — plugins are added with their config
 * 2. Initialization — connect() is called on each plugin
 * 3. Lookup — core engine retrieves plugins by name or type
 * 4. Shutdown — disconnect() is called on each plugin
 */
export class PluginRegistry {
  private plugins: Map<string, RegisteredPlugin> = new Map();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Register a plugin with its configuration.
   * Does NOT initialize the connection — call initialize() after registration.
   */
  register(plugin: IStoragePlugin, config: PluginConfig, priority: number = 0): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }

    this.plugins.set(plugin.name, {
      plugin,
      config,
      initialized: false,
      priority,
    });

    this.logger.info(`Plugin registered: ${plugin.name} (type: ${plugin.type})`);
  }

  /**
   * Initialize all registered plugins by calling connect().
   * Plugins are initialized in priority order (higher priority first).
   */
  async initializeAll(): Promise<void> {
    const sorted = [...this.plugins.entries()].sort(
      ([, a], [, b]) => b.priority - a.priority,
    );

    for (const [name, entry] of sorted) {
      try {
        this.logger.info(`Initializing plugin: ${name}...`);
        await entry.plugin.connect(entry.config, this.logger);
        entry.initialized = true;
        this.logger.info(`Plugin initialized: ${name} ✓`);
      } catch (error) {
        this.logger.error(`Failed to initialize plugin: ${name}`, error);
        throw new Error(
          `Plugin "${name}" failed to initialize: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Gracefully shutdown all plugins.
   */
  async shutdownAll(): Promise<void> {
    const entries = [...this.plugins.entries()].reverse();

    for (const [name, entry] of entries) {
      if (entry.initialized) {
        try {
          await entry.plugin.disconnect();
          entry.initialized = false;
          this.logger.info(`Plugin disconnected: ${name}`);
        } catch (error) {
          this.logger.error(`Error disconnecting plugin: ${name}`, error);
        }
      }
    }
  }

  /**
   * Get a plugin by name. Throws if not found or not initialized.
   */
  get(name: string): IStoragePlugin {
    const entry = this.plugins.get(name);
    if (!entry) {
      throw new Error(`Plugin "${name}" is not registered`);
    }
    if (!entry.initialized) {
      throw new Error(`Plugin "${name}" is registered but not initialized`);
    }
    return entry.plugin;
  }

  /**
   * Get all plugins of a specific storage type.
   */
  getByType(type: string): IStoragePlugin[] {
    return [...this.plugins.values()]
      .filter((entry) => entry.plugin.type === type && entry.initialized)
      .sort((a, b) => b.priority - a.priority)
      .map((entry) => entry.plugin);
  }

  /**
   * Get all registered and initialized plugin names.
   */
  getNames(): string[] {
    return [...this.plugins.entries()]
      .filter(([, entry]) => entry.initialized)
      .map(([name]) => name);
  }

  /**
   * Get all registered and initialized plugins.
   */
  getAll(): IStoragePlugin[] {
    return [...this.plugins.values()]
      .filter((entry) => entry.initialized)
      .map((entry) => entry.plugin);
  }

  /**
   * Check if a plugin is registered and initialized.
   */
  has(name: string): boolean {
    const entry = this.plugins.get(name);
    return entry !== undefined && entry.initialized;
  }

  /**
   * Health check all plugins and return aggregate status.
   */
  async healthCheckAll(): Promise<Record<string, HealthStatus>> {
    const results: Record<string, HealthStatus> = {};

    for (const [name, entry] of this.plugins) {
      if (entry.initialized) {
        try {
          results[name] = await entry.plugin.healthCheck();
        } catch (error) {
          results[name] = {
            healthy: false,
            latencyMs: -1,
            message: error instanceof Error ? error.message : String(error),
          };
        }
      } else {
        results[name] = {
          healthy: false,
          latencyMs: -1,
          message: 'Plugin not initialized',
        };
      }
    }

    return results;
  }

  /**
   * Get total count of registered plugins.
   */
  get size(): number {
    return this.plugins.size;
  }
}
