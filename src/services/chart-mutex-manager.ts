/**
 * Chart Mutex Manager
 *
 * Prevents race conditions from concurrent chart initializations.
 * Uses mutex locks to ensure sequential execution per symbol-timeframe.
 *
 * ZERO RISK: If mutex fails, code runs normally without lock.
 */

import { BULLETPROOF_CONFIG } from '@/config/chart-bulletproofing';

interface MutexLock {
  acquired: number;
  released: boolean;
  symbol: string;
  timeframe: string;
}

class ChartMutexManager {
  private locks = new Map<string, Promise<void>>();
  private activeLocks = new Map<string, MutexLock>();

  async withLock<T>(
    symbol: string,
    timeframe: string,
    fn: () => Promise<T>
  ): Promise<T> {
    if (!BULLETPROOF_CONFIG.enableMutexLocks) {
      return fn();
    }

    const key = `${symbol}:${timeframe}`;

    // Wait for any existing lock
    if (this.locks.has(key)) {
      console.log(`[ChartMutex] ⏳ Waiting for lock on ${key}`);
      try {
        await this.locks.get(key);
      } catch (error) {
        console.warn(`[ChartMutex] ⚠️ Previous lock failed, proceeding anyway:`, error);
      }
    }

    // Create new lock
    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    this.locks.set(key, lockPromise);
    this.activeLocks.set(key, {
      acquired: Date.now(),
      released: false,
      symbol,
      timeframe,
    });

    console.log(`[ChartMutex] 🔒 Acquired lock on ${key}`);

    // Auto-release after timeout to prevent deadlocks
    const timeoutHandle = setTimeout(() => {
      if (!this.activeLocks.get(key)?.released) {
        console.warn(`[ChartMutex] ⚠️ Auto-releasing lock on ${key} after timeout`);
        this.releaseLock(key);
      }
    }, BULLETPROOF_CONFIG.mutexTimeoutMs);

    try {
      const result = await fn();
      this.releaseLock(key);
      clearTimeout(timeoutHandle);
      return result;
    } catch (error) {
      this.releaseLock(key);
      clearTimeout(timeoutHandle);
      throw error;
    }
  }

  private releaseLock(key: string): void {
    const lock = this.activeLocks.get(key);
    if (lock && !lock.released) {
      lock.released = true;
      const duration = Date.now() - lock.acquired;
      console.log(`[ChartMutex] 🔓 Released lock on ${key} (held for ${duration}ms)`);
    }

    this.locks.delete(key);
    this.activeLocks.delete(key);
  }

  isLocked(symbol: string, timeframe: string): boolean {
    const key = `${symbol}:${timeframe}`;
    return this.locks.has(key);
  }

  getActiveLocks(): MutexLock[] {
    return Array.from(this.activeLocks.values());
  }

  forceReleaseAll(): void {
    console.warn('[ChartMutex] ⚠️ Force releasing all locks');
    this.locks.clear();
    this.activeLocks.clear();
  }
}

export const chartMutexManager = new ChartMutexManager();
