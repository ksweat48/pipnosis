/**
 * Candle Quality Validator
 *
 * Validates that database candles are real, high-quality data
 * suitable for trading decisions (not synthetic/gap-filled).
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { normalizeTimeframe } from '@/utils/timeframeNormalizer';

export interface CandleQualityMetrics {
  totalCandles: number;
  validCandles: number;
  dojiCount: number;
  gapCount: number;
  avgBodySize: number;
  avgRange: number;
  qualityScore: number; // 0-100
  isAcceptable: boolean;
  reason?: string;
}

export interface CandleQualityCheck {
  isValid: boolean;
  metrics: CandleQualityMetrics;
  reason?: string;
}

const MIN_QUALITY_SCORE = 60; // Minimum acceptable quality (60%)
const MIN_VALID_CANDLES = 5; // Need at least 5 non-DOJI candles
const MAX_GAP_TOLERANCE_MS = 600000; // 10 minutes (2x M5 candle)
const MIN_BODY_SIZE_THRESHOLD = 0.001; // Minimum body size to not be considered DOJI

class CandleQualityValidator {
  /**
   * Validate candle data quality for trading decisions
   */
  async validateCandleQuality(
    symbol: string,
    timeframe: string,
    lookback: number = 10
  ): Promise<CandleQualityCheck> {
    try {
      const dbTimeframe = normalizeTimeframe(timeframe, 'metatrader');

      const { data: candles, error } = await supabase
        .from('forex_candles')
        .select('open, high, low, close, open_time, volume')
        .eq('symbol', symbol)
        .eq('timeframe', dbTimeframe)
        .order('open_time', { ascending: false })
        .limit(lookback);

      if (error || !candles || candles.length === 0) {
        return {
          isValid: false,
          metrics: this.getEmptyMetrics(),
          reason: `No candle data found for ${symbol} ${timeframe}`
        };
      }

      const metrics = this.calculateQualityMetrics(candles, timeframe);

      // Determine if quality is acceptable
      const isAcceptable = this.isQualityAcceptable(metrics);

      return {
        isValid: isAcceptable,
        metrics,
        reason: isAcceptable ? undefined : metrics.reason
      };
    } catch (error) {
      logger.error('[CandleQualityValidator] Validation error:', error);
      return {
        isValid: false,
        metrics: this.getEmptyMetrics(),
        reason: 'Failed to validate candle quality'
      };
    }
  }

  /**
   * Calculate quality metrics from candle data
   */
  private calculateQualityMetrics(
    candles: any[],
    timeframe: string
  ): CandleQualityMetrics {
    const totalCandles = candles.length;
    let dojiCount = 0;
    let validCandles = 0;
    let gapCount = 0;
    let totalBodySize = 0;
    let totalRange = 0;

    // Check each candle
    for (let i = 0; i < candles.length; i++) {
      const candle = candles[i];
      const bodySize = Math.abs(candle.close - candle.open);
      const range = candle.high - candle.low;

      totalBodySize += bodySize;
      totalRange += range;

      // Check if it's a DOJI (no meaningful body)
      if (range > 0 && bodySize / range < MIN_BODY_SIZE_THRESHOLD) {
        dojiCount++;
      } else if (bodySize > 0) {
        validCandles++;
      }

      // Check for time gaps (except for first candle)
      if (i < candles.length - 1) {
        const currentTime = new Date(candles[i].open_time).getTime();
        const previousTime = new Date(candles[i + 1].open_time).getTime();
        const expectedGap = this.getExpectedCandleGap(timeframe);
        const actualGap = currentTime - previousTime;

        if (Math.abs(actualGap - expectedGap) > MAX_GAP_TOLERANCE_MS) {
          gapCount++;
        }
      }
    }

    const avgBodySize = totalBodySize / totalCandles;
    const avgRange = totalRange / totalCandles;

    // Calculate quality score (0-100)
    const validRatio = validCandles / totalCandles;
    const dojiPenalty = (dojiCount / totalCandles) * 30;
    const gapPenalty = (gapCount / Math.max(totalCandles - 1, 1)) * 40;
    const qualityScore = Math.max(0, Math.min(100,
      (validRatio * 100) - dojiPenalty - gapPenalty
    ));

    // Determine reason if quality is poor
    let reason: string | undefined;
    if (validCandles < MIN_VALID_CANDLES) {
      reason = `Only ${validCandles} valid candles found (need ${MIN_VALID_CANDLES})`;
    } else if (dojiCount > totalCandles * 0.5) {
      reason = `Too many DOJI candles (${dojiCount}/${totalCandles}) - data may be synthetic`;
    } else if (gapCount > totalCandles * 0.3) {
      reason = `Too many time gaps (${gapCount}) - data collection may be interrupted`;
    } else if (qualityScore < MIN_QUALITY_SCORE) {
      reason = `Quality score too low (${qualityScore.toFixed(0)}% < ${MIN_QUALITY_SCORE}%)`;
    }

    return {
      totalCandles,
      validCandles,
      dojiCount,
      gapCount,
      avgBodySize,
      avgRange,
      qualityScore,
      isAcceptable: qualityScore >= MIN_QUALITY_SCORE && validCandles >= MIN_VALID_CANDLES,
      reason
    };
  }

  /**
   * Check if quality metrics are acceptable for trading
   */
  private isQualityAcceptable(metrics: CandleQualityMetrics): boolean {
    return metrics.isAcceptable;
  }

  /**
   * Get expected time gap between candles based on timeframe
   */
  private getExpectedCandleGap(timeframe: string): number {
    const timeframeMap: Record<string, number> = {
      'M1': 60000,      // 1 minute
      'M5': 300000,     // 5 minutes
      'M15': 900000,    // 15 minutes
      'M30': 1800000,   // 30 minutes
      'H1': 3600000,    // 1 hour
      'H4': 14400000,   // 4 hours
      'D1': 86400000    // 1 day
    };

    return timeframeMap[timeframe] || 300000; // Default to 5 minutes
  }

  /**
   * Get empty metrics for error cases
   */
  private getEmptyMetrics(): CandleQualityMetrics {
    return {
      totalCandles: 0,
      validCandles: 0,
      dojiCount: 0,
      gapCount: 0,
      avgBodySize: 0,
      avgRange: 0,
      qualityScore: 0,
      isAcceptable: false,
      reason: 'No data available'
    };
  }

  /**
   * Check if WebSocket is connected and receiving ticks (for crypto pairs)
   */
  async checkWebSocketHealth(symbol: string): Promise<boolean> {
    // Check if this is a crypto symbol
    const cryptoSymbols = ['BTCUSD', 'ETHUSD'];
    if (!cryptoSymbols.includes(symbol)) {
      return true; // Not crypto, WebSocket not required
    }

    try {
      // Check if we've received recent price updates (within last 60 seconds)
      const { data: recentPrice, error } = await supabase
        .from('realtime_prices')
        .select('updated_at')
        .eq('symbol', symbol)
        .maybeSingle();

      if (error || !recentPrice) {
        logger.warn(`[CandleQualityValidator] No recent price data for ${symbol}`);
        return false;
      }

      const lastUpdate = new Date(recentPrice.updated_at).getTime();
      const now = Date.now();
      const ageMs = now - lastUpdate;

      // Consider WebSocket healthy if data is less than 60 seconds old
      const isHealthy = ageMs < 60000;

      if (!isHealthy) {
        logger.warn(
          `[CandleQualityValidator] Stale WebSocket data for ${symbol}: ` +
          `${(ageMs / 1000).toFixed(0)}s old`
        );
      }

      return isHealthy;
    } catch (error) {
      logger.error('[CandleQualityValidator] WebSocket health check error:', error);
      return false;
    }
  }
}

export const candleQualityValidator = new CandleQualityValidator();
