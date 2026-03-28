// ──────────────────────────────────────────────────────────────
// SynapseDB — AI Workload Analyzer
// Monitors query patterns and auto-optimizes routing decisions.
// ──────────────────────────────────────────────────────────────

import type { Logger } from '../types.js';

/**
 * Tracks access patterns for a single field.
 */
interface FieldAccessPattern {
  field: string;
  collection: string;
  reads: number;
  writes: number;
  searches: number;
  avgLatencyMs: number;
  lastAccessed: number;
  hotWindow: number[];       // Reads in the last N intervals
  coldSince: number | null;  // When field became "cold" (null = still hot)
}

/**
 * A recommendation from the AI analyzer.
 */
export interface RoutingRecommendation {
  id: string;
  type: 'PROMOTE_TO_CACHE' | 'DEMOTE_FROM_CACHE' | 'ADD_INDEX' | 'ARCHIVE_COLD' | 'SPLIT_STORE' | 'ENABLE_WRITE_BUFFER';
  collection: string;
  field: string;
  reason: string;
  confidence: number;        // 0.0 - 1.0
  currentStore: string;
  suggestedStore: string;
  impact: string;
  timestamp: number;
  applied: boolean;
}

/**
 * Configuration for the workload analyzer.
 */
export interface AnalyzerConfig {
  enabled: boolean;
  /** How often to analyze patterns (ms). Default: 60s */
  analyzeIntervalMs: number;
  /** Reads/min threshold to suggest cache promotion */
  cachePromotionThreshold: number;
  /** Minutes without access to suggest archival */
  coldArchivalMinutes: number;
  /** Minimum confidence to auto-apply recommendations */
  autoApplyThreshold: number;
  /** Rolling window size for hot/cold detection */
  windowSize: number;
}

const DEFAULT_CONFIG: AnalyzerConfig = {
  enabled: true,
  analyzeIntervalMs: 60_000,
  cachePromotionThreshold: 100,
  coldArchivalMinutes: 1440 * 30, // 30 days
  autoApplyThreshold: 0.95,
  windowSize: 60,
};

/**
 * WorkloadAnalyzer — AI-Driven Routing Intelligence
 *
 * Monitors every query that flows through the engine,
 * builds a real-time access heatmap, and generates
 * routing recommendations:
 *
 * - **Hot field detection**: Fields read > N times/min
 *   get recommended for Redis cache promotion.
 * - **Cold field detection**: Fields untouched for M days
 *   get recommended for S3/archive demotion.
 * - **Index suggestions**: Fields frequently used in filters
 *   get recommended for B-tree indexing.
 * - **Store splitting**: Fields with conflicting access patterns
 *   get recommended for separate store placement.
 */
export class WorkloadAnalyzer {
  private config: AnalyzerConfig;
  private logger: Logger;

  private patterns: Map<string, FieldAccessPattern> = new Map();
  private recommendations: RoutingRecommendation[] = [];
  private analysisTimer: ReturnType<typeof setInterval> | null = null;
  private intervalCounter = 0;
  private onRecommendation?: (rec: RoutingRecommendation) => void;

  constructor(
    config: Partial<AnalyzerConfig> = {}, 
    logger: Logger,
    onRecommendation?: (rec: RoutingRecommendation) => void
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = logger;
    this.onRecommendation = onRecommendation;
  }

  // ─── Telemetry Ingestion ────────────────────────────────

  /**
   * Record a field access event.
   */
  recordAccess(
    collection: string,
    field: string,
    type: 'read' | 'write' | 'search',
    latencyMs: number,
    store: string,
  ): void {
    const key = `${collection}.${field}`;
    let pattern = this.patterns.get(key);

    if (!pattern) {
      pattern = {
        field,
        collection,
        reads: 0,
        writes: 0,
        searches: 0,
        avgLatencyMs: 0,
        lastAccessed: Date.now(),
        hotWindow: [],
        coldSince: null,
      };
      this.patterns.set(key, pattern);
    }

    // Update counters
    if (type === 'read') pattern.reads++;
    else if (type === 'write') pattern.writes++;
    else if (type === 'search') pattern.searches++;

    // Running average latency
    const total = pattern.reads + pattern.writes + pattern.searches;
    pattern.avgLatencyMs =
      (pattern.avgLatencyMs * (total - 1) + latencyMs) / total;

    pattern.lastAccessed = Date.now();
    pattern.coldSince = null;

    // Update hot window
    pattern.hotWindow.push(type === 'read' ? 1 : 0);
    if (pattern.hotWindow.length > this.config.windowSize) {
      pattern.hotWindow.shift();
    }
  }

  // ─── Analysis Engine ────────────────────────────────────

  /**
   * Start periodic analysis.
   */
  start(): void {
    if (!this.config.enabled) return;

    this.analysisTimer = setInterval(() => {
      this.analyze();
    }, this.config.analyzeIntervalMs);

    this.logger.info('WorkloadAnalyzer started — monitoring query patterns');
  }

  /**
   * Stop the analyzer.
   */
  stop(): void {
    if (this.analysisTimer) {
      clearInterval(this.analysisTimer);
      this.analysisTimer = null;
    }
  }

  /**
   * Run a full analysis pass — generates recommendations.
   */
  analyze(): RoutingRecommendation[] {
    const newRecommendations: RoutingRecommendation[] = [];
    const now = Date.now();
    this.intervalCounter++;

    for (const [key, pattern] of this.patterns) {
      // ─── Hot Field Detection (→ Cache Promotion) ────────
      const readsPerInterval = pattern.hotWindow.reduce((a, b) => a + b, 0);
      const readRatio = pattern.reads / Math.max(1, pattern.reads + pattern.writes);

      if (
        readsPerInterval >= this.config.cachePromotionThreshold &&
        readRatio > 0.8
      ) {
        const confidence = Math.min(1.0, readsPerInterval / (this.config.cachePromotionThreshold * 2));

        newRecommendations.push({
          id: `rec-${key}-cache-${this.intervalCounter}`,
          type: 'PROMOTE_TO_CACHE',
          collection: pattern.collection,
          field: pattern.field,
          reason: `Field "${pattern.field}" has ${readsPerInterval} reads/interval with ${(readRatio * 100).toFixed(0)}% read ratio — ideal for caching`,
          confidence,
          currentStore: 'sql',
          suggestedStore: 'cache',
          impact: `Estimated ${Math.round(pattern.avgLatencyMs * 0.8)}ms latency reduction per read`,
          timestamp: now,
          applied: false,
        });
      }

      // ─── Cold Field Detection (→ Archive) ───────────────
      const minutesSinceAccess = (now - pattern.lastAccessed) / 60_000;

      if (minutesSinceAccess >= this.config.coldArchivalMinutes) {
        if (!pattern.coldSince) {
          pattern.coldSince = now;
        }

        const coldDuration = (now - pattern.coldSince) / 60_000;
        const confidence = Math.min(1.0, coldDuration / this.config.coldArchivalMinutes);

        newRecommendations.push({
          id: `rec-${key}-archive-${this.intervalCounter}`,
          type: 'ARCHIVE_COLD',
          collection: pattern.collection,
          field: pattern.field,
          reason: `Field "${pattern.field}" untouched for ${Math.round(minutesSinceAccess)} minutes — candidate for cold storage`,
          confidence,
          currentStore: 'sql',
          suggestedStore: 'archive',
          impact: 'Reduced storage costs, freed memory',
          timestamp: now,
          applied: false,
        });
      }

      // ─── Write-Heavy Detection (→ Index Suggestion / Write Buffer) ─────
      const writeRatio = pattern.writes / Math.max(1, pattern.reads + pattern.writes);
      const writesPerInterval = pattern.hotWindow.reduce((a, b) => a + (b === 0 ? 1 : 0), 0); // Assuming 0 implies write (based on recordAccess hotWindow logic)

      // Auto-tuning rule: Write Storm Protection
      if (writesPerInterval > 200 && writeRatio > 0.8) {
        newRecommendations.push({
          id: `rec-${key}-buffer-${this.intervalCounter}`,
          type: 'ENABLE_WRITE_BUFFER',
          collection: pattern.collection,
          field: pattern.field,
          reason: `Field "${pattern.field}" is experiencing a massive write storm (${writesPerInterval} writes/interval, ${(writeRatio * 100).toFixed(0)}% write ratio) — enabling in-memory WriteBuffer`,
          confidence: Math.min(1.0, writesPerInterval / 500),
          currentStore: 'sql',
          suggestedStore: 'memory+sql',
          impact: `Shielding primary database from ${writesPerInterval} connections, reducing to 1 bulk insert`,
          timestamp: now,
          applied: false,
        });
      } else if (pattern.searches > 50 && writeRatio < 0.3) {
        newRecommendations.push({
          id: `rec-${key}-index-${this.intervalCounter}`,
          type: 'ADD_INDEX',
          collection: pattern.collection,
          field: pattern.field,
          reason: `Field "${pattern.field}" has ${pattern.searches} searches with low write ratio (${(writeRatio * 100).toFixed(0)}%) — index would accelerate lookups`,
          confidence: Math.min(1.0, pattern.searches / 200),
          currentStore: 'sql',
          suggestedStore: 'sql',
          impact: `Estimated ${Math.round(pattern.avgLatencyMs * 0.6)}ms latency reduction per search`,
          timestamp: now,
          applied: false,
        });
      }

      // ─── Split Detection (→ Conflicting Patterns) ──────
      if (
        pattern.reads > 500 &&
        pattern.writes > 500 &&
        Math.abs(readRatio - 0.5) < 0.1
      ) {
        newRecommendations.push({
          id: `rec-${key}-split-${this.intervalCounter}`,
          type: 'SPLIT_STORE',
          collection: pattern.collection,
          field: pattern.field,
          reason: `Field "${pattern.field}" has balanced read/write (${pattern.reads}R/${pattern.writes}W) — splitting to read-replica + write-primary would improve throughput`,
          confidence: 0.7,
          currentStore: 'sql',
          suggestedStore: 'sql+cache',
          impact: 'Improved read throughput without write contention',
          timestamp: now,
          applied: false,
        });
      }
    }

    // Store new recommendations
    this.recommendations.push(...newRecommendations);

    // Trim old recommendations (keep last 1000)
    if (this.recommendations.length > 1000) {
      this.recommendations = this.recommendations.slice(-1000);
    }

    if (newRecommendations.length > 0) {
      this.logger.info(
        `WorkloadAnalyzer: ${newRecommendations.length} new recommendation(s) generated`,
      );
      
      if (this.onRecommendation) {
        for (const rec of newRecommendations) {
          this.onRecommendation(rec);
          rec.applied = true; // Mark as applied if we have a listener
        }
      }
    }

    return newRecommendations;
  }

  // ─── Introspection ──────────────────────────────────────

  /**
   * Get all pending recommendations.
   */
  getRecommendations(collection?: string): RoutingRecommendation[] {
    if (collection) {
      return this.recommendations.filter((r) => r.collection === collection);
    }
    return [...this.recommendations];
  }

  /**
   * Get the access heatmap — shows which fields are hot/cold.
   */
  heatmap(): Record<string, {
    reads: number;
    writes: number;
    searches: number;
    avgLatencyMs: number;
    temperature: 'hot' | 'warm' | 'cold' | 'frozen';
  }> {
    const result: Record<string, any> = {};
    const now = Date.now();

    for (const [key, pattern] of this.patterns) {
      const minutesSinceAccess = (now - pattern.lastAccessed) / 60_000;
      const readsPerInterval = pattern.hotWindow.reduce((a, b) => a + b, 0);

      let temperature: 'hot' | 'warm' | 'cold' | 'frozen';
      if (readsPerInterval >= this.config.cachePromotionThreshold) {
        temperature = 'hot';
      } else if (minutesSinceAccess < 5) {
        temperature = 'warm';
      } else if (minutesSinceAccess < this.config.coldArchivalMinutes) {
        temperature = 'cold';
      } else {
        temperature = 'frozen';
      }

      result[key] = {
        reads: pattern.reads,
        writes: pattern.writes,
        searches: pattern.searches,
        avgLatencyMs: Math.round(pattern.avgLatencyMs * 100) / 100,
        temperature,
      };
    }

    return result;
  }

  /**
   * Reset all tracking data.
   */
  reset(): void {
    this.patterns.clear();
    this.recommendations = [];
    this.intervalCounter = 0;
  }
}
