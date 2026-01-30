/**
 * TRADE PROCESSING LOCK SERVICE
 *
 * SSOT AUTHORITY: This is the SINGLE SOURCE OF TRUTH for determining
 * whether a trade is currently being processed.
 *
 * RESPONSIBILITY:
 * - Coordinate access to trade closure logic across multiple monitoring systems
 * - Prevent duplicate trade closures via database-backed locking
 * - Provide audit trail for all lock operations
 *
 * AUTHORITY BOUNDARY:
 * All monitoring systems (TradeLifecycleManager, PositionMonitorService,
 * RealtimeSLTPMonitor) MUST check this service before processing a trade.
 *
 * CCIP: CCIP-20260130-002 - Fix Duplicate Trade Closure Bug
 */

import { supabase } from '../lib/supabase';

export type LockingSystem = 'TradeLifecycleManager' | 'PositionMonitorService' | 'RealtimeSLTPMonitor';

export interface TradeLock {
  trade_id: string;
  locked_by: LockingSystem;
  locked_at: Date;
  lock_expires_at: Date;
}

class TradeProcessingLockService {
  private static instance: TradeProcessingLockService;
  private cleanupIntervalId: number | null = null;
  private readonly LOCK_DURATION_SECONDS = 30;
  private readonly CLEANUP_INTERVAL_MS = 60000; // 60 seconds

  private constructor() {
    // Start automatic cleanup of expired locks
    this.startCleanupJob();
  }

  /**
   * Get singleton instance (ensures only one service exists)
   */
  static getInstance(): TradeProcessingLockService {
    if (!TradeProcessingLockService.instance) {
      TradeProcessingLockService.instance = new TradeProcessingLockService();
    }
    return TradeProcessingLockService.instance;
  }

  /**
   * Try to acquire exclusive processing lock for a trade
   *
   * @param tradeId - ID of the trade to lock
   * @param system - Name of the system attempting to acquire the lock
   * @returns true if lock acquired, false if already locked by another system
   */
  async acquireLock(tradeId: string, system: LockingSystem): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('try_acquire_trade_lock', {
        p_trade_id: tradeId,
        p_locked_by: system,
        p_lock_duration_seconds: this.LOCK_DURATION_SECONDS
      });

      if (error) {
        console.error('[TradeProcessingLock] Error acquiring lock:', error);
        return false;
      }

      if (data) {
        console.log(`[TradeProcessingLock] ✅ ${system} acquired lock for trade ${tradeId}`);
      } else {
        console.log(`[TradeProcessingLock] ❌ ${system} failed to acquire lock for trade ${tradeId} (already locked)`);
      }

      return data === true;
    } catch (error) {
      console.error('[TradeProcessingLock] Exception acquiring lock:', error);
      return false;
    }
  }

  /**
   * Release processing lock for a trade
   *
   * @param tradeId - ID of the trade to unlock
   */
  async releaseLock(tradeId: string): Promise<void> {
    try {
      const { error } = await supabase.rpc('release_trade_lock', {
        p_trade_id: tradeId
      });

      if (error) {
        console.error('[TradeProcessingLock] Error releasing lock:', error);
        return;
      }

      console.log(`[TradeProcessingLock] 🔓 Released lock for trade ${tradeId}`);
    } catch (error) {
      console.error('[TradeProcessingLock] Exception releasing lock:', error);
    }
  }

  /**
   * Check if trade is currently locked (read-only check)
   *
   * @param tradeId - ID of the trade to check
   * @returns true if locked, false if available
   */
  async isLocked(tradeId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('is_trade_locked', {
        p_trade_id: tradeId
      });

      if (error) {
        console.error('[TradeProcessingLock] Error checking lock status:', error);
        return false; // Fail open: if we can't check, assume not locked
      }

      return data === true;
    } catch (error) {
      console.error('[TradeProcessingLock] Exception checking lock status:', error);
      return false; // Fail open
    }
  }

  /**
   * Get all active locks (for monitoring/debugging)
   */
  async getActiveLocks(): Promise<TradeLock[]> {
    try {
      const { data, error } = await supabase
        .from('trade_processing_locks')
        .select('*')
        .gt('lock_expires_at', new Date().toISOString());

      if (error) {
        console.error('[TradeProcessingLock] Error fetching active locks:', error);
        return [];
      }

      return (data || []).map(lock => ({
        trade_id: lock.trade_id,
        locked_by: lock.locked_by,
        locked_at: new Date(lock.locked_at),
        lock_expires_at: new Date(lock.lock_expires_at)
      }));
    } catch (error) {
      console.error('[TradeProcessingLock] Exception fetching active locks:', error);
      return [];
    }
  }

  /**
   * Manual cleanup of expired locks
   * This is also run automatically every 60 seconds
   */
  async cleanupExpiredLocks(): Promise<number> {
    try {
      const { data, error } = await supabase.rpc('cleanup_expired_trade_locks');

      if (error) {
        console.error('[TradeProcessingLock] Error cleaning up expired locks:', error);
        return 0;
      }

      if (data > 0) {
        console.log(`[TradeProcessingLock] 🧹 Cleaned up ${data} expired lock(s)`);
      }

      return data || 0;
    } catch (error) {
      console.error('[TradeProcessingLock] Exception cleaning up expired locks:', error);
      return 0;
    }
  }

  /**
   * Start automatic cleanup job
   * Runs every 60 seconds to clean up expired locks
   */
  private startCleanupJob(): void {
    if (this.cleanupIntervalId !== null) {
      return; // Already running
    }

    console.log('[TradeProcessingLock] 🚀 Starting automatic lock cleanup job');

    this.cleanupIntervalId = window.setInterval(async () => {
      await this.cleanupExpiredLocks();
    }, this.CLEANUP_INTERVAL_MS);
  }

  /**
   * Stop automatic cleanup job (for cleanup on service shutdown)
   */
  stopCleanupJob(): void {
    if (this.cleanupIntervalId !== null) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
      console.log('[TradeProcessingLock] ⏹️ Stopped automatic lock cleanup job');
    }
  }

  /**
   * Helper: Try to acquire lock, execute function, then release lock
   * This is the recommended pattern for using locks
   *
   * @param tradeId - ID of the trade to lock
   * @param system - Name of the system attempting to acquire the lock
   * @param fn - Async function to execute while holding the lock
   * @returns Result of fn, or null if lock could not be acquired
   */
  async withLock<T>(
    tradeId: string,
    system: LockingSystem,
    fn: () => Promise<T>
  ): Promise<T | null> {
    const acquired = await this.acquireLock(tradeId, system);

    if (!acquired) {
      return null; // Could not acquire lock
    }

    try {
      return await fn();
    } finally {
      await this.releaseLock(tradeId);
    }
  }
}

// Export singleton instance
export const tradeProcessingLockService = TradeProcessingLockService.getInstance();
