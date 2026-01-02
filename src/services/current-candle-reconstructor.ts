/**
 * Current Candle Reconstructor
 *
 * Solves the problem of losing the in-progress candle on page refresh.
 *
 * On page load:
 * 1. Fetches all price ticks since the last completed candle
 * 2. Reconstructs the current forming candle from those ticks
 * 3. Returns it so the chart can display it immediately
 *
 * This ensures the current candle persists across page refreshes by
 * rebuilding it from the tick data stored in the database.
 */

import { supabase } from '@/lib/supabase';
import {
  CandleData,
  RealtimePrice,
  aggregatePricesToCurrentCandle,
  getTimeframeMinutes
} from '@/services/candle-data-service';
import { Timeframe } from '@/services/chart-preferences';
import { logger, LogCategory } from '@/lib/logger';
import { reconstructCandle } from '@/services/wick-reconstruction-service';

export interface ReconstructionResult {
  candle: CandleData | null;
  tickCount: number;
  timeRange: {
    start: Date;
    end: Date;
  } | null;
  wasReconstructed: boolean;
}

class CurrentCandleReconstructor {
  /**
   * Reconstruct the current in-progress candle from database ticks
   *
   * @param symbol - Trading symbol (e.g., 'EURUSD')
   * @param timeframe - Chart timeframe (e.g., 'M5')
   * @param lastHistoricalCandleTime - Unix timestamp (seconds) of the last completed candle
   * @returns Reconstructed candle or null if no ticks found
   */
  async reconstructCurrentCandle(
    symbol: string,
    timeframe: Timeframe,
    lastHistoricalCandleTime: number
  ): Promise<ReconstructionResult> {
    try {
      const timeframeMinutes = getTimeframeMinutes(timeframe);

      // Calculate when the current candle period started
      const now = Date.now();
      const currentCandleStartMs = Math.floor(now / (timeframeMinutes * 60 * 1000)) * (timeframeMinutes * 60 * 1000);
      const currentCandleStartTime = Math.floor(currentCandleStartMs / 1000);

      logger.debug(
        LogCategory.CHART_POLLER,
        `[CandleReconstructor] Reconstructing ${symbol} ${timeframe} candle...`
      );
      logger.debug(
        LogCategory.CHART_POLLER,
        `  Last completed: ${new Date(lastHistoricalCandleTime * 1000).toISOString()}`
      );
      logger.debug(
        LogCategory.CHART_POLLER,
        `  Current period: ${new Date(currentCandleStartMs).toISOString()}`
      );

      // Fetch all ticks since the current candle period started
      // We want ticks from the START of the current candle period, not from the last historical candle
      const fetchFromTime = new Date(currentCandleStartMs);

      logger.debug(
        LogCategory.CHART_POLLER,
        `  Fetching ticks from: ${fetchFromTime.toISOString()}`
      );

      const { data: ticks, error } = await supabase
        .from('realtime_prices')
        .select('bid, ask, broker_time, created_at')
        .eq('symbol', symbol)
        .gte('broker_time', fetchFromTime.toISOString())
        .order('broker_time', { ascending: true })
        .limit(1000); // Reasonable limit for a single candle period

      if (error) {
        console.error('[CandleReconstructor] Error fetching ticks:', error);
        return {
          candle: null,
          tickCount: 0,
          timeRange: null,
          wasReconstructed: false
        };
      }

      if (!ticks || ticks.length === 0) {
        logger.debug(
          LogCategory.CHART_POLLER,
          `[CandleReconstructor] No ticks found for current period - candle hasn't started yet`
        );
        return {
          candle: null,
          tickCount: 0,
          timeRange: null,
          wasReconstructed: false
        };
      }

      logger.debug(
        LogCategory.CHART_POLLER,
        `[CandleReconstructor] Found ${ticks.length} ticks for current candle period`
      );

      // CRITICAL FIX: Filter ticks with strict quality and timestamp validation
      // This prevents stale/misaligned ticks from creating abnormal candles
      const currentPeriodTicks = ticks.filter(tick => {
        const tickTime = new Date(tick.broker_time || tick.created_at).getTime();

        // Reject ticks outside current candle period
        if (tickTime < currentCandleStartMs) {
          return false;
        }

        // CRITICAL: Reject ticks older than the full timeframe window (stale data protection)
        // For M5, allow ticks up to 5 minutes old; for H1, up to 1 hour old, etc.
        const maxTickAge = timeframeMinutes * 60 * 1000 + 30000; // Add 30s buffer for clock skew
        const tickAge = now - tickTime;
        if (tickAge > maxTickAge) {
          logger.debug(
            LogCategory.CHART_POLLER,
            `[CandleReconstructor] Rejecting stale tick: ${tickAge / 1000}s old (max: ${maxTickAge / 1000}s)`
          );
          return false;
        }

        // CRITICAL: Reject ticks from the future (clock skew protection)
        if (tickTime > now + 5000) {
          logger.debug(
            LogCategory.CHART_POLLER,
            `[CandleReconstructor] Rejecting future tick: ${(tickTime - now) / 1000}s ahead`
          );
          return false;
        }

        return true;
      });

      if (currentPeriodTicks.length === 0) {
        logger.debug(
          LogCategory.CHART_POLLER,
          `[CandleReconstructor] No ticks in current period after filtering`
        );
        return {
          candle: null,
          tickCount: 0,
          timeRange: null,
          wasReconstructed: false
        };
      }

      logger.debug(
        LogCategory.CHART_POLLER,
        `[CandleReconstructor] ${currentPeriodTicks.length} ticks in current period`
      );

      // Use the existing aggregation function to build the candle
      const reconstructedCandle = aggregatePricesToCurrentCandle(
        currentPeriodTicks as RealtimePrice[],
        timeframe,
        [], // No historical candles needed for reconstruction
        symbol
      );

      if (!reconstructedCandle) {
        logger.debug(
          LogCategory.CHART_POLLER,
          `[CandleReconstructor] Failed to aggregate ticks into candle`
        );
        return {
          candle: null,
          tickCount: currentPeriodTicks.length,
          timeRange: {
            start: new Date(currentPeriodTicks[0].broker_time || currentPeriodTicks[0].created_at),
            end: new Date(currentPeriodTicks[currentPeriodTicks.length - 1].broker_time || currentPeriodTicks[currentPeriodTicks.length - 1].created_at)
          },
          wasReconstructed: false
        };
      }

      // Verify the reconstructed candle is for the current period
      if (reconstructedCandle.time !== currentCandleStartTime) {
        console.warn(
          `[CandleReconstructor] Reconstructed candle time mismatch: ` +
          `expected ${currentCandleStartTime}, got ${reconstructedCandle.time}`
        );
      }

      const firstTick = currentPeriodTicks[0];
      const lastTick = currentPeriodTicks[currentPeriodTicks.length - 1];

      // CRITICAL FIX: Validate candle OHLC values are reasonable
      const candleRange = reconstructedCandle.high - reconstructedCandle.low;
      const candleSize = Math.abs(reconstructedCandle.close - reconstructedCandle.open);
      const wickSize = candleRange - candleSize;

      // Check for abnormal wick-to-body ratio (wick should not be > 10x body)
      if (candleSize > 0 && wickSize / candleSize > 10) {
        logger.warn(
          LogCategory.CHART_POLLER,
          `[CandleReconstructor] ⚠️ ABNORMAL CANDLE detected - excessive wick: body=${candleSize.toFixed(2)}, wick=${wickSize.toFixed(2)} (ratio: ${(wickSize / candleSize).toFixed(1)}x)`
        );
      }

      // Check for extreme candle range (> 5% of typical price indicates bad data)
      const avgPrice = (reconstructedCandle.open + reconstructedCandle.close) / 2;
      const rangePercent = (candleRange / avgPrice) * 100;
      if (rangePercent > 5) {
        logger.error(
          LogCategory.CHART_POLLER,
          `[CandleReconstructor] ❌ REJECTING candle with extreme range: ${rangePercent.toFixed(2)}% (>${5}%)`
        );
        return {
          candle: null,
          tickCount: currentPeriodTicks.length,
          timeRange: {
            start: new Date(firstTick.broker_time || firstTick.created_at),
            end: new Date(lastTick.broker_time || lastTick.created_at)
          },
          wasReconstructed: false
        };
      }

      // ENHANCEMENT: Apply wick reconstruction for better visual quality
      // Uses cached ATR data (no performance hit after first call)
      let finalCandle = reconstructedCandle;

      try {
        const candleWithMetadata = {
          ...reconstructedCandle,
          symbol,
          timeframe,
          open_time: new Date(reconstructedCandle.time * 1000).toISOString()
        };

        const enhanced = await reconstructCandle(candleWithMetadata);

        if (enhanced.reconstructed) {
          // Strip metadata, keep only OHLC
          finalCandle = {
            time: enhanced.time,
            open: enhanced.open,
            high: enhanced.high,
            low: enhanced.low,
            close: enhanced.close,
            volume: enhanced.volume
          };

          logger.debug(
            LogCategory.CHART_POLLER,
            `[CandleReconstructor] Enhanced forming candle with realistic wicks`
          );
        }
      } catch (error) {
        logger.warn(
          LogCategory.CHART_POLLER,
          `[CandleReconstructor] Wick enhancement failed, using original:`,
          error
        );
      }

      logger.debug(
        LogCategory.CHART_POLLER,
        `[CandleReconstructor] ✅ Successfully reconstructed candle:`
      );
      logger.debug(
        LogCategory.CHART_POLLER,
        `  Time: ${new Date(finalCandle.time * 1000).toISOString()}`
      );
      logger.debug(
        LogCategory.CHART_POLLER,
        `  OHLC: ${finalCandle.open.toFixed(5)} / ${finalCandle.high.toFixed(5)} / ${finalCandle.low.toFixed(5)} / ${finalCandle.close.toFixed(5)}`
      );
      logger.debug(
        LogCategory.CHART_POLLER,
        `  Built from ${currentPeriodTicks.length} ticks`
      );

      return {
        candle: finalCandle,
        tickCount: currentPeriodTicks.length,
        timeRange: {
          start: new Date(firstTick.broker_time || firstTick.created_at),
          end: new Date(lastTick.broker_time || lastTick.created_at)
        },
        wasReconstructed: true
      };
    } catch (error) {
      console.error('[CandleReconstructor] Unexpected error:', error);
      return {
        candle: null,
        tickCount: 0,
        timeRange: null,
        wasReconstructed: false
      };
    }
  }

  /**
   * Get the current candle progress percentage
   *
   * @param timeframe - Chart timeframe
   * @returns Progress percentage (0-100)
   */
  getCurrentCandleProgress(timeframe: Timeframe): number {
    const timeframeMinutes = getTimeframeMinutes(timeframe);
    const now = Date.now();
    const currentCandleStartMs = Math.floor(now / (timeframeMinutes * 60 * 1000)) * (timeframeMinutes * 60 * 1000);
    const elapsed = now - currentCandleStartMs;
    const total = timeframeMinutes * 60 * 1000;
    return Math.min((elapsed / total) * 100, 100);
  }
}

export const currentCandleReconstructor = new CurrentCandleReconstructor();
