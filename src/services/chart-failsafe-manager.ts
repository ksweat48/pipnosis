/**
 * Chart Failsafe Manager
 *
 * Always shows SOMETHING - never blank screens.
 * Falls back to cached data or demo data if all else fails.
 *
 * ZERO RISK: Fallback only activates on errors.
 */

import { BULLETPROOF_CONFIG } from '@/config/chart-bulletproofing';
import { CandleData } from './candle-data-service';

interface FailsafeCache {
  symbol: string;
  timeframe: string;
  candles: CandleData[];
  timestamp: number;
}

interface FailsafeResult<T> {
  data: T | null;
  fromCache: boolean;
  fromDemo: boolean;
  error: any | null;
  dataAge?: number;
}

class ChartFailsafeManager {
  private cache = new Map<string, FailsafeCache>();
  private failureCount = new Map<string, number>();

  async loadDataSafely<T>(
    symbol: string,
    timeframe: string,
    loadFn: () => Promise<T>,
    demoDataFn?: () => T
  ): Promise<FailsafeResult<T>> {
    if (!BULLETPROOF_CONFIG.enableFailsafe) {
      try {
        const data = await loadFn();
        return { data, fromCache: false, fromDemo: false, error: null };
      } catch (error) {
        return { data: null, fromCache: false, fromDemo: false, error };
      }
    }

    const key = `${symbol}:${timeframe}`;

    try {
      const data = await loadFn();

      // Success - cache it and reset failure count
      if (data && Array.isArray(data) && (data as any).length > 0) {
        this.cacheData(symbol, timeframe, data as any);
        this.failureCount.set(key, 0);
      }

      return { data, fromCache: false, fromDemo: false, error: null };
    } catch (error) {
      console.error(`[ChartFailsafe] ❌ Load failed for ${key}:`, error);

      // Increment failure count
      const failures = (this.failureCount.get(key) || 0) + 1;
      this.failureCount.set(key, failures);

      // Try cached data first
      const cached = this.getCachedData(symbol, timeframe);
      if (cached) {
        const age = Date.now() - cached.timestamp;
        console.warn(`[ChartFailsafe] ⚠️ Using cached data for ${key} (${Math.round(age / 1000)}s old, ${failures} failures)`);
        return {
          data: cached.candles as any,
          fromCache: true,
          fromDemo: false,
          error,
          dataAge: age,
        };
      }

      // Try demo data as last resort
      if (BULLETPROOF_CONFIG.enableDemoDataFallback && demoDataFn) {
        console.warn(`[ChartFailsafe] ⚠️ Using demo data for ${key} (${failures} failures)`);
        const demoData = demoDataFn();
        return {
          data: demoData,
          fromCache: false,
          fromDemo: true,
          error,
        };
      }

      // Complete failure
      console.error(`[ChartFailsafe] ❌ No fallback data available for ${key}`);
      return { data: null, fromCache: false, fromDemo: false, error };
    }
  }

  private cacheData(symbol: string, timeframe: string, candles: CandleData[]): void {
    const key = `${symbol}:${timeframe}`;

    // Only cache if we have valid data
    if (!candles || candles.length === 0) {
      return;
    }

    this.cache.set(key, {
      symbol,
      timeframe,
      candles,
      timestamp: Date.now(),
    });

    console.log(`[ChartFailsafe] ✅ Cached ${candles.length} candles for ${key}`);
  }

  private getCachedData(symbol: string, timeframe: string): FailsafeCache | null {
    const key = `${symbol}:${timeframe}`;
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    // Check if cache is too old
    const age = Date.now() - cached.timestamp;
    const maxAge = BULLETPROOF_CONFIG.cacheDurationMs * 3; // Allow 3x cache duration for failsafe

    if (age > maxAge) {
      console.warn(`[ChartFailsafe] ⚠️ Cache too old for ${key} (${Math.round(age / 1000)}s)`);
      return null;
    }

    return cached;
  }

  generateDemoData(symbol: string, timeframe: string, count: number = 100): CandleData[] {
    console.warn(`[ChartFailsafe] 🎬 Generating ${count} demo candles for ${symbol}`);

    const now = Math.floor(Date.now() / 1000);
    const timeframeSeconds = this.getTimeframeSeconds(timeframe);

    // Generate realistic starting price based on symbol
    let basePrice = 1.0850; // EURUSD default

    if (symbol.includes('XAU')) {
      basePrice = 2650;
    } else if (symbol.includes('US30')) {
      basePrice = 42000;
    } else if (symbol.includes('JPY')) {
      basePrice = 110;
    } else if (symbol.includes('GBP')) {
      basePrice = 1.27;
    }

    const candles: CandleData[] = [];

    for (let i = count - 1; i >= 0; i--) {
      const time = now - (i * timeframeSeconds);

      // Generate random but realistic candle
      const volatility = basePrice * 0.001; // 0.1% volatility
      const open = basePrice + (Math.random() - 0.5) * volatility * 2;
      const close = open + (Math.random() - 0.5) * volatility * 2;
      const high = Math.max(open, close) + Math.random() * volatility;
      const low = Math.min(open, close) - Math.random() * volatility;

      candles.push({
        time,
        open,
        high,
        low,
        close,
        volume: Math.floor(Math.random() * 1000),
      });

      // Slight trend
      basePrice = close;
    }

    return candles;
  }

  private getTimeframeSeconds(timeframe: string): number {
    const map: Record<string, number> = {
      M1: 60,
      M5: 300,
      M15: 900,
      M30: 1800,
      H1: 3600,
      H4: 14400,
      D1: 86400,
      W1: 604800,
    };
    return map[timeframe] || 60;
  }

  getFailureCount(symbol: string, timeframe: string): number {
    const key = `${symbol}:${timeframe}`;
    return this.failureCount.get(key) || 0;
  }

  clearCache(symbol?: string, timeframe?: string): void {
    if (symbol && timeframe) {
      const key = `${symbol}:${timeframe}`;
      this.cache.delete(key);
      this.failureCount.delete(key);
      console.log(`[ChartFailsafe] 🗑️ Cleared cache for ${key}`);
    } else {
      this.cache.clear();
      this.failureCount.clear();
      console.log('[ChartFailsafe] 🗑️ Cleared all cache');
    }
  }

  getCacheStats() {
    return {
      cacheSize: this.cache.size,
      failures: Object.fromEntries(this.failureCount),
      cachedKeys: Array.from(this.cache.keys()),
    };
  }
}

export const chartFailsafeManager = new ChartFailsafeManager();
