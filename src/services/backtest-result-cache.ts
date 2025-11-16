import { UnifiedBacktestResult } from './unified-backtest-service';

interface CachedBacktestResult {
  data: UnifiedBacktestResult[];
  timestamp: number;
  userId: string;
}

interface CachedSummary {
  data: any;
  timestamp: number;
  userId: string;
}

class BacktestResultCache {
  private resultsCache = new Map<string, CachedBacktestResult>();
  private summaryCache = new Map<string, CachedSummary>();
  private readonly CACHE_TTL_MS = 60000; // 1 minute cache for backtest results
  private readonly SUMMARY_CACHE_TTL_MS = 120000; // 2 minute cache for summaries

  cacheResults(userId: string, results: UnifiedBacktestResult[]): void {
    const key = `results_${userId}`;
    this.resultsCache.set(key, {
      data: results,
      timestamp: Date.now(),
      userId
    });

    console.log(`[Cache] Cached ${results.length} backtest results for user ${userId}`);
  }

  getCachedResults(userId: string): UnifiedBacktestResult[] | null {
    const key = `results_${userId}`;
    const cached = this.resultsCache.get(key);

    if (!cached) {
      return null;
    }

    const age = Date.now() - cached.timestamp;
    if (age > this.CACHE_TTL_MS) {
      this.resultsCache.delete(key);
      console.log(`[Cache] Expired results cache for user ${userId} (age: ${age}ms)`);
      return null;
    }

    console.log(`[Cache] Hit: Retrieved ${cached.data.length} results from cache (age: ${age}ms)`);
    return cached.data;
  }

  cacheSummary(userId: string, summary: any): void {
    const key = `summary_${userId}`;
    this.summaryCache.set(key, {
      data: summary,
      timestamp: Date.now(),
      userId
    });

    console.log(`[Cache] Cached summary for user ${userId}`);
  }

  getCachedSummary(userId: string): any | null {
    const key = `summary_${userId}`;
    const cached = this.summaryCache.get(key);

    if (!cached) {
      return null;
    }

    const age = Date.now() - cached.timestamp;
    if (age > this.SUMMARY_CACHE_TTL_MS) {
      this.summaryCache.delete(key);
      console.log(`[Cache] Expired summary cache for user ${userId} (age: ${age}ms)`);
      return null;
    }

    console.log(`[Cache] Hit: Retrieved summary from cache (age: ${age}ms)`);
    return cached.data;
  }

  invalidateUserCache(userId: string): void {
    const resultsKey = `results_${userId}`;
    const summaryKey = `summary_${userId}`;

    this.resultsCache.delete(resultsKey);
    this.summaryCache.delete(summaryKey);

    console.log(`[Cache] Invalidated cache for user ${userId}`);
  }

  invalidateAll(): void {
    this.resultsCache.clear();
    this.summaryCache.clear();
    console.log('[Cache] Cleared all caches');
  }

  getCacheStats(): {
    resultsCount: number;
    summaryCount: number;
    totalSizeBytes: number;
  } {
    let totalSize = 0;

    this.resultsCache.forEach(cached => {
      totalSize += JSON.stringify(cached).length;
    });

    this.summaryCache.forEach(cached => {
      totalSize += JSON.stringify(cached).length;
    });

    return {
      resultsCount: this.resultsCache.size,
      summaryCount: this.summaryCache.size,
      totalSizeBytes: totalSize
    };
  }

  cleanupExpiredEntries(): void {
    const now = Date.now();

    let expiredResults = 0;
    this.resultsCache.forEach((cached, key) => {
      if (now - cached.timestamp > this.CACHE_TTL_MS) {
        this.resultsCache.delete(key);
        expiredResults++;
      }
    });

    let expiredSummaries = 0;
    this.summaryCache.forEach((cached, key) => {
      if (now - cached.timestamp > this.SUMMARY_CACHE_TTL_MS) {
        this.summaryCache.delete(key);
        expiredSummaries++;
      }
    });

    if (expiredResults > 0 || expiredSummaries > 0) {
      console.log(`[Cache] Cleanup: Removed ${expiredResults} result caches and ${expiredSummaries} summary caches`);
    }
  }
}

export const backtestResultCache = new BacktestResultCache();

// Auto-cleanup every 5 minutes
if (typeof window !== 'undefined') {
  setInterval(() => {
    backtestResultCache.cleanupExpiredEntries();
  }, 300000);
}
