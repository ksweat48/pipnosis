/**
 * Market Snapshot Builder
 *
 * Creates compact, LLM-ready market snapshots for decision-making.
 * Optimized for short-term timeframes (M1, M5, M15, H1).
 */

import { supabase } from '../lib/supabase';
import { PIPNOSIS_CORE_RULES } from '../lib/pipnosis-core-rules';
import { MarketSnapshot } from './llm-strategy-brain';

interface Candle {
  open_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

class MarketSnapshotBuilder {
  async buildSnapshot(
    symbol: string,
    accountExposure: number = 0,
    openPositions: number = 0
  ): Promise<MarketSnapshot> {
    const timeframes: MarketSnapshot['timeframes'] = {};

    for (const tf of PIPNOSIS_CORE_RULES.PRIMARY_TIMEFRAMES) {
      const tfData = await this.getTimeframeData(symbol, tf);
      if (tfData) {
        timeframes[tf] = tfData;
      }
    }

    const recentPriceAction = this.analyzePriceAction(timeframes['M15']);

    return {
      symbol,
      timeframes,
      recentPriceAction,
      openPositions,
      accountExposure
    };
  }

  private async getTimeframeData(symbol: string, timeframe: string): Promise<any | null> {
    try {
      const { data: candles, error } = await supabase
        .from('forex_candles')
        .select('open_time, open, high, low, close, volume')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe.toLowerCase())
        .order('open_time', { ascending: false })
        .limit(300);

      if (error || !candles || candles.length < 50) {
        console.warn(`[Snapshot Builder] Insufficient data for ${symbol} ${timeframe}`);
        return null;
      }

      const sortedCandles = [...candles].reverse();
      const currentPrice = sortedCandles[sortedCandles.length - 1].close;

      const ema9 = this.calculateEMA(sortedCandles.map(c => c.close), 9);
      const ema21 = this.calculateEMA(sortedCandles.map(c => c.close), 21);
      const ema50 = this.calculateEMA(sortedCandles.map(c => c.close), 50);
      const rsi = this.calculateRSI(sortedCandles.map(c => c.close), 14);
      const atr = this.calculateATR(sortedCandles.slice(-14));
      const vwap = this.calculateVWAP(sortedCandles.slice(-20));

      const trend = this.determineTrend(ema9, ema21, ema50, currentPrice);
      const volatility = this.determineVolatility(atr, currentPrice);

      return {
        currentPrice,
        ema9,
        ema21,
        ema50,
        rsi,
        atr,
        vwap,
        trend,
        volatility
      };

    } catch (error) {
      console.error(`[Snapshot Builder] Error fetching ${symbol} ${timeframe}:`, error);
      return null;
    }
  }

  private calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1] || 0;

    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  private calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) return 50;

    const changes: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i - 1]);
    }

    const gains = changes.map(c => c > 0 ? c : 0);
    const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);

    const avgGain = gains.slice(-period).reduce((sum, g) => sum + g, 0) / period;
    const avgLoss = losses.slice(-period).reduce((sum, l) => sum + l, 0) / period;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return rsi;
  }

  private calculateATR(candles: Candle[]): number {
    if (candles.length < 2) return 0.001;

    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trs.push(tr);
    }

    return trs.reduce((sum, tr) => sum + tr, 0) / trs.length;
  }

  private calculateVWAP(candles: Candle[]): number {
    let totalPV = 0;
    let totalVolume = 0;

    for (const candle of candles) {
      const typical = (candle.high + candle.low + candle.close) / 3;
      const volume = candle.volume || 1;
      totalPV += typical * volume;
      totalVolume += volume;
    }

    return totalVolume > 0 ? totalPV / totalVolume : 0;
  }

  private determineTrend(
    ema9: number,
    ema21: number,
    ema50: number,
    currentPrice: number
  ): 'bullish' | 'bearish' | 'sideways' {
    const emaAligned = ema9 > ema21 && ema21 > ema50;
    const emaBearish = ema9 < ema21 && ema21 < ema50;

    if (emaAligned && currentPrice > ema9) return 'bullish';
    if (emaBearish && currentPrice < ema9) return 'bearish';
    return 'sideways';
  }

  private determineVolatility(atr: number, currentPrice: number): 'low' | 'medium' | 'high' {
    const atrPercent = (atr / currentPrice) * 100;

    if (atrPercent < 0.3) return 'low';
    if (atrPercent < 0.6) return 'medium';
    return 'high';
  }

  private analyzePriceAction(tfData: any | null): string {
    if (!tfData) return 'Insufficient data';

    const { currentPrice, vwap, ema9, ema21, rsi, trend, volatility } = tfData;

    const priceVsVwap = ((currentPrice - vwap) / vwap) * 100;
    const priceVsEma = ((currentPrice - ema9) / ema9) * 100;

    let action = '';

    if (Math.abs(priceVsVwap) < 0.1) {
      action += 'Price testing VWAP. ';
    } else if (priceVsVwap > 0.2) {
      action += 'Price extended above VWAP. ';
    } else if (priceVsVwap < -0.2) {
      action += 'Price extended below VWAP. ';
    }

    if (rsi > 70) {
      action += 'Overbought conditions (RSI > 70). ';
    } else if (rsi < 30) {
      action += 'Oversold conditions (RSI < 30). ';
    } else if (rsi > 45 && rsi < 55) {
      action += 'Neutral momentum. ';
    }

    action += `${trend.charAt(0).toUpperCase() + trend.slice(1)} bias. `;
    action += `${volatility.charAt(0).toUpperCase() + volatility.slice(1)} volatility.`;

    return action.trim();
  }

  async buildQuickSnapshot(symbol: string): Promise<MarketSnapshot | null> {
    try {
      return await this.buildSnapshot(symbol, 0, 0);
    } catch (error) {
      console.error('[Snapshot Builder] Quick snapshot failed:', error);
      return null;
    }
  }

  async validateDataQuality(symbol: string): Promise<{
    isValid: boolean;
    issues: string[];
    timeframesAvailable: string[];
  }> {
    const issues: string[] = [];
    const timeframesAvailable: string[] = [];

    for (const tf of PIPNOSIS_CORE_RULES.PRIMARY_TIMEFRAMES) {
      const { data: candles, error } = await supabase
        .from('forex_candles')
        .select('open_time')
        .eq('symbol', symbol)
        .eq('timeframe', tf.toLowerCase())
        .order('open_time', { ascending: false })
        .limit(50);

      if (error || !candles || candles.length < 50) {
        issues.push(`Insufficient ${tf} data (need 50+, have ${candles?.length || 0})`);
      } else {
        timeframesAvailable.push(tf);
      }
    }

    return {
      isValid: issues.length === 0,
      issues,
      timeframesAvailable
    };
  }
}

export const marketSnapshotBuilder = new MarketSnapshotBuilder();
