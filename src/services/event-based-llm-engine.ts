/**
 * Pipnosis Alpha Brain Engine
 *
 * The unified autonomous trading brain for both backtesting and live trading.
 * Uses intelligent strategy planning + condition monitoring + execution decisions.
 * NO legacy systems, NO Flow V2 - Pure Pipnosis Alpha architecture.
 */

import { supabase } from '../lib/supabase';
import { PIPNOSIS_CORE_RULES } from '../lib/pipnosis-core-rules';
import { triggerDetectionRules, TriggerEvent, MarketSnapshot } from './trigger-detection-rules';
import { llmSnapshotBuilder, LLMSnapshot, LLMTradeDecision } from './llm-snapshot-builder';
import { rewardEngine, TraderScore } from './reward-engine';
import { llmStrategyBrain, StrategyPlan } from './llm-strategy-brain';
import { conditionMonitor } from './condition-monitor';
import { llmExecutionBrain } from './llm-execution-brain';
import { safetyEnforcer } from './safety-enforcer';
import { performanceAnalyzer } from './performance-analyzer';
import { developerModeLogger } from './developer-mode-logger';
import { openAIClient } from './openai-client';
import { calculatePositionSize, getCurrencyPipInfo, calculateDollarPerPip } from '../utils/currencyHelpers';

export interface EventBasedEngineConfig {
  symbol: string;
  timeframe: string;
  useLLM: boolean;
  riskMode: 'low' | 'medium' | 'high';
  maxConcurrentTrades: number;
  initialBalance?: number;
  goalContext?: {
    goalSessionId?: string;
    targetAmount: number;
    currentProgress: number;
    remainingAmount: number;
    tradesCompleted: number;
    tradesPlanned: number;
  };
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
  autonomousDecisions: number;
  safetyBlocks: number;
}

class EventBasedLLMEngine {
  private readonly GPT_MODEL = 'gpt-4o';
  private sessionTokenUsage: number = 0;
  private readonly MAX_TOKENS_PER_SESSION = 50000;
  private readonly TOKEN_RESET_WINDOW_HOURS = 4;
  private userId: string | null = null;
  private sessionId: string | null = null;
  private tokenWindowStart: number = Date.now();

  // Autonomous brain state
  private traderScore: TraderScore | null = null;
  private currentStrategy: StrategyPlan | null = null;
  private strategyPlanCount: number = 0;
  // Pipnosis Alpha is ALWAYS active - no fallback systems

  constructor() {
  }

  /**
   * Initialize Pipnosis Alpha Brain with user context
   */
  async initialize(userId: string, sessionId: string | null = null): Promise<void> {
    this.userId = userId;
    this.sessionId = sessionId;
    this.sessionTokenUsage = 0;
    this.tokenWindowStart = Date.now();
    await developerModeLogger.initialize(userId);

    // Load trader score
    this.traderScore = await rewardEngine.loadTraderScore(userId);
    console.log(`[Event Engine] 🧠 Autonomous Pipnosis Alpha initialized`);
    console.log(`[Event Engine] 📊 Trader Score: ${this.traderScore.current_score}/100`);
    console.log(`[Event Engine] 🎭 Personality: ${this.traderScore.confidence_level}`);
  }

  /**
   * Check if token budget needs to be reset (sliding window)
   */
  private checkTokenBudgetReset(): void {
    const now = Date.now();
    const windowElapsed = (now - this.tokenWindowStart) / (1000 * 60 * 60); // hours

    if (windowElapsed >= this.TOKEN_RESET_WINDOW_HOURS) {
      const previousUsage = this.sessionTokenUsage;
      this.sessionTokenUsage = 0;
      this.tokenWindowStart = now;
      console.log(`[Event Engine] 🔄 Token budget reset after ${windowElapsed.toFixed(1)}h (Used: ${previousUsage} tokens)`);
    }
  }

  /**
   * Pipnosis Alpha Brain is always enabled - no configuration needed
   */
  setAutonomousBrain(enabled: boolean): void {
    // Deprecated: Alpha is always active
    console.log('[Pipnosis Alpha] Brain is always enabled');
  }

  /**
   * Process a single candle and check for trade opportunities
   */
  async processCandle(
    candles: any[],
    config: EventBasedEngineConfig,
    openTrades: SimulatedTrade[] = [],
    goalContext?: {
      goalSessionId?: string;
      targetAmount: number;
      currentProgress: number;
      remainingAmount: number;
      tradesCompleted: number;
      tradesPlanned: number;
    }
  ): Promise<{ trade: SimulatedTrade | null; trigger: TriggerEvent | null; llmCalled: boolean }> {
    // Pipnosis Alpha is the ONLY trading path
    return this.processCandleAutonomous(candles, config, openTrades, goalContext);
  }

  /**
   * Process candle using autonomous Pipnosis Alpha brain
   */
  private async processCandleAutonomous(
    candles: any[],
    config: EventBasedEngineConfig,
    openTrades: SimulatedTrade[] = [],
    goalContext?: {
      goalSessionId?: string;
      targetAmount: number;
      currentProgress: number;
      remainingAmount: number;
      tradesCompleted: number;
      tradesPlanned: number;
    }
  ): Promise<{ trade: SimulatedTrade | null; trigger: TriggerEvent | null; llmCalled: boolean }> {
    if (candles.length < 50) {
      return { trade: null, trigger: null, llmCalled: false };
    }

    if (openTrades.length >= config.maxConcurrentTrades) {
      return { trade: null, trigger: null, llmCalled: false };
    }

    // STEP 1: Plan strategy (once per 100 candles)
    if (!this.currentStrategy || this.strategyPlanCount >= 100) {
      const marketState = llmSnapshotBuilder.buildMarketState(candles);
      const levels = llmSnapshotBuilder.detectSupportResistance(candles, marketState.price);

      const strategySnapshot = llmStrategyBrain.buildStrategySnapshot(
        candles,
        config.symbol,
        config.timeframe,
        {
          ema20: marketState.ema20,
          ema50: marketState.ema50,
          ema200: marketState.ema200,
          rsi: marketState.rsi,
          stochRsi: marketState.stochRsi,
          atr: marketState.atr,
          vwap: marketState.vwap
        },
        {
          trend: marketState.trend,
          momentum: marketState.momentum,
          volatility: marketState.volatility
        },
        {
          support: levels.support,
          resistance: levels.resistance,
          swingHigh: marketState.swingHigh,
          swingLow: marketState.swingLow
        }
      );

      this.currentStrategy = await llmStrategyBrain.planStrategy(
        strategySnapshot,
        this.traderScore!
      );
      this.strategyPlanCount = 0;
      console.log(`[Autonomous Brain] ✅ Strategy planned: ${this.currentStrategy.mode}`);
      console.log(`[Autonomous Brain] Watching for: ${this.currentStrategy.conditions.join(', ')}`);
      console.log(`[Autonomous Brain] Risk Level: ${this.currentStrategy.riskLevel}%`);
    }
    this.strategyPlanCount++;

    // STEP 2: Check conditions (NO LLM) with error recovery
    let conditionCheck;
    let marketState;
    try {
      marketState = llmSnapshotBuilder.buildMarketState(candles);
      conditionCheck = conditionMonitor.checkConditions(
        this.currentStrategy,
        marketState
      );

      if (!conditionCheck.ready) {
        const statusMsg = this.getDetailedConditionStatus(conditionCheck, marketState);
        console.log(`[Autonomous Brain] ${statusMsg}`);
        console.log(`[Autonomous Brain] Monitoring conditions... waiting for setup`);
        return { trade: null, trigger: null, llmCalled: false };
      }

      console.log(`[Autonomous Brain] ✅ Conditions met: ${conditionCheck.trigger}`);
    } catch (error) {
      console.error('[Autonomous Brain] ❌ Condition check failed:', error);
      console.log('[Autonomous Brain] Continuing to next scan (error recovery)');
      return { trade: null, trigger: null, llmCalled: false };
    }

    // STEP 3: Execute decision (LLM call)
    const direction = conditionCheck.trigger.toLowerCase().includes('buy') ? 'buy' : 'sell';
    const microSnapshot = llmExecutionBrain.buildMicroSnapshot(
      marketState.price,
      {
        ema50: marketState.ema50,
        ema200: marketState.ema200,
        rsi: marketState.rsi,
        stochRsi: marketState.stochRsi,
        atr: marketState.atr,
        vwap: marketState.vwap
      },
      {
        trend: marketState.trend,
        volatility: marketState.volatility
      },
      direction
    );

    console.log(`[Autonomous Brain] 🤖 Calling GPT-4o for trade validation...`);
    const decision = await llmExecutionBrain.decideTrade(
      conditionCheck.trigger,
      microSnapshot,
      this.traderScore!,
      this.currentStrategy.mode,
      conditionCheck.conditionsMet
    );

    if (decision.action === 'NO_TRADE') {
      console.log(`[Autonomous Brain] ✗ GPT-4o declined trade: ${decision.reasoning}`);
      return { trade: null, trigger: null, llmCalled: true };
    }

    console.log(`[Autonomous Brain] ✅ GPT-4o approved: ${decision.action} ${config.symbol}`);

    // STEP 4: Safety validation
    const balance = config.initialBalance || 10000;
    const currentExposure = openTrades.reduce((sum, t) => {
      const risk = Math.abs(t.entryPrice - t.stopLoss) * t.positionSize;
      return sum + (risk / balance);
    }, 0);

    const safetyCheck = safetyEnforcer.validateTrade(decision, {
      balance,
      currentExposure,
      openTrades: openTrades.length,
      dailyDrawdown: 0,
      atr: marketState.atr,
      currentPrice: marketState.price
    });

    if (!safetyCheck.passed) {
      console.warn(`[Autonomous] 🚫 Safety blocked:`);
      safetyCheck.violations.forEach(v => console.warn(`  - ${v}`));
      return { trade: null, trigger: null, llmCalled: true };
    }

    // Use adjusted decision if safety enforcer made improvements
    const finalDecision = safetyCheck.adjustedDecision || decision;

    // STEP 5: Calculate proper position size and create trade
    const riskModeMap = { low: 3, medium: 5, high: 10 };
    const riskPercent = riskModeMap[config.riskMode] || 5;

    const positionSize = calculatePositionSize(
      config.symbol,
      balance,
      riskPercent,
      finalDecision.entry,
      finalDecision.stopLoss
    );

    const currentCandle = candles[candles.length - 1];
    const trade: SimulatedTrade = {
      id: Math.random().toString(36).substring(7),
      symbol: config.symbol,
      timeframe: config.timeframe,
      direction: finalDecision.action.toLowerCase() as 'buy' | 'sell',
      entryTime: new Date(currentCandle.open_time),
      entryPrice: finalDecision.entry,
      stopLoss: finalDecision.stopLoss,
      takeProfit: finalDecision.takeProfit,
      positionSize: positionSize,
      confidence: finalDecision.confidence,
      reasoning: finalDecision.reasoning,
      triggerType: this.currentStrategy.mode,
      maxHoldMinutes: 240,
      pnl: 0,
      outcome: 'open'
    };

    console.log(`[Autonomous] ✓ Trade: ${trade.direction} @ ${trade.entryPrice}`);
    return { trade, trigger: null, llmCalled: true };
  }


  // Removed legacy methods:
  // - executeSingleLLMCall (Layer 5 fallback)
  // - logPipelineCompletion (5-layer logging)
  // - executeRuleBasedDecision (non-LLM fallback)
  // - createTradeFromLLMDecision (used by deleted processCandleLegacy)
  // All trade decisions now handled by Pipnosis Alpha Brain

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
   * Close a trade and calculate PnL
   * Uses currency-specific pip values and dollar-per-pip calculations
   */
  private closeTrade(trade: SimulatedTrade, exitPrice: number, exitTime: Date, exitReason: string): void {
    trade.exitPrice = exitPrice;
    trade.exitTime = exitTime;
    trade.exitReason = exitReason;

    // Get currency-specific pip information
    const pipInfo = getCurrencyPipInfo(trade.symbol);
    const pipValue = pipInfo.pipValue;

    // Calculate pips gained/lost
    let pipsGained = 0;
    if (trade.direction === 'buy') {
      pipsGained = (exitPrice - trade.entryPrice) / pipValue;
    } else {
      pipsGained = (trade.entryPrice - exitPrice) / pipValue;
    }

    // Calculate dollar value per pip for this position size
    const dollarPerPip = calculateDollarPerPip(trade.symbol, trade.positionSize);

    // Calculate final PnL
    trade.pnl = pipsGained * dollarPerPip;

    if (trade.pnl > 0.5) {
      trade.outcome = 'win';
    } else if (trade.pnl < -0.5) {
      trade.outcome = 'loss';
    } else {
      trade.outcome = 'breakeven';
    }

    trade.holdingMinutes = Math.floor((exitTime.getTime() - trade.entryTime.getTime()) / 60000);

    console.log(
      `[Event Engine] Trade closed: ${trade.outcome.toUpperCase()} - ${trade.direction.toUpperCase()} ${trade.symbol} @ ${trade.entryPrice} -> ${exitPrice}, ` +
      `${pipsGained.toFixed(1)} pips, $${dollarPerPip.toFixed(2)}/pip, PnL: $${trade.pnl.toFixed(2)}, held ${trade.holdingMinutes}min`
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

  /**
   * Send 5-layer pipeline results to AI conversation
   */
  private async sendPipelineResultsToConversation(
    snapshot: MarketSnapshot,
    trigger: TriggerEvent,
    regimeResult: any,
    qualityResult: any,
    mistakeResult: any,
    calibrationResult: any,
    executionResult: LLMTradeDecision,
    totalDuration: number
  ): Promise<void> {
    if (!this.userId || !this.sessionId) return;

    const isApproved = executionResult.action !== 'NO_TRADE';
    const emoji = isApproved ? '✅' : '🚫';

    const message = `🧠 5-Layer Analysis Complete (${totalDuration}ms)\\n` +
      `✓ Hard Gate: Pattern allowed\\n` +
      `✓ Layer 1: ${regimeResult.regime} / ${regimeResult.volatility} volatility\\n` +
      `✓ Layer 2: Quality ${qualityResult.quality_score}/100 - ${qualityResult.is_high_quality ? 'High quality' : 'Standard'}\\n` +
      `✓ Layer 3: ${mistakeResult.risk_level} risk - ${mistakeResult.mistakes_found === 0 ? 'No issues' : mistakeResult.mistakes_found + ' issues'}\\n` +
      `✓ Layer 4: Confidence ${trigger.confidence}% → ${calibrationResult.calibrated_confidence}% (${calibrationResult.confidence_delta >= 0 ? '+' : ''}${calibrationResult.confidence_delta}%)\\n` +
      `${emoji} Layer 5: ${executionResult.action}`;

    try {
      await supabase.from('goal_ai_conversations').insert({
        goal_session_id: this.sessionId,
        user_id: this.userId,
        role: 'ai',
        message,
        context: {
          pipeline_duration: totalDuration,
          trigger_type: trigger.type,
          final_decision: executionResult.action
        },
        sentiment: isApproved ? 'analytical' : 'cautionary',
        technical_data: {
          regime: regimeResult.regime,
          volatility: regimeResult.volatility,
          quality_score: qualityResult.quality_score,
          confidence_before: trigger.confidence,
          confidence_after: calibrationResult.calibrated_confidence
        },
        market_snapshot: {
          decision: executionResult.action,
          confidence: calibrationResult.calibrated_confidence,
          trend: regimeResult.regime
        }
      });
    } catch (error) {
      console.error('[Pipeline] Error sending to conversation:', error);
    }
  }

  /**
   * Handle trade close and update trader score
   */
  async onTradeClose(trade: SimulatedTrade): Promise<void> {
    if (!this.userId || !this.traderScore || !this.useAutonomousBrain) {
      return;
    }

    const outcome = trade.pnl > 0 ? 'win' : trade.pnl < 0 ? 'loss' : 'breakeven';

    const tradeContext = {
      symbol: trade.symbol,
      direction: trade.direction,
      entry_price: trade.entryPrice,
      exit_price: trade.exitPrice!,
      pnl: trade.pnl,
      risk_amount: 300,
      duration_minutes: trade.holdingMinutes || 0,
      max_drawdown: 0,
      atr: 0,
      outcome
    };

    try {
      // Apply reward/penalty
      if (outcome === 'win') {
        const reward = await rewardEngine.applyWinReward(
          this.userId,
          tradeContext,
          this.traderScore
        );
        console.log(`[Autonomous] 📈 Score: ${reward.oldScore} → ${reward.newScore}`);
      } else if (outcome === 'loss') {
        const penalty = await rewardEngine.applyLossPenalty(
          this.userId,
          tradeContext,
          this.traderScore
        );
        console.log(`[Autonomous] 📉 Score: ${penalty.oldScore} → ${penalty.newScore}`);
      }

      // Reload score
      this.traderScore = await rewardEngine.loadTraderScore(this.userId);

      // Analyze performance
      const scoreImpact = await rewardEngine.analyzeScoreImpact(this.userId, tradeContext);
      await performanceAnalyzer.analyzeTradePerformance(
        this.userId,
        tradeContext,
        scoreImpact,
        trade.id
      );

      console.log(`[Autonomous] 🎯 New personality: ${this.traderScore.confidence_level}`);
    } catch (error) {
      console.error('[Autonomous] Error updating trader score:', error);
    }
  }

  /**
   * Get detailed condition status with actual values
   */
  private getDetailedConditionStatus(
    conditionCheck: any,
    marketState: any
  ): string {
    const met = conditionCheck.conditionsMet || [];
    const failed = conditionCheck.conditionsFailed || [];
    const total = met.length + failed.length;

    if (total === 0) {
      return '⏳ No conditions to evaluate';
    }

    let status = `📊 Conditions: ${met.length}/${total} met`;

    if (met.length > 0) {
      status += `\n  ✅ ${met.join(', ')}`;
    }

    if (failed.length > 0 && failed.length <= 3) {
      status += `\n  ❌ Waiting: ${failed.join(', ')}`;
    }

    return status;
  }
}

export const eventBasedLLMEngine = new EventBasedLLMEngine();
