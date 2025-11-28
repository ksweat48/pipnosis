import { supabase } from '../lib/supabase';

const DB_NAME = 'pipnosis_candle_cache';
const DB_VERSION = 1;
const STORE_NAME = 'candles';
const CACHE_VALIDITY_MS = 5 * 60 * 1000;
const STALE_DATA_THRESHOLD_MS = 24 * 60 * 60 * 1000;

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
        const candleSymbol = candle.symbol || symbol;
        const candleTimeframe = candle.timeframe || timeframe;

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

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
}

export const candleCacheManager = new CandleCacheManager();
