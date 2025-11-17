/**
 * Local Backtest Engine (Refactored)
 *
 * Runs backtests entirely in local memory with ZERO database writes during execution.
 * Only writes compressed summary at completion.
 */

import { supabase } from '../lib/supabase';
import { PIPNOSIS_CORE_RULES, PipnosisCoreRules } from '../lib/pipnosis-core-rules';
import { localMemoryLayer } from './local-memory-layer';
import { llmStrategyBrain, MarketSnapshot } from './llm-strategy-brain';
import { marketSnapshotBuilder } from './market-snapshot-builder';
import { supabaseSummaryWriter } from './supabase-summary-writer';

export interface LocalBacktestConfig {
  symbol: string;
  startDate: Date;
  endDate: Date;
  initialBalance: number;
  riskMode: 'low' | 'medium' | 'high';
  useLLMDecisions: boolean;
  maxTrades?: number;
}

export interface BacktestProgress {
  phase: 'loading_data' | 'analyzing' | 'complete';
  message: string;
  percentComplete: number;
  tradesExecuted: number;
  currentBalance: number;
}

class LocalBacktestEngine {
  async runBacktest(
    userId: string,
    config: LocalBacktestConfig,
    onProgress?: (progress: BacktestProgress) => void
  ): Promise<{ sessionId: string; summary: any }> {
    const sessionId = `backtest-${userId}-${Date.now()}`;

    console.log(`[Local Backtest] Starting backtest: ${config.symbol} ${config.startDate.toISOString()} to ${config.endDate.toISOString()}`);

    localMemoryLayer.createSession(sessionId, config.initialBalance);

    onProgress?.({
      phase: 'loading_data',
      message: 'Loading historical data...',
      percentComplete: 10,
      tradesExecuted: 0,
      currentBalance: config.initialBalance
    });

    const candles = await this.loadHistoricalCandles(config.symbol, config.startDate, config.endDate);

    if (candles.length < 100) {
      throw new Error(`Insufficient historical data: only ${candles.length} candles found`);
    }

    console.log(`[Local Backtest] Loaded ${candles.length} candles`);

    onProgress?.({
      phase: 'analyzing',
      message: 'Analyzing market conditions and executing trades...',
      percentComplete: 30,
      tradesExecuted: 0,
      currentBalance: config.initialBalance
    });

    let tradesExecuted = 0;
    const maxTrades = config.maxTrades || 50;
    const skipCandles = Math.floor(candles.length / maxTrades);

    for (let i = 100; i < candles.length && tradesExecuted < maxTrades; i += skipCandles) {
      const lookbackCandles = candles.slice(Math.max(0, i - 100), i);

      const snapshot = await this.buildSnapshotFromCandles(config.symbol, lookbackCandles);
      if (!snapshot) continue;

      const decision = config.useLLMDecisions
        ? await llmStrategyBrain.makeDecision(snapshot)
        : this.generateRuleBasedDecision(snapshot);

      if (decision.action === 'enter_long' || decision.action === 'enter_short') {
        const futureCandles = candles.slice(i, Math.min(i + 50, candles.length));
        const trade = await this.simulateTrade(
          sessionId,
          config.symbol,
          decision,
          snapshot.timeframes.M15.currentPrice,
          futureCandles
        );

        if (trade) {
          tradesExecuted++;

          const metrics = localMemoryLayer.getSessionMetrics(sessionId);
          if (metrics) {
            onProgress?.({
              phase: 'analyzing',
              message: `Executed ${tradesExecuted} trades...`,
              percentComplete: 30 + Math.floor((i / candles.length) * 60),
              tradesExecuted,
              currentBalance: metrics.currentBalance
            });
          }
        }
      }
    }

    console.log(`[Local Backtest] Completed ${tradesExecuted} trades`);

    onProgress?.({
      phase: 'complete',
      message: 'Generating summary...',
      percentComplete: 95,
      tradesExecuted,
      currentBalance: localMemoryLayer.getSessionMetrics(sessionId)?.currentBalance || config.initialBalance
    });

    const summary = localMemoryLayer.generateSessionSummary(
      sessionId,
      userId,
      `Backtest: ${config.symbol}`
    );

    if (summary) {
      await supabaseSummaryWriter.writeSessionSummary(summary, true);
    }

    onProgress?.({
      phase: 'complete',
      message: 'Backtest complete!',
      percentComplete: 100,
      tradesExecuted,
      currentBalance: summary?.metrics.currentBalance || config.initialBalance
    });

    localMemoryLayer.closeSession(sessionId);

    return { sessionId, summary };
  }

  private async loadHistoricalCandles(
    symbol: string,
    startDate: Date,
    endDate: Date
  ): Promise<any[]> {
    const { data: candles, error } = await supabase
      .from('forex_candles')
      .select('open_time, open, high, low, close, volume')
      .eq('symbol', symbol)
      .eq('timeframe', 'm15')
      .gte('open_time', startDate.toISOString())
      .lte('open_time', endDate.toISOString())
      .order('open_time', { ascending: true });

    if (error) {
      console.error('[Local Backtest] Error loading candles:', error);
      return [];
    }

    return candles || [];
  }

  private async buildSnapshotFromCandles(
    symbol: string,
    candles: any[]
  ): Promise<MarketSnapshot | null> {
    if (candles.length < 50) return null;

    const currentPrice = candles[candles.length - 1].close;
    const prices = candles.map(c => c.close);

    const ema9 = this.calculateEMA(prices, 9);
    const ema21 = this.calculateEMA(prices, 21);
    const ema50 = this.calculateEMA(prices, 50);
    const rsi = this.calculateRSI(prices, 14);
    const atr = this.calculateATR(candles.slice(-14));
    const vwap = this.calculateVWAP(candles.slice(-20));

    const trend = this.determineTrend(ema9, ema21, ema50);
    const volatility = this.determineVolatility(atr, currentPrice);

    return {
      symbol,
      timeframes: {
        M15: {
          currentPrice,
          ema9,
          ema21,
          ema50,
          rsi,
          atr,
          vwap,
          trend,
          volatility
        }
      },
      recentPriceAction: `${trend} trend, ${volatility} volatility`,
      openPositions: 0,
      accountExposure: 0
    };
  }

  private generateRuleBasedDecision(snapshot: MarketSnapshot): any {
    const tfData = snapshot.timeframes.M15;
    const priceVsVwap = ((tfData.currentPrice - tfData.vwap) / tfData.vwap) * 100;

    if (Math.abs(priceVsVwap) < 0.15 && tfData.ema9 > tfData.ema21 && tfData.rsi > 45 && tfData.rsi < 65) {
      return {
        action: 'enter_long',
        confidence: 70,
        entryZone: { ideal: tfData.currentPrice },
        stopLoss: tfData.currentPrice - tfData.atr * 1.5,
        takeProfit: tfData.currentPrice + tfData.atr * 2.5,
        expectedDurationMinutes: 90,
        setupType: 'VWAP Bounce',
        reasoning: 'VWAP support with bullish EMA'
      };
    }

    return { action: 'no_trade', confidence: 0 };
  }

  private async simulateTrade(
    sessionId: string,
    symbol: string,
    decision: any,
    entryPrice: number,
    futureCandles: any[]
  ): Promise<any | null> {
    const isLong = decision.action === 'enter_long';
    const stopLoss = decision.stopLoss || entryPrice * (isLong ? 0.99 : 1.01);
    const takeProfit = decision.takeProfit || entryPrice * (isLong ? 1.02 : 0.98);

    const maxDurationCandles = Math.min(
      Math.floor(PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_MINUTES / 15),
      futureCandles.length
    );

    let exitPrice = entryPrice;
    let exitReason = 'Max duration reached';
    let candlesHeld = 0;

    for (let i = 0; i < maxDurationCandles; i++) {
      const candle = futureCandles[i];
      candlesHeld++;

      if (isLong) {
        if (candle.low <= stopLoss) {
          exitPrice = stopLoss;
          exitReason = 'Stop loss hit';
          break;
        }
        if (candle.high >= takeProfit) {
          exitPrice = takeProfit;
          exitReason = 'Take profit hit';
          break;
        }
      } else {
        if (candle.high >= stopLoss) {
          exitPrice = stopLoss;
          exitReason = 'Stop loss hit';
          break;
        }
        if (candle.low <= takeProfit) {
          exitPrice = takeProfit;
          exitReason = 'Take profit hit';
          break;
        }
      }
    }

    if (candlesHeld === maxDurationCandles) {
      exitPrice = futureCandles[maxDurationCandles - 1].close;
    }

    const trade = localMemoryLayer.addTrade(sessionId, {
      symbol,
      timeframe: 'M15',
      direction: isLong ? 'buy' : 'sell',
      entryTime: new Date(),
      entryPrice,
      positionSize: 0.01,
      stopLoss,
      takeProfit,
      pnl: 0,
      pnlPercent: 0,
      outcome: 'open',
      confidence: decision.confidence || 70,
      setupType: decision.setupType || 'Unknown',
      aiReasoning: decision.reasoning
    });

    localMemoryLayer.closeTrade(sessionId, trade.id, exitPrice, exitReason);

    return trade;
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
    const changes = prices.slice(1).map((p, i) => p - prices[i]);
    const gains = changes.map(c => c > 0 ? c : 0).slice(-period);
    const losses = changes.map(c => c < 0 ? Math.abs(c) : 0).slice(-period);
    const avgGain = gains.reduce((s, g) => s + g, 0) / period;
    const avgLoss = losses.reduce((s, l) => s + l, 0) / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private calculateATR(candles: any[]): number {
    if (candles.length < 2) return 0.001;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
      trs.push(tr);
    }
    return trs.reduce((s, tr) => s + tr, 0) / trs.length;
  }

  private calculateVWAP(candles: any[]): number {
    let totalPV = 0, totalVol = 0;
    for (const c of candles) {
      const typical = (c.high + c.low + c.close) / 3;
      const vol = c.volume || 1;
      totalPV += typical * vol;
      totalVol += vol;
    }
    return totalVol > 0 ? totalPV / totalVol : 0;
  }

  private determineTrend(ema9: number, ema21: number, ema50: number): 'bullish' | 'bearish' | 'sideways' {
    if (ema9 > ema21 && ema21 > ema50) return 'bullish';
    if (ema9 < ema21 && ema21 < ema50) return 'bearish';
    return 'sideways';
  }

  private determineVolatility(atr: number, price: number): 'low' | 'medium' | 'high' {
    const atrPercent = (atr / price) * 100;
    if (atrPercent < 0.3) return 'low';
    if (atrPercent < 0.6) return 'medium';
    return 'high';
  }
}

export const localBacktestEngine = new LocalBacktestEngine();
