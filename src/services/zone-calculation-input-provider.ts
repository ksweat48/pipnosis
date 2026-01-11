/**
 * Zone Calculation Input Provider - SSOT for Technical Indicator Aggregation
 *
 * Gathers all technical inputs needed for adaptive zone calculation:
 * - ATR (15m and 1h timeframes)
 * - VWAP
 * - EMA20 and EMA50
 * - Spread
 * - Recent swing levels
 *
 * SSOT Responsibility: THIS is the ONLY place that aggregates zone calculation inputs.
 */

import { marketDataService } from './market-data-service';
import { marketSnapshotCache } from './market-snapshot-cache';
import { calculateEMA } from '../strategies/indicators';
import { getCurrencyPipInfo } from '../utils/currencyHelpers';
import { logger } from '../lib/logger';

export interface ZoneCalculationInputs {
  // Price data
  currentPrice: number;

  // Volatility metrics
  atr15m: number;
  atr1h: number;

  // Mean reversion anchors
  vwap?: number;
  ema20?: number;
  ema50?: number;

  // Microstructure
  spread: number;
  pipValue: number;

  // Swing levels (for Limit zones)
  recentSwingHigh?: number;
  recentSwingLow?: number;

  // Metadata
  symbol: string;
  timestamp: number;
}

export class ZoneCalculationInputProvider {
  /**
   * SSOT: Gather all technical inputs for zone calculation
   */
  static async gatherInputs(
    symbol: string,
    currentPrice: number
  ): Promise<ZoneCalculationInputs> {
    try {
      // Get cached snapshot if available
      const snapshot = await marketSnapshotCache.get(symbol);

      // Get ATR values (15m and 1h)
      const atr15m = snapshot?.indicators?.atr || await this.getATR(symbol, '15m');
      const atr1h = await this.getATR(symbol, '1h');

      // Get VWAP
      const vwap = snapshot?.indicators?.vwap;

      // Get EMAs from candle data
      const { ema20, ema50 } = await this.getEMAs(symbol);

      // Get spread (estimate from pip value)
      const pipInfo = getCurrencyPipInfo(symbol);
      const spread = this.estimateSpread(symbol, pipInfo.pipValue);

      // Get recent swing levels
      const { swingHigh, swingLow } = await this.getSwingLevels(symbol);

      logger.debug(`[ZoneInputProvider] Gathered inputs for ${symbol}:`, {
        atr15m: atr15m.toFixed(5),
        atr1h: atr1h.toFixed(5),
        vwap: vwap?.toFixed(5),
        ema20: ema20?.toFixed(5),
        ema50: ema50?.toFixed(5),
        spread: spread.toFixed(5)
      });

      return {
        currentPrice,
        atr15m,
        atr1h,
        vwap,
        ema20,
        ema50,
        spread,
        pipValue: pipInfo.pipValue,
        recentSwingHigh: swingHigh,
        recentSwingLow: swingLow,
        symbol,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('[ZoneInputProvider] Failed to gather inputs:', error);

      // Fallback to minimal inputs
      const pipInfo = getCurrencyPipInfo(symbol);
      return {
        currentPrice,
        atr15m: currentPrice * 0.002, // 0.2% fallback
        atr1h: currentPrice * 0.003,  // 0.3% fallback
        spread: pipInfo.pipValue * 2,
        pipValue: pipInfo.pipValue,
        symbol,
        timestamp: Date.now()
      };
    }
  }

  /**
   * Get ATR for specific timeframe
   */
  private static async getATR(symbol: string, timeframe: '15m' | '1h'): Promise<number> {
    try {
      // Try to get from market data service
      const candles = await marketDataService.getCandles(symbol, timeframe, 20);
      if (!candles || candles.length < 14) {
        throw new Error('Insufficient candles for ATR calculation');
      }

      // Calculate ATR manually
      const ranges: number[] = [];
      for (let i = 1; i < candles.length; i++) {
        const high = candles[i].high;
        const low = candles[i].low;
        const prevClose = candles[i - 1].close;

        const trueRange = Math.max(
          high - low,
          Math.abs(high - prevClose),
          Math.abs(low - prevClose)
        );
        ranges.push(trueRange);
      }

      // Simple moving average of true ranges
      const atr = ranges.reduce((sum, r) => sum + r, 0) / ranges.length;
      return atr;
    } catch (error) {
      logger.warn(`[ZoneInputProvider] Failed to calculate ATR for ${symbol} ${timeframe}:`, error);

      // Fallback estimate (0.2% for 15m, 0.3% for 1h)
      const fallbackMultiplier = timeframe === '15m' ? 0.002 : 0.003;
      return (await marketDataService.getCurrentPrice(symbol)) * fallbackMultiplier;
    }
  }

  /**
   * Get EMA20 and EMA50 from recent candles
   */
  private static async getEMAs(symbol: string): Promise<{ ema20?: number; ema50?: number }> {
    try {
      const candles = await marketDataService.getCandles(symbol, '15m', 50);
      if (!candles || candles.length < 50) {
        return {};
      }

      const closes = candles.map(c => c.close);
      const ema20 = calculateEMA(closes, 20);
      const ema50 = calculateEMA(closes, 50);

      return { ema20, ema50 };
    } catch (error) {
      logger.warn(`[ZoneInputProvider] Failed to calculate EMAs for ${symbol}:`, error);
      return {};
    }
  }

  /**
   * Estimate spread based on symbol
   */
  private static estimateSpread(symbol: string, pipValue: number): number {
    // Typical spread estimates (in pips)
    const spreadPips: Record<string, number> = {
      'EURUSD': 1.0,
      'GBPUSD': 1.5,
      'USDJPY': 1.0,
      'AUDUSD': 1.2,
      'USDCAD': 1.5,
      'NZDUSD': 1.8,
      'USDCHF': 1.5,
      'XAUUSD': 3.0,
      'BTCUSD': 10.0,
      'ETHUSD': 2.0
    };

    const pips = spreadPips[symbol] || 2.0; // Default 2 pips
    return pips * pipValue;
  }

  /**
   * Get recent swing high and low levels
   */
  private static async getSwingLevels(
    symbol: string
  ): Promise<{ swingHigh?: number; swingLow?: number }> {
    try {
      const candles = await marketDataService.getCandles(symbol, '15m', 30);
      if (!candles || candles.length < 10) {
        return {};
      }

      // Find swing high (local maximum)
      let swingHigh: number | undefined;
      let swingLow: number | undefined;

      for (let i = 2; i < candles.length - 2; i++) {
        const current = candles[i];
        const prev2 = candles[i - 2];
        const prev1 = candles[i - 1];
        const next1 = candles[i + 1];
        const next2 = candles[i + 2];

        // Swing high: current high > all neighbors
        if (
          current.high > prev2.high &&
          current.high > prev1.high &&
          current.high > next1.high &&
          current.high > next2.high
        ) {
          if (!swingHigh || current.high > swingHigh) {
            swingHigh = current.high;
          }
        }

        // Swing low: current low < all neighbors
        if (
          current.low < prev2.low &&
          current.low < prev1.low &&
          current.low < next1.low &&
          current.low < next2.low
        ) {
          if (!swingLow || current.low < swingLow) {
            swingLow = current.low;
          }
        }
      }

      return { swingHigh, swingLow };
    } catch (error) {
      logger.warn(`[ZoneInputProvider] Failed to calculate swing levels for ${symbol}:`, error);
      return {};
    }
  }

  /**
   * Validate that inputs are sufficient for zone calculation
   */
  static validateInputs(inputs: ZoneCalculationInputs): boolean {
    // Minimum requirements
    if (!inputs.currentPrice || inputs.currentPrice <= 0) return false;
    if (!inputs.atr15m || inputs.atr15m <= 0) return false;
    if (!inputs.spread || inputs.spread <= 0) return false;

    return true;
  }
}
