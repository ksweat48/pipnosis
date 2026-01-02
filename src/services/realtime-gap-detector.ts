/**
 * Realtime Gap Detector
 *
 * Detects and fills gaps in candle data synchronously during updates.
 * Runs inline with candle polling (500ms for crypto) - no separate intervals.
 *
 * Gap Filling Strategy (cascading):
 * 1. Realtime prices table (0-5 minute gaps) - instant fill
 * 2. Last known price interpolation (5-15 minute gaps) - synthetic fill
 * 3. Defer to backend filler (15+ minute gaps) - logged for repair
 *
 * Performance: <10ms per gap detection cycle
 */

import { supabase } from '@/lib/supabase';
import { CandleData } from '@/services/candle-data-service';
import { Timeframe, appTimeframeToDb } from '@/services/chart-preferences';
import { getTimeframeMinutes } from '@/services/candle-data-service';
import { logger, LogCategory } from '@/lib/logger';

interface GapInfo {
  startTime: number;
  endTime: number;
  expectedCandles: number;
  missingCount: number;
  gapMinutes: number;
}

interface GapFillResult {
  filled: boolean;
  syntheticCandles: CandleData[];
  method: 'realtime_prices' | 'interpolation' | 'deferred';
  gapInfo: GapInfo;
}

class RealtimeGapDetector {
  private readonly MAX_PROCESSING_TIME_MS = 10;
  private readonly MAX_SCAN_CANDLES = 50;

  /**
   * Detect gaps in candle array (synchronized with polling)
   * Performance: O(n) single pass, ~5ms for 50 candles
   */
  detectGaps(candles: CandleData[], timeframe: Timeframe): GapInfo[] {
    if (candles.length < 2) return [];

    const gaps: GapInfo[] = [];
    const intervalSeconds = getTimeframeMinutes(timeframe) * 60;

    // Scan last N candles only (performance optimization)
    const scanStart = Math.max(0, candles.length - this.MAX_SCAN_CANDLES);
    const candlesToScan = candles.slice(scanStart);

    for (let i = 1; i < candlesToScan.length; i++) {
      const prevCandle = candlesToScan[i - 1];
      const currentCandle = candlesToScan[i];

      const expectedNextTime = prevCandle.time + intervalSeconds;
      const actualGap = currentCandle.time - prevCandle.time;

      // Gap detected
      if (actualGap > intervalSeconds) {
        const missingCandles = Math.floor(actualGap / intervalSeconds) - 1;
        const gapMinutes = actualGap / 60;

        gaps.push({
          startTime: prevCandle.time,
          endTime: currentCandle.time,
          expectedCandles: missingCandles + 2,
          missingCount: missingCandles,
          gapMinutes
        });

        logger.debug(LogCategory.CHART_POLLER,
          `Gap detected: ${missingCandles} missing candles (${gapMinutes.toFixed(1)}min gap)`
        );
      }
    }

    return gaps;
  }

  /**
   * Fill gaps using cascading strategy
   * Returns synthetic candles that should be inserted
   */
  async fillGaps(
    gaps: GapInfo[],
    symbol: string,
    timeframe: Timeframe,
    lastKnownPrice: number
  ): Promise<CandleData[]> {
    const startTime = Date.now();
    const syntheticCandles: CandleData[] = [];

    for (const gap of gaps) {
      // Check time budget
      if (Date.now() - startTime > this.MAX_PROCESSING_TIME_MS) {
        logger.warn(LogCategory.CHART_POLLER, 'Gap filling exceeded time budget, deferring remaining gaps');
        break;
      }

      // Strategy 1: Use realtime prices (0-5 minute gaps)
      if (gap.gapMinutes <= 5) {
        const filled = await this.fillFromRealtimePrices(gap, symbol, timeframe);
        if (filled.length > 0) {
          syntheticCandles.push(...filled);
          logger.debug(LogCategory.CHART_POLLER, `Filled ${filled.length} candles from realtime prices`);
          continue;
        }
      }

      // Strategy 2: Interpolate from last known price (5-15 minute gaps)
      if (gap.gapMinutes <= 15) {
        const filled = this.fillByInterpolation(gap, symbol, timeframe, lastKnownPrice);
        syntheticCandles.push(...filled);
        logger.debug(LogCategory.CHART_POLLER, `Filled ${filled.length} candles by interpolation`);
        continue;
      }

      // Strategy 3: Defer to backend (15+ minute gaps)
      logger.warn(LogCategory.CHART_POLLER,
        `Large gap detected (${gap.gapMinutes.toFixed(1)}min), deferring to backend filler`
      );
      this.logGapForBackendRepair(gap, symbol, timeframe);
    }

    return syntheticCandles;
  }

  /**
   * Fill gaps using realtime_prices table
   * Fast path for recent gaps (0-5 minutes)
   */
  private async fillFromRealtimePrices(
    gap: GapInfo,
    symbol: string,
    timeframe: Timeframe
  ): Promise<CandleData[]> {
    try {
      const intervalMs = getTimeframeMinutes(timeframe) * 60 * 1000;
      const syntheticCandles: CandleData[] = [];

      // Fetch prices for the gap period
      const { data: prices, error } = await supabase
        .from('realtime_prices')
        .select('bid, ask, broker_time, created_at')
        .eq('symbol', symbol)
        .gte('broker_time', new Date(gap.startTime * 1000).toISOString())
        .lt('broker_time', new Date(gap.endTime * 1000).toISOString())
        .order('broker_time', { ascending: true })
        .limit(1000);

      if (error || !prices || prices.length === 0) {
        return [];
      }

      // Group prices by candle period
      const pricesByPeriod = new Map<number, any[]>();

      prices.forEach(price => {
        const priceTime = new Date(price.broker_time || price.created_at).getTime();
        const candleTime = Math.floor(priceTime / intervalMs) * intervalMs / 1000;

        if (!pricesByPeriod.has(candleTime)) {
          pricesByPeriod.set(candleTime, []);
        }
        pricesByPeriod.get(candleTime)!.push(price);
      });

      // Create synthetic candles from grouped prices
      for (const [candleTime, periodPrices] of pricesByPeriod) {
        const midPrices = periodPrices.map(p => (p.bid + p.ask) / 2);

        syntheticCandles.push({
          time: candleTime,
          open: midPrices[0],
          high: Math.max(...midPrices),
          low: Math.min(...midPrices),
          close: midPrices[midPrices.length - 1],
          volume: periodPrices.length
        });
      }

      return syntheticCandles;
    } catch (error) {
      logger.error(LogCategory.CHART_POLLER, 'Error filling from realtime prices:', error);
      return [];
    }
  }

  /**
   * Fill gaps by interpolating from last known price
   * Fallback for medium gaps (5-15 minutes) when no tick data available
   */
  private fillByInterpolation(
    gap: GapInfo,
    symbol: string,
    timeframe: Timeframe,
    lastKnownPrice: number
  ): CandleData[] {
    const syntheticCandles: CandleData[] = [];
    const intervalSeconds = getTimeframeMinutes(timeframe) * 60;

    // Create flat candles at last known price
    // These will be enhanced with realistic wicks by wick-reconstruction-service
    let currentTime = gap.startTime + intervalSeconds;

    while (currentTime < gap.endTime) {
      syntheticCandles.push({
        time: currentTime,
        open: lastKnownPrice,
        high: lastKnownPrice,
        low: lastKnownPrice,
        close: lastKnownPrice,
        volume: 0
      });

      currentTime += intervalSeconds;
    }

    return syntheticCandles;
  }

  /**
   * Log gap for backend repair (async processing)
   * Large gaps are handled by scheduled backend job
   */
  private logGapForBackendRepair(gap: GapInfo, symbol: string, timeframe: Timeframe): void {
    // Send to gap monitoring service (fire and forget)
    supabase
      .from('gap_monitoring_logs')
      .insert({
        symbol,
        timeframe: appTimeframeToDb(timeframe),
        gap_start: new Date(gap.startTime * 1000).toISOString(),
        gap_end: new Date(gap.endTime * 1000).toISOString(),
        missing_candles: gap.missingCount,
        gap_minutes: gap.gapMinutes,
        detection_source: 'realtime_gap_detector',
        detected_at: new Date().toISOString()
      })
      .then(({ error }) => {
        if (error) {
          logger.error(LogCategory.CHART_POLLER, 'Error logging gap:', error);
        }
      });
  }

  /**
   * Quick check if candles have any gaps
   * Ultra-fast for happy path (no gaps)
   */
  hasGaps(candles: CandleData[], timeframe: Timeframe): boolean {
    if (candles.length < 2) return false;

    const intervalSeconds = getTimeframeMinutes(timeframe) * 60;
    const scanStart = Math.max(0, candles.length - this.MAX_SCAN_CANDLES);

    for (let i = scanStart + 1; i < candles.length; i++) {
      const gap = candles[i].time - candles[i - 1].time;
      if (gap > intervalSeconds) {
        return true;
      }
    }

    return false;
  }

  /**
   * Insert synthetic candles into existing array (maintains sort order)
   */
  mergeSyntheticCandles(
    existing: CandleData[],
    synthetic: CandleData[]
  ): CandleData[] {
    if (synthetic.length === 0) return existing;

    // Combine and deduplicate by time
    const candleMap = new Map<number, CandleData>();

    // Add existing candles (they take precedence)
    existing.forEach(candle => {
      candleMap.set(candle.time, candle);
    });

    // Add synthetic candles (only if time slot is empty)
    synthetic.forEach(candle => {
      if (!candleMap.has(candle.time)) {
        candleMap.set(candle.time, candle);
      }
    });

    // Sort by time
    return Array.from(candleMap.values()).sort((a, b) => a.time - b.time);
  }

  /**
   * Get gap statistics for monitoring
   */
  getGapStats(gaps: GapInfo[]): {
    totalGaps: number;
    totalMissingCandles: number;
    smallGaps: number;
    mediumGaps: number;
    largeGaps: number;
  } {
    return {
      totalGaps: gaps.length,
      totalMissingCandles: gaps.reduce((sum, g) => sum + g.missingCount, 0),
      smallGaps: gaps.filter(g => g.gapMinutes <= 5).length,
      mediumGaps: gaps.filter(g => g.gapMinutes > 5 && g.gapMinutes <= 15).length,
      largeGaps: gaps.filter(g => g.gapMinutes > 15).length
    };
  }
}

export const realtimeGapDetector = new RealtimeGapDetector();
