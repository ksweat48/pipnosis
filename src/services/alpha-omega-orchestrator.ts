/**
 * Alpha + Omega Orchestrator
 *
 * CCIP-2026-02-24: Omega Council Refactor — Raw Data to Alpha
 *
 * Central service that:
 * - Builds a raw market snapshot (SSOT) from shared intelligence
 * - Calls Omega-8 (Orderflow) for genuine orderflow computation
 * - Passes raw market briefing to Alpha coordinator
 * - Handles errors gracefully
 *
 * ARCHITECTURE:
 * Omega specialists 1-5 (Trend, Scalper, Confirmation, Reversal, Volatility)
 * have been removed from this pipeline. They were synthesizing bias labels
 * (BULLISH, FAVORABLE, score:45) which pre-framed Alpha's reasoning.
 * Alpha now receives pure raw market data and reasons independently.
 *
 * Only Omega-8 (Orderflow) remains — it detects Equal Highs/Lows, Liquidity
 * Sweeps, and Fair Value Gaps, which are genuine computations not present
 * in the raw snapshot.
 */

import { riskPreflightGate, type RiskPreflightInput } from './risk-preflight-gate';
import { omega8Hybrid, type Omega8MarketSnapshot } from '../brains/omega8-hybrid-orderflow';
import { alphaCoordinator, type OmegaCouncilVotes, type MarketContext, type AlphaDecision } from '../brains/coordinator-alpha';
import { midTradeMonitor, type MidTradeSnapshot, type MidTradeDecision } from '../brains/midtrade-monitor';
import type { TraderScore } from './ai-identity';
import { omegaAlphaLogger } from './omega-alpha-logger';
import type { OmegaSensors } from './omega-sensors';
import type { RegimeSnapshot } from './regime-oracle';
import type { AdversarialSignal } from './adversarial-detector';
import { buildMarketBriefing } from './market-briefing-builder';
import type { MarketSnapshotInput } from '../types/market-briefing';
import { sentimentCoordinator } from './sentiment-coordinator';
import type { AggregatedSentiment } from './sentiment-aggregator';
import { sharedIntelligenceCoordinator } from './shared-intelligence-coordinator';
import type { MarketSnapshotData } from './market-snapshot-cache';
import { tradeExecutionFreshnessGate, type ExecutionContext } from './trade-execution-freshness-gate';
import { getMTFConfig, getStyleMTFConfig, resolveCanonicalStyle, type Timeframe, type RiskMode } from '../config/timeframe-hierarchy';

import { createTradeContext, type TradeContext } from '../utils/tradeMath';
import { validatePreFlight, createBlockedDecision } from './ssot-preflight-guard';
import { freshnessBlockLogger } from './freshness-block-logger';
import { FreshnessBlockCategory } from '../types/freshness-block';
import { confidenceCalculationEngine } from './confidence-calculation-engine';
import {
  getConcurrentExecutionConfig,
  isConcurrentExecutionEnabled,
  formatConcurrentConfigForLogging,
  getSessionTimeout,
  getIntraBatchStaggerMs,
  type MarketSession
} from '../config/concurrent-execution-config';
import { ALPHA_IDENTITY } from '../config/alpha-identity';
import { marketScheduleService } from './market-schedule-service';
import { calculateSessionContext } from '../utils/marketHours';
import { deriveMarketPhase } from '../utils/market-phase-deriver';
import { omega9ConstraintProvider } from './omega9-constraint-provider';


export interface FullMarketState {
  symbol: string;
  price: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  stochRsi: number;
  atr: number;
  vwap: number;
  trend: string;
  volatility: string;
  momentum: number;
  support: number[];
  resistance: number[];
  swingHigh: number;
  swingLow: number;
  recentCandles: any[];
  structure?: { hh: boolean; hl: boolean; lh: boolean; ll: boolean };
  omegaSensors: OmegaSensors; // Pro-trader indicators at zero cost
  regime?: RegimeSnapshot; // Market regime intelligence (session, volatility, structure)
  adversarial?: AdversarialSignal; // Adversarial manipulation detection
  sentiment?: AggregatedSentiment; // Omega-7 market sentiment analysis
}

export interface TradePosition {
  direction: 'buy' | 'sell';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  entryTime: Date;
  symbol: string;
  positionSize: number;
  riskPct: number;
}

class AlphaOmegaOrchestrator {
  private cacheStats = {
    hits: 0,
    misses: 0,
    totalSaved: 0
  };

  /**
   * Run full Alpha + Omega decision pipeline
   */
  async makeTradeDecision(
    marketState: FullMarketState,
    traderScore: TraderScore,
    proposedSL: number,
    proposedTP: number,
    goalContext?: import('../brains/coordinator-alpha').GoalContext,
    userId?: string,
    imSignal?: Record<string, unknown>
  ): Promise<AlphaDecision> {

    // ✅ SSOT GUARDRAIL #1: Create TradeContext (MANDATORY for all math operations)
    const contextResult = createTradeContext(marketState.symbol);

    if (!contextResult.success || !contextResult.context) {
      console.error(`[Alpha+Omega] 🚫 SSOT VIOLATION: Failed to create TradeContext - ${contextResult.error}`);
      return {
        action: 'NO_TRADE',
        decision: 'NO_TRADE',
        entry: marketState.price,
        stopLoss: proposedSL,
        takeProfit: proposedTP,
        confidence: 0,
        reasoning: `SSOT VIOLATION: ${contextResult.error}`,
        omega_summary: `Math operations blocked - no valid TradeContext (error: ${contextResult.errorCode})`
      };
    }

    const tradeContext = contextResult.context;

    // ✅ SSOT GUARDRAIL #2: Validate TradeContext integrity (pre-flight check)
    const preFlightValidation = await validatePreFlight(tradeContext, marketState.symbol, 'alpha-omega-orchestrator');

    if (!preFlightValidation.passed) {
      console.error(`[Alpha+Omega] 🚫 SSOT PRE-FLIGHT FAILED: ${preFlightValidation.error}`);
      const blockedDecision = createBlockedDecision(preFlightValidation, marketState.symbol);
      return {
        ...blockedDecision,
        entry: marketState.price,
        stopLoss: proposedSL,
        takeProfit: proposedTP,
        omega_summary: `Pre-flight validation failed: ${preFlightValidation.violationType}`
      };
    }


    // CCIP-STYLE-TF-2026: Style is the SSOT for entry timeframe.
    // Risk mode controls financial exposure only — never timeframe or style selection.
    const riskMode: RiskMode = goalContext?.riskMode || 'medium';
    const resolvedOmegaStyle = resolveCanonicalStyle(goalContext?.tradeStyle, 'SCALP');
    const styleMTFConfig = getStyleMTFConfig(resolvedOmegaStyle);
    const entryTimeframe: Timeframe = styleMTFConfig.entryTimeframe;

    // Capture signal price and timestamp at analysis time (for drift detection)
    const signalPrice = marketState.price;
    const signalTimestamp = Date.now();

    // FRESHNESS ADVISORY: Check data quality but don't block (except for critical staleness)
    const preCheck = await tradeExecutionFreshnessGate.preCheckFreshness(marketState.symbol);

    const isCriticallyStale = preCheck.reason?.includes('stale') && !preCheck.shouldProceed;

    if (isCriticallyStale) {
      console.error(`[Alpha+Omega] HARD BLOCK: ${preCheck.reason} (DATA INTEGRITY)`);

      if (userId) {
        freshnessBlockLogger.logOmegaBlock(
          marketState.symbol,
          entryTimeframe,
          FreshnessBlockCategory.BLOCK_STALE_PRICE_FEED,
          { symbol: marketState.symbol, reason: preCheck.reason || 'critically stale', refreshAttempted: false, wasAutoRefreshed: false },
          userId
        );
      }

      return {
        action: 'NO_TRADE',
        decision: 'NO_TRADE',
        entry: marketState.price,
        stopLoss: proposedSL,
        takeProfit: proposedTP,
        confidence: 0,
        reasoning: `HARD BLOCK - DATA INTEGRITY: ${preCheck.reason}`,
        omega_summary: 'Execution blocked - price data critically stale (>5min), violates SSOT'
      };
    }

    if (!preCheck.shouldProceed) {

      if (userId) {
        freshnessBlockLogger.logOmegaBlock(
          marketState.symbol,
          entryTimeframe,
          FreshnessBlockCategory.BLOCK_STALE_PRICE_FEED,
          { symbol: marketState.symbol, reason: preCheck.reason || 'advisory staleness', refreshAttempted: false, wasAutoRefreshed: false, advisory: true },
          userId
        );
      }
    }

    // ✅ STEP 0: Get Market Context from Regime Analysis (if not already provided)
    let sentiment = marketState.sentiment;
    if (!sentiment) {
      try {
        sentiment = await sentimentCoordinator.getCurrentSentiment(
          marketState.symbol,
          marketState.recentCandles,
          marketState,
          new Date(signalTimestamp)
        );
        if (sentiment) {
          marketState.sentiment = sentiment; // Add to market state for Omegas
        } else {
        }
      } catch (error) {
      }
    }

    // ✅ NEW: Get shared snapshot ONCE (SSOT for all Omegas)
    // This is THE critical change: one snapshot, not 7+ separate queries
    let snapshot: MarketSnapshotData;
    try {
      snapshot = await sharedIntelligenceCoordinator.getMarketSnapshot(
        marketState.symbol,
        entryTimeframe
      );
    } catch (error) {
      console.error(`[Alpha+Omega] ❌ Failed to build snapshot:`, error);
      return {
        action: 'NO_TRADE',
        decision: 'NO_TRADE',
        entry: marketState.price,
        stopLoss: proposedSL,
        takeProfit: proposedTP,
        confidence: 0,
        reasoning: `Snapshot build failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        omega_summary: 'System error - no market snapshot available'
      };
    }

    // CCIP-STALENESS-FIX-2026-02-20: Price Drift Guard
    // If the snapshot price has drifted materially from the signal price captured at
    // pipeline entry, the snapshot is structurally stale. We invalidate it and force a
    // fresh fetch rather than letting Alpha reason against an already-wrong picture.
    // Threshold: 15 pips for majors/crosses, 50 pips for indices (US30/NAS100), 20 pips for gold.
    // This is a hard block on the SNAPSHOT — it does NOT call the LLM until data is fresh.
    try {
      const { calculatePipDistance } = await import('../utils/currencyHelpers');
      const driftPips = Math.abs(calculatePipDistance(marketState.symbol, signalPrice, snapshot.price));
      const DRIFT_THRESHOLDS: Record<string, number> = {
        XAUUSD: 20, XAGUSD: 20,
        US30: 50, NAS100: 50, SPX500: 30, UK100: 30, GER40: 30,
        BTCUSD: 150, ETHUSD: 50,
      };
      const driftLimit = DRIFT_THRESHOLDS[marketState.symbol] ?? 15;

      if (driftPips > driftLimit) {
        sharedIntelligenceCoordinator.invalidateSnapshot(marketState.symbol, entryTimeframe);

        if (userId) {
          freshnessBlockLogger.logOmegaBlock(
            marketState.symbol,
            entryTimeframe,
            FreshnessBlockCategory.BLOCK_STALE_OMEGA_INTELLIGENCE,
            { symbol: marketState.symbol, ageSeconds: Math.round((Date.now() - signalTimestamp) / 1000), reason: `Price drifted ${driftPips.toFixed(1)} pips since signal (limit ${driftLimit}pips)`, refreshAttempted: true, wasAutoRefreshed: true, advisory: false },
            userId
          );
        }

        return {
          action: 'NO_TRADE',
          decision: 'NO_TRADE',
          entry: marketState.price,
          stopLoss: proposedSL,
          takeProfit: proposedTP,
          confidence: 0,
          reasoning: `DRIFT GUARD: Market moved ${driftPips.toFixed(1)} pips since analysis started — snapshot invalidated, retry on next cycle`,
          omega_summary: 'Execution blocked — price drifted too far while building snapshot'
        };
      }
    } catch (driftErr) {
    }

    // Risk is now a PRE-FLIGHT GATE (not a voting Omega)
    // Determine probable direction based on SL/TP placement
    const probableDirection: 'BUY' | 'SELL' = proposedSL < snapshot.price ? 'BUY' : 'SELL';

    // Check risk constraints BEFORE expensive Omega calls
    const riskPreflightInput: RiskPreflightInput = {
      symbol: snapshot.symbol,
      direction: probableDirection,
      entry: snapshot.price,
      stopLoss: proposedSL,
      takeProfit: proposedTP,
      atr: snapshot.atr,
      accountBalance: goalContext?.accountBalance || 10000,
      riskPercent: goalContext?.riskPercent || 2,
      existingExposure: 0
    };
    const riskCheck = riskPreflightGate.validate(riskPreflightInput);

    // Separate HARD violations (physics/safety) from ADVISORY warnings
    const hardViolations = riskCheck.violations.filter(v =>
      v.message.includes('Invalid position') ||
      v.message.includes('Stop loss on wrong side') ||
      v.message.includes('mathematically impossible')
    );

    const advisoryViolations = riskCheck.violations.filter(v => !hardViolations.includes(v));

    // Only block on HARD violations (physics/safety)
    if (hardViolations.length > 0) {
      const violationMessages = hardViolations.map(v => v.message).join('; ');
      console.error(`[Alpha+Omega] 🚫 HARD BLOCK: ${violationMessages} (PHYSICS/SAFETY)`);
      return {
        action: 'NO_TRADE',
        decision: 'NO_TRADE',
        entry: snapshot.price,
        stopLoss: proposedSL,
        takeProfit: proposedTP,
        confidence: 0,
        reasoning: `HARD BLOCK - PHYSICS/SAFETY: ${violationMessages}`,
        omega_summary: `Risk pre-flight hard block: ${violationMessages}`
      };
    }

    // Log risk score and warnings (all advisory now)

    if (advisoryViolations.length > 0) {
      const advisoryMessages = advisoryViolations.map(v => v.message).join('; ');
    }

    if (riskCheck.warnings.length > 0) {
      const warningMessages = riskCheck.warnings.map(w => w.message).join('; ');
    }

    // CCIP-2026-02-24: Omega 1-5 removed. Only Omega-8 (Orderflow) runs.
    // Omega-8 performs genuine computation: Equal Highs/Lows detection,
    // Liquidity Sweeps, Fair Value Gaps — not present in raw snapshot.
    // All other intelligence reaches Alpha through the raw market briefing.
    const startTime = Date.now();

    const safeEvaluate = async <T>(fn: () => T, name: string): Promise<T | null> => {
      try {
        return fn();
      } catch (err) {
        return null;
      }
    };

    const omega8Vote = await safeEvaluate(() => omega8Hybrid.runOmega8({
      symbol: snapshot.symbol,
      timeframe: entryTimeframe,
      price: snapshot.price,
      atr: snapshot.atr,
      candles: snapshot.candles.slice(-30).map(c => ({
        time: typeof c.open_time === 'string' ? new Date(c.open_time).getTime() : new Date(c.open_time).getTime(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume || 1000
      })),
      trendBias: snapshot.trend === 'bull' ? 'up' : snapshot.trend === 'bear' ? 'down' : 'sideways',
      support: snapshot.support,
      resistance: snapshot.resistance
    }), 'Omega-8 Hybrid');

    const omegaTime = Date.now() - startTime;

    if (omega8Vote) {
      const usedLLM = (omega8Vote as any).usedLLM ? ' [LLM]' : ' [DET]';
    }

    // ✅ Snapshot freshness check (snapshot already validated by cache)
    const snapshotAge = Date.now() - snapshot.createdAt;
    const snapshotAgeSeconds = Math.round(snapshotAge / 1000);

    // Create freshness advisory for confidence penalty system
    let freshnessAdvisory: { confidenceReduction: number; overallSeverity: string } | null = null;
    if (snapshotAgeSeconds > 30) {
      const confidenceReduction = Math.min(50, Math.round((snapshotAgeSeconds - 30) * 1.5));
      const overallSeverity = snapshotAgeSeconds > 60 ? 'high' : snapshotAgeSeconds > 45 ? 'medium' : 'low';
      freshnessAdvisory = { confidenceReduction, overallSeverity };
    }

    if (snapshotAgeSeconds > 60) {
      sharedIntelligenceCoordinator.invalidateSnapshot(marketState.symbol, entryTimeframe);

      if (userId) {
        freshnessBlockLogger.logOmegaBlock(
          marketState.symbol,
          entryTimeframe,
          FreshnessBlockCategory.BLOCK_STALE_OMEGA_INTELLIGENCE,
          { symbol: marketState.symbol, ageSeconds: snapshotAgeSeconds, reason: `Snapshot ${snapshotAgeSeconds}s old`, refreshAttempted: false, wasAutoRefreshed: false, advisory: true },
          userId
        );
      }
    }

    const conflictCheck = {
      hasConflict: false,
      conflictType: 'NONE' as const,
      severity: 'NONE' as const,
      conflictDescription: 'Omegas provide intelligence only',
      confidencePenalty: 1.0
    };

    // Risk is now handled by pre-flight gate (already validated above)
    // Risk warnings are surfaced earlier in the pipeline

    // Build market context for Alpha
    // CCIP-2026-03-09: atr20 is now populated from the snapshot ATR when the entry
    // timeframe is M5 (SCALP). The snapshot is always built for the style-derived
    // entryTimeframe — so snapshot.atr IS the M5 ATR for SCALP scans.
    // This resolves the persistent "atr20: N/A" in Alpha's ATR legend which caused
    // Alpha to fall back to the coarser marketState.atr for SCALP stop sizing and
    // ATR-phase calculations, producing unreliable FRESH/DEVELOPING/EXHAUSTED readings.
    // SSOT: styleAtrMap in coordinator-alpha.ts maps SCALP → atr20 field.
    const marketContext: MarketContext = {
      symbol: marketState.symbol,
      regime: marketState.trend,
      volatility: marketState.volatility,
      price: marketState.price,
      atr: marketState.atr,
      // Populate atr20 from the snapshot ATR (style-timeframe-aligned):
      // - SCALP uses M5 snapshot → atr20 is the M5 20-period ATR
      // - MICRO_INTRADAY uses M15 snapshot → atr20 carries the M15 ATR (bonus: regime cross-check)
      // - INTRADAY uses H1 snapshot → atr20 carries H1 ATR
      // When snapshot.atr is an ATRValue object it retains timeframe metadata for traceability.
      atr20: snapshot.atr
    };

    // CCIP-ALPHA-GOV-001: SSOT spread table — used pre-Alpha (Alpha hasn't run yet).
    // After Alpha returns, decision.spread_estimate_pips is the authoritative override
    // and is logged post-decision for audit. Static table is the correct pre-Alpha fallback.
    const TYPICAL_SPREADS_PIPS: Record<string, number> = {
      'EURUSD': 1.0, 'GBPUSD': 1.5, 'USDJPY': 1.0, 'AUDUSD': 1.2, 'USDCAD': 1.5,
      'NZDUSD': 1.8, 'USDCHF': 1.5, 'XAUUSD': 3.0, 'BTCUSD': 10.0, 'ETHUSD': 2.0,
      'EURJPY': 1.5, 'GBPJPY': 2.5, 'AUDJPY': 1.8, 'EURGBP': 1.2, 'USDMXN': 3.0,
      'SPX500': 0.5, 'US30': 2.0, 'NAS100': 1.0, 'GER40': 1.0, 'UK100': 1.0,
    };
    const estimatedSpreadPips = TYPICAL_SPREADS_PIPS[snapshot.symbol] ?? 2.0;

    // Build market briefing from raw snapshot data (replaces vote-based context)
    const briefingSessionContext = calculateSessionContext();

    // CCIP-2026-03-15: Derive unified market phase from existing regime oracle signals.
    // This is a pure mapping from already-computed data — no new calculations.
    // Phase is delivered as a verified fact so Alpha reads it as data, not a task.
    const marketPhaseResult = deriveMarketPhase({
      regimeStructure: snapshot.regime?.structure,
      atrCompression: snapshot.regime?.atr_compression,
      atrExpansion: typeof snapshot.regime?.atr_expansion === 'boolean'
        ? snapshot.regime.atr_expansion
        : typeof snapshot.regime?.atr_expansion === 'number'
          ? snapshot.regime.atr_expansion > 1.2
          : undefined,
    });

    const snapshotInput: MarketSnapshotInput = {
      symbol: snapshot.symbol,
      price: snapshot.price,
      ema20: snapshot.ema20,
      ema50: snapshot.ema50,
      ema200: snapshot.ema200,
      rsi: snapshot.rsi,
      momentum: snapshot.momentum,
      stochastic: snapshot.stochRsi,
      macd: snapshot.macd,
      macdSignal: snapshot.macdSignal,
      vwap: snapshot.vwap,
      atr: snapshot.atr.value,
      support: snapshot.support,
      resistance: snapshot.resistance,
      swingHigh: snapshot.swingHigh,
      swingLow: snapshot.swingLow,
      trend: snapshot.trend,
      volatility: snapshot.volatility,
      regime: snapshot.regime?.structure || 'unknown',
      session: briefingSessionContext.currentSession,
      sessionName: briefingSessionContext.sessionName,
      sessionMinutesRemaining: briefingSessionContext.sessionTimeRemainingMinutes,
      nextSessionName: briefingSessionContext.nextSessionName,
      minutesUntilNextSession: briefingSessionContext.minutesUntilNextSession,
      marketPhase: marketPhaseResult.phase,
      marketPhaseConfidence: marketPhaseResult.confidence,
      spreadPips: estimatedSpreadPips,
      sensors: snapshot.omegaSensors,
      candles: snapshot.candles.map(c => ({ open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
    };
    const marketBriefing = buildMarketBriefing(snapshotInput, omega8Vote as any);

    // Alpha coordinates the decision (with full authority)
    const alphaStart = Date.now();

    const decision = await alphaCoordinator.coordinate(
      marketBriefing,
      {
        trend: null,
        scalper: null,
        confirmation: null,
        reversal: null,
        volatility: null,
        risk: null,
        omega8: omega8Vote
      },
      marketContext,
      traderScore,
      userId,
      conflictCheck,
      goalContext,
      marketState.adversarial,
      marketState.regime,
      snapshot.candles,
      imSignal
    );

    const alphaTime = Date.now() - alphaStart;
    const totalTime = Date.now() - startTime;

    // CCIP-ALPHA-GOV-001: Post-decision audit — spread and R:R ceiling.
    // Alpha's spread_estimate_pips and rr_ceiling_override are assertions of Alpha's authority.
    // They cannot be applied pre-Alpha (Alpha hasn't run yet). Post-decision: log for audit trail.

    if (decision.spread_estimate_pips != null) {
      console.log(`[CCIP-ALPHA-GOV-001] Alpha asserted spread_estimate_pips=${decision.spread_estimate_pips} for ${snapshot.symbol} (briefing used static=${estimatedSpreadPips})`);
    }

    if (
      decision.rr_ceiling_override != null &&
      decision.action !== 'NO_TRADE' &&
      decision.entry != null &&
      decision.takeProfit != null &&
      decision.stopLoss != null
    ) {
      const rrAudit = omega9ConstraintProvider.validateAlphaRRCeiling({
        symbol: snapshot.symbol,
        entry: decision.entry,
        takeProfit: decision.takeProfit,
        stopLoss: decision.stopLoss,
        direction: decision.action as 'BUY' | 'SELL',
        rr_ceiling_override: decision.rr_ceiling_override,
        tradeStyle: decision.resolvedStyle ?? 'SCALP',
      });
      console.log(`[CCIP-ALPHA-GOV-001] ${rrAudit.auditNote}`);
    }

    const originalConfidence = decision.confidence;

    // CCIP-GOVERNANCE-2026-03-20: No penalty arithmetic applied to Alpha's confidence.
    // Alpha's stated confidence IS the execution value. Engine call is for audit trail only.
    const confidenceResult = await confidenceCalculationEngine.calculateFinalConfidence({
      base_confidence: originalConfidence,
      symbol: marketState.symbol,
      risk_mode: riskMode as RiskMode,
      user_id: userId,
      adaptive_floor: undefined
    });

    const finalConfidence = originalConfidence;

    // ✅ CRITICAL SAFETY CHECK: Ensure entry price is never null/undefined
    // This prevents database insertion errors in goal_session_trades
    if (decision.entry === null || decision.entry === undefined || typeof decision.entry !== 'number' || isNaN(decision.entry)) {
      console.error('[Alpha+Omega] 🚨 CRITICAL: Decision has invalid entry price!');
      console.error(`[Alpha+Omega] Entry value: ${decision.entry} (type: ${typeof decision.entry})`);
      console.error('[Alpha+Omega] Forcing NO_TRADE to prevent database error');
      return {
        action: 'NO_TRADE' as const,
        decision: 'NO_TRADE' as const,
        entry: marketState.price,
        stopLoss: marketState.price,
        takeProfit: marketState.price,
        confidence: 0,
        reasoning: `BLOCKED: Invalid entry price (${decision.entry}) - data integrity protection`,
        omega_summary: 'Entry price validation failed'
      };
    }

    // ✅ CCIP 2026-02-14: Attach Omega conflict information to decision
    // This enables Alpha learning system to track conflict scenarios
    const conflictInfo: import('../types/alpha-thesis').ConflictInfo = {
      detected: conflictCheck.hasConflict,
      type: conflictCheck.conflictType,
      severity: conflictCheck.severity,
      description: conflictCheck.conflictDescription,
      penalty: conflictCheck.confidencePenalty
    };


    return {
      ...decision,
      confidence: finalConfidence,
      confidenceAdjustments: [],
      confidenceRewards: [],
      confidenceCalculationAudit: {
        base: originalConfidence,
        finalConfidence: originalConfidence,
        isDegraded: confidenceResult.is_degraded,
        auditId: confidenceResult.audit_id,
        riskMode: riskMode.toUpperCase(),
        passesThreshold: confidenceResult.passes_threshold,
        executionThreshold: confidenceResult.execution_threshold
      },
      conflictInfo
    };
  }

  /**
   * Evaluate multiple symbols with CONCURRENT execution and early-exit optimization
   * SSOT COMPLIANT: Uses concurrent-execution-config.ts for all behavior
   * GOVERNANCE: Tracks execution metrics and alerts on anomalies
   *
   * Modes:
   * - CONCURRENT: Analyze all symbols simultaneously (default)
   * - SEQUENTIAL: Analyze one by one (fallback for rate limit issues)
   *
   * Early-Exit: Stops as soon as first viable trade found (saves LLM costs)
   */
  async evaluateMultipleSymbols(
    marketStates: FullMarketState[],
    traderScore: TraderScore,
    userId?: string,
    goalContext?: import('../brains/coordinator-alpha').GoalContext,
    imSignalMap?: Map<string, Record<string, unknown>>
  ): Promise<Map<string, AlphaDecision>> {
    const config = getConcurrentExecutionConfig();
    const isConcurrent = isConcurrentExecutionEnabled();
    const mode = isConcurrent ? 'CONCURRENT' : 'SEQUENTIAL';


    const startTime = Date.now();

    // GOVERNANCE: Track execution start
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    if (config.governance.enabled) {
    }

    // Route to appropriate evaluation strategy
    const decisionMap = isConcurrent
      ? await this.evaluateConcurrently(marketStates, traderScore, userId, goalContext, executionId, imSignalMap)
      : await this.evaluateSequentially(marketStates, traderScore, userId, goalContext, executionId, imSignalMap);

    const duration = Date.now() - startTime;
    const evaluatedCount = decisionMap.size;


    // GOVERNANCE: Alert if execution exceeded threshold
    if (config.governance.enabled && duration > config.governance.alertThresholdMs) {
    }

    return decisionMap;
  }

  /**
   * CONCURRENT EVALUATION: Process all symbols simultaneously
   * Uses Promise.allSettled for graceful error handling
   * Implements early-exit optimization with Promise.race
   */
  private createSymbolEvaluationPromise(
    marketState: FullMarketState,
    traderScore: TraderScore,
    sessionTimeout: number,
    currentSession: MarketSession,
    sessionDescription: string,
    goalContext?: import('../brains/coordinator-alpha').GoalContext,
    userId?: string,
    index?: number,
    total?: number,
    imSignal?: Record<string, unknown>,
    staggerDelayMs?: number
  ): Promise<{ symbol: string; decision: AlphaDecision; timing: number }> {
    const symbolStartTime = Date.now();

    return new Promise(async (resolve) => {
      try {
        if (staggerDelayMs && staggerDelayMs > 0) {
          await new Promise(r => setTimeout(r, staggerDelayMs));
        }


        if (!marketState.atr || marketState.atr <= 0) {
          const noTradeDecision: AlphaDecision = {
            action: 'NO_TRADE' as const,
            decision: 'NO_TRADE' as const,
            entry: marketState.price,
            stopLoss: marketState.price,
            takeProfit: marketState.price,
            confidence: 0,
            reasoning: `Invalid ATR (${marketState.atr}) - cannot calculate stop loss`,
            omega_summary: 'SKIP: Invalid ATR data'
          };
          resolve({ symbol: marketState.symbol, decision: noTradeDecision, timing: Date.now() - symbolStartTime });
          return;
        }

        // CCIP-ALPHA-GOV-001: proposedSL/TP are pre-Alpha structural proposals for the briefing.
        // Alpha has not run yet — no tp_multiplier_override is available at this point.
        // The override is applied in the post-Alpha audit block below. Static base is correct here.
        const { stopLossMultiplier, takeProfitMultiplier } = this.calculateDynamicMultipliers(marketState, undefined, true);
        const proposedSL = marketState.price - (marketState.atr * stopLossMultiplier);
        const proposedTP = marketState.price + (marketState.atr * takeProfitMultiplier);

        let timeoutId: ReturnType<typeof setTimeout>;
        let warn50Id: ReturnType<typeof setTimeout>;
        let warn75Id: ReturnType<typeof setTimeout>;

        const clearTimers = () => {
          clearTimeout(timeoutId);
          clearTimeout(warn50Id);
          clearTimeout(warn75Id);
        };

        const timeoutPromise = new Promise<AlphaDecision>((_, reject) => {
          warn50Id = setTimeout(() => {
          }, sessionTimeout * 0.5);

          warn75Id = setTimeout(() => {
          }, sessionTimeout * 0.75);

          timeoutId = setTimeout(() => {
            reject(new Error(`Symbol evaluation timeout (${sessionTimeout}ms - ${currentSession} session)`));
          }, sessionTimeout);
        });

        const decision = await Promise.race([
          this.makeTradeDecision(marketState, traderScore, proposedSL, proposedTP, goalContext, userId, imSignal),
          timeoutPromise
        ]);

        // CCIP-ALPHA-GOV-001: Post-Alpha audit — log whether tp_multiplier_override was set.
        // Alpha is required to set this on every BUY/SELL response. Absence is a governance warn.
        if (decision.action !== 'NO_TRADE') {
          if (decision.tp_multiplier_override == null) {
            console.warn(`[CCIP-ALPHA-GOV-001] ${marketState.symbol}: tp_multiplier_override not set by Alpha — static 3.0x ATR base was used for proposed TP`);
          }
        }

        clearTimers();
        const timing = Date.now() - symbolStartTime;
        resolve({ symbol: marketState.symbol, decision, timing });

      } catch (error) {
        const timing = Date.now() - symbolStartTime;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const isTimeout = errorMessage.includes('timeout')
          || (error instanceof Error && error.name === 'AbortError')
          || errorMessage.includes('signal is aborted');

        if (isTimeout) {
          console.error(`[Alpha+Omega Timeout] ${marketState.symbol}: ${timing}ms (limit: ${sessionTimeout}ms, session: ${currentSession})`);
        } else {
          console.error(`[Alpha+Omega] ${marketState.symbol} failed (${timing}ms):`, errorMessage);
        }

        const errorDecision: AlphaDecision = {
          action: 'NO_TRADE' as const,
          decision: 'NO_TRADE' as const,
          entry: marketState.price,
          stopLoss: marketState.price,
          takeProfit: marketState.price,
          confidence: 0,
          reasoning: isTimeout
            ? `Evaluation timeout after ${timing}ms - LLM API latency exceeded ${sessionTimeout}ms limit`
            : `Evaluation failed: ${errorMessage}`,
          omega_summary: isTimeout
            ? `Timeout: Exceeded ${(sessionTimeout / 1000).toFixed(0)}s limit (${sessionDescription})`
            : `Error: ${errorMessage}`
        };

        resolve({ symbol: marketState.symbol, decision: errorDecision, timing });
      }
    });
  }

  /**
   * ROLLING CONCURRENCY POOL: Evaluate symbols with a fixed-width concurrent slot pool.
   *
   * CCIP-2026-03-12: Replaces the batch-sequential loop (3 batches of 3, wait for all 3,
   * then start next 3). The new model keeps exactly maxConcurrentSymbols slots active at
   * all times. As soon as any slot completes, the next symbol is submitted immediately.
   *
   * Why this is faster:
   *   Old: [S1,S2,S3] → wait for all 3 → [S4,S5,S6] → wait → [S7,S8,S9]
   *        If S3 takes 88s while S1,S2 finish in 25s, 63s of idle time before S4 starts.
   *   New: [S1,S2,S3,S4,S5] running; S1 finishes at 25s → S6 starts at 25s.
   *        No idle time. Pool always drains into the next available symbol.
   *
   * Early-exit still works: when a viable trade is found, remaining queued symbols are
   * skipped (the queue drains naturally; no in-flight work is aborted).
   */
  private async evaluateConcurrently(
    marketStates: FullMarketState[],
    traderScore: TraderScore,
    userId?: string,
    goalContext?: import('../brains/coordinator-alpha').GoalContext,
    executionId?: string,
    imSignalMap?: Map<string, Record<string, unknown>>
  ): Promise<Map<string, AlphaDecision>> {
    const config = getConcurrentExecutionConfig();
    // CCIP-2026-0318A-ADVISORY: minConfidence falls back to ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE (50).
    // The previous fallback to config.earlyExit.minConfidenceThreshold (was 72) blocked
    // valid ACCEPTABLE-band (50-69%) trades. SSOT for the structural floor is alpha-identity.ts.
    const minConfidence = goalContext?.minConfidence ?? ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE;
    const maxConcurrent = config.concurrency.maxConcurrentSymbols || marketStates.length;

    // CCIP-MULTI-TRADE-TOP-N: In multi-trade mode ALL symbols must be evaluated so
    // the best-symbol-selector can rank and return the top N eligible pairs.
    // Early-exit saves LLM cost in single-trade mode but defeats multi-trade intent.
    const earlyExitAllowed = config.earlyExit.enabled && !goalContext?.multiTradeMode;

    const currentSession = marketScheduleService.getCurrentMarketSession();
    const sessionTimeout = getSessionTimeout(currentSession);
    const sessionDescription = marketScheduleService.getSessionDescription(currentSession);


    const decisionMap = new Map<string, AlphaDecision>();
    const symbolTimings = new Map<string, number>();

    let foundViableTrade = false;
    let viableTradeSymbol = '';

    // Rolling pool: maintain a set of in-flight promises. As each completes, process its
    // result and — if no early-exit and symbols remain — submit the next symbol immediately.
    const queue = [...marketStates];
    let symbolsSubmitted = 0;
    const inFlight = new Map<string, Promise<{ symbol: string; decision: AlphaDecision; timing: number }>>();

    const submitNext = (): boolean => {
      if (queue.length === 0) return false;
      if (foundViableTrade && earlyExitAllowed) return false;
      const marketState = queue.shift()!;
      const globalIdx = symbolsSubmitted++;
      // CCIP-2026-03-13d: Apply intra-batch stagger to all symbols after the first.
      // Spreads Netlify function invocations across time to avoid simultaneous cold-start
      // overhead that pushes total wall-clock past the Netlify CDN 26s synchronous kill wall.
      // SSOT: stagger value sourced from getIntraBatchStaggerMs() in concurrent-execution-config.ts.
      const staggerMs = globalIdx > 0 ? getIntraBatchStaggerMs() : 0;
      const promise = this.createSymbolEvaluationPromise(
        marketState,
        traderScore,
        sessionTimeout,
        currentSession,
        sessionDescription,
        goalContext,
        userId,
        globalIdx,
        marketStates.length,
        imSignalMap?.get(marketState.symbol),
        staggerMs
      );
      inFlight.set(marketState.symbol, promise);
      return true;
    };

    // Seed the pool to maxConcurrent slots
    const initialCount = Math.min(maxConcurrent, marketStates.length);
    for (let i = 0; i < initialCount; i++) {
      submitNext();
    }


    // Drain the pool: each iteration waits for the fastest in-flight slot to finish,
    // records the result, then immediately submits the next queued symbol.
    while (inFlight.size > 0) {
      const raceResult = await Promise.race(
        Array.from(inFlight.values()).map(p =>
          p.then(result => ({ resolved: result, symbol: result.symbol }))
        )
      );

      const { resolved } = raceResult;
      inFlight.delete(resolved.symbol);

      const { symbol, decision, timing } = resolved;
      decisionMap.set(symbol, decision);
      symbolTimings.set(symbol, timing);

      const isViableTrade = decision.action !== 'NO_TRADE' && decision.confidence >= minConfidence;
      if (isViableTrade && !foundViableTrade) {
        foundViableTrade = true;
        viableTradeSymbol = symbol;
        const remaining = queue.length + inFlight.size;
      }

      // Submit next symbol into the freed slot (respects early-exit flag)
      if (!foundViableTrade || !earlyExitAllowed) {
        submitNext();
      }
    }

    if (foundViableTrade) {
    }

    if (config.governance.enabled) {
      // CCIP (2026-03-07): confidence === 0 on NO_TRADE is reserved exclusively for system failures
      // (data missing, parse error, wall violation, hard block). Reasoned rejections carry confidence >= 10.
      const errorCount = Array.from(decisionMap.values()).filter(d => d.action === 'NO_TRADE' && d.confidence === 0).length;
      const reasonedNoTradeCount = Array.from(decisionMap.values()).filter(d => d.action === 'NO_TRADE' && d.confidence > 0).length;
      const errorRate = (errorCount / marketStates.length) * 100;

      if (errorRate > config.governance.alertErrorRatePercent) {
      }
    }

    if (config.tracking.logDetailedTimings) {
      symbolTimings.forEach((timing, symbol) => {
        const decision = decisionMap.get(symbol);
      });
    }

    return decisionMap;
  }

  /**
   * SEQUENTIAL EVALUATION: Process symbols one by one (original behavior)
   * Used as fallback or when concurrent mode disabled
   */
  private async evaluateSequentially(
    marketStates: FullMarketState[],
    traderScore: TraderScore,
    userId?: string,
    goalContext?: import('../brains/coordinator-alpha').GoalContext,
    executionId?: string,
    imSignalMap?: Map<string, Record<string, unknown>>
  ): Promise<Map<string, AlphaDecision>> {
    const config = getConcurrentExecutionConfig();
    // CCIP-2026-0318A-ADVISORY: minConfidence falls back to ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE (50).
    const minConfidence = goalContext?.minConfidence ?? ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE;

    // CCIP-MULTI-TRADE-TOP-N: Same guard as concurrent path — suppress early-exit
    // when multi-trade mode is active so all symbols get evaluated for top-N ranking.
    const earlyExitAllowed = config.earlyExit.enabled && !goalContext?.multiTradeMode;


    const decisionMap = new Map<string, AlphaDecision>();

    // Sequential evaluation with early-exit logic
    for (let i = 0; i < marketStates.length; i++) {
      const marketState = marketStates[i];

      try {

        if (!marketState.atr || marketState.atr <= 0) {
          console.error(`%c INVALID ATR for ${marketState.symbol}`, 'color: #ff0000; font-weight: bold');
          const noTradeDecision: AlphaDecision = {
            action: 'NO_TRADE' as const,
            decision: 'NO_TRADE' as const,
            entry: marketState.price,
            stopLoss: marketState.price,
            takeProfit: marketState.price,
            confidence: 0,
            reasoning: `Invalid ATR (${marketState.atr}) - cannot calculate stop loss`,
            omega_summary: 'SKIP: Invalid ATR data'
          };
          decisionMap.set(marketState.symbol, noTradeDecision);
          continue;
        }

        // CCIP-ALPHA-GOV-001: proposedSL/TP are pre-Alpha structural proposals for the briefing.
        // Alpha has not run yet — no tp_multiplier_override is available at this point.
        // The override is applied in the post-Alpha audit block below. Static base is correct here.
        const { stopLossMultiplier, takeProfitMultiplier } = this.calculateDynamicMultipliers(marketState, undefined, true);
        const proposedSL = marketState.price - (marketState.atr * stopLossMultiplier);
        const proposedTP = marketState.price + (marketState.atr * takeProfitMultiplier);

        const { calculatePipDistance } = await import('../utils/currencyHelpers');
        const slDistancePips = calculatePipDistance(marketState.symbol, marketState.price, proposedSL);


        const decision = await this.makeTradeDecision(
          marketState,
          traderScore,
          proposedSL,
          proposedTP,
          goalContext,
          userId,
          imSignalMap?.get(marketState.symbol)
        );

        // CCIP-ALPHA-GOV-001: Post-Alpha audit — log whether tp_multiplier_override was set.
        // Alpha is required to set this on every BUY/SELL response. Absence is a governance warn.
        if (decision.action !== 'NO_TRADE') {
          if (decision.tp_multiplier_override == null) {
            console.warn(`[CCIP-ALPHA-GOV-001] ${marketState.symbol}: tp_multiplier_override not set by Alpha — static 3.0x ATR base was used for proposed TP`);
          }
        }

        decisionMap.set(marketState.symbol, decision);

        // EARLY EXIT: Stop scanning if viable trade found (single-trade mode only)
        // CCIP-MULTI-TRADE-TOP-N: earlyExitAllowed is false when multiTradeMode=true
        if (earlyExitAllowed) {
          const isViableTrade = decision.action !== 'NO_TRADE' && decision.confidence >= minConfidence;

          if (isViableTrade) {
            const remainingSymbols = marketStates.length - (i + 1);
            break;
          } else {
          }
        }

      } catch (error) {
        console.error(`[Alpha+Omega] Failed to evaluate ${marketState.symbol}:`, error);
        const errorDecision: AlphaDecision = {
          action: 'NO_TRADE' as const,
          decision: 'NO_TRADE' as const,
          entry: marketState.price,
          stopLoss: marketState.price,
          takeProfit: marketState.price,
          confidence: 0,
          reasoning: `Evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          omega_summary: 'System error during evaluation'
        };
        decisionMap.set(marketState.symbol, errorDecision);
        continue;
      }
    }

    return decisionMap;
  }

  /**
   * Monitor open trade (mid-trade evaluation)
   */
  async monitorOpenTrade(
    position: TradePosition,
    marketState: FullMarketState,
    traderScore: TraderScore,
    currentPrice: number,
    currentTime: Date,
    userId?: string,
    sessionId?: string
  ): Promise<MidTradeDecision | null> {
    // Calculate drawdown
    const directionFactor = position.direction === 'buy' ? 1 : -1;
    const drawdown = (position.entryPrice - currentPrice) * directionFactor;
    const slDistance = (position.entryPrice - position.stopLoss) * directionFactor;
    const drawdownPct = slDistance > 0 ? drawdown / slDistance : 0;

    // Thresholds
    const SOFT_TRIGGER = 0.30;
    const HARD_TRIGGER = 0.50;
    const EMERGENCY_TRIGGER = 0.70;

    if (drawdownPct < SOFT_TRIGGER) {
      // No monitoring needed
      return null;
    }

    // Build mid-trade snapshot
    const snapshot: MidTradeSnapshot = {
      p: currentPrice,
      ep: position.entryPrice,
      sl: position.stopLoss,
      tp: position.takeProfit,
      dir: position.direction,
      dd: drawdownPct,
      e20: marketState.ema20,
      e50: marketState.ema50,
      rsi: marketState.rsi,
      atr: marketState.atr,
      vw_d: currentPrice - marketState.vwap,
      tr: marketState.trend,
      vol: marketState.volatility,
      t: Math.floor((currentTime.getTime() - position.entryTime.getTime()) / 60000),
      risk_pct: position.riskPct,
      sym: position.symbol,
      structure: marketState.structure
    };

    // Determine check level
    if (drawdownPct >= EMERGENCY_TRIGGER) {
      return await midTradeMonitor.evaluateEmergency(snapshot, traderScore, userId, sessionId);
    } else if (drawdownPct >= HARD_TRIGGER) {
      return await midTradeMonitor.evaluateHard(snapshot, traderScore, userId, sessionId);
    } else {
      return await midTradeMonitor.evaluateSoft(snapshot, traderScore, userId, sessionId);
    }
  }

  /**
   * Calculate dynamic stop loss and take profit multipliers based on market conditions.
   *
   * CCIP-ALPHA-GOV-001: Accepts optional tp_multiplier_override from Alpha's prior output.
   * When provided, Alpha's override replaces the static base multiplier (3.0x).
   * The system logs a WARN when falling back to the static default.
   * Callers should pass Alpha's tp_multiplier_override when available.
   */
  private calculateDynamicMultipliers(
    marketState: FullMarketState,
    alphaMultiplierOverride?: number,
    isPreAlphaProposal?: boolean
  ): {
    stopLossMultiplier: number;
    takeProfitMultiplier: number;
  } {
    const STATIC_TP_BASE = 3.0;
    // CCIP-ALPHA-GOV-001: The warn is suppressed when this call is a pre-Alpha structural
    // proposal (isPreAlphaProposal=true). Alpha has not run yet — absence here is expected.
    // The governance warn fires post-Alpha in the call sites above, after makeTradeDecision
    // returns, giving the correct audit signal: Alpha ran but did not set the field.
    if (alphaMultiplierOverride == null && !isPreAlphaProposal) {
      console.warn(`[CCIP-ALPHA-GOV-001] tp_multiplier_override not set by Alpha — falling back to static TP base ${STATIC_TP_BASE}x ATR`);
    }

    let slMultiplier = 1.8; // Base: 1.8x ATR (increased from 1.5x for more breathing room)
    // CCIP-ALPHA-GOV-001: Use Alpha's override when provided; otherwise static base.
    let tpMultiplier = alphaMultiplierOverride != null ? alphaMultiplierOverride : STATIC_TP_BASE;

    // Adjust for volatility
    if (marketState.volatility === 'low') {
      slMultiplier = 1.5; // Tighter stops in low volatility
      tpMultiplier = 2.5;
    } else if (marketState.volatility === 'high') {
      slMultiplier = 2.5; // Wider stops in high volatility
      tpMultiplier = 4.0;
    }

    // Adjust for regime if available
    if (marketState.regime) {
      // High risk regime = wider stops
      if (marketState.regime.is_high_risk_regime) {
        slMultiplier *= 1.3;
        tpMultiplier *= 1.2;
      }

      // ATR expansion = wider stops
      if (marketState.regime.atr_expansion > 1.5) {
        slMultiplier *= 1.2;
      }

      // Wick risk = wider stops
      if (marketState.regime.wick_risk === 'high') {
        slMultiplier *= 1.2;
      }
    }

    // Adjust for adversarial conditions
    if (marketState.adversarial) {
      if (marketState.adversarial.level === 'moderate') {
        slMultiplier *= 1.15;
      } else if (marketState.adversarial.level === 'severe') {
        slMultiplier *= 1.3;
      }
    }

    // Ensure minimum R:R ratio of 1.5:1
    if (tpMultiplier / slMultiplier < 1.5) {
      tpMultiplier = slMultiplier * 1.5;
    }

    return {
      stopLossMultiplier: slMultiplier,
      takeProfitMultiplier: tpMultiplier
    };
  }

  /**
   * REMOVED: Old snapshot builder methods (no longer needed)
   * All Omegas now share the SAME snapshot from MarketSnapshotCache
   * This ensures 100% data consistency across all Omegas
   */

  /**
   * Determine structure pattern (overloaded for both types)
   */
  private determineStructure(state: FullMarketState | MarketSnapshotData): string {
    if (state.structure) {
      if (state.structure.hh && state.structure.hl) return 'hh';
      if (state.structure.ll && state.structure.lh) return 'll';
    }
    return 'unknown';
  }

  /**
   * Calculate wick/body ratio
   */
  private calculateWickRatio(candles: number[][]): number {
    if (candles.length === 0) return 0;

    let totalWickRatio = 0;
    for (const [open, high, low, close] of candles) {
      const body = Math.abs(close - open);
      const upperWick = high - Math.max(open, close);
      const lowerWick = Math.min(open, close) - low;
      const totalWick = upperWick + lowerWick;

      if (body > 0) {
        totalWickRatio += totalWick / body;
      }
    }

    return totalWickRatio / candles.length;
  }

}

export const alphaOmegaOrchestrator = new AlphaOmegaOrchestrator();
