import { supabase } from '@/lib/supabase';
import type { Timeframe, UnifiedSymbol } from '@/types';

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
    try {
      const candles = await this.fetchM5Candles(symbol, lookbackCandles);

      if (candles.length < 20) {
        return this.getDefaultContext(symbol);
      }

      const swings = this.detectSwings(candles);
      const avgSwing = this.calculateAverageSwing(swings);
      const m5ATR = this.calculateM5ATR(candles);
      const currentProgress = this.estimateCurrentSwingProgress(candles, avgSwing);
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
    } catch (error) {
      console.warn('[M5SwingAnalyzer] Error fetching M5 context:', error);
      return this.getDefaultContext(symbol);
    }
  }

  private async fetchM5Candles(symbol: UnifiedSymbol, limit: number) {
    const { data, error } = await supabase
      .from('forex_candles_best')
      .select('timestamp, open, high, low, close')
      .eq('symbol', symbol)
      .eq('timeframe', 'M5' as Timeframe)
      .order('timestamp', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return (data || []).reverse();
  }

  private detectSwings(candles: any[]): number[] {
    const swings: number[] = [];
    let lastPivotHigh = candles[0].high;
    let lastPivotLow = candles[0].low;
    let currentSwingStart = 0;

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
          swings.push(swingSize * 10000);
        }
        lastPivotHigh = candle.high;
        currentSwingStart = i;
      }

      if (isLocalLow && candle.low < lastPivotLow * 0.999) {
        const swingSize = Math.abs(lastPivotHigh - candle.low);
        if (swingSize > 0) {
          swings.push(swingSize * 10000);
        }
        lastPivotLow = candle.low;
        currentSwingStart = i;
      }
    }

    return swings.filter(s => s > 5 && s < 200);
  }

  private calculateAverageSwing(swings: number[]): number {
    if (swings.length === 0) return 35;
    return swings.reduce((sum, s) => sum + s, 0) / swings.length;
  }

  private calculateM5ATR(candles: any[], period: number = 14): number {
    if (candles.length < period) return 15;

    const trueRanges = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );

      trueRanges.push(tr * 10000);
    }

    const recentTRs = trueRanges.slice(-period);
    return recentTRs.reduce((sum, tr) => sum + tr, 0) / recentTRs.length;
  }

  private estimateCurrentSwingProgress(candles: any[], avgSwing: number): number {
    if (candles.length < 10) return 0.5;

    const recent = candles.slice(-10);
    const recentHigh = Math.max(...recent.map(c => c.high));
    const recentLow = Math.min(...recent.map(c => c.low));
    const currentMove = (recentHigh - recentLow) * 10000;

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

  private getDefaultContext(symbol: UnifiedSymbol): M5SwingContext {
    return {
      avgSwingPips: 35,
      recentSwings: [28, 42, 31, 38, 35],
      currentSwingProgress: 0.5,
      m5ATR: 15,
      session: 'Unknown',
      sessionTypicalRange: '30-45 pips',
      suggestedTPRange: [20, 50],
      suggestedSLRange: [10, 18]
    };
  }
}

export const m5SwingAnalyzer = new M5SwingAnalyzer();
