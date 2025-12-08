import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { CandleData } from '../types/chart';

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
  private static readonly TARGET_CANDLES = 200;
  private static readonly EMERGENCY_LIMIT = 15000; // Increased from 250 to handle historical backfill data
  private static readonly TIMEFRAME_SECONDS: Record<string, number> = {
    'M1': 60,
    'M5': 300,
    'M15': 900,
    'M30': 1800,
    'H1': 3600,
    'H4': 14400,
    'D1': 86400
  };

  static async guaranteeChartData(
    symbol: string,
    timeframe: string,
    targetCount: number = this.TARGET_CANDLES
  ): Promise<GuarantorResult> {
    const startTimeMs = Date.now();

    try {
      logger.info(`[ChartDataGuarantor] Guaranteeing ${targetCount} candles for ${symbol} ${timeframe}`);

      if (targetCount <= 0) {
        throw new Error(`Invalid targetCount: ${targetCount}`);
      }

      if (!this.TIMEFRAME_SECONDS[timeframe]) {
        throw new Error(`Invalid timeframe: ${timeframe}`);
      }

      const endTime = new Date();
      const startTime = this.calculateStartTime(endTime, timeframe, targetCount);

      if (isNaN(startTime.getTime())) {
        throw new Error('Invalid start time calculated');
      }

      if (isNaN(endTime.getTime())) {
        throw new Error('Invalid end time');
      }

      const startTimeISO = startTime.toISOString();
      const endTimeISO = endTime.toISOString();

      logger.info(`[ChartDataGuarantor] Query range: ${startTimeISO} to ${endTimeISO}`);

      // Order by descending to get the NEWEST candles first (fixes issue where
      // browser aggregator creates 500+ candles but we only fetch oldest 250)
      const { data: candles, error } = await supabase
        .from('forex_candles')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .gte('open_time', startTimeISO)
        .lte('open_time', endTimeISO)
        .order('open_time', { ascending: false })  // Get newest first
        .limit(this.EMERGENCY_LIMIT);

      if (error) {
        logger.error('[ChartDataGuarantor] Database error:', error);
        throw error;
      }

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

      // Candles are now in descending order (newest first), so reverse to ascending
      const reversedCandles = [...candles].reverse();
      const validCandles = this.validateCandles(reversedCandles);
      const gapAnalysis = this.detectGaps(validCandles, timeframe);

      const isComplete = validCandles.length >= targetCount && !gapAnalysis.hasWeekdayGaps;

      logger.info(`[ChartDataGuarantor] Retrieved ${validCandles.length} valid candles, target: ${targetCount}, complete: ${isComplete}`);

      // Since we ordered descending and reversed, we now have ascending order
      // Take the last targetCount candles (most recent)
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
    const estimatedSeconds = intervalSeconds * targetCount * safetyMultiplier;
    const startTimeMs = endTime.getTime() - estimatedSeconds * 1000;

    if (isNaN(startTimeMs) || startTimeMs < 0) {
      throw new Error('Calculated start time is invalid');
    }

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

  private static detectGaps(
    candles: CandleData[],
    timeframe: string
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
        const prevDay = prevTime.getUTCDay();
        const currDay = currTime.getUTCDay();

        const isWeekendGap =
          (prevDay === 5 && currDay === 0) ||
          (prevDay === 5 && currDay === 1) ||
          (prevDay === 6 && currDay === 0) ||
          (prevDay === 6 && currDay === 1);

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
      const { data: candles, error } = await supabase
        .from('forex_candles')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .gte('open_time', fromTime)
        .lte('open_time', toTime)
        .order('open_time', { ascending: true });

      if (error) {
        throw error;
      }

      return this.validateCandles(candles || []);

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
    targetCount: number = this.TARGET_CANDLES
  ): Promise<GuarantorResult> {
    logger.info(`[ChartDataGuarantor] Guaranteeing ${targetCount} candles with aggressive backfill for ${symbol} ${timeframe}`);

    let result = await this.guaranteeChartData(symbol, timeframe, targetCount);

    if (result.isComplete && !result.hasGaps) {
      logger.info('[ChartDataGuarantor] Data is complete with no gaps, returning immediately');
      return result;
    }

    if (result.hasGaps && result.gapDetails.length > 0) {
      logger.warn(`[ChartDataGuarantor] Found ${result.gapDetails.length} gaps, attempting to fill...`);

      const gapFillPromises = result.gapDetails.slice(0, 3).map(gap =>
        this.requestGapFill(symbol, timeframe, gap.start, gap.end)
      );

      await Promise.all(gapFillPromises);

      await new Promise(resolve => setTimeout(resolve, 3000));

      result = await this.guaranteeChartData(symbol, timeframe, targetCount);
    }

    if (result.missingCount > targetCount * 0.5) {
      logger.warn(`[ChartDataGuarantor] Still missing ${result.missingCount} candles (>${targetCount * 0.5}), triggering historical backfill`);

      try {
        const response = await fetch('/.netlify/functions/historical-backfill', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            symbol,
            timeframe,
            daysBack: 7
          })
        });

        if (response.ok) {
          logger.info('[ChartDataGuarantor] Historical backfill triggered, waiting for data...');

          await new Promise(resolve => setTimeout(resolve, 5000));

          result = await this.guaranteeChartData(symbol, timeframe, targetCount);
        }
      } catch (error) {
        logger.error('[ChartDataGuarantor] Historical backfill failed:', error);
      }
    }

    return result;
  }

  static calculateSmartCandleCount(timeframe: string): number {
    const counts: Record<string, number> = {
      'M1': 500,    // 8 hours of M1 candles (optimized for chart display)
      'M5': 288,    // 24 hours of M5 candles (optimized for chart display)
      'M15': 672,   // 7 days of M15 candles (optimized for chart display)
      'M30': 720,   // 15 days of M30 candles (optimized for chart display)
      'H1': 720,    // 30 days of H1 candles
      'H4': 720,    // 120 days of H4 candles
      'D1': 365     // 1 year of daily candles
    };

    return counts[timeframe] || 500;
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
