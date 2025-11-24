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
import { avoidPatternEnforcer } from './avoid-pattern-enforcer';
import { llmRegimeValidator } from './llm-regime-validator';
import { llmSetupQuality } from './llm-setup-quality';
import { llmMistakePrevention } from './llm-mistake-prevention';
import { llmConfidenceCalibrator } from './llm-confidence-calibrator';
import { developerModeLogger } from './developer-mode-logger';

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
  hardGateBlocks: number;
  layer1Aborts: number;
  layer2Aborts: number;
  layer3Aborts: number;
  fullPipelineExecutions: number;
}

class EventBasedLLMEngine {
  private apiKey: string;
  private readonly GPT_MODEL = 'gpt-4o';
  private sessionTokenUsage: number = 0;
  private readonly MAX_TOKENS_PER_SESSION = 50000;
  private userId: string | null = null;
  private sessionId: string | null = null;
  private use5LayerPipeline: boolean = true;

  constructor() {
    this.apiKey = typeof import.meta !== 'undefined' && import.meta.env
      ? import.meta.env.VITE_OPENAI_API_KEY || ''
      : process.env.VITE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
  }

  /**
   * Initialize engine with user context for 5-layer pipeline
   */
  async initialize(userId: string, sessionId: string | null = null): Promise<void> {
    this.userId = userId;
    this.sessionId = sessionId;
    await developerModeLogger.initialize(userId);
    console.log('[Event Engine] 5-Layer Pipeline initialized for user:', userId);
  }

  /**
   * Enable or disable 5-layer pipeline (default: enabled)
   */
  set5LayerPipeline(enabled: boolean): void {
    this.use5LayerPipeline = enabled;
    console.log(`[Event Engine] 5-Layer Pipeline: ${enabled ? 'ENABLED' : 'DISABLED'}`);
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
      console.log(`[Event Engine] ⚠️ Insufficient candles: ${candles.length}/50 required`);
      return { trade: null, trigger: null, llmCalled: false };
    }

    if (openTrades.length >= config.maxConcurrentTrades) {
      console.log(`[Event Engine] ⚠️ Max concurrent trades reached: ${openTrades.length}/${config.maxConcurrentTrades}`);
      return { trade: null, trigger: null, llmCalled: false };
    }

    const snapshot = this.buildMarketSnapshot(candles, config.symbol, config.timeframe);

    const triggers = triggerDetectionRules.detectTriggers(snapshot);

    if (triggers.length === 0) {
      console.log(`[Event Engine] 📊 No triggers detected (${config.symbol} @ ${snapshot.timestamp.toISOString()})`);
      return { trade: null, trigger: null, llmCalled: false };
    }

    const topTrigger = triggers[0];

    console.log(`[Event Engine] 🎯 ${triggers.length} trigger(s) detected! Top: ${topTrigger.type} (${topTrigger.confidence}%)`);

    if (!triggerDetectionRules.validateTrigger(topTrigger)) {
      console.log(`[Event Engine] ❌ Trigger validation FAILED: ${topTrigger.type}`);
      return { trade: null, trigger: topTrigger, llmCalled: false };
    }

    console.log(`[Event Engine] ✅ Trigger validated: ${topTrigger.type} (${topTrigger.confidence}%)`);

    if (!config.useLLM || !this.apiKey) {
      console.log(`[Event Engine] 🔧 LLM disabled or no API key - using rule-based fallback`);
      console.log(`  useLLM: ${config.useLLM}, hasApiKey: ${!!this.apiKey}`);
      const ruleBasedTrade = this.executeRuleBasedDecision(topTrigger, snapshot, config, openTrades);
      if (ruleBasedTrade) {
        console.log(`[Event Engine] ✓ Rule-based trade generated: ${ruleBasedTrade.direction.toUpperCase()}`);
      } else {
        console.log(`[Event Engine] ✗ Rule-based decision: NO_TRADE`);
      }
      return { trade: ruleBasedTrade, trigger: topTrigger, llmCalled: false };
    }

    if (this.sessionTokenUsage >= this.MAX_TOKENS_PER_SESSION) {
      console.warn(`[Event Engine] ⚠️ Token budget exhausted: ${this.sessionTokenUsage}/${this.MAX_TOKENS_PER_SESSION}`);
      console.warn('[Event Engine] Falling back to rule-based decisions');
      const ruleBasedTrade = this.executeRuleBasedDecision(topTrigger, snapshot, config, openTrades);
      return { trade: ruleBasedTrade, trigger: topTrigger, llmCalled: false };
    }

    console.log(`[Event Engine] 🚀 Calling 5-Layer LLM Pipeline... (Tokens: ${this.sessionTokenUsage}/${this.MAX_TOKENS_PER_SESSION})`);

    const llmDecision = await this.callLLM(topTrigger, snapshot, openTrades);

    console.log(`[Event Engine] 📋 LLM Decision: ${llmDecision.action}`);

    if (llmDecision.action === 'NO_TRADE') {
      console.log(`[Event Engine] ✗ LLM declined trade`);
      console.log(`  Reason: ${llmDecision.reasoning}`);
      console.log(`  Confidence: ${llmDecision.confidence}%`);
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
   * Call LLM for trade decision - now uses 5-layer pipeline
   */
  private async callLLM(
    trigger: TriggerEvent,
    snapshot: MarketSnapshot,
    openPositions: SimulatedTrade[]
  ): Promise<LLMTradeDecision> {
    if (this.use5LayerPipeline && this.userId) {
      return this.execute5LayerPipeline(trigger, snapshot, openPositions);
    } else {
      return this.executeSingleLLMCall(trigger, snapshot, openPositions);
    }
  }

  /**
   * Execute complete 5-layer pipeline with HARD GATE
   */
  private async execute5LayerPipeline(
    trigger: TriggerEvent,
    snapshot: MarketSnapshot,
    openPositions: SimulatedTrade[]
  ): Promise<LLMTradeDecision> {
    const pipelineStart = Date.now();
    let totalTokens = 0;

    console.log('\n========================================');
    console.log('🚀 STARTING 5-LAYER LLM PIPELINE');
    console.log(`Symbol: ${snapshot.symbol} | Trigger: ${trigger.type} | Confidence: ${trigger.confidence}%`);
    console.log('========================================\n');

    try {
      // ============================================================
      // HARD GATE: Avoid Pattern Enforcer
      // ============================================================
      console.log('[HARD GATE] 🚫 Checking avoid patterns...');
      const hardGateResult = await avoidPatternEnforcer.enforceAvoidPatterns(
        this.userId!,
        snapshot,
        trigger.type,
        'moderate'
      );

      await developerModeLogger.logAvoidPatternEvent(
        snapshot.symbol,
        trigger.type,
        hardGateResult.is_blocked,
        hardGateResult.block_reason,
        hardGateResult.matched_patterns
      );

      if (hardGateResult.is_blocked) {
        console.log(`[HARD GATE] 🚫 BLOCKED: ${hardGateResult.block_reason}`);
        await this.logPipelineCompletion(snapshot.symbol, trigger.type, {
          hardGateResult: 'blocked',
          layer1Passed: false,
          layer2Passed: false,
          layer3Passed: false,
          layer4Completed: false,
          layer5Executed: false,
          finalDecision: 'NO_TRADE',
          totalProcessingTimeMs: Date.now() - pipelineStart,
          totalTokensUsed: 0,
          layersExecuted: 0,
          abortLayer: 0,
          abortReason: hardGateResult.block_reason
        });
        return {
          action: 'NO_TRADE',
          confidence: 0,
          reasoning: hardGateResult.block_reason || 'Setup matches losing pattern'
        };
      }

      console.log('[HARD GATE] ✅ ALLOWED');

      // ============================================================
      // LAYER 1: Regime Validator
      // ============================================================
      console.log('\n[LAYER 1] 🔍 Regime Validation...');
      const layer1Start = Date.now();
      const regimeResult = await llmRegimeValidator.validateRegime(
        snapshot,
        trigger.type,
        trigger.confidence
      );
      const layer1Duration = Date.now() - layer1Start;
      totalTokens += 200;

      await developerModeLogger.logLayerDecision(
        this.sessionId,
        snapshot.symbol,
        1,
        'Regime Validator',
        regimeResult.recommendation,
        regimeResult,
        layer1Duration,
        200,
        regimeResult.regime_ok
      );

      if (!regimeResult.regime_ok || regimeResult.recommendation === 'abort') {
        console.log(`[LAYER 1] ❌ REJECTED: ${regimeResult.reasoning}`);
        await this.logPipelineCompletion(snapshot.symbol, trigger.type, {
          hardGateResult: 'allowed',
          layer1Passed: false,
          layer2Passed: false,
          layer3Passed: false,
          layer4Completed: false,
          layer5Executed: false,
          finalDecision: 'NO_TRADE',
          totalProcessingTimeMs: Date.now() - pipelineStart,
          totalTokensUsed: totalTokens,
          layersExecuted: 1,
          abortLayer: 1,
          abortReason: regimeResult.reasoning
        });
        this.sessionTokenUsage += totalTokens;
        return {
          action: 'NO_TRADE',
          confidence: 0,
          reasoning: `Regime validation failed: ${regimeResult.reasoning}`
        };
      }

      console.log(`[LAYER 1] ✅ PASSED - ${regimeResult.detected_regime.trend}/${regimeResult.detected_regime.volatility}`);

      // ============================================================
      // LAYER 2: Setup Quality Scorer
      // ============================================================
      console.log('\n[LAYER 2] 📊 Setup Quality Scoring...');
      const layer2Start = Date.now();
      const qualityResult = await llmSetupQuality.scoreSetup(
        snapshot,
        trigger.type,
        trigger.confidence,
        regimeResult,
        65
      );
      const layer2Duration = Date.now() - layer2Start;
      totalTokens += 300;

      await developerModeLogger.logLayerDecision(
        this.sessionId,
        snapshot.symbol,
        2,
        'Setup Quality',
        qualityResult.recommendation,
        qualityResult,
        layer2Duration,
        300,
        qualityResult.meets_threshold
      );

      if (!qualityResult.meets_threshold) {
        console.log(`[LAYER 2] ❌ REJECTED: Quality ${qualityResult.quality_score}/100`);
        await this.logPipelineCompletion(snapshot.symbol, trigger.type, {
          hardGateResult: 'allowed',
          layer1Passed: true,
          layer2Passed: false,
          layer3Passed: false,
          layer4Completed: false,
          layer5Executed: false,
          finalDecision: 'NO_TRADE',
          totalProcessingTimeMs: Date.now() - pipelineStart,
          totalTokensUsed: totalTokens,
          layersExecuted: 2,
          abortLayer: 2,
          abortReason: qualityResult.reasoning
        });
        this.sessionTokenUsage += totalTokens;
        return {
          action: 'NO_TRADE',
          confidence: 0,
          reasoning: `Quality insufficient: ${qualityResult.reasoning}`
        };
      }

      console.log(`[LAYER 2] ✅ PASSED - Quality: ${qualityResult.quality_score}/100`);

      // ============================================================
      // LAYER 3: Mistake Prevention Brain
      // ============================================================
      console.log('\n[LAYER 3] 🛡️ Mistake Prevention...');
      const layer3Start = Date.now();
      const mistakeResult = await llmMistakePrevention.checkForMistakes(
        this.userId!,
        snapshot,
        trigger.type,
        regimeResult,
        qualityResult
      );
      const layer3Duration = Date.now() - layer3Start;
      totalTokens += 300;

      await developerModeLogger.logLayerDecision(
        this.sessionId,
        snapshot.symbol,
        3,
        'Mistake Prevention',
        mistakeResult.recommendation,
        mistakeResult,
        layer3Duration,
        300,
        mistakeResult.allow_trade
      );

      if (!mistakeResult.allow_trade) {
        console.log(`[LAYER 3] 🚫 BLOCKED: ${mistakeResult.preventive_reasoning}`);
        await this.logPipelineCompletion(snapshot.symbol, trigger.type, {
          hardGateResult: 'allowed',
          layer1Passed: true,
          layer2Passed: true,
          layer3Passed: false,
          layer4Completed: false,
          layer5Executed: false,
          finalDecision: 'NO_TRADE',
          totalProcessingTimeMs: Date.now() - pipelineStart,
          totalTokensUsed: totalTokens,
          layersExecuted: 3,
          abortLayer: 3,
          abortReason: mistakeResult.preventive_reasoning
        });
        this.sessionTokenUsage += totalTokens;
        return {
          action: 'NO_TRADE',
          confidence: 0,
          reasoning: `Mistake prevention: ${mistakeResult.preventive_reasoning}`
        };
      }

      console.log(`[LAYER 3] ✅ PASSED - Risk: ${mistakeResult.risk_level}`);

      // ============================================================
      // LAYER 4: Confidence Calibrator
      // ============================================================
      console.log('\n[LAYER 4] 🎯 Confidence Calibration...');
      const layer4Start = Date.now();
      const calibrationResult = await llmConfidenceCalibrator.calibrateConfidence(
        this.userId!,
        snapshot.symbol,
        trigger.confidence,
        {
          triggerType: trigger.type,
          regimeQuality: regimeResult.confidence_in_regime,
          setupQuality: qualityResult.quality_score,
          riskLevel: mistakeResult.risk_level
        }
      );
      const layer4Duration = Date.now() - layer4Start;
      totalTokens += 200;

      await developerModeLogger.logLayerDecision(
        this.sessionId,
        snapshot.symbol,
        4,
        'Confidence Calibrator',
        calibrationResult.recommendation,
        calibrationResult,
        layer4Duration,
        200,
        true
      );

      const adjustment = calibrationResult.calibrated_confidence - trigger.confidence;
      console.log(`[LAYER 4] ✅ ${trigger.confidence}% → ${calibrationResult.calibrated_confidence}% (${adjustment > 0 ? '+' : ''}${adjustment.toFixed(1)}%)`);

      // Check if calibrator blocks trade in Mature Mode
      if (calibrationResult.calibratorCanBlockTrade && calibrationResult.calibrated_confidence < calibrationResult.minimumConfidenceApplied) {
        console.log(`[LAYER 4] 🚫 BLOCKED: Confidence ${calibrationResult.calibrated_confidence}% < ${calibrationResult.minimumConfidenceApplied}% (Mature Mode)`);
        await this.logPipelineCompletion(snapshot.symbol, trigger.type, {
          hardGateResult: 'allowed',
          layer1Passed: true,
          layer2Passed: true,
          layer3Passed: true,
          layer4Completed: true,
          layer5Executed: false,
          finalDecision: 'NO_TRADE',
          finalConfidence: trigger.confidence,
          calibratedConfidence: calibrationResult.calibrated_confidence,
          totalProcessingTimeMs: Date.now() - pipelineStart,
          totalTokensUsed: totalTokens,
          layersExecuted: 4,
          abortLayer: 4,
          abortReason: `Confidence too low: ${calibrationResult.calibrated_confidence}% (min ${calibrationResult.minimumConfidenceApplied}%)`
        });
        this.sessionTokenUsage += totalTokens;
        return {
          action: 'NO_TRADE',
          confidence: 0,
          reasoning: `Confidence calibration blocked trade: ${calibrationResult.calibrated_confidence}% below minimum ${calibrationResult.minimumConfidenceApplied}%`
        };
      }

      // In Learning Mode, log pass-through even if confidence is low
      if (calibrationResult.learningMode && calibrationResult.calibrated_confidence < 70) {
        console.log(`[LAYER 4] ⚠️ Low confidence (${calibrationResult.calibrated_confidence}%) but LEARNING MODE allows pass-through`);
      }

      // ============================================================
      // LAYER 5: Execution Brain (existing logic)
      // ============================================================
      console.log('\n[LAYER 5] 🎯 Execution Decision...');
      const layer5Start = Date.now();
      const executionResult = await this.executeSingleLLMCall(trigger, snapshot, openPositions, calibrationResult.calibrated_confidence);
      const layer5Duration = Date.now() - layer5Start;
      totalTokens += 500;

      await developerModeLogger.logLayerDecision(
        this.sessionId,
        snapshot.symbol,
        5,
        'Execution Brain',
        executionResult.action,
        executionResult,
        layer5Duration,
        500,
        true
      );

      console.log(`[LAYER 5] ✅ ${executionResult.action}`);

      // Log complete pipeline
      const totalDuration = Date.now() - pipelineStart;
      await this.logPipelineCompletion(snapshot.symbol, trigger.type, {
        hardGateResult: 'allowed',
        layer1Passed: true,
        layer2Passed: true,
        layer3Passed: true,
        layer4Completed: true,
        layer5Executed: true,
        finalDecision: executionResult.action,
        finalConfidence: trigger.confidence,
        calibratedConfidence: calibrationResult.calibrated_confidence,
        totalProcessingTimeMs: totalDuration,
        totalTokensUsed: totalTokens,
        layersExecuted: 5,
        abortLayer: null,
        abortReason: null
      });

      this.sessionTokenUsage += totalTokens;

      console.log('\n========================================');
      console.log('✅ PIPELINE COMPLETE');
      console.log(`Duration: ${totalDuration}ms | Tokens: ${totalTokens}`);
      console.log('========================================\n');

      return executionResult;

    } catch (error) {
      console.error('[5-Layer Pipeline] Error:', error);
      return {
        action: 'NO_TRADE',
        confidence: 0,
        reasoning: 'Pipeline error: ' + (error as Error).message
      };
    }
  }

  /**
   * Original single LLM call (Layer 5 only, or fallback)
   */
  private async executeSingleLLMCall(
    trigger: TriggerEvent,
    snapshot: MarketSnapshot,
    openPositions: SimulatedTrade[],
    overrideConfidence?: number
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

      console.log(`[Event Engine] LLM response received (${latency}ms, ${tokensUsed} tokens)`);

      const content = data.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No content in LLM response');
      }

      const decision = llmSnapshotBuilder.parseLLMResponse(content);

      if (overrideConfidence !== undefined) {
        decision.confidence = overrideConfidence;
      }

      return decision;
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
   * Log pipeline completion to database
   */
  private async logPipelineCompletion(symbol: string, triggerType: string, data: any): Promise<void> {
    if (!this.userId) return;
    await developerModeLogger.logPipelineExecution(
      this.sessionId,
      symbol,
      triggerType,
      data
    );
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
