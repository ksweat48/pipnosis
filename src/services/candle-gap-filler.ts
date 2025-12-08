/**
 * Candle Gap Filler Service
 *
 * Intelligently fills small gaps in candle data for smoother visual continuity.
 * Only fills gaps during market hours, preserves real market gaps.
 */

import { CandleData } from './candle-data-service';
import { getForexMarketStatus } from '@/utils/marketHours';

export interface GapFillerOptions {
  maxGapMinutes: number; // Maximum gap to fill (default: 15 minutes)
  fillWeekendGaps: boolean; // Whether to fill weekend gaps (default: false)
  interpolationMethod: 'linear' | 'last_price' | 'none';
  preserveMajorGaps: boolean; // Don't fill gaps > 0.5% price change
}

class CandleGapFillerService {
  private options: GapFillerOptions = {
    maxGapMinutes: 15,
    fillWeekendGaps: false,
    interpolationMethod: 'last_price',
    preserveMajorGaps: true
  };

  /**
   * Fill gaps in candle data
   */
  fillGaps(candles: CandleData[], timeframeMinutes: number = 5): CandleData[] {
    if (candles.length < 2) return candles;

    const filledCandles: CandleData[] = [];

    for (let i = 0; i < candles.length; i++) {
      const currentCandle = candles[i];
      filledCandles.push(currentCandle);

      if (i < candles.length - 1) {
        const nextCandle = candles[i + 1];
        const syntheticCandles = this.generateSyntheticCandles(
          currentCandle,
          nextCandle,
          timeframeMinutes
        );

        if (syntheticCandles.length > 0) {
          filledCandles.push(...syntheticCandles);
        }
      }
    }

    return filledCandles;
  }

  /**
   * Generate synthetic candles to fill gap between two candles
   */
  private generateSyntheticCandles(
    prevCandle: CandleData,
    nextCandle: CandleData,
    timeframeMinutes: number
  ): CandleData[] {
    const prevTime = this.getTimeInSeconds(prevCandle.time);
    const nextTime = this.getTimeInSeconds(nextCandle.time);
    const expectedGap = timeframeMinutes * 60; // seconds
    const actualGap = nextTime - prevTime;

    // No gap - candles are consecutive
    if (actualGap <= expectedGap * 1.1) { // Allow 10% tolerance
      return [];
    }

    const gapMinutes = actualGap / 60;

    // Gap too large - don't fill
    if (gapMinutes > this.options.maxGapMinutes) {
      return [];
    }

    // Check if gap is during weekend
    const prevDate = new Date(prevTime * 1000);
    const nextDate = new Date(nextTime * 1000);
    if (!this.options.fillWeekendGaps && this.isWeekendGap(prevDate, nextDate)) {
      return [];
    }

    // Check if gap represents major price movement
    if (this.options.preserveMajorGaps) {
      const priceChange = Math.abs(nextCandle.open - prevCandle.close);
      const priceChangePercent = (priceChange / prevCandle.close) * 100;

      if (priceChangePercent > 0.5) {
        // Major price gap - preserve it
        return [];
      }
    }

    // Calculate how many candles to generate
    const missingCandles = Math.floor((actualGap - expectedGap) / expectedGap);

    if (missingCandles <= 0) return [];

    const syntheticCandles: CandleData[] = [];

    for (let i = 1; i <= missingCandles; i++) {
      const candleTime = prevTime + (i * expectedGap);
      const candleDate = new Date(candleTime * 1000);

      // Skip if this time is during market closure
      const marketStatus = getForexMarketStatus(candleDate);
      if (!marketStatus.isOpen) {
        continue;
      }

      const synthetic = this.interpolateCandle(
        prevCandle,
        nextCandle,
        candleTime,
        i,
        missingCandles + 1
      );

      if (synthetic) {
        syntheticCandles.push(synthetic);
      }
    }

    return syntheticCandles;
  }

  /**
   * Interpolate a single candle between two existing candles
   */
  private interpolateCandle(
    prevCandle: CandleData,
    nextCandle: CandleData,
    time: number,
    index: number,
    totalSteps: number
  ): CandleData | null {
    const ratio = index / totalSteps;

    if (this.options.interpolationMethod === 'last_price') {
      // Use the previous candle's close price for all OHLC
      const price = prevCandle.close;

      return {
        time,
        open: price,
        high: price,
        low: price,
        close: price,
        symbol: prevCandle.symbol || 'UNKNOWN',
        timeframe: prevCandle.timeframe || 'M5'
      };
    } else if (this.options.interpolationMethod === 'linear') {
      // Linear interpolation between prev close and next open
      const startPrice = prevCandle.close;
      const endPrice = nextCandle.open;
      const interpolatedPrice = startPrice + (endPrice - startPrice) * ratio;

      // Add small random variation to make it look more natural
      const variation = interpolatedPrice * 0.0001; // 0.01% variation
      const high = interpolatedPrice + variation;
      const low = interpolatedPrice - variation;

      return {
        time,
        open: interpolatedPrice,
        high: Math.max(interpolatedPrice, high),
        low: Math.min(interpolatedPrice, low),
        close: interpolatedPrice,
        symbol: prevCandle.symbol || 'UNKNOWN',
        timeframe: prevCandle.timeframe || 'M5'
      };
    }

    return null;
  }

  /**
   * Check if gap spans weekend closure
   */
  private isWeekendGap(startDate: Date, endDate: Date): boolean {
    const startDay = startDate.getUTCDay();
    const endDay = endDate.getUTCDay();

    // Gap spans from Friday to Sunday/Monday
    if (startDay === 5 && (endDay === 0 || endDay === 1)) {
      return true;
    }

    // Gap includes Saturday
    if (startDay === 6 || endDay === 6) {
      return true;
    }

    // Check if gap duration suggests weekend
    const gapHours = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60);
    if (gapHours > 24) {
      return true;
    }

    return false;
  }

  /**
   * Convert time to seconds (handle both Unix timestamps and Date objects)
   */
  private getTimeInSeconds(time: number | Date | string): number {
    if (typeof time === 'number') {
      return time; // Already in seconds
    }
    if (time instanceof Date) {
      return Math.floor(time.getTime() / 1000);
    }
    if (typeof time === 'string') {
      return Math.floor(new Date(time).getTime() / 1000);
    }
    return 0;
  }

  /**
   * Update gap filler options
   */
  updateOptions(newOptions: Partial<GapFillerOptions>): void {
    this.options = { ...this.options, ...newOptions };
    localStorage.setItem('candle_gap_filler_options', JSON.stringify(this.options));
  }

  /**
   * Get current options
   */
  getOptions(): GapFillerOptions {
    return { ...this.options };
  }

  /**
   * Load options from localStorage
   */
  loadOptions(): void {
    try {
      const stored = localStorage.getItem('candle_gap_filler_options');
      if (stored) {
        this.options = { ...this.options, ...JSON.parse(stored) };
      }
    } catch (error) {
      console.error('[CandleGapFiller] Error loading options:', error);
    }
  }

  /**
   * Get gap filling statistics
   */
  getGapFillingStats(originalCandles: CandleData[], filledCandles: CandleData[]): {
    originalCount: number;
    filledCount: number;
    syntheticCount: number;
    gapsFilled: number;
  } {
    const syntheticCount = filledCandles.length - originalCandles.length;

    // Count actual gaps (not just synthetic candles)
    let gapsFilled = 0;
    let consecutiveSynthetic = 0;

    for (const candle of filledCandles) {
      // This is a simplified check - in reality we'd need to track which candles are synthetic
      if (originalCandles.some(oc =>
        this.getTimeInSeconds(oc.time) === this.getTimeInSeconds(candle.time)
      )) {
        if (consecutiveSynthetic > 0) {
          gapsFilled++;
          consecutiveSynthetic = 0;
        }
      } else {
        consecutiveSynthetic++;
      }
    }

    return {
      originalCount: originalCandles.length,
      filledCount: filledCandles.length,
      syntheticCount,
      gapsFilled
    };
  }

  /**
   * Enable/disable gap filling
   */
  setEnabled(enabled: boolean): void {
    this.options.interpolationMethod = enabled ? 'last_price' : 'none';
  }

  /**
   * Check if gap filling is enabled
   */
  isEnabled(): boolean {
    return this.options.interpolationMethod !== 'none';
  }
}

export const candleGapFillerService = new CandleGapFillerService();
