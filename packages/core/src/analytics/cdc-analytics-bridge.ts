// ──────────────────────────────────────────────────────────────
// SynapseDB — CDC → Analytics Bridge (Zero-ETL)
// Wires the EventBus CDC stream directly into the AnalyticsEngine.
// No Kafka. No Debezium. No Airbyte. Just instant analytics.
// ──────────────────────────────────────────────────────────────

import type { ChangeEvent, Logger, Document } from '../types.js';
import type { EventBus } from '../sync/event-bus.js';
import type { AnalyticsEngine } from './engine.js';

/**
 * Analytics sink interface — pluggable destinations for CDC events.
 */
export interface IAnalyticsSink {
  readonly name: string;
  /** Called for every CDC event after analytics ingestion */
  write(event: ChangeEvent): Promise<void>;
  /** Flush any buffered data */
  flush(): Promise<void>;
  /** Shutdown the sink */
  close(): Promise<void>;
}

/**
 * CDCAnalyticsBridge — The "Zero-ETL" Engine
 *
 * Traditional analytics pipeline:
 *   Postgres → Debezium → Kafka → Spark → Snowflake → Dashboard
 *   Cost: $50K+/year | Latency: minutes to hours | Complexity: 5+ systems
 *
 * SynapseDB Zero-ETL:
 *   Engine → CDC EventBus → AnalyticsEngine → Dashboard
 *   Cost: $0 | Latency: <1ms | Complexity: 0 systems
 *
 * Every INSERT, UPDATE, and DELETE that flows through SynapseDB
 * is silently captured and streamed into the columnar analytics
 * engine in real-time. No pipelines. No delays. No infrastructure.
 */
export class CDCAnalyticsBridge {
  private logger: Logger;
  private analyticsEngine: AnalyticsEngine;
  private sinks: IAnalyticsSink[] = [];
  private unsubscribe: (() => void) | null = null;

  // Telemetry
  private stats = {
    eventsIngested: 0,
    insertsProcessed: 0,
    updatesProcessed: 0,
    deletesProcessed: 0,
    sinkErrors: 0,
    startedAt: Date.now(),
  };

  constructor(analyticsEngine: AnalyticsEngine, logger: Logger) {
    this.analyticsEngine = analyticsEngine;
    this.logger = logger;
  }

  /**
   * Connect the bridge to the CDC EventBus.
   * From this moment, every write is instantly available for analytics.
   */
  attach(eventBus: EventBus): void {
    this.unsubscribe = eventBus.onAll(async (event) => {
      await this.processEvent(event);
    });

    this.logger.info(
      '🔗 Zero-ETL Bridge ACTIVE — all writes now stream to analytics in real-time',
    );
  }

  /**
   * Add an external sink (ClickHouse, DuckDB file, console, etc.)
   */
  addSink(sink: IAnalyticsSink): void {
    this.sinks.push(sink);
    this.logger.info(`Analytics sink added: ${sink.name}`);
  }

  /**
   * Process a single CDC event.
   */
  private async processEvent(event: ChangeEvent): Promise<void> {
    try {
      switch (event.operation) {
        case 'INSERT':
          if (event.document) {
            this.analyticsEngine.ingest(event.collection, event.document);
            this.stats.insertsProcessed++;
          }
          break;

        case 'UPDATE':
          if (event.document) {
            // Upsert: ingest will update existing row by PK
            this.analyticsEngine.ingest(event.collection, event.document);
            this.stats.updatesProcessed++;
          }
          break;

        case 'DELETE':
          this.analyticsEngine.remove(event.collection, event.primaryKey);
          this.stats.deletesProcessed++;
          break;
      }

      this.stats.eventsIngested++;

      // Fan out to external sinks (fire-and-forget)
      for (const sink of this.sinks) {
        sink.write(event).catch((err) => {
          this.stats.sinkErrors++;
          this.logger.error(`Sink "${sink.name}" failed: ${err.message}`);
        });
      }
    } catch (err: any) {
      this.logger.error(`CDC Analytics Bridge error: ${err.message}`);
    }
  }

  /**
   * Get bridge telemetry.
   */
  getStats() {
    return {
      ...this.stats,
      uptimeMs: Date.now() - this.stats.startedAt,
      eventsPerSecond:
        this.stats.eventsIngested /
        Math.max(1, (Date.now() - this.stats.startedAt) / 1000),
      sinkCount: this.sinks.length,
      analyticsCollections: Object.keys(this.analyticsEngine.stats()),
    };
  }

  /**
   * Flush all sinks.
   */
  async flush(): Promise<void> {
    await Promise.allSettled(this.sinks.map((s) => s.flush()));
  }

  /**
   * Detach from the EventBus and close all sinks.
   */
  async shutdown(): Promise<void> {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    await Promise.allSettled(this.sinks.map((s) => s.close()));
    this.logger.info('Zero-ETL Bridge shut down');
  }
}
