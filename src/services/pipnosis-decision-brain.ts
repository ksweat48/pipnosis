/**
 * Pipnosis Unified Decision Brain
 *
 * THE SINGLE SOURCE OF TRUTH FOR ALL TRADING DECISIONS
 * Used by: Synthetic Backtests, Smart Goal Mode, Live Demo Trading
 *
 * All trades go through the same 5-layer LLM pipeline + Hard Rule Engine
 * No mode-specific logic. No hardcoded formulas. Full LLM autonomy.
 */

import { supabase } from '../lib/supabase';
import { PIPNOSIS_CORE_RULES, PipnosisCoreRules } from '../lib/pipnosis-core-rules';
import { avoidPatternEnforcer } from './avoid-pattern-enforcer';
import { llmRegimeValidator } from './llm-regime-validator';
import { llmSetupQuality } from './llm-setup-quality';
import { llmMistakePrevention } from './llm-mistake-prevention';
import { llmConfidenceCalibrator } from './llm-confidence-calibrator';
import { llmStrategyBrain, type MarketSnapshot as LLMMarketSnapshot } from './llm-strategy-brain';
import { developerModeLogger } from './developer-mode-logger';
import { aiSkillTracker, type SkillLevel } from './ai-skill-tracker';

export type TradingMode = 'backtest' | 'live_demo' | 'smart_goal';

export interface SkillLevelContext {
  currentLevel: SkillLevel;
  currentLevelNumeric: number;
  targetLevel: SkillLevel;

  currentPerformance: {
    winRate: number;
    profitFactor: number;
    totalTrades: number;
    consistency: number;
  };

  targetRequirements: {
    minWinRate: number;
    minProfitFactor: number;
    minTrades: number;
    minConsistency: number;
  };

  gaps: {
    winRateGap: number;
    profitFactorGap: number;
    tradesGap: number;
    consistencyGap: number;
  };

  strategicGuidance: string[];
}

export type ExitStrategy = 'fixed_tp' | 'trailing_stop' | 'partial_exit' | 'indicator_based' | 'time_based';

export interface TradeDecision {
  action: 'enter_long' | 'enter_short' | 'no_trade' | 'hold' | 'close';
  direction?: 'buy' | 'sell';
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  positionSizePercent?: number;
  trailingStopConfig?: {
    enabled: boolean;
    distance: number;
    activationLevel?: number;
  };
  maxHoldMinutes?: number;
  confidence: number;
  reasoning: string;
  riskAssessment: string;
  setupType: string;
  exitStrategy?: ExitStrategy;
  keyFactors?: string[];
  alternativeScenarios?: string[];
  expectedRMultiple?: number;
  pipelineResults?: PipelineExecutionResult;
}

export interface DecisionContext {
  mode: TradingMode;
  symbol: string;
  timeframe: string;
  currentPrice: number;
  snapshot: {
    ohlc: Array<{ time: Date; open: number; high: number; low: number; close: number; volume?: number }>;
    indicators: {
      ema9?: number;
      ema21?: number;
      ema50?: number;
      rsi?: number;
      atr?: number;
      vwap?: number;
      [key: string]: number | undefined;
    };
    trend?: 'bullish' | 'bearish' | 'sideways';
    volatility?: 'low' | 'medium' | 'high';
  };
  triggerContext?: {
    type: string;
    confidence: number;
    context?: string;
  };
  userRiskSettings: {
    maxRiskPercent: number;
    maxConcurrentTrades: number;
    accountBalance: number;
    riskMode: 'low' | 'medium' | 'high';
  };
  sessionContext: {
    userId: string;
    sessionId: string | null;
    openPositions: number;
    currentExposure: number;
    dailyPnL?: number;
    goalProgress?: {
      targetAmount: number;
      currentProfit: number;
      progressPercent: number;
      remainingAmount: number;
      tradesCompleted: number;
    };
  };
  skillLevelContext?: SkillLevelContext;
  historicalContext?: {
    recentWinRate?: number;
    recentProfitFactor?: number;
    bestSetupType?: string;
    worstSetupType?: string;
    avgTradeDuration?: number;
    keyLessons?: string[];
  };
}

export interface PipelineExecutionResult {
  hardGateResult: 'allowed' | 'blocked';
  hardGateReason?: string;
  layer1Passed: boolean;
  layer1Reasoning?: string;
  layer2Passed: boolean;
  layer2Score?: number;
  layer3Passed: boolean;
  layer3Reasoning?: string;
  layer4Passed: boolean;
  layer4CalibratedConfidence?: number;
  layer5Executed: boolean;
  finalDecision: 'TRADE' | 'NO_TRADE';
  totalProcessingTimeMs: number;
  totalTokensUsed: number;
  layersExecuted: number;
  abortLayer?: number;
  abortReason?: string;
}

export interface TradeAdjustmentDecision {
  shouldAdjust: boolean;
  adjustmentType?: 'trailing_stop' | 'partial_exit' | 'move_sl_to_breakeven' | 'extend_tp' | 'early_exit';
  newStopLoss?: number;
  newTakeProfit?: number;
  partialClosePercent?: number;
  trailingDistance?: number;
  reasoning: string;
  confidence: number;
}

class PipnosisDecisionBrain {
  private sessionTokenUsage: number = 0;
  private readonly MAX_TOKENS_PER_SESSION = 50000;

  /**
   * Main entry point: Make a trade decision
   * This is called by ALL trading modes (backtest, live demo, smart goal)
   */
  async decideTrade(context: DecisionContext): Promise<TradeDecision> {
    const pipelineStart = Date.now();
    let totalTokens = 0;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`[PIPNOSIS BRAIN] DECISION REQUEST - Mode: ${context.mode.toUpperCase()}`);
    console.log(`Symbol: ${context.symbol} | Price: ${context.currentPrice}`);
    console.log(`${'='.repeat(80)}\n`);

    try {
      // ============================================================
      // SKILL LEVEL CONTEXT (ADMIN ONLY)
      // ============================================================
      if (!context.skillLevelContext) {
        const isAdmin = await this.checkIfUserIsAdmin(context.sessionContext.userId);
        if (isAdmin) {
          context.skillLevelContext = await this.fetchSkillLevelContext(context.sessionContext.userId);
          if (context.skillLevelContext) {
            console.log(`[SKILL CONTEXT] 📊 Level: ${context.skillLevelContext.currentLevel} → ${context.skillLevelContext.targetLevel}`);
            console.log(`[SKILL CONTEXT] WR: ${context.skillLevelContext.currentPerformance.winRate.toFixed(1)}% / ${context.skillLevelContext.targetRequirements.minWinRate}% (Gap: ${context.skillLevelContext.gaps.winRateGap > 0 ? '+' : ''}${context.skillLevelContext.gaps.winRateGap.toFixed(1)}%)`);
            console.log(`[SKILL CONTEXT] PF: ${context.skillLevelContext.currentPerformance.profitFactor.toFixed(2)} / ${context.skillLevelContext.targetRequirements.minProfitFactor.toFixed(2)} (Gap: ${context.skillLevelContext.gaps.profitFactorGap > 0 ? '+' : ''}${context.skillLevelContext.gaps.profitFactorGap.toFixed(2)})`);
          }
        }
      }

      const pipelineResult: PipelineExecutionResult = {
        hardGateResult: 'allowed',
        layer1Passed: false,
        layer2Passed: false,
        layer3Passed: false,
        layer4Passed: false,
        layer5Executed: false,
        finalDecision: 'NO_TRADE',
        totalProcessingTimeMs: 0,
        totalTokensUsed: 0,
        layersExecuted: 0
      };

      // ============================================================
      // HARD GATE: Avoid Pattern Enforcer
      // ============================================================
      console.log('[HARD GATE] 🚫 Checking Avoid Pattern Enforcer...');
      const hardGateResult = await avoidPatternEnforcer.evaluateSetup(
        context.sessionContext.userId,
        context.symbol,
        context.triggerContext?.type || 'manual_entry',
        'moderate'
      );

      totalTokens += 0;

      if (hardGateResult.is_blocked) {
        console.log(`[HARD GATE] ❌ BLOCKED: ${hardGateResult.block_reason}`);
        pipelineResult.hardGateResult = 'blocked';
        pipelineResult.hardGateReason = hardGateResult.block_reason || 'Matches losing pattern';
        pipelineResult.totalProcessingTimeMs = Date.now() - pipelineStart;
        pipelineResult.totalTokensUsed = totalTokens;

        await this.logPipelineExecution(context, pipelineResult);

        return {
          action: 'no_trade',
          confidence: 0,
          reasoning: hardGateResult.block_reason || 'Setup matches known losing pattern',
          riskAssessment: 'High risk of repeating past mistakes',
          setupType: context.triggerContext?.type || 'unknown',
          pipelineResults: pipelineResult
        };
      }

      console.log('[HARD GATE] ✅ ALLOWED - Proceeding to LLM pipeline');

      // ============================================================
      // LAYER 1: Regime Validator
      // ============================================================
      console.log('\n[LAYER 1] 🔍 Regime Validation...');
      const layer1Start = Date.now();

      const marketSnapshot = this.buildMarketSnapshotForLLM(context);
      const regimeResult = await llmRegimeValidator.validateRegime(
        marketSnapshot,
        context.triggerContext?.type || 'manual_entry',
        context.triggerContext?.confidence || 75,
        context.skillLevelContext
      );

      const layer1Duration = Date.now() - layer1Start;
      totalTokens += 200;
      pipelineResult.layersExecuted = 1;

      await developerModeLogger.logLayerDecision(
        context.sessionContext.sessionId,
        context.symbol,
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
        pipelineResult.layer1Reasoning = regimeResult.reasoning;
        pipelineResult.abortLayer = 1;
        pipelineResult.abortReason = regimeResult.reasoning;
        pipelineResult.totalProcessingTimeMs = Date.now() - pipelineStart;
        pipelineResult.totalTokensUsed = totalTokens;

        await this.logPipelineExecution(context, pipelineResult);

        return {
          action: 'no_trade',
          confidence: 0,
          reasoning: `Regime validation failed: ${regimeResult.reasoning}`,
          riskAssessment: 'Market conditions not suitable',
          setupType: context.triggerContext?.type || 'unknown',
          pipelineResults: pipelineResult
        };
      }

      console.log(`[LAYER 1] ✅ PASSED - ${regimeResult.detected_regime.trend}/${regimeResult.detected_regime.volatility}`);
      pipelineResult.layer1Passed = true;

      // ============================================================
      // LAYER 2: Setup Quality Evaluator
      // ============================================================
      console.log('\n[LAYER 2] 📊 Setup Quality Scoring...');
      const layer2Start = Date.now();

      const qualityResult = await llmSetupQuality.scoreSetup(
        marketSnapshot,
        context.triggerContext?.type || 'manual_entry',
        context.triggerContext?.confidence || 75,
        regimeResult,
        undefined,
        context.skillLevelContext
      );

      const layer2Duration = Date.now() - layer2Start;
      totalTokens += 250;
      pipelineResult.layersExecuted = 2;

      await developerModeLogger.logLayerDecision(
        context.sessionContext.sessionId,
        context.symbol,
        2,
        'Setup Quality',
        qualityResult.recommendation,
        qualityResult,
        layer2Duration,
        250,
        qualityResult.quality_score >= 65
      );

      if (qualityResult.quality_score < 65 || qualityResult.recommendation === 'abort') {
        console.log(`[LAYER 2] ❌ REJECTED: Quality=${qualityResult.quality_score}/100 (min 65)`);
        pipelineResult.layer2Score = qualityResult.quality_score;
        pipelineResult.abortLayer = 2;
        pipelineResult.abortReason = `Setup quality too low: ${qualityResult.quality_score}/100`;
        pipelineResult.totalProcessingTimeMs = Date.now() - pipelineStart;
        pipelineResult.totalTokensUsed = totalTokens;

        await this.logPipelineExecution(context, pipelineResult);

        return {
          action: 'no_trade',
          confidence: 0,
          reasoning: `Setup quality insufficient: ${qualityResult.quality_score}/100 (need 65+)`,
          riskAssessment: 'Low probability setup',
          setupType: context.triggerContext?.type || 'unknown',
          pipelineResults: pipelineResult
        };
      }

      console.log(`[LAYER 2] ✅ PASSED - Quality=${qualityResult.quality_score}/100`);
      pipelineResult.layer2Passed = true;
      pipelineResult.layer2Score = qualityResult.quality_score;

      // ============================================================
      // LAYER 3: Mistake Prevention Brain
      // ============================================================
      console.log('\n[LAYER 3] 🛡️ Mistake Prevention...');
      const layer3Start = Date.now();

      const mistakeResult = await llmMistakePrevention.checkForMistakes(
        context.sessionContext.userId,
        marketSnapshot,
        context.triggerContext?.type || 'manual_entry',
        regimeResult,
        qualityResult,
        context.skillLevelContext
      );

      const layer3Duration = Date.now() - layer3Start;
      totalTokens += 300;
      pipelineResult.layersExecuted = 3;

      await developerModeLogger.logLayerDecision(
        context.sessionContext.sessionId,
        context.symbol,
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
        pipelineResult.layer3Reasoning = mistakeResult.preventive_reasoning;
        pipelineResult.abortLayer = 3;
        pipelineResult.abortReason = mistakeResult.preventive_reasoning;
        pipelineResult.totalProcessingTimeMs = Date.now() - pipelineStart;
        pipelineResult.totalTokensUsed = totalTokens;

        await this.logPipelineExecution(context, pipelineResult);

        return {
          action: 'no_trade',
          confidence: 0,
          reasoning: `Mistake prevention: ${mistakeResult.preventive_reasoning}`,
          riskAssessment: 'High risk of repeating past mistakes',
          setupType: context.triggerContext?.type || 'unknown',
          pipelineResults: pipelineResult
        };
      }

      console.log(`[LAYER 3] ✅ PASSED - Risk: ${mistakeResult.risk_level}`);
      pipelineResult.layer3Passed = true;

      // ============================================================
      // LAYER 4: Confidence Calibrator
      // ============================================================
      console.log('\n[LAYER 4] 🎯 Confidence Calibration...');
      const layer4Start = Date.now();

      const calibrationResult = await llmConfidenceCalibrator.calibrateConfidence(
        context.sessionContext.userId,
        context.symbol,
        context.triggerContext?.confidence || 75,
        {
          triggerType: context.triggerContext?.type || 'manual_entry',
          regimeQuality: regimeResult.confidence_in_regime,
          setupQuality: qualityResult.quality_score,
          riskLevel: mistakeResult.risk_level
        },
        context.skillLevelContext
      );

      const layer4Duration = Date.now() - layer4Start;
      totalTokens += 200;
      pipelineResult.layersExecuted = 4;

      await developerModeLogger.logLayerDecision(
        context.sessionContext.sessionId,
        context.symbol,
        4,
        'Confidence Calibrator',
        calibrationResult.recommendation,
        calibrationResult,
        layer4Duration,
        200,
        true
      );

      const calibratedConfidence = calibrationResult.calibrated_confidence;
      const adjustment = calibratedConfidence - (context.triggerContext?.confidence || 75);
      console.log(`[LAYER 4] ✅ ${context.triggerContext?.confidence || 75}% → ${calibratedConfidence}% (${adjustment > 0 ? '+' : ''}${adjustment.toFixed(1)}%)`);

      pipelineResult.layer4Passed = true;
      pipelineResult.layer4CalibratedConfidence = calibratedConfidence;

      if (calibratedConfidence < 70) {
        console.log(`[LAYER 4] ❌ CONFIDENCE TOO LOW: ${calibratedConfidence}% (min 70%)`);
        pipelineResult.abortLayer = 4;
        pipelineResult.abortReason = `Calibrated confidence too low: ${calibratedConfidence}%`;
        pipelineResult.totalProcessingTimeMs = Date.now() - pipelineStart;
        pipelineResult.totalTokensUsed = totalTokens;

        await this.logPipelineExecution(context, pipelineResult);

        return {
          action: 'no_trade',
          confidence: calibratedConfidence,
          reasoning: `Insufficient confidence after calibration: ${calibratedConfidence}% (need 70%+)`,
          riskAssessment: 'Low confidence in setup success',
          setupType: context.triggerContext?.type || 'unknown',
          pipelineResults: pipelineResult
        };
      }

      // ============================================================
      // LAYER 5: Execution Brain (LLM Strategy Brain)
      // ============================================================
      console.log('\n[LAYER 5] 🎯 LLM Execution Brain...');
      const layer5Start = Date.now();

      const llmDecision = await this.callLLMExecutionBrain(
        context,
        calibratedConfidence,
        regimeResult,
        qualityResult
      );

      const layer5Duration = Date.now() - layer5Start;
      totalTokens += 500;
      pipelineResult.layersExecuted = 5;
      pipelineResult.layer5Executed = true;

      await developerModeLogger.logLayerDecision(
        context.sessionContext.sessionId,
        context.symbol,
        5,
        'Execution Brain',
        llmDecision.action,
        llmDecision,
        layer5Duration,
        500,
        true
      );

      console.log(`[LAYER 5] ✅ ${llmDecision.action}`);

      // Validate against Hard Rules
      const validationResult = PipnosisHardRuleEngine.validateTradeDecision(llmDecision, context);

      if (!validationResult.isValid) {
        console.log(`[HARD RULES] ❌ VIOLATION: ${validationResult.violations.join(', ')}`);
        pipelineResult.finalDecision = 'NO_TRADE';
        pipelineResult.abortReason = `Hard rule violation: ${validationResult.violations[0]}`;
        pipelineResult.totalProcessingTimeMs = Date.now() - pipelineStart;
        pipelineResult.totalTokensUsed = totalTokens;

        await this.logPipelineExecution(context, pipelineResult);

        return {
          action: 'no_trade',
          confidence: calibratedConfidence,
          reasoning: `Hard rule violation: ${validationResult.violations.join('; ')}`,
          riskAssessment: 'Violates safety constraints',
          setupType: llmDecision.setupType,
          pipelineResults: pipelineResult
        };
      }

      console.log('[HARD RULES] ✅ ALL CONSTRAINTS SATISFIED');

      pipelineResult.finalDecision = 'TRADE';
      pipelineResult.totalProcessingTimeMs = Date.now() - pipelineStart;
      pipelineResult.totalTokensUsed = totalTokens;

      await this.logPipelineExecution(context, pipelineResult);

      console.log(`\n${'='.repeat(80)}`);
      console.log(`[PIPNOSIS BRAIN] ✅ DECISION: ${llmDecision.action}`);
      console.log(`Confidence: ${calibratedConfidence}% | Setup: ${llmDecision.setupType}`);
      console.log(`Pipeline: ${totalTokens} tokens, ${(Date.now() - pipelineStart)}ms`);
      console.log(`${'='.repeat(80)}\n`);

      return {
        ...llmDecision,
        confidence: calibratedConfidence,
        pipelineResults: pipelineResult
      };

    } catch (error) {
      console.error('[PIPNOSIS BRAIN] ❌ ERROR:', error);

      return {
        action: 'no_trade',
        confidence: 0,
        reasoning: `Pipeline error: ${(error as Error).message}`,
        riskAssessment: 'System error',
        setupType: 'error'
      };
    }
  }

  /**
   * Decide if an open trade should be adjusted (trailing stop, partial exit, etc.)
   */
  async decideTradeAdjustment(
    context: DecisionContext,
    trade: {
      entryPrice: number;
      currentStopLoss: number;
      currentTakeProfit: number;
      direction: 'buy' | 'sell';
      entryTime: Date;
      unrealizedPnL: number;
    }
  ): Promise<TradeAdjustmentDecision> {
    // TODO: Implement real-time trade management
    // This will call LLM to determine if adjustments are needed
    // For now, return no adjustment
    return {
      shouldAdjust: false,
      reasoning: 'Trade management not yet implemented',
      confidence: 0
    };
  }

  private async callLLMExecutionBrain(
    context: DecisionContext,
    calibratedConfidence: number,
    regimeResult: any,
    qualityResult: any
  ): Promise<TradeDecision> {
    const llmSnapshot: LLMMarketSnapshot = {
      symbol: context.symbol,
      timeframes: {
        [context.timeframe]: {
          currentPrice: context.currentPrice,
          ema9: context.snapshot.indicators.ema9 || context.currentPrice,
          ema21: context.snapshot.indicators.ema21 || context.currentPrice,
          ema50: context.snapshot.indicators.ema50 || context.currentPrice,
          rsi: context.snapshot.indicators.rsi || 50,
          atr: context.snapshot.indicators.atr || context.currentPrice * 0.001,
          vwap: context.snapshot.indicators.vwap || context.currentPrice,
          trend: context.snapshot.trend || 'sideways',
          volatility: context.snapshot.volatility || 'medium'
        }
      },
      recentPriceAction: `${context.snapshot.trend || 'neutral'} trend`,
      openPositions: context.sessionContext.openPositions,
      accountExposure: context.sessionContext.currentExposure
    };

    const goalContext = context.sessionContext.goalProgress ? {
      targetAmount: context.sessionContext.goalProgress.targetAmount,
      currentProfit: context.sessionContext.goalProgress.currentProfit,
      progressPercent: context.sessionContext.goalProgress.progressPercent,
      remainingAmount: context.sessionContext.goalProgress.remainingAmount,
      tradesCompleted: context.sessionContext.goalProgress.tradesCompleted,
      avgProfitPerTrade: context.sessionContext.goalProgress.currentProfit / Math.max(1, context.sessionContext.goalProgress.tradesCompleted),
      sessionDuration: 'ongoing'
    } : undefined;

    const historyContext = context.historicalContext ? {
      recentWinRate: context.historicalContext.recentWinRate || 0,
      recentProfitFactor: context.historicalContext.recentProfitFactor || 1,
      bestSetupType: context.historicalContext.bestSetupType || 'unknown',
      worstSetupType: context.historicalContext.worstSetupType || 'unknown',
      avgTradeDuration: context.historicalContext.avgTradeDuration || 60,
      keyLessons: context.historicalContext.keyLessons || []
    } : undefined;

    const llmDecision = await llmStrategyBrain.makeDecision(
      llmSnapshot,
      goalContext,
      historyContext,
      context.sessionContext.userId,
      context.skillLevelContext
    );

    const direction = llmDecision.action === 'enter_long' ? 'buy' : llmDecision.action === 'enter_short' ? 'sell' : undefined;

    return {
      action: llmDecision.action === 'enter_long' || llmDecision.action === 'enter_short' ?
        (llmDecision.action === 'enter_long' ? 'enter_long' : 'enter_short') :
        llmDecision.action,
      direction,
      entryPrice: llmDecision.entryZone?.ideal || context.currentPrice,
      stopLoss: llmDecision.stopLoss,
      takeProfit: llmDecision.takeProfit,
      positionSizePercent: llmDecision.positionSizePercent,
      maxHoldMinutes: llmDecision.expectedDurationMinutes,
      confidence: calibratedConfidence,
      reasoning: llmDecision.reasoning,
      riskAssessment: llmDecision.riskAssessment,
      setupType: llmDecision.setupType,
      keyFactors: llmDecision.keyFactors,
      alternativeScenarios: llmDecision.alternativeScenarios,
      trailingStopConfig: {
        enabled: false,
        distance: context.snapshot.indicators.atr || context.currentPrice * 0.001
      }
    };
  }

  private buildMarketSnapshotForLLM(context: DecisionContext): any {
    const latestCandle = context.snapshot.ohlc[context.snapshot.ohlc.length - 1];

    return {
      symbol: context.symbol,
      timestamp: latestCandle?.time || new Date(),
      ohlc: context.snapshot.ohlc,
      indicators: context.snapshot.indicators,
      priceAction: {
        trend: context.snapshot.trend || 'sideways',
        volatility: context.snapshot.volatility || 'medium',
        momentum: 'neutral'
      }
    };
  }

  private async logPipelineExecution(
    context: DecisionContext,
    result: PipelineExecutionResult
  ): Promise<void> {
    try {
      await supabase.from('llm_pipeline_execution_log').insert({
        user_id: context.sessionContext.userId,
        session_id: context.sessionContext.sessionId,
        symbol: context.symbol,
        trading_mode: context.mode,
        trigger_type: context.triggerContext?.type || 'manual',
        hard_gate_result: result.hardGateResult,
        layer_1_passed: result.layer1Passed,
        layer_2_passed: result.layer2Passed,
        layer_3_passed: result.layer3Passed,
        layer_4_passed: result.layer4Passed,
        layer_5_executed: result.layer5Executed,
        final_decision: result.finalDecision,
        abort_layer: result.abortLayer,
        abort_reason: result.abortReason,
        total_processing_time_ms: result.totalProcessingTimeMs,
        total_tokens_used: result.totalTokensUsed,
        layers_executed: result.layersExecuted,
        created_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('[Pipeline Log] Error logging execution:', error);
    }
  }

  private async checkIfUserIsAdmin(userId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('is_admin')
        .eq('id', userId)
        .maybeSingle();

      if (error || !data) return false;
      return data.is_admin === true;
    } catch (error) {
      console.error('[Skill Context] Error checking admin status:', error);
      return false;
    }
  }

  private async fetchSkillLevelContext(userId: string): Promise<SkillLevelContext | null> {
    try {
      const skillProgression = await aiSkillTracker.getSkillProgression(userId);
      if (!skillProgression) return null;

      const thresholds = aiSkillTracker.getSkillLevelThresholds();
      const currentLevelIndex = thresholds.findIndex(t => t.level === skillProgression.currentSkillLevel);

      if (currentLevelIndex === -1 || currentLevelIndex >= thresholds.length - 1) {
        return null;
      }

      const currentThreshold = thresholds[currentLevelIndex];
      const nextThreshold = thresholds[currentLevelIndex + 1];

      const winRateGap = skillProgression.currentWinRate - nextThreshold.minWinRate;
      const profitFactorGap = skillProgression.currentProfitFactor - nextThreshold.minProfitFactor;
      const tradesGap = skillProgression.totalTradesAnalyzed - nextThreshold.minTrades;
      const consistencyGap = 50 - nextThreshold.minConsistency;

      const strategicGuidance = this.generateStrategicGuidance({
        winRateGap,
        profitFactorGap,
        tradesGap,
        consistencyGap,
        currentLevel: skillProgression.currentSkillLevel,
        targetLevel: nextThreshold.level
      });

      return {
        currentLevel: skillProgression.currentSkillLevel,
        currentLevelNumeric: skillProgression.skillLevelNumeric,
        targetLevel: nextThreshold.level,
        currentPerformance: {
          winRate: skillProgression.currentWinRate,
          profitFactor: skillProgression.currentProfitFactor,
          totalTrades: skillProgression.totalTradesAnalyzed,
          consistency: 50
        },
        targetRequirements: {
          minWinRate: nextThreshold.minWinRate,
          minProfitFactor: nextThreshold.minProfitFactor,
          minTrades: nextThreshold.minTrades,
          minConsistency: nextThreshold.minConsistency
        },
        gaps: {
          winRateGap,
          profitFactorGap,
          tradesGap,
          consistencyGap
        },
        strategicGuidance
      };
    } catch (error) {
      console.error('[Skill Context] Error fetching skill progression:', error);
      return null;
    }
  }

  private generateStrategicGuidance(params: {
    winRateGap: number;
    profitFactorGap: number;
    tradesGap: number;
    consistencyGap: number;
    currentLevel: SkillLevel;
    targetLevel: SkillLevel;
  }): string[] {
    const guidance: string[] = [];

    if (params.winRateGap < 0) {
      const gapAbs = Math.abs(params.winRateGap);
      if (gapAbs > 10) {
        guidance.push(`CRITICAL: Increase win rate by ${gapAbs.toFixed(1)}% - Be highly selective, only take 75+ quality setups`);
      } else if (gapAbs > 5) {
        guidance.push(`Win rate needs ${gapAbs.toFixed(1)}% improvement - Raise quality bar to 70+ minimum`);
      } else {
        guidance.push(`Win rate nearly on target (need +${gapAbs.toFixed(1)}%) - Maintain current selectiveness`);
      }
    } else {
      guidance.push(`Win rate ABOVE target (+${params.winRateGap.toFixed(1)}%) - Excellent selectiveness`);
    }

    if (params.profitFactorGap < 0) {
      const gapAbs = Math.abs(params.profitFactorGap);
      if (gapAbs > 0.5) {
        guidance.push(`Profit factor low (need +${gapAbs.toFixed(2)}) - Focus on higher R:R setups (2.5:1+) and let winners run`);
      } else if (gapAbs > 0.2) {
        guidance.push(`Profit factor needs improvement (+${gapAbs.toFixed(2)}) - Extend take profits in strong trends`);
      } else {
        guidance.push(`Profit factor close to target (+${gapAbs.toFixed(2)}) - Continue current R:R strategy`);
      }
    } else {
      guidance.push(`Profit factor ABOVE target (+${params.profitFactorGap.toFixed(2)}) - Excellent trade management`);
    }

    if (params.consistencyGap < 0) {
      guidance.push(`Consistency needs improvement - Avoid erratic pairs and marginal setups`);
    }

    if (params.tradesGap < 0) {
      const remaining = Math.abs(params.tradesGap);
      if (remaining > 50000) {
        guidance.push(`Long journey ahead (${remaining.toLocaleString()} trades to ${params.targetLevel}) - Focus on quality learning, not speed`);
      } else if (remaining > 1000) {
        guidance.push(`${remaining.toLocaleString()} trades remaining to ${params.targetLevel} - Maintain quality while building experience`);
      } else {
        guidance.push(`Almost there! ${remaining} trades to ${params.targetLevel} - Don't compromise quality at the finish line`);
      }
    }

    if (guidance.length === 0) {
      guidance.push(`All metrics on track for ${params.targetLevel} - Maintain current strategy`);
    }

    return guidance;
  }
}

/**
 * Hard Rule Engine - Validates all trade decisions
 * These rules are NON-NEGOTIABLE and cannot be overridden
 */
export class PipnosisHardRuleEngine {
  static validateTradeDecision(
    decision: TradeDecision,
    context: DecisionContext
  ): { isValid: boolean; violations: string[]; adjustedDecision?: TradeDecision } {
    const violations: string[] = [];

    if (decision.action === 'no_trade' || decision.action === 'hold' || decision.action === 'close') {
      return { isValid: true, violations: [] };
    }

    if (!decision.stopLoss || !decision.takeProfit || !decision.entryPrice) {
      violations.push('Missing required trade parameters (SL, TP, or Entry)');
      return { isValid: false, violations };
    }

    const entryPrice = decision.entryPrice;
    const stopLoss = decision.stopLoss;
    const takeProfit = decision.takeProfit;

    const isLong = decision.action === 'enter_long' || decision.direction === 'buy';

    if (isLong) {
      if (stopLoss >= entryPrice) {
        violations.push(`Stop loss (${stopLoss}) must be below entry (${entryPrice}) for long trades`);
      }
      if (takeProfit <= entryPrice) {
        violations.push(`Take profit (${takeProfit}) must be above entry (${entryPrice}) for long trades`);
      }
    } else {
      if (stopLoss <= entryPrice) {
        violations.push(`Stop loss (${stopLoss}) must be above entry (${entryPrice}) for short trades`);
      }
      if (takeProfit >= entryPrice) {
        violations.push(`Take profit (${takeProfit}) must be below entry (${entryPrice}) for short trades`);
      }
    }

    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);
    const riskRewardRatio = reward / risk;

    if (riskRewardRatio < 1.5) {
      violations.push(`Risk:Reward ratio ${riskRewardRatio.toFixed(2)}:1 is below minimum 1.5:1`);
    }

    if (decision.maxHoldMinutes && decision.maxHoldMinutes > PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_MINUTES) {
      violations.push(`Max hold time ${decision.maxHoldMinutes} minutes exceeds limit of ${PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_MINUTES} minutes`);
    }

    if (decision.positionSizePercent && decision.positionSizePercent > context.userRiskSettings.maxRiskPercent) {
      violations.push(`Position size ${decision.positionSizePercent}% exceeds user max ${context.userRiskSettings.maxRiskPercent}%`);
    }

    if (context.sessionContext.openPositions >= context.userRiskSettings.maxConcurrentTrades) {
      violations.push(`Already at max concurrent trades (${context.userRiskSettings.maxConcurrentTrades})`);
    }

    if (decision.confidence < 70) {
      violations.push(`Confidence ${decision.confidence}% below minimum 70%`);
    }

    return { isValid: violations.length === 0, violations };
  }

  static validateTradeAdjustment(
    originalStopLoss: number,
    newStopLoss: number,
    currentPrice: number,
    direction: 'buy' | 'sell'
  ): { isValid: boolean; violations: string[] } {
    const violations: string[] = [];

    if (direction === 'buy') {
      if (newStopLoss < originalStopLoss) {
        violations.push('Cannot widen stop loss (move lower) on long position');
      }
      if (newStopLoss > currentPrice) {
        violations.push('Cannot move stop loss above current price on long position');
      }
    } else {
      if (newStopLoss > originalStopLoss) {
        violations.push('Cannot widen stop loss (move higher) on short position');
      }
      if (newStopLoss < currentPrice) {
        violations.push('Cannot move stop loss below current price on short position');
      }
    }

    return { isValid: violations.length === 0, violations };
  }
}

export const pipnosisDecisionBrain = new PipnosisDecisionBrain();
