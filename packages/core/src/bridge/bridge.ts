// ──────────────────────────────────────────────────────────────
// SynapseDB — Feature Bridge
// Maps what each DB can and can't do, providing graceful
// fallback stubs for missing features.
// ──────────────────────────────────────────────────────────────

import type { PluginCapabilities, Logger } from '../types.js';
import type { IStoragePlugin } from '../plugin/contract.js';
import type { PluginRegistry } from '../plugin/registry.js';

/**
 * Feature identifiers that can be queried.
 */
export type Feature =
  | 'transactions'
  | 'fullTextSearch'
  | 'vectorSearch'
  | 'nestedDocuments'
  | 'ttl'
  | 'indexes'
  | 'uniqueConstraints';

/**
 * Feature status for a specific plugin.
 */
export interface FeatureStatus {
  supported: boolean;
  fallback: 'native' | 'emulated' | 'unsupported';
  description: string;
}

/**
 * Complete capability report for a plugin.
 */
export interface PluginCapabilityReport {
  pluginName: string;
  pluginType: string;
  features: Record<Feature, FeatureStatus>;
}

/**
 * FeatureBridge — Capability Mapping & Fallback System
 *
 * Sits between the Core Engine and the Driver Adapters.
 * For each plugin, it knows exactly what features are supported
 * and provides graceful degradation for missing capabilities.
 *
 * Example:
 * - Redis doesn't support full-text search → Bridge provides
 *   an in-memory regex filter fallback.
 * - In-memory vector store doesn't support transactions →
 *   Bridge provides best-effort write semantics.
 */
export class FeatureBridge {
  private registry: PluginRegistry;
  private logger: Logger;
  private capabilityCache: Map<string, PluginCapabilities> = new Map();

  constructor(registry: PluginRegistry, logger: Logger) {
    this.registry = registry;
    this.logger = logger;
  }

  /**
   * Check if a specific plugin supports a feature.
   */
  canDo(pluginName: string, feature: Feature): boolean {
    const caps = this.getCapabilities(pluginName);
    return this.mapFeature(caps, feature);
  }

  /**
   * Get a full capability report for a plugin.
   */
  report(pluginName: string): PluginCapabilityReport {
    const plugin = this.registry.get(pluginName);
    const caps = this.getCapabilities(pluginName);

    const features: Record<Feature, FeatureStatus> = {
      transactions: this.featureStatus(caps.supportsTransactions, 'ACID transactions', 'best-effort writes'),
      fullTextSearch: this.featureStatus(caps.supportsFullTextSearch, 'native full-text search', 'in-memory regex filter'),
      vectorSearch: this.featureStatus(caps.supportsVectorSearch, 'native vector similarity', 'brute-force cosine scan'),
      nestedDocuments: this.featureStatus(caps.supportsNestedDocuments, 'nested document storage', 'JSON serialization'),
      ttl: this.featureStatus(caps.supportsTTL, 'automatic TTL expiry', 'manual cleanup'),
      indexes: this.featureStatus(caps.supportsIndexes, 'native index creation', 'full collection scan'),
      uniqueConstraints: this.featureStatus(caps.supportsUniqueConstraints, 'unique constraint enforcement', 'pre-insert check'),
    };

    return {
      pluginName,
      pluginType: plugin.type,
      features,
    };
  }

  /**
   * Get capability reports for ALL registered plugins.
   */
  reportAll(): PluginCapabilityReport[] {
    const reports: PluginCapabilityReport[] = [];
    const plugins = this.registry.getAll();

    for (const plugin of plugins) {
      reports.push(this.report(plugin.name));
    }

    return reports;
  }

  /**
   * Find the best plugin for a given feature.
   * Returns the plugin name that natively supports the feature,
   * or null if no plugin supports it.
   */
  bestPluginFor(feature: Feature): string | null {
    const plugins = this.registry.getAll();

    for (const plugin of plugins) {
      if (this.canDo(plugin.name, feature)) {
        return plugin.name;
      }
    }

    return null;
  }

  /**
   * Get a compatibility matrix showing all plugins vs all features.
   */
  matrix(): Record<string, Record<Feature, 'native' | 'emulated' | 'unsupported'>> {
    const result: Record<string, Record<Feature, 'native' | 'emulated' | 'unsupported'>> = {};
    const plugins = this.registry.getAll();

    for (const plugin of plugins) {
      const report = this.report(plugin.name);
      const row: Record<Feature, 'native' | 'emulated' | 'unsupported'> = {} as Record<Feature, 'native' | 'emulated' | 'unsupported'>;

      for (const [feature, status] of Object.entries(report.features)) {
        row[feature as Feature] = status.fallback;
      }

      result[plugin.name] = row;
    }

    return result;
  }

  /**
   * Invalidate cached capabilities (e.g., after a plugin is added/removed).
   */
  invalidateCache(): void {
    this.capabilityCache.clear();
  }

  // ─── Private Helpers ─────────────────────────────────────

  private getCapabilities(pluginName: string): PluginCapabilities {
    let caps = this.capabilityCache.get(pluginName);
    if (!caps) {
      const plugin = this.registry.get(pluginName);
      caps = plugin.capabilities();
      this.capabilityCache.set(pluginName, caps);
    }
    return caps;
  }

  private mapFeature(caps: PluginCapabilities, feature: Feature): boolean {
    switch (feature) {
      case 'transactions':       return caps.supportsTransactions;
      case 'fullTextSearch':     return caps.supportsFullTextSearch;
      case 'vectorSearch':       return caps.supportsVectorSearch;
      case 'nestedDocuments':    return caps.supportsNestedDocuments;
      case 'ttl':                return caps.supportsTTL;
      case 'indexes':            return caps.supportsIndexes;
      case 'uniqueConstraints':  return caps.supportsUniqueConstraints;
      default:                   return false;
    }
  }

  private featureStatus(
    supported: boolean,
    nativeDesc: string,
    fallbackDesc: string,
  ): FeatureStatus {
    if (supported) {
      return {
        supported: true,
        fallback: 'native',
        description: nativeDesc,
      };
    }

    return {
      supported: false,
      fallback: 'emulated',
      description: `Fallback: ${fallbackDesc}`,
    };
  }
}
