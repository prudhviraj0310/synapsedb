import type { ApiResponse } from '../types.js';

/**
 * IdempotencyStore tracks executed operation IDs to prevent
 * duplicate writes (e.g., from network retries or client errors).
 * 
 * In a true distributed deployment, this would be backed by Redis
 * with TTLs, but this in-memory map serves as the fallback/prototype.
 */
export class IdempotencyStore {
  private cache = new Map<string, { result: ApiResponse<any>; expiresAt: number }>();
  
  constructor(private readonly defaultTtlMs: number = 24 * 60 * 60 * 1000) {}

  public has(operationId: string): boolean {
    this.clean();
    return this.cache.has(operationId);
  }

  public get(operationId: string): ApiResponse<any> | undefined {
    this.clean();
    return this.cache.get(operationId)?.result;
  }

  public set(operationId: string, result: ApiResponse<any>): void {
    this.cache.set(operationId, {
      result,
      expiresAt: Date.now() + this.defaultTtlMs
    });
  }

  private clean() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (value.expiresAt < now) {
        this.cache.delete(key);
      }
    }
  }
}
