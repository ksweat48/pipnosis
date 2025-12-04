import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

export interface CandleData {
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
  data_source: string;
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
  private static readonly EMERGENCY_LIMIT = 250;
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
    const startTime = Date.now();

    try {
      logger.info(`[ChartDataGuarantor] Guaranteeing ${targetCount} candles for ${symbol} ${timeframe}`);

      const endTime = new Date();
      const startTime = this.calculateStartTime(endTime, timeframe, targetCount);

      const { data: candles, error } = await supabase
        .from('forex_candles')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .gte('open_time', startTime.toISOString())
        .lte('open_time', endTime.toISOString())
        .order('open_time', { ascending: true })
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
          loadTime: Date.now() - startTime
        };
      }

      const validCandles = this.validateCandles(candles);
      const gapAnalysis = this.detectGaps(validCandles, timeframe);

      const isComplete = validCandles.length >= targetCount && !gapAnalysis.hasWeekdayGaps;

      logger.info(`[ChartDataGuarantor] Retrieved ${validCandles.length} valid candles, target: ${targetCount}, complete: ${isComplete}`);

      return {
        candles: validCandles.slice(-targetCount),
        isComplete,
        missingCount: Math.max(0, targetCount - validCandles.length),
        hasGaps: gapAnalysis.hasWeekdayGaps,
        gapDetails: gapAnalysis.gaps,
        loadTime: Date.now() - startTime
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
    const intervalSeconds = this.TIMEFRAME_SECONDS[timeframe] || 3600;

    const safetyMultiplier = 2.5;
    const estimatedSeconds = intervalSeconds * targetCount * safetyMultiplier;

    return new Date(endTime.getTime() - estimatedSeconds * 1000);
  }

  private static validateCandles(candles: any[]): CandleData[] {
    return candles.filter(candle => {
      if (!candle.open || !candle.high || !candle.low || !candle.close) {
        return false;
      }

      if (candle.high < candle.low) {
        return false;
      }

      if (candle.high < candle.open || candle.high < candle.close) {
        return false;
      }

      if (candle.low > candle.open || candle.low > candle.close) {
        return false;
      }

      return true;
    });
  }

  private static detectGaps(
    candles: CandleData[],
    timeframe: string
  ): { hasWeekdayGaps: boolean; gaps: Array<{ start: string; end: string; count: number }> } {
    if (candles.length < 2) {
      return { hasWeekdayGaps: false, gaps: [] };
    }

    const intervalSeconds = this.TIMEFRAME_SECONDS[timeframe] || 3600;
    const expectedIntervalMs = intervalSeconds * 1000;
    const gapThreshold = expectedIntervalMs * 1.5;

    const gaps: Array<{ start: string; end: string; count: number }> = [];
    let hasWeekdayGaps = false;

    for (let i = 1; i < candles.length; i++) {
      const prevTime = new Date(candles[i - 1].open_time);
      const currTime = new Date(candles[i].open_time);
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

      const response = await fetch('/.netlify/functions/fill-candle-gaps', {
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

  static calculateSmartCandleCount(timeframe: string): number {
    const counts: Record<string, number> = {
      'M1': 240,
      'M5': 200,
      'M15': 200,
      'M30': 200,
      'H1': 168,
      'H4': 168,
      'D1': 90
    };

    return counts[timeframe] || 200;
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
