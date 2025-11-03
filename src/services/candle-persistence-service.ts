import { supabase, isCurrentUserAdmin } from '@/lib/supabase';
import { Timeframe } from '@/services/chart-preferences';
import { CandleData } from '@/services/candle-data-service';

interface SaveCandleResult {
  success: boolean;
  error?: string;
  candleTime?: string;
}

interface BatchSaveResult {
  total: number;
  saved: number;
  failed: number;
  errors: string[];
}

class CandlePersistenceService {
  private pendingCandles: Map<string, CandleData[]> = new Map();
  private saveInProgress = false;
  private readonly BATCH_SIZE = 10;
  private readonly SAVE_INTERVAL_MS = 30000;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.startAutoSave();
  }

  private startAutoSave() {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
    }

    this.saveTimer = setInterval(() => {
      this.flushAllPending();
    }, this.SAVE_INTERVAL_MS);
  }

  private getCacheKey(symbol: string, timeframe: Timeframe): string {
    return `${symbol}_${timeframe}`;
  }

  queueCandleForSave(symbol: string, timeframe: Timeframe, candle: CandleData): void {
    const key = this.getCacheKey(symbol, timeframe);
    const pending = this.pendingCandles.get(key) || [];

    const exists = pending.some(c => c.time === candle.time);
    if (!exists) {
      pending.push(candle);
      this.pendingCandles.set(key, pending);

      console.log(`[CandlePersistence] Queued candle for ${symbol} ${timeframe} at ${new Date(candle.time * 1000).toISOString()}`);
    }

    if (pending.length >= this.BATCH_SIZE) {
      this.flushPending(symbol, timeframe);
    }
  }

  async saveCompletedCandle(
    symbol: string,
    timeframe: Timeframe,
    candle: CandleData
  ): Promise<SaveCandleResult> {
    try {
      const userIsAdmin = await isCurrentUserAdmin();
      if (!userIsAdmin) {
        console.warn('[CandlePersistence] User is not admin, candle save skipped');
        return {
          success: false,
          error: 'Admin privileges required to save candle data'
        };
      }

      if (!candle.open || !candle.high || !candle.low || !candle.close || !candle.time) {
        return {
          success: false,
          error: 'Invalid candle data: missing required fields'
        };
      }

      if (candle.high < candle.low) {
        return {
          success: false,
          error: `Invalid candle: high (${candle.high}) < low (${candle.low})`
        };
      }

      const openTimeMs = candle.time * 1000;
      const openTime = new Date(openTimeMs);

      const timeframeMinutes = this.getTimeframeMinutes(timeframe);
      const closeTime = new Date(openTimeMs + timeframeMinutes * 60 * 1000);

      const candleRecord = {
        symbol,
        timeframe,
        open_time: openTime.toISOString(),
        close_time: closeTime.toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume || 0
      };

      const { error: forexError } = await supabase
        .from('forex_candles')
        .upsert(candleRecord, {
          onConflict: 'symbol,timeframe,open_time',
          ignoreDuplicates: false
        });

      if (forexError) {
        console.error('[CandlePersistence] Failed to save to forex_candles:', forexError);
        return {
          success: false,
          error: forexError.message
        };
      }

      const marketDataRecord = {
        symbol,
        timeframe,
        timestamp: openTime.toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume || 0
      };

      const { error: marketError } = await supabase
        .from('market_data')
        .upsert(marketDataRecord, {
          onConflict: 'symbol,timeframe,timestamp',
          ignoreDuplicates: false
        });

      if (marketError) {
        console.warn('[CandlePersistence] Failed to save to market_data:', marketError);
      }

      console.log(`[CandlePersistence] ✓ Saved completed candle: ${symbol} ${timeframe} at ${openTime.toISOString()}`);

      return {
        success: true,
        candleTime: openTime.toISOString()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[CandlePersistence] Error saving candle:', errorMessage);
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  async saveBatch(
    symbol: string,
    timeframe: Timeframe,
    candles: CandleData[]
  ): Promise<BatchSaveResult> {
    const result: BatchSaveResult = {
      total: candles.length,
      saved: 0,
      failed: 0,
      errors: []
    };

    if (candles.length === 0) {
      return result;
    }

    console.log(`[CandlePersistence] Saving batch of ${candles.length} candles for ${symbol} ${timeframe}`);

    for (const candle of candles) {
      const saveResult = await this.saveCompletedCandle(symbol, timeframe, candle);

      if (saveResult.success) {
        result.saved++;
      } else {
        result.failed++;
        if (saveResult.error) {
          result.errors.push(saveResult.error);
        }
      }
    }

    console.log(`[CandlePersistence] Batch complete: ${result.saved} saved, ${result.failed} failed`);

    return result;
  }

  async flushPending(symbol: string, timeframe: Timeframe): Promise<void> {
    if (this.saveInProgress) {
      console.log('[CandlePersistence] Save already in progress, skipping flush');
      return;
    }

    const key = this.getCacheKey(symbol, timeframe);
    const pending = this.pendingCandles.get(key);

    if (!pending || pending.length === 0) {
      return;
    }

    this.saveInProgress = true;

    try {
      const candlesToSave = [...pending];
      this.pendingCandles.delete(key);

      await this.saveBatch(symbol, timeframe, candlesToSave);
    } catch (error) {
      console.error('[CandlePersistence] Error flushing pending candles:', error);
    } finally {
      this.saveInProgress = false;
    }
  }

  async flushAllPending(): Promise<void> {
    if (this.saveInProgress) {
      return;
    }

    const keys = Array.from(this.pendingCandles.keys());

    for (const key of keys) {
      const [symbol, timeframe] = key.split('_');
      await this.flushPending(symbol, timeframe as Timeframe);
    }
  }

  getPendingCount(symbol: string, timeframe: Timeframe): number {
    const key = this.getCacheKey(symbol, timeframe);
    return this.pendingCandles.get(key)?.length || 0;
  }

  clearPending(symbol: string, timeframe: Timeframe): void {
    const key = this.getCacheKey(symbol, timeframe);
    this.pendingCandles.delete(key);
  }

  destroy(): void {
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }

    this.flushAllPending();
  }

  private getTimeframeMinutes(timeframe: Timeframe): number {
    const map: Record<Timeframe, number> = {
      M1: 1,
      M5: 5,
      M15: 15,
      M30: 30,
      H1: 60,
      H4: 240,
      D1: 1440,
      W1: 10080
    };
    return map[timeframe] || 15;
  }
}

export const candlePersistenceService = new CandlePersistenceService();
