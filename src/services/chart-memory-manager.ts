/**
 * Chart Memory Manager
 *
 * Prevents memory leaks during long trading sessions.
 * Automatically cleans up old cached candles and monitors memory usage.
 *
 * ZERO RISK: Optional monitoring that doesn't affect core functionality.
 */

import { BULLETPROOF_CONFIG } from '@/config/chart-bulletproofing';

interface ManagedCache {
  id: string;
  getSize: () => number;
  clear: () => void;
  prune?: (limit: number) => number;
}

interface MemoryStats {
  totalCaches: number;
  totalItems: number;
  lastCleanup: number;
  cleanupCount: number;
}

class ChartMemoryManager {
  private caches = new Map<string, ManagedCache>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private stats: MemoryStats = {
    totalCaches: 0,
    totalItems: 0,
    lastCleanup: Date.now(),
    cleanupCount: 0,
  };

  start(): void {
    if (!BULLETPROOF_CONFIG.enableMemoryManager) {
      return;
    }

    if (this.cleanupInterval) {
      console.warn('[MemoryManager] Already running');
      return;
    }

    console.log('[MemoryManager] 🚀 Starting automatic cleanup');

    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, BULLETPROOF_CONFIG.memoryCleanupIntervalMs);

    // Initial cleanup
    this.cleanup();
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      console.log('[MemoryManager] 🛑 Stopped automatic cleanup');
    }
  }

  registerCache(cache: ManagedCache): void {
    if (this.caches.has(cache.id)) {
      console.warn(`[MemoryManager] Cache ${cache.id} already registered`);
      return;
    }

    this.caches.set(cache.id, cache);
    this.stats.totalCaches = this.caches.size;
    console.log(`[MemoryManager] ✅ Registered cache: ${cache.id}`);
  }

  unregisterCache(id: string): void {
    if (this.caches.delete(id)) {
      this.stats.totalCaches = this.caches.size;
      console.log(`[MemoryManager] ✅ Unregistered cache: ${id}`);
    }
  }

  private cleanup(): void {
    console.log('[MemoryManager] 🧹 Running cleanup...');

    let totalItems = 0;
    let itemsPruned = 0;

    for (const [id, cache] of this.caches) {
      const size = cache.getSize();
      totalItems += size;

      if (size > BULLETPROOF_CONFIG.maxCachedCandles && cache.prune) {
        const pruned = cache.prune(BULLETPROOF_CONFIG.maxCachedCandles);
        itemsPruned += pruned;
        console.log(`[MemoryManager] 🗑️ Pruned ${pruned} items from ${id} (had ${size}, now ${cache.getSize()})`);
      }
    }

    this.stats.totalItems = totalItems;
    this.stats.lastCleanup = Date.now();
    this.stats.cleanupCount++;

    if (itemsPruned > 0) {
      console.log(`[MemoryManager] ✅ Cleanup complete: ${itemsPruned} items pruned, ${totalItems} items remaining`);

      // Suggest garbage collection if available
      if (typeof window !== 'undefined' && 'gc' in window) {
        console.log('[MemoryManager] 🗑️ Triggering garbage collection');
        (window as any).gc();
      }
    } else {
      console.log(`[MemoryManager] ✅ Cleanup complete: No pruning needed (${totalItems} items total)`);
    }
  }

  forceCleanup(): void {
    console.log('[MemoryManager] ⚡ Force cleanup requested');
    this.cleanup();
  }

  clearAllCaches(): void {
    console.warn('[MemoryManager] ⚠️ Clearing all caches');

    for (const [id, cache] of this.caches) {
      cache.clear();
      console.log(`[MemoryManager] 🗑️ Cleared cache: ${id}`);
    }

    this.stats.totalItems = 0;
  }

  getStats(): MemoryStats & { caches: Array<{ id: string; size: number }> } {
    const caches = Array.from(this.caches.entries()).map(([id, cache]) => ({
      id,
      size: cache.getSize(),
    }));

    return {
      ...this.stats,
      caches,
    };
  }

  getMemoryUsage(): { used?: number; limit?: number; percentage?: number } {
    if (typeof performance !== 'undefined' && 'memory' in performance) {
      const memory = (performance as any).memory;
      return {
        used: memory.usedJSHeapSize,
        limit: memory.jsHeapSizeLimit,
        percentage: (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100,
      };
    }
    return {};
  }
}

export const chartMemoryManager = new ChartMemoryManager();

// Auto-start on import
if (BULLETPROOF_CONFIG.enableMemoryManager) {
  chartMemoryManager.start();
}
