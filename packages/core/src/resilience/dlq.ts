import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { Logger } from '../types.js';

export interface FailedOperation {
  id: string;
  storeName: string;
  collection: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  payload: unknown;
  timestamp: number;
  error: string;
}

/**
 * Persistent Dead Letter Queue backed by a local JSONL file.
 * Survives process restarts and allows manual or automated replay of dropped events.
 */
export class DeadLetterQueue {
  private queue: FailedOperation[] = [];
  private readonly logPath: string;

  constructor(private readonly logger: Logger, storagePath: string = './.synapse-data') {
    this.logPath = path.join(storagePath, 'dlq.jsonl');
    this.initStorage().catch(e => this.logger.error('Failed to init DLQ storage:', e));
  }

  private async initStorage() {
    try {
      await fs.mkdir(path.dirname(this.logPath), { recursive: true });
      const raw = await fs.readFile(this.logPath, 'utf-8');
      
      const lines = raw.split('\n').filter(Boolean);
      this.queue = lines.map(l => JSON.parse(l));
      
      if (this.queue.length > 0) {
         this.logger.warn(`[DLQ] Restored ${this.queue.length} pending failed operations from disk.`);
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        this.logger.error('Error reading DLQ log on startup', error);
      }
      // If file doesn't exist, start fresh
      this.queue = [];
    }
  }

  private async flush() {
    try {
      const payload = this.queue.map(op => JSON.stringify(op)).join('\n');
      const outPath = this.logPath;
      if (payload === '') {
          // If empty, clean file to save space instead of appending nothing
          await fs.writeFile(outPath, '', 'utf-8');
      } else {
          await fs.writeFile(outPath, payload + '\n', 'utf-8');
      }
    } catch (error) {
       this.logger.error('[DLQ] Failed to flush to disk!', error);
    }
  }

  async add(operation: FailedOperation) {
    this.queue.push(operation);
    this.logger.warn(
      `[DLQ] Added failed ${operation.operation} on '${operation.collection}' for backend '${operation.storeName}': ${operation.error}`
    );
    await this.flush();
  }

  getPending(): FailedOperation[] {
    return [...this.queue];
  }

  async remove(id: string) {
    this.queue = this.queue.filter(op => op.id !== id);
    await this.flush();
  }

  async clear() {
    this.queue = [];
    await this.flush();
  }

  /**
   * Replays all pending operations by feeding them back into the provided processor function.
   * If the processor returns true, the item is removed from the DLQ.
   */
  async replay(processor: (op: FailedOperation) => Promise<boolean>): Promise<{ success: number; failed: number }> {
    const pending = [...this.queue];
    let successCount = 0;
    let failedCount = 0;
    
    if (pending.length === 0) return { success: 0, failed: 0 };
    
    this.logger.info(`[DLQ] Starting automated replay of ${pending.length} dropped operations...`);

    for (const op of pending) {
      try {
         const resolved = await processor(op);
         if (resolved) {
            await this.remove(op.id);
            successCount++;
         } else {
            failedCount++;
         }
      } catch (err: any) {
         this.logger.error(`[DLQ] Replay step failed for operation ${op.id}`, err);
         failedCount++;
      }
    }
    
    this.logger.info(`[DLQ] Replay finished: ${successCount} successfully recovered, ${failedCount} persistently failed.`);
    return { success: successCount, failed: failedCount };
  }
}
