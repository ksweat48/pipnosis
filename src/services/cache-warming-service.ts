import { supabase } from '../lib/supabase';
import { alphaOmegaOrchestrator, type FullMarketState } from './alpha-omega-orchestrator';
import { globalScoutRunner } from './global-scout-runner';
import { sharedIntelligenceCoordinator } from './shared-intelligence-coordinator';
import { DEFAULT_WATCHLIST } from '../config/watchlist';
import { computeOmegaSensors, OmegaSensors } from './omega-sensors';
import type { CandleData } from '../types';
import type { TraderScore } from './ai-identity';

export interface CacheWarmingResult {
  symbol: string;
  success: boolean;
  omegaCached: number;
  error?: string;
  durationMs: number;
}

export interface FullWarmingReport {
  startTime: Date;
  endTime: Date;
  totalDurationMs: number;
  symbolsWarmed: number;
  totalOmegaCached: number;
  failures: string[];
  results: CacheWarmingResult[];
}

class CacheWarmingService {
  private isWarming = false;
  private lastWarmTime = 0;
  private readonly MIN_WARM_INTERVAL_MS = 5 * 60 * 1000;

  async warmAllSymbols(
    symbols: string[] = [...DEFAULT_WATCHLIST],
    timeframe: string = 'M15'
  ): Promise<FullWarmingReport> {
    if (this.isWarming) {
      console.log('[CacheWarming] Already warming, skipping...');
      return this.createEmptyReport('Already warming');
    }

    const now = Date.now();
    if (now - this.lastWarmTime < this.MIN_WARM_INTERVAL_MS) {
      console.log('[CacheWarming] Too soon since last warm, skipping...');
      return this.createEmptyReport('Too soon since last warm');
    }

    this.isWarming = true;
    this.lastWarmTime = now;

    const startTime = new Date();
    console.log(`[CacheWarming] Starting cache warming for ${symbols.length} symbols...`);

    const results: CacheWarmingResult[] = [];
    const failures: string[] = [];

    try {
      console.log('[CacheWarming] Running global scout first...');
      await globalScoutRunner.runGlobalScout(symbols, timeframe);

      for (const symbol of symbols) {
        const symbolStart = Date.now();
        try {
          const result = await this.warmSymbol(symbol, timeframe);
          results.push({
            symbol,
            success: true,
            omegaCached: result.omegaCached,
            durationMs: Date.now() - symbolStart
          });
          console.log(`[CacheWarming] Warmed ${symbol}: ${result.omegaCached} Omega brains cached`);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          failures.push(`${symbol}: ${errorMsg}`);
          results.push({
            symbol,
            success: false,
            omegaCached: 0,
            error: errorMsg,
            durationMs: Date.now() - symbolStart
          });
          console.error(`[CacheWarming] Failed to warm ${symbol}:`, error);
        }

        await this.delay(100);
      }

      const endTime = new Date();
      const totalDurationMs = endTime.getTime() - startTime.getTime();
      const totalOmegaCached = results.reduce((sum, r) => sum + r.omegaCached, 0);

      console.log(`[CacheWarming] Complete: ${results.filter(r => r.success).length}/${symbols.length} symbols, ${totalOmegaCached} Omega brains cached in ${totalDurationMs}ms`);

      return {
        startTime,
        endTime,
        totalDurationMs,
        symbolsWarmed: results.filter(r => r.success).length,
        totalOmegaCached,
        failures,
        results
      };
    } finally {
      this.isWarming = false;
    }
  }

  private async warmSymbol(symbol: string, timeframe: string): Promise<{ omegaCached: number }> {
    const candles = await this.fetchCandles(symbol, timeframe, 100);
    if (!candles || candles.length < 50) {
      throw new Error(`Insufficient candle data: ${candles?.length || 0} candles`);
    }

    const marketState = await this.buildMarketState(symbol, candles);

    const proposedSL = marketState.price - (marketState.atr * 2);
    const proposedTP = marketState.price + (marketState.atr * 3);

    const mockTraderScore: TraderScore = {
      current_score: 75,
      lifetime_profit: 0,
      lifetime_loss: 0,
      streak_wins: 0,
      streak_losses: 0,
      confidence_level: 'medium',
      risk_appetite: 2,
      trading_style: 'balanced',
      total_trades: 0,
      win_rate: 50
    };

    const startTime = Date.now();
    // PRIORITY 3 FIX: Pass userId (undefined for system cache warming)
    await alphaOmegaOrchestrator.makeTradeDecision(
      marketState,
      mockTraderScore,
      proposedSL,
      proposedTP,
      undefined, // No goal context in cache warming
      undefined  // No userId for system-level cache warming
    );
    const durationMs = Date.now() - startTime;

    return {
      omegaCached: durationMs < 500 ? 0 : 7
    };
  }

  private async fetchCandles(symbol: string, timeframe: string, limit: number): Promise<CandleData[]> {
    const { data, error } = await supabase
      .from('forex_candles')
      .select('time, open, high, low, close, volume')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .order('time', { ascending: false })
      .limit(limit);

    if (error) {
      console.error(`[CacheWarming] Supabase error for ${symbol}:`, error);
      return [];
    }

    return (data || []).reverse().map(c => ({
      time: typeof c.time === 'number' ? c.time : new Date(c.time).getTime() / 1000,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume
    }));
  }

  private async buildMarketState(symbol: string, candles: CandleData[]): Promise<FullMarketState> {
    const currentCandle = candles[candles.length - 1];
    if (!currentCandle) {
      throw new Error('No candle data available');
    }
    const price = currentCandle.close;

    const indicators = this.calculateBasicIndicators(candles);
    const { support, resistance } = this.calculateSupportResistance(candles);
    const { swingHigh, swingLow } = this.calculateSwings(candles);

    const sensors: OmegaSensors = {
      sh: swingHigh,
      sl: swingLow,
      bos: 'none',
      cho: 'none',
      eqh: 0,
      eql: 0,
      vol_ratio: 1,
      vol_trend: 'stable',
      vol_spike: false,
      cvd: 0,
      rsi: indicators.rsi,
      macd: 0,
      macd_sig: 0,
      momentum: indicators.momentum,
      stoch: { k: 50, d: 50 },
      pat: { engulf: false, pin: false, doji: false, inside: false },
      mic: { wick_ratio: 0, body_size: 0, gap: false, trap: 'none' },
      ema20: indicators.ema20,
      ema50: indicators.ema50,
      ema200: indicators.ema200,
      atr: indicators.atr,
      vwap: price
    };

    return {
      symbol,
      price,
      ema20: indicators.ema20,
      ema50: indicators.ema50,
      ema200: indicators.ema200,
      rsi: indicators.rsi,
      stochRsi: 50,
      atr: indicators.atr,
      vwap: price,
      trend: this.determineTrendFromIndicators(indicators),
      volatility: this.determineVolatility(indicators.atr, price),
      momentum: indicators.momentum,
      support,
      resistance,
      swingHigh,
      swingLow,
      recentCandles: candles.slice(-30),
      omegaSensors: sensors
    };
  }

  private calculateBasicIndicators(candles: CandleData[]): {
    ema20: number;
    ema50: number;
    ema200: number;
    rsi: number;
    atr: number;
    momentum: number;
  } {
    const closes = candles.map(c => c.close);
    const price = closes[closes.length - 1] || 0;

    const ema20 = this.calculateEMA(closes, 20);
    const ema50 = this.calculateEMA(closes, 50);
    const ema200 = this.calculateEMA(closes, Math.min(200, closes.length - 1));
    const rsi = this.calculateRSI(closes, 14);
    const atr = this.calculateATR(candles, 14);
    const momentum = closes.length >= 10 ? (closes[closes.length - 1] - closes[closes.length - 10]) / closes[closes.length - 10] * 100 : 0;

    return { ema20, ema50, ema200, rsi, atr, momentum };
  }

  private calculateEMA(data: number[], period: number): number {
    if (data.length < period) return data[data.length - 1] || 0;
    const multiplier = 2 / (period + 1);
    let ema = data[data.length - period] || 0;
    for (let i = data.length - period + 1; i < data.length; i++) {
      ema = ((data[i] || 0) - ema) * multiplier + ema;
    }
    return ema;
  }

  private calculateRSI(closes: number[], period: number): number {
    if (closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
      const change = (closes[i] || 0) - (closes[i - 1] || 0);
      if (change > 0) gains += change;
      else losses -= change;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private calculateATR(candles: CandleData[], period: number): number {
    if (candles.length < period + 1) return candles[candles.length - 1]?.close * 0.01 || 0;
    let sum = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
      const candle = candles[i];
      const prevCandle = candles[i - 1];
      if (!candle || !prevCandle) continue;
      const tr = Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - prevCandle.close),
        Math.abs(candle.low - prevCandle.close)
      );
      sum += tr;
    }
    return sum / period;
  }

  private determineTrendFromIndicators(indicators: { ema20: number; ema50: number; rsi: number }): string {
    if (indicators.ema20 > indicators.ema50 && indicators.rsi > 50) return 'bull';
    if (indicators.ema20 < indicators.ema50 && indicators.rsi < 50) return 'bear';
    return 'sideways';
  }

  private calculateSupportResistance(candles: CandleData[]): { support: number[]; resistance: number[] } {
    const recentCandles = candles.slice(-20);
    const lows = recentCandles.map(c => c.low).sort((a, b) => a - b);
    const highs = recentCandles.map(c => c.high).sort((a, b) => b - a);

    return {
      support: lows.slice(0, 3),
      resistance: highs.slice(0, 3)
    };
  }

  private calculateSwings(candles: CandleData[]): { swingHigh: number; swingLow: number } {
    const recentCandles = candles.slice(-10);
    let swingHigh = -Infinity;
    let swingLow = Infinity;

    for (const candle of recentCandles) {
      if (candle.high > swingHigh) swingHigh = candle.high;
      if (candle.low < swingLow) swingLow = candle.low;
    }

    return { swingHigh, swingLow };
  }

  private determineVolatility(atr: number, price: number): string {
    const atrPercent = (atr / price) * 100;
    if (atrPercent < 0.3) return 'low';
    if (atrPercent < 0.8) return 'medium';
    return 'high';
  }

  private createEmptyReport(reason: string): FullWarmingReport {
    const now = new Date();
    return {
      startTime: now,
      endTime: now,
      totalDurationMs: 0,
      symbolsWarmed: 0,
      totalOmegaCached: 0,
      failures: [reason],
      results: []
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async cleanupAndWarm(): Promise<{ cleanup: { omega: number; alpha: number; scout: number }; warming: FullWarmingReport }> {
    console.log('[CacheWarming] Running cleanup before warming...');
    const cleanup = await sharedIntelligenceCoordinator.cleanupExpiredCache();
    console.log(`[CacheWarming] Cleanup: ${cleanup.omega} omega, ${cleanup.alpha} alpha, ${cleanup.scout} scout entries removed`);

    const warming = await this.warmAllSymbols();

    return { cleanup, warming };
  }

  getLastWarmTime(): Date | null {
    return this.lastWarmTime > 0 ? new Date(this.lastWarmTime) : null;
  }

  isCurrentlyWarming(): boolean {
    return this.isWarming;
  }
}

export const cacheWarmingService = new CacheWarmingService();
