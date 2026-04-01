import { supabase } from '@/lib/supabase';
import type { Timeframe, UnifiedSymbol } from '@/types';
import { getCurrencyPipInfo } from '@/utils/currencyHelpers';

export interface M5SwingContext {
  avgSwingPips: number;
  recentSwings: number[];
  currentSwingProgress: number;
  m5ATR: number;
  session: string;
  sessionTypicalRange: string;
  suggestedTPRange: [number, number];
  suggestedSLRange: [number, number];
}

export interface M5SwingStatistics {
  symbol: UnifiedSymbol;
  avgSwingPips: number;
  medianSwingPips: number;
  recentSwings: number[];
  currentProgress: number;
  m5ATR: number;
  session: string;
  sessionTypical: string;
}

class M5SwingAnalyzer {
  private readonly SWING_DETECTION_THRESHOLD = 0.382;

  async getRecentSwings(
    symbol: UnifiedSymbol,
    lookbackCandles: number = 50
  ): Promise<M5SwingContext> {
    const candles = await this.fetchM5Candles(symbol, lookbackCandles);

    if (candles.length < 20) {
      throw new Error(
        `[M5SwingAnalyzer] LIVE DATA FAILURE: only ${candles.length} M5 candles returned for ${symbol} (need 20+). ` +
        `Candle pipeline is broken — check forex_candles_best table, data source, and backfill status. ` +
        `Refusing to fall back to static defaults as Alpha requires live market data.`
      );
    }

    const pipValue = getCurrencyPipInfo(symbol).pipValue;
    const swings = this.detectSwings(candles, pipValue);
    const avgSwing = this.calculateAverageSwing(swings);
    const m5ATR = this.calculateM5ATR(candles, 14, pipValue);
    const currentProgress = this.estimateCurrentSwingProgress(candles, avgSwing, pipValue);
    const session = this.detectSession();
    const sessionRange = this.getSessionTypicalRange(session, avgSwing);

    return {
      avgSwingPips: Math.round(avgSwing),
      recentSwings: swings.slice(-5).map(s => Math.round(s)),
      currentSwingProgress: Math.min(currentProgress, 1.0),
      m5ATR: Math.round(m5ATR),
      session,
      sessionTypicalRange: sessionRange,
      suggestedTPRange: this.calculateTPRange(avgSwing, session),
      suggestedSLRange: this.calculateSLRange(m5ATR)
    };
  }

  private async fetchM5Candles(symbol: UnifiedSymbol, limit: number) {
    const { data, error } = await supabase
      .from('forex_candles_best')
      .select('open_time, open, high, low, close')
      .eq('symbol', symbol)
      .eq('timeframe', 'M5' as Timeframe)
      .order('open_time', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(
        `[M5SwingAnalyzer] LIVE DATA FAILURE: Database query failed for ${symbol} M5 candles. ` +
        `Error: ${error.message} (code: ${error.code}). ` +
        `Alpha cannot operate without live candle data.`
      );
    }

    if (!data || data.length === 0) {
      throw new Error(
        `[M5SwingAnalyzer] LIVE DATA FAILURE: Zero M5 candles returned for ${symbol}. ` +
        `Table forex_candles_best may be empty or the symbol is not being collected. ` +
        `Check the candle aggregation pipeline.`
      );
    }

    const validCandles = data.filter(c =>
      c.open_time !== null &&
      c.high !== null &&
      c.low !== null &&
      c.close !== null &&
      c.high > 0 &&
      c.low > 0 &&
      c.close > 0 &&
      c.high >= c.low
    );

    if (validCandles.length < data.length * 0.8) {
      throw new Error(
        `[M5SwingAnalyzer] LIVE DATA INTEGRITY FAILURE: ${data.length - validCandles.length} of ${data.length} M5 candles for ${symbol} have null/invalid OHLC values. ` +
        `Data pipeline is producing corrupted candles. Alpha refuses to calculate ATR from corrupt data.`
      );
    }

    return validCandles.reverse();
  }

  private detectSwings(candles: any[], pipValue: number): number[] {
    const swings: number[] = [];
    let lastPivotHigh = candles[0].high;
    let lastPivotLow = candles[0].low;

    for (let i = 2; i < candles.length - 2; i++) {
      const candle = candles[i];

      const isLocalHigh =
        candle.high > candles[i-1].high &&
        candle.high > candles[i-2].high &&
        candle.high > candles[i+1].high &&
        candle.high > candles[i+2].high;

      const isLocalLow =
        candle.low < candles[i-1].low &&
        candle.low < candles[i-2].low &&
        candle.low < candles[i+1].low &&
        candle.low < candles[i+2].low;

      if (isLocalHigh && candle.high > lastPivotHigh * 1.001) {
        const swingSize = Math.abs(candle.high - lastPivotLow);
        if (swingSize > 0) {
          swings.push(swingSize / pipValue);
        }
        lastPivotHigh = candle.high;
      }

      if (isLocalLow && candle.low < lastPivotLow * 0.999) {
        const swingSize = Math.abs(lastPivotHigh - candle.low);
        if (swingSize > 0) {
          swings.push(swingSize / pipValue);
        }
        lastPivotLow = candle.low;
      }
    }

    return swings.filter(s => s > 5 && s < 200);
  }

  private calculateAverageSwing(swings: number[]): number {
    if (swings.length === 0) return 35;
    return swings.reduce((sum, s) => sum + s, 0) / swings.length;
  }

  private calculateM5ATR(candles: any[], period: number = 14, pipValue: number = 0.0001): number {
    if (candles.length < period) {
      throw new Error(
        `[M5SwingAnalyzer] ATR CALCULATION FAILURE: Need ${period} candles but only have ${candles.length}. ` +
        `Cannot compute live ATR. This should have been caught at the candle count check.`
      );
    }

    const trueRanges = [];
    for (let i = 1; i < candles.length; i++) {
      const high = Number(candles[i].high);
      const low = Number(candles[i].low);
      const prevClose = Number(candles[i - 1].close);

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );

      trueRanges.push(tr / pipValue);
    }

    const recentTRs = trueRanges.slice(-period);
    return recentTRs.reduce((sum, tr) => sum + tr, 0) / recentTRs.length;
  }

  private estimateCurrentSwingProgress(candles: any[], avgSwing: number, pipValue: number): number {
    if (candles.length < 10) return 0.5;

    const recent = candles.slice(-10);
    const recentHigh = Math.max(...recent.map(c => c.high));
    const recentLow = Math.min(...recent.map(c => c.low));
    const currentMove = (recentHigh - recentLow) / pipValue;

    return Math.min(currentMove / avgSwing, 1.0);
  }

  private detectSession(): string {
    const hour = new Date().getUTCHours();

    if (hour >= 7 && hour < 16) return 'London';
    if (hour >= 13 && hour < 21) return 'New York';
    if (hour >= 0 && hour < 7) return 'Asian';
    return 'Overlap';
  }

  private getSessionTypicalRange(session: string, baseAvg: number): string {
    const multipliers: Record<string, [number, number]> = {
      'London': [1.3, 1.6],
      'New York': [1.2, 1.5],
      'Overlap': [1.4, 1.8],
      'Asian': [0.7, 1.0]
    };

    const [low, high] = multipliers[session] || [1.0, 1.2];
    const rangeMin = Math.round(baseAvg * low);
    const rangeMax = Math.round(baseAvg * high);

    return `${rangeMin}-${rangeMax} pips`;
  }

  private calculateTPRange(avgSwing: number, session: string): [number, number] {
    const baseMin = avgSwing * 0.6;
    const baseMax = avgSwing * 1.4;

    if (session === 'London' || session === 'Overlap') {
      return [Math.round(baseMin), Math.round(baseMax * 1.2)];
    }

    if (session === 'Asian') {
      return [Math.round(baseMin * 0.7), Math.round(baseMax * 0.8)];
    }

    return [Math.round(baseMin), Math.round(baseMax)];
  }

  private calculateSLRange(m5ATR: number): [number, number] {
    const minSL = Math.max(m5ATR * 0.8, 10);
    const maxSL = m5ATR * 1.5;

    return [Math.round(minSL), Math.round(maxSL)];
  }
}

export const m5SwingAnalyzer = new M5SwingAnalyzer();
