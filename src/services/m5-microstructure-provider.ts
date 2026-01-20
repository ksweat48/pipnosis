/**
 * M5 Microstructure Provider
 *
 * SINGLE SOURCE OF TRUTH for M5-level microstructure data.
 *
 * RESPONSIBILITY:
 * Provides M5 candles, indicators, and microstructure analysis for entry qualification.
 *
 * SSOT COMPLIANCE:
 * - M5 data retrieval: THIS SERVICE
 * - M5 candle aggregation: background-candle-aggregator.ts
 * - Entry timing qualification: entry-qualification-engine.ts
 * - M15 context: llm-snapshot-builder.ts
 */

import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import type { M5Candle } from './entry-qualification-engine';
import { MarketDataService } from './market-data-service';

export interface M5Microstructure {
  candles: M5Candle[];
  vwap: number;
  ema20: number;
  rsi: number;
  volumeAvg20: number;
  currentPrice: number;
  atr: number;
}

class M5MicrostructureProvider {
  /**
   * Fetch M5 microstructure data for a symbol
   * Returns last 30 M5 candles with calculated indicators
   */
  async getMicrostructure(symbol: string): Promise<M5Microstructure | null> {
    try {
      // ✅ PHASE 2: Use MarketDataService as SSOT
      const marketDataService = MarketDataService.getInstance();
      const candles = await marketDataService.getCandles(symbol, 'm5', 30);

      if (!candles) {
        logger.error('[M5 Microstructure] Failed to fetch M5 candles');
        return null;
      }

      if (!candles || candles.length === 0) {
        logger.warn('[M5 Microstructure] No M5 candles found for', symbol);
        return null;
      }

      // Reverse to chronological order
      candles.reverse();

      // Convert to M5Candle format
      const m5Candles: M5Candle[] = candles.map(c => ({
        time: new Date(c.open_time).toISOString(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume || 0
      }));

      // Calculate indicators
      const closes = m5Candles.map(c => c.close);
      const highs = m5Candles.map(c => c.high);
      const lows = m5Candles.map(c => c.low);
      const volumes = m5Candles.map(c => c.volume);

      const currentPrice = closes[closes.length - 1];
      const vwap = this.calculateVWAP(m5Candles.slice(-20));
      const ema20 = this.calculateEMA(closes, 20);
      const rsi = this.calculateRSI(closes, 14);
      const volumeAvg20 = volumes.slice(-20).reduce((sum, v) => sum + v, 0) / 20;
      const atr = this.calculateATR(highs, lows, closes, 14);

      logger.info(`[M5 Microstructure] ${symbol}: Price=${currentPrice.toFixed(5)}, VWAP=${vwap.toFixed(5)}, EMA20=${ema20.toFixed(5)}, RSI=${rsi.toFixed(1)}, ATR=${atr.toFixed(5)}`);

      return {
        candles: m5Candles,
        vwap,
        ema20,
        rsi,
        volumeAvg20,
        currentPrice,
        atr
      };
    } catch (error) {
      logger.error('[M5 Microstructure] Error fetching microstructure:', error);
      return null;
    }
  }

  /**
   * Calculate VWAP (Volume Weighted Average Price)
   */
  private calculateVWAP(candles: M5Candle[]): number {
    let sumPV = 0;
    let sumV = 0;

    for (const candle of candles) {
      const typical = (candle.high + candle.low + candle.close) / 3;
      const volume = candle.volume || 1000; // Fallback volume
      sumPV += typical * volume;
      sumV += volume;
    }

    return sumV > 0 ? sumPV / sumV : candles[candles.length - 1].close;
  }

  /**
   * Calculate EMA (Exponential Moving Average)
   */
  private calculateEMA(values: number[], period: number): number {
    if (values.length < period) {
      // Fallback: simple average
      return values.reduce((sum, v) => sum + v, 0) / values.length;
    }

    const multiplier = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((sum, val) => sum + val, 0) / period;

    for (let i = period; i < values.length; i++) {
      ema = (values[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  /**
   * Calculate RSI (Relative Strength Index)
   */
  private calculateRSI(closes: number[], period: number = 14): number {
    if (closes.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = closes.length - period; i < closes.length; i++) {
      const change = closes[i] - closes[i - 1];
      if (change > 0) {
        gains += change;
      } else {
        losses -= change;
      }
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return rsi;
  }

  /**
   * Calculate ATR (Average True Range)
   */
  private calculateATR(highs: number[], lows: number[], closes: number[], period: number): number {
    if (highs.length < period + 1) {
      // Fallback: simple range average
      const ranges = highs.map((h, i) => h - lows[i]);
      return ranges.reduce((sum, r) => sum + r, 0) / ranges.length;
    }

    const trValues: number[] = [];
    for (let i = Math.max(1, highs.length - period); i < highs.length; i++) {
      const high = highs[i];
      const low = lows[i];
      const prevClose = closes[i - 1];
      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trValues.push(tr);
    }

    return trValues.reduce((sum, tr) => sum + tr, 0) / trValues.length;
  }

  /**
   * Get current M5 spread
   * Estimates spread from recent candles (high-low average)
   */
  async getCurrentSpread(symbol: string): Promise<{ currentPips: number; averagePips: number }> {
    try {
      // ✅ PHASE 2: Use MarketDataService as SSOT
      const marketDataService = MarketDataService.getInstance();
      const recentCandles = await marketDataService.getCandles(symbol, 'm5', 20);

      if (!recentCandles || recentCandles.length === 0) {
        // Fallback default spreads
        return { currentPips: 1.5, averagePips: 1.5 };
      }

      const spreads = recentCandles.map(c => (c.high - c.low) * 10000); // Convert to pips
      const currentPips = spreads[0];
      const averagePips = spreads.reduce((sum, s) => sum + s, 0) / spreads.length;

      return { currentPips, averagePips };
    } catch (error) {
      logger.error('[M5 Microstructure] Error fetching spread:', error);
      return { currentPips: 1.5, averagePips: 1.5 };
    }
  }

  /**
   * Check if M5 data is available for a symbol
   * Useful for graceful degradation if M5 not yet populated
   */
  async isM5DataAvailable(symbol: string): Promise<boolean> {
    try {
      // ✅ PHASE 2: Use MarketDataService as SSOT
      const marketDataService = MarketDataService.getInstance();
      const data = await marketDataService.getCandles(symbol, 'm5', 1);

      return data !== null && data.length > 0;
    } catch (error) {
      return false;
    }
  }
}

export const m5MicrostructureProvider = new M5MicrostructureProvider();
