/**
 * Event-Based LLM Trading Engine
 *
 * The unified trading engine for both backtesting and live trading
 * Uses Flow V2 as local trigger detector, only calls LLM when high-probability setups detected
 * Enforces strict intraday Pipnosis rules
 */

import { supabase } from '../lib/supabase';
import { PIPNOSIS_CORE_RULES } from '../lib/pipnosis-core-rules';
import { triggerDetectionRules, TriggerEvent, MarketSnapshot } from './trigger-detection-rules';
import { llmSnapshotBuilder, LLMSnapshot, LLMTradeDecision } from './llm-snapshot-builder';

export interface EventBasedEngineConfig {
  symbol: string;
  timeframe: string;
  useLLM: boolean;
  riskMode: 'low' | 'medium' | 'high';
  maxConcurrentTrades: number;
  initialBalance?: number;
}

export interface SimulatedTrade {
  id: string;
  symbol: string;
  timeframe: string;
  direction: 'buy' | 'sell';
  entryTime: Date;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  positionSize: number;
  confidence: number;
  reasoning: string;
  triggerType: string;
  maxHoldMinutes: number;
  exitTime?: Date;
  exitPrice?: number;
  exitReason?: string;
  pnl: number;
  outcome: 'win' | 'loss' | 'breakeven' | 'open';
  holdingMinutes?: number;
}

export interface EngineStatistics {
  totalCandles: number;
  triggersDetected: number;
  llmCallsMade: number;
  tradesExecuted: number;
  tradesWon: number;
  tradesLost: number;
  totalPnL: number;
  winRate: number;
  avgHoldTime: number;
  triggerToTradeRatio: number;
}

class EventBasedLLMEngine {
  private apiKey: string;
  private readonly GPT_MODEL = 'gpt-4o';
  private sessionTokenUsage: number = 0;
  private readonly MAX_TOKENS_PER_SESSION = 50000;

  constructor() {
    this.apiKey = typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_OPENAI_API_KEY || ''
      : process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
  }

  /**
   * Process a single candle and check for trade opportunities
   */
  async processCandle(
    candles: any[],
    config: EventBasedEngineConfig,
    openTrades: SimulatedTrade[] = []
  ): Promise<{ trade: SimulatedTrade | null; trigger: TriggerEvent | null; llmCalled: boolean }> {
    if (candles.length < 50) {
      return { trade: null, trigger: null, llmCalled: false };
    }

    if (openTrades.length >= config.maxConcurrentTrades) {
      return { trade: null, trigger: null, llmCalled: false };
    }

    const snapshot = this.buildMarketSnapshot(candles, config.symbol, config.timeframe);

    const triggers = triggerDetectionRules.detectTriggers(snapshot);

    if (triggers.length === 0) {
      return { trade: null, trigger: null, llmCalled: false };
    }

    const topTrigger = triggers[0];

    if (!triggerDetectionRules.validateTrigger(topTrigger)) {
      return { trade: null, trigger: topTrigger, llmCalled: false };
    }

    console.log(`[Event Engine] 🎯 Trigger detected: ${topTrigger.type} (${topTrigger.confidence}%)`);

    if (!config.useLLM || !this.apiKey) {
      const ruleBasedTrade = this.executeRuleBasedDecision(topTrigger, snapshot, config, openTrades);
      return { trade: ruleBasedTrade, trigger: topTrigger, llmCalled: false };
    }

    if (this.sessionTokenUsage >= this.MAX_TOKENS_PER_SESSION) {
      console.warn('[Event Engine] Token budget exhausted, using rule-based fallback');
      const ruleBasedTrade = this.executeRuleBasedDecision(topTrigger, snapshot, config, openTrades);
      return { trade: ruleBasedTrade, trigger: topTrigger, llmCalled: false };
    }

    const llmDecision = await this.callLLM(topTrigger, snapshot, openTrades);

    if (llmDecision.action === 'NO_TRADE') {
      console.log('[Event Engine] ✗ LLM declined: ' + llmDecision.reasoning);
      return { trade: null, trigger: topTrigger, llmCalled: true };
    }

    const validation = llmSnapshotBuilder.validateDecision(llmDecision);
    if (!validation.isValid) {
      console.warn('[Event Engine] LLM decision violated rules:', validation.violations);
      return { trade: null, trigger: topTrigger, llmCalled: true };
    }

    const trade = this.createTradeFromLLMDecision(llmDecision, topTrigger, snapshot);
    console.log(`[Event Engine] ✓ Trade approved: ${trade.direction.toUpperCase()} @ ${trade.entryPrice}`);

    return { trade, trigger: topTrigger, llmCalled: true };
  }

  /**
   * Build market snapshot from candle data
   */
  private buildMarketSnapshot(candles: any[], symbol: string, timeframe: string): MarketSnapshot {
    const recentCandles = candles.slice(-50);
    const currentCandle = candles[candles.length - 1];

    const closes = recentCandles.map(c => c.close);
    const highs = recentCandles.map(c => c.high);
    const lows = recentCandles.map(c => c.low);
    const volumes = recentCandles.map(c => c.volume || 1000);

    const vwap = this.calculateVWAP(recentCandles.slice(-20));
    const ema20 = this.calculateEMA(closes, 20);
    const ema50 = this.calculateEMA(closes, 50);
    const atr = this.calculateATR(highs.slice(-14), lows.slice(-14), closes.slice(-14));
    const volumeBaseline = volumes.slice(-20).reduce((sum, v) => sum + v, 0) / 20;

    const trend = this.determineTrend(ema20, ema50, closes[closes.length - 1]);
    const volatility = this.determineVolatility(atr, closes[closes.length - 1]);
    const momentum = this.calculateMomentum(closes);

    return {
      symbol,
      timestamp: new Date(currentCandle.open_time),
      ohlc: recentCandles.map(c => ({
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume || 1000
      })),
      indicators: {
        vwap,
        ema20,
        ema50,
        atr,
        volumeBaseline
      },
      priceAction: {
        trend,
        volatility,
        momentum
      }
    };
  }

  /**
   * Call LLM for trade decision
   */
  private async callLLM(
    trigger: TriggerEvent,
    snapshot: MarketSnapshot,
    openPositions: SimulatedTrade[]
  ): Promise<LLMTradeDecision> {
    try {
      const llmSnapshot = llmSnapshotBuilder.buildSnapshot(
        trigger,
        snapshot.ohlc,
        snapshot.indicators,
        snapshot.priceAction,
        openPositions
      );

      const prompt = llmSnapshotBuilder.formatSnapshotAsPrompt(llmSnapshot);

      console.log('[Event Engine] 🤖 Calling LLM for evaluation...');
      const startTime = Date.now();

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.GPT_MODEL,
          messages: [
            {
              role: 'system',
              content: 'You are Pipnosis, an elite short-term intraday AI trader. Respond with valid JSON only.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 800
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Event Engine] LLM API error:', errorText);
        return {
          action: 'NO_TRADE',
          confidence: 0,
          reasoning: 'LLM API error'
        };
      }

      const data = await response.json();
      const latency = Date.now() - startTime;
      const tokensUsed = data.usage?.total_tokens || 0;
      this.sessionTokenUsage += tokensUsed;

      console.log(`[Event Engine] LLM response received (${latency}ms, ${tokensUsed} tokens)`);

      const content = data.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No content in LLM response');
      }

      return llmSnapshotBuilder.parseLLMResponse(content);
    } catch (error) {
      console.error('[Event Engine] LLM call failed:', error);
      return {
        action: 'NO_TRADE',
        confidence: 0,
        reasoning: 'LLM call failed: ' + (error as Error).message
      };
    }
  }

  /**
   * Execute rule-based decision when LLM not available
   */
  private executeRuleBasedDecision(
    trigger: TriggerEvent,
    snapshot: MarketSnapshot,
    config: EventBasedEngineConfig,
    openPositions: SimulatedTrade[]
  ): SimulatedTrade | null {
    const currentPrice = snapshot.ohlc[snapshot.ohlc.length - 1].close;
    const { atr, vwap, ema20 } = snapshot.indicators;

    if (trigger.confidence < 70) {
      return null;
    }

    let direction: 'buy' | 'sell' = 'buy';
    let stopLoss: number;
    let takeProfit: number;

    if (trigger.type.includes('vwap')) {
      direction = currentPrice > vwap ? 'sell' : 'buy';
    } else if (trigger.type.includes('ema')) {
      direction = currentPrice > ema20 ? 'buy' : 'sell';
    } else if (snapshot.priceAction.trend === 'bullish') {
      direction = 'buy';
    } else if (snapshot.priceAction.trend === 'bearish') {
      direction = 'sell';
    }

    if (direction === 'buy') {
      stopLoss = currentPrice - atr * 1.5;
      takeProfit = currentPrice + atr * 2.5;
    } else {
      stopLoss = currentPrice + atr * 1.5;
      takeProfit = currentPrice - atr * 2.5;
    }

    const maxHoldMinutes = Math.min(
      PIPNOSIS_CORE_RULES.TRADE_DURATION_PREFERRED_MAX_HOURS * 60,
      180
    );

    return {
      id: `trade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      symbol: snapshot.symbol,
      timeframe: 'M15',
      direction,
      entryTime: snapshot.timestamp,
      entryPrice: currentPrice,
      stopLoss,
      takeProfit,
      positionSize: 0.01,
      confidence: trigger.confidence,
      reasoning: `Rule-based: ${trigger.context}`,
      triggerType: trigger.type,
      maxHoldMinutes,
      pnl: 0,
      outcome: 'open'
    };
  }

  /**
   * Create trade from LLM decision
   */
  private createTradeFromLLMDecision(
    decision: LLMTradeDecision,
    trigger: TriggerEvent,
    snapshot: MarketSnapshot
  ): SimulatedTrade {
    const direction = decision.action === 'BUY' ? 'buy' : 'sell';
    const entryPrice = decision.entry || snapshot.ohlc[snapshot.ohlc.length - 1].close;
    const maxHoldMinutes = Math.min(
      decision.maxHoldMinutes || PIPNOSIS_CORE_RULES.TRADE_DURATION_PREFERRED_MAX_HOURS * 60,
      PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_MINUTES
    );

    return {
      id: `trade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      symbol: snapshot.symbol,
      timeframe: 'M15',
      direction,
      entryTime: snapshot.timestamp,
      entryPrice,
      stopLoss: decision.stopLoss!,
      takeProfit: decision.takeProfit!,
      positionSize: 0.01,
      confidence: decision.confidence,
      reasoning: decision.reasoning,
      triggerType: trigger.type,
      maxHoldMinutes,
      pnl: 0,
      outcome: 'open'
    };
  }

  /**
   * Update open trades with current price
   */
  updateOpenTrades(openTrades: SimulatedTrade[], currentCandle: any): SimulatedTrade[] {
    const currentPrice = currentCandle.close;
    const currentTime = new Date(currentCandle.open_time);
    const updatedTrades: SimulatedTrade[] = [];

    for (const trade of openTrades) {
      const isTP = trade.direction === 'buy'
        ? currentPrice >= trade.takeProfit
        : currentPrice <= trade.takeProfit;

      const isSL = trade.direction === 'buy'
        ? currentPrice <= trade.stopLoss
        : currentPrice >= trade.stopLoss;

      const holdingMinutes = Math.floor((currentTime.getTime() - trade.entryTime.getTime()) / 60000);
      const maxDurationExceeded = holdingMinutes >= trade.maxHoldMinutes;

      if (isTP) {
        this.closeTrade(trade, trade.takeProfit, currentTime, 'take_profit');
      } else if (isSL) {
        this.closeTrade(trade, trade.stopLoss, currentTime, 'stop_loss');
      } else if (maxDurationExceeded) {
        this.closeTrade(trade, currentPrice, currentTime, 'max_duration');
      } else {
        updatedTrades.push(trade);
      }
    }

    return updatedTrades;
  }

  /**
   * Close a trade
   */
  private closeTrade(trade: SimulatedTrade, exitPrice: number, exitTime: Date, exitReason: string): void {
    trade.exitPrice = exitPrice;
    trade.exitTime = exitTime;
    trade.exitReason = exitReason;

    const pipValue = 0.0001;
    let pipsGained = 0;

    if (trade.direction === 'buy') {
      pipsGained = (exitPrice - trade.entryPrice) / pipValue;
    } else {
      pipsGained = (trade.entryPrice - exitPrice) / pipValue;
    }

    const pipValueInMoney = 10;
    const lotSize = trade.positionSize;
    trade.pnl = pipsGained * pipValueInMoney * lotSize;

    if (trade.pnl > 0.5) {
      trade.outcome = 'win';
    } else if (trade.pnl < -0.5) {
      trade.outcome = 'loss';
    } else {
      trade.outcome = 'breakeven';
    }

    trade.holdingMinutes = Math.floor((exitTime.getTime() - trade.entryTime.getTime()) / 60000);

    console.log(
      `[Event Engine] Trade closed: ${trade.outcome.toUpperCase()} - ${trade.direction.toUpperCase()} @ ${trade.entryPrice} -> ${exitPrice}, PnL: $${trade.pnl.toFixed(2)}, held ${trade.holdingMinutes}min`
    );
  }

  /**
   * Calculate VWAP
   */
  private calculateVWAP(candles: any[]): number {
    let totalPV = 0;
    let totalVolume = 0;

    for (const candle of candles) {
      const typical = (candle.high + candle.low + candle.close) / 3;
      const volume = candle.volume || 1000;
      totalPV += typical * volume;
      totalVolume += volume;
    }

    return totalVolume > 0 ? totalPV / totalVolume : candles[candles.length - 1].close;
  }

  /**
   * Calculate EMA
   */
  private calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1] || 0;

    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  /**
   * Calculate ATR
   */
  private calculateATR(highs: number[], lows: number[], closes: number[]): number {
    if (highs.length < 2) return 0.001;

    const trs = [];
    for (let i = 1; i < highs.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
      trs.push(tr);
    }

    return trs.reduce((sum, tr) => sum + tr, 0) / trs.length;
  }

  /**
   * Determine trend
   */
  private determineTrend(ema20: number, ema50: number, currentPrice: number): 'bullish' | 'bearish' | 'sideways' {
    if (ema20 > ema50 && currentPrice > ema20) return 'bullish';
    if (ema20 < ema50 && currentPrice < ema20) return 'bearish';
    return 'sideways';
  }

  /**
   * Determine volatility
   */
  private determineVolatility(atr: number, price: number): 'low' | 'medium' | 'high' {
    const atrPercent = (atr / price) * 100;
    if (atrPercent < 0.3) return 'low';
    if (atrPercent < 0.6) return 'medium';
    return 'high';
  }

  /**
   * Calculate momentum
   */
  private calculateMomentum(closes: number[]): number {
    if (closes.length < 10) return 50;

    const change = ((closes[closes.length - 1] - closes[closes.length - 10]) / closes[closes.length - 10]) * 100;
    return Math.min(100, Math.max(0, 50 + (change * 10)));
  }

  /**
   * Get session token usage
   */
  getTokenUsage(): number {
    return this.sessionTokenUsage;
  }

  /**
   * Reset session token usage
   */
  resetTokenUsage(): void {
    this.sessionTokenUsage = 0;
  }
}

export const eventBasedLLMEngine = new EventBasedLLMEngine();
