import { logger } from '../lib/logger';
import { CandleData } from '../types/chart';
import { databaseResilienceWrapper } from './database-resilience-wrapper';
import { shouldDisableMetaAPI } from '../lib/environment';
import { marketDataService } from './market-data-service';
import { TIME_MS } from '../config/time-constants';

interface DatabaseCandleRecord {
  id: string;
  symbol: string;
  timeframe: string;
  open_time: string;
  close_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  data_source?: string;
}

export interface GuarantorResult {
  candles: CandleData[];
  isComplete: boolean;
  missingCount: number;
  hasGaps: boolean;
  gapDetails: Array<{ start: string; end: string; count: number }>;
  loadTime: number;
}

export class ChartDataGuarantor {
  // CCIP-BROKER-CLOCK-SKEW-2026-04-13: Value is governed in TIME_MS.BROKER.CLOCK_SKEW_MS (time-constants.ts).
  // Do not redefine this constant anywhere else. All candle query upper bounds must use this offset.
  private static readonly BROKER_CLOCK_SKEW_MS = TIME_MS.BROKER.CLOCK_SKEW_MS;
  private static readonly EMERGENCY_LIMIT = 15000;
  private static readonly DEV_EMERGENCY_LIMIT = 100;

  private static readonly TIMEFRAME_SECONDS: Record<string, number> = {
    'M1': 60,
    'M5': 300,
    'M15': 900,
    'M30': 1800,
    'H1': 3600,
    'H4': 14400,
    'D1': 86400
  };

  /**
   * SSOT: Single authoritative candle count per timeframe.
   * Used by both guaranteeChartData (chart display) and ensureMinimumDataset (data health checks).
   *
   * CCIP-FIX-M5-WEEKEND-2026-02-23:
   * Counts are set to ensure the time window produced by calculateStartTime() always
   * exceeds the 48-hour forex weekend gap for every timeframe. See calculateStartTime()
   * for the minimum window enforcement logic.
   */
  private static readonly CANDLE_COUNTS: Record<string, number> = {
    'M1': 500,
    'M5': 300,
    'M15': 672,
    'M30': 720,
    'H1': 720,
    'H4': 720,
    'D1': 500
  };

  /**
   * SSOT: Per-timeframe minimum lookback window in hours.
   *
   * CCIP-FIX-M5-WEEKEND-2026-02-23 — Root cause analysis:
   * The forex weekend gap is ~48 hours (Fri ~22:00 UTC to Sun ~22:00 UTC).
   * With the previous flat safetyMultiplier of 2.5:
   *   M1  window = 60s  × 500 × 2.5 = 75,000s  = 20.8h  → BELOW 48h gap → blank chart on Monday
   *   M5  window = 300s × 200 × 2.5 = 150,000s = 41.7h  → BELOW 48h gap → blank chart on Monday
   *   M15 window = 900s × 672 × 2.5 = 1,512,000s = 420h → above gap (safe)
   *
   * Fix: enforce a hard minimum window of 72 hours for all timeframes. 72h = 48h weekend
   * gap + 24h trading buffer. Higher timeframes already exceed this naturally.
   * The effective window = max(intervalSeconds × count × 2.5, MIN_WINDOW_HOURS × 3600).
   */
  private static readonly MIN_WINDOW_HOURS: Record<string, number> = {
    'M1': 72,
    'M5': 72,
    'M15': 72,
    'M30': 72,
    'H1': 240,   // 10 days — ensures 240+ H1 candles across weekends
    'H4': 720,   // 30 days — ensures 180 H4 candles
    'D1': 8760   // 365 days — ensures full year of D1 candles
  };

  static async guaranteeChartData(
    symbol: string,
    timeframe: string,
    targetCount: number = this.CANDLE_COUNTS[timeframe] ?? 300
  ): Promise<GuarantorResult> {
    const startTimeMs = Date.now();
    const isDevEnvironment = shouldDisableMetaAPI();

    try {
      logger.info(`[ChartDataGuarantor] Guaranteeing ${targetCount} candles for ${symbol} ${timeframe} (${isDevEnvironment ? 'DEV' : 'PROD'} mode)`);

      if (targetCount <= 0) {
        throw new Error(`Invalid targetCount: ${targetCount}`);
      }

      if (!this.TIMEFRAME_SECONDS[timeframe]) {
        throw new Error(`Invalid timeframe: ${timeframe}`);
      }

      const now = new Date();
      const endTime = new Date(now.getTime() + this.BROKER_CLOCK_SKEW_MS);
      const startTime = this.calculateStartTime(now, timeframe, targetCount);

      if (isNaN(startTime.getTime())) {
        throw new Error('Invalid start time calculated');
      }

      if (isNaN(endTime.getTime())) {
        throw new Error('Invalid end time');
      }

      const startTimeISO = startTime.toISOString();
      const endTimeISO = endTime.toISOString();

      logger.info(`[ChartDataGuarantor] Query range: ${startTimeISO} to ${endTimeISO}`);

      const queryLimit = isDevEnvironment ? this.DEV_EMERGENCY_LIMIT : this.EMERGENCY_LIMIT;
      const cacheDuration = isDevEnvironment ? 60000 : 30000;

      logger.info(`[ChartDataGuarantor] Query limit: ${queryLimit}, cache: ${cacheDuration}ms`);

      const candles = await databaseResilienceWrapper.query(
        () => marketDataService.getQualityCandlesInRange(
          symbol,
          timeframe,
          startTime,
          endTime,
          false,
          queryLimit
        ),
        {
          cacheKey: `chart-guarantor:${symbol}:${timeframe}:${startTimeISO}`,
          cacheDuration: cacheDuration,
        }
      );

      if (!candles || candles.length === 0) {
        logger.warn('[ChartDataGuarantor] No candles found');
        return {
          candles: [],
          isComplete: false,
          missingCount: targetCount,
          hasGaps: false,
          gapDetails: [],
          loadTime: Date.now() - startTimeMs
        };
      }

      const reversedCandles = [...candles].reverse();
      const validCandles = this.validateCandles(reversedCandles);
      const gapAnalysis = this.detectGaps(validCandles, timeframe, symbol);

      const isComplete = validCandles.length >= targetCount && !gapAnalysis.hasWeekdayGaps;

      logger.info(`[ChartDataGuarantor] Retrieved ${validCandles.length} valid candles, target: ${targetCount}, complete: ${isComplete}`);

      return {
        candles: validCandles.slice(-targetCount),
        isComplete,
        missingCount: Math.max(0, targetCount - validCandles.length),
        hasGaps: gapAnalysis.hasWeekdayGaps,
        gapDetails: gapAnalysis.gaps,
        loadTime: Date.now() - startTimeMs
      };

    } catch (error) {
      logger.error('[ChartDataGuarantor] Error:', error);
      throw error;
    }
  }

  /**
   * SSOT authority for chart query start time calculation.
   *
   * CCIP-FIX-M5-WEEKEND-2026-02-23:
   * Uses max(rawWindow, minWindowHours) to guarantee the query always bridges
   * the forex weekend gap for short-interval timeframes (M1, M5).
   *
   * Math proof for M5 fix:
   *   Raw window:  300s × 300 × 2.5 = 225,000s = 62.5h  (now exceeds 48h gap)
   *   Min floor:   72h = 259,200s
   *   Effective:   max(62.5h, 72h) = 72h  ✓ always bridges the weekend
   *
   * Math proof for M1 fix:
   *   Raw window:  60s × 500 × 2.5 = 75,000s = 20.8h   (BELOW 48h gap)
   *   Min floor:   72h = 259,200s
   *   Effective:   max(20.8h, 72h) = 72h  ✓ always bridges the weekend
   */
  private static calculateStartTime(
    endTime: Date,
    timeframe: string,
    targetCount: number
  ): Date {
    if (isNaN(endTime.getTime())) {
      throw new Error('Invalid endTime provided to calculateStartTime');
    }

    if (targetCount <= 0) {
      throw new Error(`Invalid targetCount: ${targetCount}`);
    }

    const intervalSeconds = this.TIMEFRAME_SECONDS[timeframe];
    if (!intervalSeconds) {
      throw new Error(`Unknown timeframe: ${timeframe}`);
    }

    const safetyMultiplier = 2.5;
    const rawWindowSeconds = intervalSeconds * targetCount * safetyMultiplier;

    const minWindowHours = this.MIN_WINDOW_HOURS[timeframe] ?? 72;
    const minWindowSeconds = minWindowHours * 3600;

    const effectiveWindowSeconds = Math.max(rawWindowSeconds, minWindowSeconds);
    const startTimeMs = endTime.getTime() - effectiveWindowSeconds * 1000;

    if (isNaN(startTimeMs) || startTimeMs < 0) {
      throw new Error('Calculated start time is invalid');
    }

    logger.info(
      `[ChartDataGuarantor] ${timeframe} window: raw=${(rawWindowSeconds / 3600).toFixed(1)}h, ` +
      `floor=${minWindowHours}h, effective=${(effectiveWindowSeconds / 3600).toFixed(1)}h`
    );

    return new Date(startTimeMs);
  }

  private static validateCandles(candles: any[]): CandleData[] {
    const transformed: CandleData[] = [];
    let conversionFailures = 0;

    for (const dbCandle of candles) {
      if (!dbCandle.open || !dbCandle.high || !dbCandle.low || !dbCandle.close) {
        continue;
      }

      if (dbCandle.high < dbCandle.low) {
        continue;
      }

      if (dbCandle.high < dbCandle.open || dbCandle.high < dbCandle.close) {
        continue;
      }

      if (dbCandle.low > dbCandle.open || dbCandle.low > dbCandle.close) {
        continue;
      }

      const timeInSeconds = new Date(dbCandle.open_time).getTime() / 1000;

      if (isNaN(timeInSeconds) || !isFinite(timeInSeconds)) {
        conversionFailures++;
        logger.warn('[ChartDataGuarantor] Failed to convert open_time to timestamp:', dbCandle.open_time);
        continue;
      }

      transformed.push({
        time: timeInSeconds,
        open: Number(dbCandle.open),
        high: Number(dbCandle.high),
        low: Number(dbCandle.low),
        close: Number(dbCandle.close),
        volume: dbCandle.volume ? Number(dbCandle.volume) : 0
      });
    }

    if (conversionFailures > 0) {
      logger.warn(`[ChartDataGuarantor] Failed to convert ${conversionFailures} candles`);
    }

    if (transformed.length > 0) {
      logger.info(`[ChartDataGuarantor] Transformed ${transformed.length} candles. Sample:`, {
        firstCandle: {
          time: transformed[0].time,
          timeAsDate: new Date(transformed[0].time * 1000).toISOString(),
          open: transformed[0].open
        }
      });
    }

    return transformed;
  }

  private static isForexWeekendGap(prevTime: Date, currTime: Date): boolean {
    const prevDay = prevTime.getUTCDay();
    const currDay = currTime.getUTCDay();
    // Any gap that bridges Friday→Saturday, Friday→Sunday, Friday→Monday,
    // Saturday→Sunday, Saturday→Monday, or Sunday→Monday is a weekend gap for forex.
    const weekendDays = new Set([0, 6]); // Sunday=0, Saturday=6
    if (weekendDays.has(prevDay) || weekendDays.has(currDay)) return true;
    // Friday close (>=17:00 EST) to Monday open — treat entire Fri-Mon span as weekend
    if (prevDay === 5 && currDay === 1) return true;
    return false;
  }

  private static detectGaps(
    candles: CandleData[],
    timeframe: string,
    symbol?: string
  ): { hasWeekdayGaps: boolean; gaps: Array<{ start: string; end: string; count: number }> } {
    if (candles.length < 2) {
      return { hasWeekdayGaps: false, gaps: [] };
    }

    const intervalSeconds = this.TIMEFRAME_SECONDS[timeframe];
    if (!intervalSeconds) {
      logger.warn(`[ChartDataGuarantor] Unknown timeframe for gap detection: ${timeframe}`);
      return { hasWeekdayGaps: false, gaps: [] };
    }

    const expectedIntervalMs = intervalSeconds * 1000;
    const gapThreshold = expectedIntervalMs * 1.5;
    const gaps: Array<{ start: string; end: string; count: number }> = [];
    let hasWeekdayGaps = false;

    for (let i = 1; i < candles.length; i++) {
      const prevTime = new Date(candles[i - 1].time * 1000);
      const currTime = new Date(candles[i].time * 1000);

      if (isNaN(prevTime.getTime()) || isNaN(currTime.getTime())) {
        logger.warn('[ChartDataGuarantor] Invalid date in gap detection, skipping');
        continue;
      }

      const timeDiff = currTime.getTime() - prevTime.getTime();

      if (timeDiff > gapThreshold) {
        const isWeekendGap = this.isForexWeekendGap(prevTime, currTime);

        if (!isWeekendGap) {
          hasWeekdayGaps = true;
          const missingCandles = Math.floor(timeDiff / expectedIntervalMs) - 1;
          gaps.push({
            start: prevTime.toISOString(),
            end: currTime.toISOString(),
            count: missingCandles
          });
        }
      }
    }

    return { hasWeekdayGaps, gaps };
  }

  static async fetchIncrementalData(
    symbol: string,
    timeframe: string,
    fromTime: string,
    toTime: string
  ): Promise<CandleData[]> {
    try {
      const startTime = new Date(fromTime);
      const endTime = new Date(toTime);

      const candles = await marketDataService.getCandlesInRange(
        symbol,
        timeframe,
        startTime,
        endTime,
        true
      );

      return this.validateCandles(candles);

    } catch (error) {
      logger.error('[ChartDataGuarantor] Incremental fetch error:', error);
      throw error;
    }
  }

  static async requestGapFill(
    symbol: string,
    timeframe: string,
    startTime: string,
    endTime: string
  ): Promise<void> {
    try {
      logger.info(`[ChartDataGuarantor] Requesting gap fill for ${symbol} ${timeframe}`, {
        startTime,
        endTime
      });

      const response = await fetch('/.netlify/functions/automatic-gap-filler', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol,
          timeframe,
          startTime,
          endTime,
          priority: 'high'
        })
      });

      if (!response.ok) {
        throw new Error(`Gap fill request failed: ${response.status}`);
      }

      logger.info('[ChartDataGuarantor] Gap fill request submitted');

    } catch (error) {
      logger.error('[ChartDataGuarantor] Gap fill request error:', error);
    }
  }

  static async guaranteeChartDataWithBackfill(
    symbol: string,
    timeframe: string,
    targetCount: number = this.CANDLE_COUNTS[timeframe] ?? 300
  ): Promise<GuarantorResult> {
    return await this.guaranteeChartData(symbol, timeframe, targetCount);
  }

  /**
   * SSOT: Returns the authoritative candle count for a given timeframe.
   * Single source of truth used by both the chart display and data health checks.
   * Do not define candle counts anywhere else.
   */
  static calculateSmartCandleCount(timeframe: string): number {
    return this.CANDLE_COUNTS[timeframe] ?? 300;
  }

  static async ensureMinimumDataset(
    symbol: string,
    timeframe: string
  ): Promise<boolean> {
    try {
      const minCandles = this.calculateSmartCandleCount(timeframe);
      const result = await this.guaranteeChartData(symbol, timeframe, minCandles);

      if (result.isComplete) {
        logger.info(`[ChartDataGuarantor] Dataset is complete for ${symbol} ${timeframe}`);
        return true;
      }

      if (result.hasGaps && result.gapDetails.length > 0) {
        logger.warn(`[ChartDataGuarantor] Detected ${result.gapDetails.length} gaps`);

        for (const gap of result.gapDetails) {
          await this.requestGapFill(symbol, timeframe, gap.start, gap.end);
        }
      }

      if (result.missingCount > 0) {
        logger.warn(`[ChartDataGuarantor] Missing ${result.missingCount} candles`);
      }

      return false;

    } catch (error) {
      logger.error('[ChartDataGuarantor] Error ensuring minimum dataset:', error);
      return false;
    }
  }
}
