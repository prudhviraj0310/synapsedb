// ──────────────────────────────────────────────────────────────
// SynapseDB — DuckDB Analytics Engine (Embedded HTAP)
// In-memory columnar analytics using SynapseDB's CDC stream.
// ──────────────────────────────────────────────────────────────

import type { Logger, Document } from '../types.js';

/**
 * Result of an analytics query.
 */
export interface AnalyticsResult {
  /** Column names */
  columns: string[];
  /** Result rows */
  rows: unknown[][];
  /** Number of rows scanned */
  rowsScanned: number;
  /** Query execution time (ms) */
  took: number;
  /** Data source (which collections and how many rows were used) */
  sources: Record<string, number>;
}

/**
 * An aggregation operation.
 */
export interface AggregateOp {
  type: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX' | 'GROUP';
  field?: string;
  alias?: string;
}

/**
 * AnalyticsEngine — Embedded HTAP (Hybrid Transactional + Analytical)
 *
 * Provides columnar analytics on live transactional data without
 * the need for a separate data warehouse (Snowflake, BigQuery, etc.).
 *
 * How it works:
 * 1. The SynapseDB CDC engine silently streams change events to this module.
 * 2. Data is stored in a **column-oriented in-memory store**.
 * 3. Analytical queries (SUM, AVG, GROUP BY, etc.) execute directly
 *    on the columnar data — orders of magnitude faster than row stores.
 *
 * In production, this would be backed by DuckDB (WASM or native).
 * This implementation is a zero-dependency columnar engine for dev/testing.
 */
export class AnalyticsEngine {
  private logger: Logger;

  /** Column store: collection → field → values[] */
  private columns: Map<string, Map<string, unknown[]>> = new Map();
  /** Row count per collection */
  private rowCounts: Map<string, number> = new Map();
  /** Primary key for fast lookups */
  private pkIndex: Map<string, Map<string, number>> = new Map(); // collection → pk_value → row_index

  constructor(logger: Logger) {
    this.logger = logger;
  }

  // ─── Data Ingestion (from CDC) ──────────────────────────

  /**
   * Ingest a document into the columnar store.
   * Called by the CDC engine on every write operation.
   */
  ingest(collection: string, document: Document, pk = 'id'): void {
    let colStore = this.columns.get(collection);
    if (!colStore) {
      colStore = new Map();
      this.columns.set(collection, colStore);
      this.pkIndex.set(collection, new Map());
    }

    const rowCount = this.rowCounts.get(collection) ?? 0;
    const pkValue = String(document[pk] ?? '');
    const index = this.pkIndex.get(collection)!;

    // Check if this is an update to an existing row
    const existingRow = index.get(pkValue);

    for (const [field, value] of Object.entries(document)) {
      let column = colStore.get(field);
      if (!column) {
        // Initialize column with nulls for existing rows
        column = new Array(rowCount).fill(null);
        colStore.set(field, column);
      }

      if (existingRow !== undefined) {
        // Update existing row
        column[existingRow] = value;
      } else {
        // Append new row
        column.push(value);
      }
    }

    if (existingRow === undefined) {
      // New row — fill any columns that weren't in this doc with null
      for (const [, column] of colStore) {
        if (column.length <= rowCount) {
          column.push(null);
        }
      }
      index.set(pkValue, rowCount);
      this.rowCounts.set(collection, rowCount + 1);
    }
  }

  /**
   * Remove a document from the columnar store.
   */
  remove(collection: string, documentId: string): void {
    const index = this.pkIndex.get(collection);
    if (!index) return;

    const rowIdx = index.get(documentId);
    if (rowIdx === undefined) return;

    const colStore = this.columns.get(collection);
    if (colStore) {
      // Mark row as deleted (set to null) — we don't compact to keep indices stable
      for (const [, column] of colStore) {
        column[rowIdx] = null;
      }
    }

    index.delete(documentId);
  }

  // ─── Analytics Queries ──────────────────────────────────

  /**
   * Run an aggregation query.
   *
   * @example
   * ```typescript
   * // Total revenue
   * analytics.aggregate('orders', [{ type: 'SUM', field: 'amount', alias: 'total' }]);
   *
   * // Average price by category
   * analytics.aggregate('products',
   *   [{ type: 'GROUP', field: 'category' }, { type: 'AVG', field: 'price', alias: 'avg_price' }]
   * );
   * ```
   */
  aggregate(
    collection: string,
    ops: AggregateOp[],
    filter?: Record<string, unknown>,
  ): AnalyticsResult {
    const startTime = Date.now();
    const colStore = this.columns.get(collection);
    const rowCount = this.rowCounts.get(collection) ?? 0;

    if (!colStore || rowCount === 0) {
      return {
        columns: ops.map((o) => o.alias ?? o.field ?? o.type),
        rows: [],
        rowsScanned: 0,
        took: Date.now() - startTime,
        sources: { [collection]: 0 },
      };
    }

    // Determine which rows pass the filter
    const validRows = this.getFilteredRows(colStore, rowCount, filter);

    // Check for GROUP BY
    const groupOp = ops.find((o) => o.type === 'GROUP');
    const aggOps = ops.filter((o) => o.type !== 'GROUP');

    if (groupOp && groupOp.field) {
      return this.groupedAggregate(
        collection, colStore, validRows, groupOp.field, aggOps, startTime,
      );
    }

    // Simple aggregation (no GROUP BY)
    const resultRow: unknown[] = [];
    const resultColumns: string[] = [];

    for (const op of aggOps) {
      const alias = op.alias ?? `${op.type.toLowerCase()}_${op.field ?? 'all'}`;
      resultColumns.push(alias);

      const column = op.field ? colStore.get(op.field) : null;

      switch (op.type) {
        case 'COUNT':
          resultRow.push(validRows.length);
          break;
        case 'SUM':
          resultRow.push(this.sumColumn(column, validRows));
          break;
        case 'AVG':
          resultRow.push(this.avgColumn(column, validRows));
          break;
        case 'MIN':
          resultRow.push(this.minColumn(column, validRows));
          break;
        case 'MAX':
          resultRow.push(this.maxColumn(column, validRows));
          break;
      }
    }

    return {
      columns: resultColumns,
      rows: [resultRow],
      rowsScanned: validRows.length,
      took: Date.now() - startTime,
      sources: { [collection]: rowCount },
    };
  }

  /**
   * Get a raw scan of the columnar data.
   */
  scan(
    collection: string,
    fields?: string[],
    filter?: Record<string, unknown>,
    limit?: number,
  ): AnalyticsResult {
    const startTime = Date.now();
    const colStore = this.columns.get(collection);
    const rowCount = this.rowCounts.get(collection) ?? 0;

    if (!colStore || rowCount === 0) {
      return {
        columns: fields ?? [],
        rows: [],
        rowsScanned: 0,
        took: Date.now() - startTime,
        sources: { [collection]: 0 },
      };
    }

    const selectedFields = fields ?? [...colStore.keys()];
    const validRows = this.getFilteredRows(colStore, rowCount, filter);
    const limitRows = limit ? validRows.slice(0, limit) : validRows;

    const rows: unknown[][] = [];
    for (const rowIdx of limitRows) {
      const row: unknown[] = [];
      for (const field of selectedFields) {
        const column = colStore.get(field);
        row.push(column ? column[rowIdx] : null);
      }
      rows.push(row);
    }

    return {
      columns: selectedFields,
      rows,
      rowsScanned: validRows.length,
      took: Date.now() - startTime,
      sources: { [collection]: rowCount },
    };
  }

  // ─── Introspection ──────────────────────────────────────

  /**
   * Get statistics about the analytics store.
   */
  stats(): Record<string, { rows: number; columns: number; sizeEstimate: number }> {
    const result: Record<string, any> = {};

    for (const [collection, colStore] of this.columns) {
      const rowCount = this.rowCounts.get(collection) ?? 0;
      let sizeEstimate = 0;

      for (const [, column] of colStore) {
        // Rough estimate: 8 bytes per numeric, 50 bytes per string/complex
        sizeEstimate += column.length * 16;
      }

      result[collection] = {
        rows: rowCount,
        columns: colStore.size,
        sizeEstimate,
      };
    }

    return result;
  }

  /**
   * List available columns for a collection.
   */
  describeCols(collection: string): string[] {
    const colStore = this.columns.get(collection);
    return colStore ? [...colStore.keys()] : [];
  }

  /**
   * Clear all analytics data.
   */
  clear(): void {
    this.columns.clear();
    this.rowCounts.clear();
    this.pkIndex.clear();
  }

  // ─── Private Helpers ────────────────────────────────────

  private getFilteredRows(
    colStore: Map<string, unknown[]>,
    rowCount: number,
    filter?: Record<string, unknown>,
  ): number[] {
    const validRows: number[] = [];

    for (let i = 0; i < rowCount; i++) {
      // Check if row was deleted (all columns null at this index)
      const idCol = colStore.get('id');
      if (idCol && idCol[i] === null) continue;

      // Apply filter
      if (filter) {
        let matches = true;
        for (const [field, value] of Object.entries(filter)) {
          const column = colStore.get(field);
          if (!column || column[i] !== value) {
            matches = false;
            break;
          }
        }
        if (!matches) continue;
      }

      validRows.push(i);
    }

    return validRows;
  }

  private groupedAggregate(
    collection: string,
    colStore: Map<string, unknown[]>,
    validRows: number[],
    groupField: string,
    aggOps: AggregateOp[],
    startTime: number,
  ): AnalyticsResult {
    const groupColumn = colStore.get(groupField);
    if (!groupColumn) {
      return {
        columns: [groupField, ...aggOps.map((o) => o.alias ?? o.type)],
        rows: [],
        rowsScanned: validRows.length,
        took: Date.now() - startTime,
        sources: { [collection]: validRows.length },
      };
    }

    // Group rows by field value
    const groups = new Map<unknown, number[]>();

    for (const rowIdx of validRows) {
      const groupValue = groupColumn[rowIdx];
      let group = groups.get(groupValue);
      if (!group) {
        group = [];
        groups.set(groupValue, group);
      }
      group.push(rowIdx);
    }

    // Compute aggregations per group
    const resultColumns = [groupField, ...aggOps.map((o) => o.alias ?? `${o.type.toLowerCase()}_${o.field ?? 'all'}`)];
    const resultRows: unknown[][] = [];

    for (const [groupValue, groupRows] of groups) {
      const row: unknown[] = [groupValue];

      for (const op of aggOps) {
        const column = op.field ? colStore.get(op.field) : null;

        switch (op.type) {
          case 'COUNT':
            row.push(groupRows.length);
            break;
          case 'SUM':
            row.push(this.sumColumn(column, groupRows));
            break;
          case 'AVG':
            row.push(this.avgColumn(column, groupRows));
            break;
          case 'MIN':
            row.push(this.minColumn(column, groupRows));
            break;
          case 'MAX':
            row.push(this.maxColumn(column, groupRows));
            break;
        }
      }

      resultRows.push(row);
    }

    return {
      columns: resultColumns,
      rows: resultRows,
      rowsScanned: validRows.length,
      took: Date.now() - startTime,
      sources: { [collection]: validRows.length },
    };
  }

  private sumColumn(column: unknown[] | null | undefined, rows: number[]): number {
    if (!column) return 0;
    let sum = 0;
    for (const i of rows) {
      const v = column[i];
      if (typeof v === 'number') sum += v;
    }
    return Math.round(sum * 100) / 100;
  }

  private avgColumn(column: unknown[] | null | undefined, rows: number[]): number {
    if (!column || rows.length === 0) return 0;
    return Math.round((this.sumColumn(column, rows) / rows.length) * 100) / 100;
  }

  private minColumn(column: unknown[] | null | undefined, rows: number[]): unknown {
    if (!column || rows.length === 0) return null;
    let min: unknown = undefined;
    for (const i of rows) {
      const v = column[i];
      if (v !== null && v !== undefined) {
        if (min === undefined || (v as any) < (min as any)) min = v;
      }
    }
    return min;
  }

  private maxColumn(column: unknown[] | null | undefined, rows: number[]): unknown {
    if (!column || rows.length === 0) return null;
    let max: unknown = undefined;
    for (const i of rows) {
      const v = column[i];
      if (v !== null && v !== undefined) {
        if (max === undefined || (v as any) > (max as any)) max = v;
      }
    }
    return max;
  }
}
