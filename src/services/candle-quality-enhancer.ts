/**
 * Candle Quality Enhancer
 *
 * Single entry point for all candle enhancement:
 * 1. Gap filling (fills missing candles)
 * 2. Wick reconstruction (adds realistic wicks)
 * 3. Validation (ensures data quality)
 *
 * Called automatically before candles reach the chart.
 * Results are cached for 30 seconds to avoid redundant processing.
 *
 * Performance:
 * - First enhancement: ~50ms (ATR calculation + gap fill)
 * - Subsequent enhancements: <10ms (cached ATR + gap detection only)
 */

import { CandleData } from '@/services/candle-data-service';
import { Timeframe } from '@/services/chart-preferences';
import { realtimeGapDetector } from './realtime-gap-detector';
import { reconstructCandles } from './wick-reconstruction-service';
import { logger, LogCategory } from '@/lib/logger';

interface EnhancementResult {
  candles: CandleData[];
  stats: {
    gapsFilled: number;
    wicksReconstructed: number;
    processingTimeMs: number;
  };
}

interface CacheEntry {
  candles: CandleData[];
  timestamp: number;
}

class CandleQualityEnhancer {
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL_MS = 30 * 1000; // 30 seconds
  private readonly MAX_CACHE_SIZE = 20;

  /**
   * Enhance candles: fill gaps + reconstruct wicks + validate
   * Main entry point for all chart data
   */
  async enhanceCandles(
    candles: CandleData[],
    symbol: string,
    timeframe: Timeframe,
    options: {
      fillGaps?: boolean;
      reconstructWicks?: boolean;
      useCache?: boolean;
    } = {}
  ): Promise<EnhancementResult> {
    const {
      fillGaps = true,
      reconstructWicks = true,
      useCache = true
    } = options;

    const startTime = Date.now();

    // Check cache
    if (useCache) {
      const cacheKey = this.getCacheKey(symbol, timeframe, candles);
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        return {
          candles: cached,
          stats: {
            gapsFilled: 0,
            wicksReconstructed: 0,
            processingTimeMs: Date.now() - startTime
          }
        };
      }
    }

    let processedCandles = [...candles];
    let gapsFilled = 0;
    let wicksReconstructed = 0;

    // Step 1: Fill gaps (if enabled and gaps detected)
    if (fillGaps && candles.length > 0) {
      const gaps = realtimeGapDetector.detectGaps(candles, timeframe);

      if (gaps.length > 0) {
        const lastKnownPrice = candles[candles.length - 1].close;
        const syntheticCandles = await realtimeGapDetector.fillGaps(
          gaps,
          symbol,
          timeframe,
          lastKnownPrice
        );

        if (syntheticCandles.length > 0) {
          processedCandles = realtimeGapDetector.mergeSyntheticCandles(
            processedCandles,
            syntheticCandles
          );
          gapsFilled = syntheticCandles.length;

          logger.debug(LogCategory.CHART_POLLER,
            `Filled ${gapsFilled} gap candles for ${symbol} ${timeframe}`
          );
        }
      }
    }

    // Step 2: Reconstruct wicks (if enabled)
    if (reconstructWicks && processedCandles.length > 0) {
      // Prepare candles for reconstruction (add required fields)
      const candlesWithMetadata = processedCandles.map(c => ({
        ...c,
        symbol,
        timeframe,
        open_time: new Date(c.time * 1000).toISOString()
      }));

      const reconstructed = await reconstructCandles(candlesWithMetadata);

      // Count how many were actually reconstructed
      wicksReconstructed = reconstructed.filter(c => c.reconstructed).length;

      // Strip reconstruction metadata and return clean candles
      processedCandles = reconstructed.map(c => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
      }));

      if (wicksReconstructed > 0) {
        logger.debug(LogCategory.CHART_POLLER,
          `Reconstructed wicks for ${wicksReconstructed} candles (${symbol} ${timeframe})`
        );
      }
    }

    // Step 3: Validate (ensure no NaN, Infinity, or negative values)
    processedCandles = this.validateCandles(processedCandles);

    const processingTimeMs = Date.now() - startTime;

    // Cache result
    if (useCache) {
      const cacheKey = this.getCacheKey(symbol, timeframe, candles);
      this.setCache(cacheKey, processedCandles);
    }

    logger.debug(LogCategory.CHART_POLLER,
      `Enhanced ${processedCandles.length} candles in ${processingTimeMs}ms ` +
      `(gaps: ${gapsFilled}, wicks: ${wicksReconstructed})`
    );

    return {
      candles: processedCandles,
      stats: {
        gapsFilled,
        wicksReconstructed,
        processingTimeMs
      }
    };
  }

  /**
   * Quick check if enhancement is needed
   * Returns false if candles are already perfect (no gaps, all have wicks)
   */
  needsEnhancement(candles: CandleData[], timeframe: Timeframe): boolean {
    if (candles.length === 0) return false;

    // Quick check for gaps
    if (realtimeGapDetector.hasGaps(candles, timeframe)) {
      return true;
    }

    // Quick check for flat candles (need wicks)
    const hasFlat = candles.some(c => c.high === c.low);
    if (hasFlat) {
      return true;
    }

    return false;
  }

  /**
   * Validate candles for data quality
   */
  private validateCandles(candles: CandleData[]): CandleData[] {
    return candles.filter(candle => {
      // Remove candles with invalid prices
      if (
        !isFinite(candle.open) ||
        !isFinite(candle.high) ||
        !isFinite(candle.low) ||
        !isFinite(candle.close) ||
        candle.open <= 0 ||
        candle.high <= 0 ||
        candle.low <= 0 ||
        candle.close <= 0
      ) {
        logger.warn(LogCategory.CHART_POLLER,
          `Removed invalid candle: ${JSON.stringify(candle)}`
        );
        return false;
      }

      // Ensure high >= low
      if (candle.high < candle.low) {
        logger.warn(LogCategory.CHART_POLLER,
          `Fixed candle with high < low: ${candle.high} < ${candle.low}`
        );
        // Swap them
        [candle.high, candle.low] = [candle.low, candle.high];
      }

      // Ensure high/low contain open/close
      const maxOC = Math.max(candle.open, candle.close);
      const minOC = Math.min(candle.open, candle.close);

      if (candle.high < maxOC) {
        candle.high = maxOC;
      }

      if (candle.low > minOC) {
        candle.low = minOC;
      }

      return true;
    });
  }

  /**
   * Cache management
   */
  private getCacheKey(symbol: string, timeframe: Timeframe, candles: CandleData[]): string {
    // Use first and last candle times as cache key
    if (candles.length === 0) return `${symbol}_${timeframe}_empty`;

    const firstTime = candles[0].time;
    const lastTime = candles[candles.length - 1].time;
    return `${symbol}_${timeframe}_${firstTime}_${lastTime}_${candles.length}`;
  }

  private getFromCache(key: string): CandleData[] | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // Check if expired
    if (Date.now() - entry.timestamp > this.CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }

    return entry.candles;
  }

  private setCache(key: string, candles: CandleData[]): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      candles,
      timestamp: Date.now()
    });
  }

  /**
   * Clear cache (useful for testing or memory management)
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.cache.size,
      maxSize: this.MAX_CACHE_SIZE,
      ttlMs: this.CACHE_TTL_MS
    };
  }
}

export const candleQualityEnhancer = new CandleQualityEnhancer();
