// ──────────────────────────────────────────────────────────────
// SynapseDB — Analytics Sinks (Pluggable Destinations)
// Export CDC analytics to files, consoles, or external systems.
// ──────────────────────────────────────────────────────────────

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ChangeEvent, Logger } from '../types.js';
import type { IAnalyticsSink } from './cdc-analytics-bridge.js';

/**
 * ConsoleSink — Logs analytics events to the terminal.
 * Useful for development and debugging.
 */
export class ConsoleSink implements IAnalyticsSink {
  readonly name = 'console';
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async write(event: ChangeEvent): Promise<void> {
    this.logger.info(
      `📊 [Analytics] ${event.operation} on ${event.collection} (pk: ${event.primaryKey})`,
    );
  }

  async flush(): Promise<void> {}
  async close(): Promise<void> {}
}

/**
 * FileSink — Appends NDJSON to a local file.
 * Portable analytics export — can be loaded into DuckDB, Pandas, etc.
 *
 * @example
 * ```bash
 * # Query the exported data with DuckDB CLI:
 * duckdb -c "SELECT * FROM read_json_auto('analytics.ndjson')"
 * ```
 */
export class FileSink implements IAnalyticsSink {
  readonly name = 'file';
  private filePath: string;
  private buffer: string[] = [];
  private flushSize: number;

  constructor(filePath: string, flushSize = 100) {
    this.filePath = filePath;
    this.flushSize = flushSize;
  }

  async write(event: ChangeEvent): Promise<void> {
    const record = {
      timestamp: event.timestamp,
      collection: event.collection,
      operation: event.operation,
      primaryKey: event.primaryKey,
      document: event.document,
      source: event.sourcePlugin,
    };
    this.buffer.push(JSON.stringify(record));

    if (this.buffer.length >= this.flushSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const data = this.buffer.join('\n') + '\n';
    this.buffer = [];

    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, data, 'utf-8');
  }

  async close(): Promise<void> {
    await this.flush();
  }
}

/**
 * MemorySink — Collects events in-memory for testing.
 */
export class MemorySink implements IAnalyticsSink {
  readonly name = 'memory';
  events: ChangeEvent[] = [];

  async write(event: ChangeEvent): Promise<void> {
    this.events.push(event);
  }

  async flush(): Promise<void> {}
  async close(): Promise<void> {}
}
