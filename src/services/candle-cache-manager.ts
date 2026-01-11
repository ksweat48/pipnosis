import { supabase } from '../lib/supabase';

const DB_NAME = 'pipnosis_candle_cache';
const DB_VERSION = 1;
const STORE_NAME = 'candles';
// CRITICAL FIX: Reduced cache validity to 2 minutes for immediate gap fill visibility
// This ensures users see new candles and gap fills without manual refresh
const CACHE_VALIDITY_MS = 2 * 60 * 1000; // 2 minutes (reduced from 30 minutes)
const STALE_DATA_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours (reduced from 48 hours)

interface CachedCandle {
  cacheId: string;
  symbol: string;
  timeframe: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tick_volume?: number;
  spread?: number;
}

interface CacheMetadata {
  symbol: string;
  timeframe: string;
  fetchTimestamp: number;
  candleCount: number;
  oldestCandle: string;
  newestCandle: string;
}

class CandleCacheManager {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;
  private forceRefresh: boolean = false;
  private realtimeSubscription: any = null;

  private async initDB(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const objectStore = db.createObjectStore(STORE_NAME, { keyPath: 'cacheId' });
          objectStore.createIndex('symbol_timeframe', ['symbol', 'timeframe'], { unique: false });
          objectStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!db.objectStoreNames.contains('metadata')) {
          const metaStore = db.createObjectStore('metadata', { keyPath: ['symbol', 'timeframe'] });
          metaStore.createIndex('fetchTimestamp', 'fetchTimestamp', { unique: false });
        }
      };
    });

    return this.initPromise;
  }

  async getCachedCandles(symbol: string, timeframe: string): Promise<{ candles: CachedCandle[], metadata: CacheMetadata | null }> {
    await this.initDB();
    if (!this.db) throw new Error('Database not initialized');

    // CRITICAL: If force refresh is enabled, skip cache entirely
    if (this.forceRefresh) {
      console.log('[CandleCache] 🔄 Force refresh enabled - bypassing cache');
      return { candles: [], metadata: null };
    }

    const metadata = await this.getMetadata(symbol, timeframe);

    if (!metadata || !this.isCacheValid(metadata)) {
      return { candles: [], metadata: null };
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME], 'readonly');
      const objectStore = transaction.objectStore(STORE_NAME);
      const index = objectStore.index('symbol_timeframe');
      const request = index.getAll([symbol, timeframe]);

      request.onsuccess = () => {
        resolve({ candles: request.result, metadata });
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async getMetadata(symbol: string, timeframe: string): Promise<CacheMetadata | null> {
    if (!this.db) return null;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['metadata'], 'readonly');
      const objectStore = transaction.objectStore('metadata');
      const request = objectStore.get([symbol, timeframe]);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  private isCacheValid(metadata: CacheMetadata): boolean {
    const age = Date.now() - metadata.fetchTimestamp;
    return age < CACHE_VALIDITY_MS;
  }

  async saveCandles(symbol: string, timeframe: string, candles: any[]): Promise<void> {
    await this.initDB();
    if (!this.db || candles.length === 0) return;

    const candlesWithIds = candles
      .map(candle => {
        // Extract timestamp first for validation
        const timestamp = candle.open_time || candle.timestamp || candle.time;
        // CRITICAL FIX: Always use function parameters to prevent cross-contamination
        // Never trust candle.symbol as it may contain stale data from previous operations
        const candleSymbol = symbol;
        const candleTimeframe = timeframe;

        // Validate ALL required fields before creating cache entry
        if (!timestamp) {
          console.warn(`[CandleCache] Skipping candle - missing timestamp:`, candle);
          return null;
        }

        if (!candleSymbol || !candleTimeframe) {
          console.warn(`[CandleCache] Skipping candle - missing symbol or timeframe:`, candle);
          return null;
        }

        if (candle.open == null || candle.high == null || candle.low == null || candle.close == null) {
          console.warn(`[CandleCache] Skipping candle - missing OHLC data:`, candle);
          return null;
        }

        // Remove database-specific fields that shouldn't be in cache
        const { id, created_at, updated_at, user_id, ...cleanCandle } = candle;

        // Create cache entry with guaranteed valid cacheId
        const cacheId = `${candleSymbol}_${candleTimeframe}_${timestamp}`;

        return {
          cacheId,
          symbol: candleSymbol,
          timeframe: candleTimeframe,
          timestamp: timestamp,
          open: Number(candle.open),
          high: Number(candle.high),
          low: Number(candle.low),
          close: Number(candle.close),
          volume: Number(candle.volume || 0),
          tick_volume: candle.tick_volume ? Number(candle.tick_volume) : undefined,
          spread: candle.spread ? Number(candle.spread) : undefined
        };
      })
      .filter((candle): candle is NonNullable<typeof candle> => candle !== null);

    // If no valid candles after filtering, don't save
    if (candlesWithIds.length === 0) {
      console.warn(`[CandleCache] No valid candles to save for ${symbol} ${timeframe}`);
      return;
    }

    const sortedCandles = [...candlesWithIds].sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const metadata: CacheMetadata = {
      symbol,
      timeframe,
      fetchTimestamp: Date.now(),
      candleCount: candlesWithIds.length,
      oldestCandle: sortedCandles[0].timestamp,
      newestCandle: sortedCandles[sortedCandles.length - 1].timestamp
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME, 'metadata'], 'readwrite');
      const candleStore = transaction.objectStore(STORE_NAME);
      const metaStore = transaction.objectStore('metadata');

      candlesWithIds.forEach(candle => {
        candleStore.put(candle);
      });

      metaStore.put(metadata);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async clearStaleCache(): Promise<void> {
    await this.initDB();
    if (!this.db) return;

    const transaction = this.db.transaction(['metadata'], 'readonly');
    const metaStore = transaction.objectStore('metadata');
    const index = metaStore.index('fetchTimestamp');
    const request = index.openCursor();

    const staleKeys: [string, string][] = [];
    const staleThreshold = Date.now() - STALE_DATA_THRESHOLD_MS;

    request.onsuccess = async (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        const metadata = cursor.value as CacheMetadata;
        if (metadata.fetchTimestamp < staleThreshold) {
          staleKeys.push([metadata.symbol, metadata.timeframe]);
        }
        cursor.continue();
      } else {
        for (const key of staleKeys) {
          await this.clearCache(key[0], key[1]);
        }
      }
    };
  }

  async clearCache(symbol: string, timeframe: string): Promise<void> {
    await this.initDB();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME, 'metadata'], 'readwrite');
      const candleStore = transaction.objectStore(STORE_NAME);
      const metaStore = transaction.objectStore('metadata');
      const index = candleStore.index('symbol_timeframe');
      const request = index.openCursor([symbol, timeframe]);

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      metaStore.delete([symbol, timeframe]);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async clearAllCache(): Promise<void> {
    await this.initDB();
    if (!this.db) return;

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORE_NAME, 'metadata'], 'readwrite');
      const candleStore = transaction.objectStore(STORE_NAME);
      const metaStore = transaction.objectStore('metadata');

      candleStore.clear();
      metaStore.clear();

      transaction.oncomplete = () => {
        console.log('[CandleCache] ✅ All cache cleared');
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }

  setForceRefresh(enabled: boolean): void {
    this.forceRefresh = enabled;
    if (enabled) {
      console.log('[CandleCache] 🔄 Force refresh mode ENABLED - all requests will bypass cache');
    } else {
      console.log('[CandleCache] ✅ Force refresh mode DISABLED - cache enabled');
    }
  }

  async invalidateSymbolTimeframe(symbol: string, timeframe: string): Promise<void> {
    // Silenced: This happens frequently during normal operation
    // console.log(`[CandleCache] 🗑️ Invalidating cache for ${symbol} ${timeframe}`);
    await this.clearCache(symbol, timeframe);
  }

  async getCacheInfo(): Promise<{ size: number; symbols: string[] }> {
    await this.initDB();
    if (!this.db) return { size: 0, symbols: [] };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['metadata'], 'readonly');
      const metaStore = transaction.objectStore('metadata');
      const request = metaStore.getAll();

      request.onsuccess = () => {
        const metadata = request.result as CacheMetadata[];
        const symbols = [...new Set(metadata.map(m => `${m.symbol}/${m.timeframe}`))];
        const totalCandles = metadata.reduce((sum, m) => sum + m.candleCount, 0);
        resolve({ size: totalCandles, symbols });
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Subscribe to real-time cache invalidation events from Supabase
   * When new candles are inserted, the cache is automatically invalidated
   */
  subscribeToInvalidationEvents(): void {
    if (this.realtimeSubscription) {
      console.log('[CandleCache] ⚠️ Already subscribed to invalidation events');
      return;
    }

    console.log('[CandleCache] 🔔 Subscribing to real-time cache invalidation events...');

    try {
      this.realtimeSubscription = supabase
        .channel('candle-cache-invalidation')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'candle_cache_invalidation_events'
          },
          async (payload) => {
            const { symbol, timeframe, candle_time } = payload.new as any;
            // Silenced: This happens frequently during normal operation
            // console.log(
            //   `[CandleCache] 🔄 Real-time invalidation: ${symbol} ${timeframe} at ${candle_time}`
            // );

            // Invalidate cache immediately
            await this.invalidateSymbolTimeframe(symbol, timeframe);
          }
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('[CandleCache] ✅ Subscribed to cache invalidation events');
          } else if (status === 'CHANNEL_ERROR') {
            // Log warning but allow graceful degradation - NOT an error
            console.warn('[CandleCache] ⚠️ Realtime subscription unavailable - cache will use manual refresh only');
            this.realtimeSubscription = null;
          } else if (status === 'TIMED_OUT') {
            console.warn('[CandleCache] ⏱️ Realtime subscription timed out - cache will use manual refresh');
            this.realtimeSubscription = null;
          } else if (status === 'CLOSED') {
            this.realtimeSubscription = null;
          }
        });
    } catch (error) {
      console.warn('[CandleCache] ⚠️ Error setting up realtime subscription:', error);
      console.warn('[CandleCache] Continuing without realtime updates - functionality not affected');
      this.realtimeSubscription = null;
    }
  }

  /**
   * Unsubscribe from real-time cache invalidation events
   */
  unsubscribeFromInvalidationEvents(): void {
    if (this.realtimeSubscription) {
      console.log('[CandleCache] 🔕 Unsubscribing from cache invalidation events');
      supabase.removeChannel(this.realtimeSubscription);
      this.realtimeSubscription = null;
    }
  }
}

export const candleCacheManager = new CandleCacheManager();
