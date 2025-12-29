import { cachedAlphaOmegaOrchestrator } from './cached-alpha-omega-orchestrator';
import { globalScoutRunner } from './global-scout-runner';
import { sharedIntelligenceCoordinator } from './shared-intelligence-coordinator';
import { candleDataService } from './candle-data-service';
import { WATCHLIST_SYMBOLS } from '../config/watchlist';
import { omegaSensors } from './omega-sensors';
import type { FullMarketState } from './alpha-omega-orchestrator';
import type { CandleData } from '../types';

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
    symbols: string[] = WATCHLIST_SYMBOLS,
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
    const candles = await candleDataService.getCandles(symbol, timeframe, 100);
    if (!candles || candles.length < 50) {
      throw new Error(`Insufficient candle data: ${candles?.length || 0} candles`);
    }

    const marketState = await this.buildMarketState(symbol, candles);

    const proposedSL = marketState.price - (marketState.atr * 2);
    const proposedTP = marketState.price + (marketState.atr * 3);

    const mockTraderScore = {
      score: 75,
      personality: 'BALANCED' as const,
      experience: 'intermediate'
    };

    const result = await cachedAlphaOmegaOrchestrator.makeTradeDecisionWithCache(
      marketState,
      mockTraderScore,
      proposedSL,
      proposedTP,
      undefined,
      candles
    );

    return {
      omegaCached: result.cacheStats.omegaCacheMisses
    };
  }

  private async buildMarketState(symbol: string, candles: CandleData[]): Promise<FullMarketState> {
    const currentCandle = candles[candles.length - 1];
    const price = currentCandle.close;

    const sensors = omegaSensors.calculate(candles);

    const { support, resistance } = this.calculateSupportResistance(candles);
    const { swingHigh, swingLow } = this.calculateSwings(candles);

    return {
      symbol,
      price,
      ema20: sensors.ema20 || price,
      ema50: sensors.ema50 || price,
      ema200: sensors.ema200 || price,
      rsi: sensors.rsi || 50,
      stochRsi: sensors.stoch?.k || 50,
      atr: sensors.atr || price * 0.01,
      vwap: sensors.vwap || price,
      trend: this.determineTrend(sensors),
      volatility: this.determineVolatility(sensors.atr || 0, price),
      momentum: sensors.momentum || 0,
      support,
      resistance,
      swingHigh,
      swingLow,
      recentCandles: candles.slice(-30),
      omegaSensors: sensors
    };
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

  private determineTrend(sensors: ReturnType<typeof omegaSensors.calculate>): string {
    const ema20 = sensors.ema20 || 0;
    const ema50 = sensors.ema50 || 0;
    const rsi = sensors.rsi || 50;

    if (ema20 > ema50 && rsi > 50) return 'bull';
    if (ema20 < ema50 && rsi < 50) return 'bear';
    return 'sideways';
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
