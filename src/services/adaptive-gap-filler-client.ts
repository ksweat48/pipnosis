/**
 * Adaptive Gap Filler Client
 *
 * Lightweight client-side gap filler that runs synchronized with candle polling.
 * No separate setInterval - piggybacks on existing 500ms/3s polling cycles.
 *
 * Performance Budget: 10ms max per cycle
 * - Quick scan: last 50 candles only (~5ms)
 * - Immediate fill: gaps < 5 minutes (~1ms per candle)
 * - Lazy queue: gaps 5-15 minutes (next cycle)
 * - Backend defer: gaps > 15 minutes (logged only)
 *
 * For crypto at 500ms polling, this runs every 500ms.
 * For forex at 3s polling, this runs every 3s.
 */

import { CandleData, getTimeframeMinutes } from '@/services/candle-data-service';
import { Timeframe } from '@/services/chart-preferences';
import { realtimeGapDetector } from './realtime-gap-detector';
import { logger, LogCategory } from '@/lib/logger';

interface GapFillRequest {
  symbol: string;
  timeframe: Timeframe;
  candles: CandleData[];
  lastKnownPrice: number;
}

class AdaptiveGapFillerClient {
  private readonly MAX_PROCESSING_TIME_MS = 10;
  private readonly MAX_SCAN_CANDLES = 50;

  // Lazy queue for medium gaps (processed next cycle)
  private lazyQueue: GapFillRequest[] = [];

  /**
   * Process candles on every polling cycle
   * Synchronized with candle poller (500ms for crypto, 3s for forex)
   *
   * Returns enhanced candles with gaps filled
   */
  async processOnCycle(
    symbol: string,
    timeframe: Timeframe,
    candles: CandleData[]
  ): Promise<CandleData[]> {
    if (candles.length === 0) return candles;

    const startTime = Date.now();
    let processedCandles = candles;

    // Quick scan: check last N candles for gaps (~5ms)
    const hasGaps = this.quickGapCheck(candles, timeframe);

    if (!hasGaps) {
      // Happy path: no gaps, return immediately
      return candles;
    }

    // Detect specific gaps
    const gaps = realtimeGapDetector.detectGaps(candles, timeframe);

    if (gaps.length === 0) {
      return candles;
    }

    const lastKnownPrice = candles[candles.length - 1].close;

    // Separate gaps by size
    const smallGaps = gaps.filter(g => g.gapMinutes <= 5);
    const mediumGaps = gaps.filter(g => g.gapMinutes > 5 && g.gapMinutes <= 15);
    const largeGaps = gaps.filter(g => g.gapMinutes > 15);

    // Strategy 1: Fill small gaps immediately (<5 minutes)
    if (smallGaps.length > 0) {
      // Check time budget
      if (Date.now() - startTime < this.MAX_PROCESSING_TIME_MS) {
        const syntheticCandles = await realtimeGapDetector.fillGaps(
          smallGaps,
          symbol,
          timeframe,
          lastKnownPrice
        );

        if (syntheticCandles.length > 0) {
          processedCandles = realtimeGapDetector.mergeSyntheticCandles(
            processedCandles,
            syntheticCandles
          );

          logger.debug(LogCategory.CHART_POLLER,
            `[AdaptiveGapFiller] Filled ${syntheticCandles.length} small gaps immediately`
          );
        }
      }
    }

    // Strategy 2: Queue medium gaps for next cycle (5-15 minutes)
    if (mediumGaps.length > 0) {
      this.lazyQueue.push({
        symbol,
        timeframe,
        candles: processedCandles,
        lastKnownPrice
      });

      logger.debug(LogCategory.CHART_POLLER,
        `[AdaptiveGapFiller] Queued ${mediumGaps.length} medium gaps for next cycle`
      );
    }

    // Strategy 3: Large gaps already logged by realtimeGapDetector
    if (largeGaps.length > 0) {
      logger.debug(LogCategory.CHART_POLLER,
        `[AdaptiveGapFiller] Deferred ${largeGaps.length} large gaps to backend`
      );
    }

    // Process lazy queue if time budget allows
    if (Date.now() - startTime < this.MAX_PROCESSING_TIME_MS / 2 && this.lazyQueue.length > 0) {
      await this.processLazyQueue();
    }

    const processingTime = Date.now() - startTime;

    if (processingTime > this.MAX_PROCESSING_TIME_MS) {
      logger.warn(LogCategory.CHART_POLLER,
        `[AdaptiveGapFiller] Exceeded time budget: ${processingTime}ms (max: ${this.MAX_PROCESSING_TIME_MS}ms)`
      );
    }

    return processedCandles;
  }

  /**
   * Quick gap check (ultra-fast, ~2ms for 50 candles)
   * Returns true if any gaps found, false if all good
   */
  private quickGapCheck(candles: CandleData[], timeframe: Timeframe): boolean {
    if (candles.length < 2) return false;

    const intervalSeconds = getTimeframeMinutes(timeframe) * 60;
    const scanStart = Math.max(0, candles.length - this.MAX_SCAN_CANDLES);

    for (let i = scanStart + 1; i < candles.length; i++) {
      const gap = candles[i].time - candles[i - 1].time;
      if (gap > intervalSeconds) {
        return true; // Gap found
      }
    }

    return false; // No gaps
  }

  /**
   * Process lazy queue (medium gaps from previous cycles)
   */
  private async processLazyQueue(): Promise<void> {
    if (this.lazyQueue.length === 0) return;

    // Process one item from queue
    const request = this.lazyQueue.shift();
    if (!request) return;

    const gaps = realtimeGapDetector.detectGaps(request.candles, request.timeframe);
    const mediumGaps = gaps.filter(g => g.gapMinutes > 5 && g.gapMinutes <= 15);

    if (mediumGaps.length > 0) {
      const syntheticCandles = await realtimeGapDetector.fillGaps(
        mediumGaps,
        request.symbol,
        request.timeframe,
        request.lastKnownPrice
      );

      if (syntheticCandles.length > 0) {
        logger.debug(LogCategory.CHART_POLLER,
          `[AdaptiveGapFiller] Filled ${syntheticCandles.length} medium gaps from lazy queue`
        );
      }
    }
  }

  /**
   * Get queue statistics
   */
  getQueueStats() {
    return {
      queueSize: this.lazyQueue.length,
      maxProcessingTimeMs: this.MAX_PROCESSING_TIME_MS
    };
  }

  /**
   * Clear lazy queue (useful for cleanup or testing)
   */
  clearQueue(): void {
    this.lazyQueue = [];
  }
}

export const adaptiveGapFillerClient = new AdaptiveGapFillerClient();
