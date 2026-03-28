import { randomUUID } from 'node:crypto';
import type { Logger } from '../types.js';

export interface ILockManager {
  acquire(key: string, ttlMs: number): Promise<string | null>;
  release(key: string, lockValue: string): Promise<boolean>;
}

/**
 * LockManager implements distributed locking (Redlock-lite)
 * to prevent concurrent mutations on exact identical resources.
 * 
 * If no Redis backend configuration is provided, it safely falls
 * back to maintaining locks in-memory (useful for single-node tests).
 */
export class LockManager implements ILockManager {
  private inMemoryLocks = new Map<string, { val: string; expires: number }>();

  // Optional: Redis client instance passed dynamically from the Redis plugin
  private redisClient: any | null = null;
  private logger: Logger;

  constructor(logger: Logger, redisClient?: any) {
    this.logger = logger;
    this.redisClient = redisClient ?? null;
  }

  /**
   * Acquire a lock for an operation.
   * Returns a unique lock token string if successful, or null if the resource is locked.
   */
  async acquire(key: string, ttlMs: number = 5000): Promise<string | null> {
    const lockVal = randomUUID();
    const lockKey = `synapse:lock:${key}`;

    if (this.redisClient) {
      // SET key val NX PX ttlMs (Set if Not eXists, Set TTL)
      const res = await this.redisClient.set(lockKey, lockVal, 'NX', 'PX', ttlMs);
      if (res === 'OK') {
        this.logger.debug(`Acquired distributed lock: ${key}`);
        return lockVal;
      }
      this.logger.warn(`Failed to acquire distributed lock: ${key} (currently locked)`);
      return null;
    }

    // In-memory fallback
    this.cleanInMemory();
    if (this.inMemoryLocks.has(lockKey)) {
       this.logger.warn(`[Local] Failed to acquire lock: ${key}`);
       return null;
    }
    
    this.inMemoryLocks.set(lockKey, { val: lockVal, expires: Date.now() + ttlMs });
    return lockVal;
  }

  /**
   * Release a previously acquired lock, provided the token value matches.
   */
  async release(key: string, lockValue: string): Promise<boolean> {
    const lockKey = `synapse:lock:${key}`;

    if (this.redisClient) {
      // Lua script to safely delete ONLY if the value matches (prevent deleting someone else's lock if TTL expired)
      const lua = `
        if redis.call("get",KEYS[1]) == ARGV[1]
        then
            return redis.call("del",KEYS[1])
        else
            return 0
        end
      `;
      const res = await this.redisClient.eval(lua, 1, lockKey, lockValue);
      return res === 1;
    }

    // In-memory fallback
    const l = this.inMemoryLocks.get(lockKey);
    if (l && l.val === lockValue) {
      this.inMemoryLocks.delete(lockKey);
      return true;
    }
    return false;
  }

  private cleanInMemory() {
    const now = Date.now();
    for (const [key, lock] of this.inMemoryLocks.entries()) {
      if (lock.expires < now) this.inMemoryLocks.delete(key);
    }
  }
}
