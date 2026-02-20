/**
 * Alpha + Omega Orchestrator
 *
 * Central service that:
 * - Builds snapshots for each Omega specialist
 * - Calls all Omegas in parallel (with 3-tier cache integration)
 * - Passes votes to Alpha coordinator
 * - Handles errors gracefully
 * - Provides easy integration point
 *
 * NOW INTEGRATED WITH 3-TIER CACHE SYSTEM:
 * - Omega votes cached platform-wide in omega_market_intelligence table
 * - Alpha strategic decisions cached in alpha_strategic_cache table
 * - Typical savings: 50-70% LLM cost reduction
 */

import { omegaTrend, type TrendSnapshot } from '../brains/omega/trend';
import { omegaScalper, type ScalperSnapshot } from '../brains/omega/scalper';
import { omegaConfirmation, type ConfirmationSnapshot } from '../brains/omega/confirmation';
import { omegaReversal, type ReversalSnapshot } from '../brains/omega/reversal';
import { omegaVolatility, type VolatilitySnapshot } from '../brains/omega/volatility';
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
import { getMTFConfig, type Timeframe, type RiskMode } from '../config/timeframe-hierarchy';
import { getConfidencePenaltyCap } from '../config/trade-constraints';
import { createTradeContext, type TradeContext } from '../utils/tradeMath';
import { validatePreFlight, createBlockedDecision } from './ssot-preflight-guard';
import { freshnessBlockLogger } from './freshness-block-logger';
import { FreshnessBlockCategory } from '../types/freshness-block';
import { confidenceCalculationEngine, type ConfidenceModifier } from './confidence-calculation-engine';
import {
  getConcurrentExecutionConfig,
  isConcurrentExecutionEnabled,
  formatConcurrentConfigForLogging,
  getSessionTimeout,
  type MarketSession
} from '../config/concurrent-execution-config';
import { marketScheduleService } from './market-schedule-service';
import { calculateSessionContext } from '../utils/marketHours';

export interface ConfidencePenalty {
  source: string;
  multiplier: number;
  reason: string;
}

export interface ConfidencePenaltyResult {
  appliedPenalty: ConfidencePenalty;
  allProposedPenalties: ConfidencePenalty[];
  finalMultiplier: number;
}

export interface ConfidenceReward {
  source: string;
  bonus: number; // Percentage points to add (e.g., 5 means +5%)
  reason: string;
}

export interface ConfidenceRewardResult {
  rewards: ConfidenceReward[];
  totalBonus: number; // Total percentage points to add
}

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
    userId?: string
  ): Promise<AlphaDecision> {
    console.log('[Alpha+Omega] 🎯 Starting decision pipeline...');

    // ✅ SSOT GUARDRAIL #1: Create TradeContext (MANDATORY for all math operations)
    console.log(`[Alpha+Omega] 🔒 Creating TradeContext for ${marketState.symbol}...`);
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
    console.log(`[Alpha+Omega] ✅ TradeContext created: hash=${tradeContext.profileHash}, pip=${tradeContext.pipValue}, decimals=${tradeContext.decimalPlaces}`);

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

    console.log('[Alpha+Omega] ✅ SSOT pre-flight passed - TradeContext validated');

    // SSOT: Get dynamic timeframe based on risk mode BEFORE any usage
    const riskMode: RiskMode = goalContext?.riskMode || 'medium';
    const mtfConfig = getMTFConfig(riskMode);
    const entryTimeframe: Timeframe = mtfConfig.entryTimeframe;
    console.log(`[Alpha+Omega] Risk Mode: ${riskMode.toUpperCase()} -> Entry Timeframe: ${entryTimeframe}`);

    // Resolve tradeStyle for style-aware Omega council specialists
    const ORCHESTRATOR_STYLE_MAP: Record<string, 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY'> = {
      'scalp': 'SCALP',
      'micro_intraday': 'MICRO_INTRADAY',
      'intraday': 'INTRADAY'
    };
    const resolvedOmegaStyle: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY' =
      (goalContext?.tradeStyle ? ORCHESTRATOR_STYLE_MAP[goalContext.tradeStyle.toLowerCase()] : undefined) || 'SCALP';
    console.log(`[Alpha+Omega] Omega council style: ${resolvedOmegaStyle} (goalContext.tradeStyle=${goalContext?.tradeStyle || 'not set'})`);

    // Capture signal price and timestamp at analysis time (for drift detection)
    const signalPrice = marketState.price;
    const signalTimestamp = Date.now();
    console.log(`[Alpha+Omega] Signal captured: ${signalPrice} at ${new Date(signalTimestamp).toISOString()}`);

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
      console.warn(`[Alpha+Omega] PRE-CHECK ADVISORY: ${preCheck.reason}`);
      console.warn(`[Alpha+Omega] Proceeding with Alpha's authority - advisory will be included in confidence penalties`);

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
        console.log('[Alpha+Omega] 🔮 Analyzing market context...');
        sentiment = await sentimentCoordinator.getCurrentSentiment(
          marketState.symbol,
          marketState.recentCandles,
          marketState,
          new Date(signalTimestamp)
        );
        if (sentiment) {
          console.log(`[Alpha+Omega] ✅ Market Context: ${sentiment.sentiment.toUpperCase()} | USD: ${sentiment.usd_strength} | Vol: ${sentiment.volatility} | Confidence: ${sentiment.confidence}%`);
          console.log(`[Alpha+Omega] 📊 Context: ${sentiment.summary}`);
          marketState.sentiment = sentiment; // Add to market state for Omegas
        } else {
          console.warn('[Alpha+Omega] ⚠️ Market context unavailable - proceeding without');
        }
      } catch (error) {
        console.warn('[Alpha+Omega] ⚠️ Market context analysis failed:', error);
      }
    }

    // ✅ NEW: Get shared snapshot ONCE (SSOT for all Omegas)
    // This is THE critical change: one snapshot, not 7+ separate queries
    let snapshot: MarketSnapshotData;
    try {
      snapshot = await sharedIntelligenceCoordinator.getMarketSnapshot(
        marketState.symbol,
        entryTimeframe,
        riskMode
      );
      console.log(`[Alpha+Omega] 📊 Snapshot SSOT: ${snapshot.snapshotHash}`);
      console.log(`  Price: ${snapshot.price.toFixed(5)} | ATR: ${snapshot.atr.value.toFixed(5)} | Trend: ${snapshot.trend}`);
      console.log(`  ✅ All Omegas will see THIS EXACT DATA (no drift)`);
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
        console.warn(`[Alpha+Omega] DRIFT GUARD: ${driftPips.toFixed(1)} pips drift since signal (limit ${driftLimit}pips) — invalidating snapshot`);
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
      console.warn('[Alpha+Omega] Drift guard calculation failed (non-blocking):', driftErr);
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
    console.log(`[Alpha+Omega] ✅ Risk pre-flight passed hard constraints (Score: ${riskCheck.riskScore}/100)`);

    if (advisoryViolations.length > 0) {
      const advisoryMessages = advisoryViolations.map(v => v.message).join('; ');
      console.warn(`[Alpha+Omega] ⚠️  Risk advisory violations: ${advisoryMessages}`);
      console.warn(`[Alpha+Omega] Alpha has authority to proceed - violations will affect confidence`);
    }

    if (riskCheck.warnings.length > 0) {
      const warningMessages = riskCheck.warnings.map(w => w.message).join('; ');
      console.warn(`[Alpha+Omega] ⚠️  Risk warnings: ${warningMessages}`);
    }

    // ✅ NEW: Call Omegas directly with shared snapshot (deterministic, instant)
    console.log('[Alpha+Omega] 🔮 Calling Omega Council (snapshot-first, deterministic)...');
    const startTime = Date.now();

    // Helper to safely wrap synchronous Omega calls in Promises
    const safeEvaluate = async <T>(fn: () => T, name: string): Promise<T | null> => {
      try {
        return fn();
      } catch (err) {
        console.warn(`[${name}] Failed:`, err instanceof Error ? err.message : String(err));
        return null;
      }
    };

    const [trendVote, scalperVote, confirmationVote, reversalVote, volatilityVote, omega8Vote] = await Promise.all([
      safeEvaluate(() => omegaTrend.evaluate({
        p: snapshot.price,
        e20: snapshot.ema20,
        e50: snapshot.ema50,
        e200: snapshot.ema200,
        mom: snapshot.momentum,
        tr: snapshot.trend,
        vol: snapshot.volatility,
        tradeStyle: resolvedOmegaStyle,
        regime: marketState.regime ? {
          trend_strength: marketState.regime.trend_strength_score,
          structure: marketState.regime.structure,
          bias: marketState.regime.market_bias
        } : undefined,
        adv: marketState.adversarial ? {
          lvl: marketState.adversarial.level,
          score: marketState.adversarial.suspicion_score
        } : undefined
      }), 'Omega Trend'),

      safeEvaluate(() => omegaScalper.evaluate({
        p: snapshot.price,
        vw: snapshot.vwap,
        atr: snapshot.atr,
        rsi: snapshot.rsi,
        vol: snapshot.volatility,
        c: snapshot.candles.slice(-3).map(c => [c.open, c.high, c.low, c.close]),
        tradeStyle: resolvedOmegaStyle,
        regime: marketState.regime ? {
          session: marketState.regime.session,
          session_open: marketState.regime.session_open,
          atr_expansion: marketState.regime.atr_expansion
        } : undefined,
        adv: marketState.adversarial ? {
          lvl: marketState.adversarial.level,
          pat: marketState.adversarial.patterns.slice(0, 2)
        } : undefined
      }), 'Omega Scalper'),

      safeEvaluate(() => omegaConfirmation.evaluate({
        p: snapshot.price,
        sup: snapshot.support,
        res: snapshot.resistance,
        sw: { h: snapshot.swingHigh, l: snapshot.swingLow },
        str: this.determineStructure(snapshot),
        tr: snapshot.trend,
        tradeStyle: resolvedOmegaStyle,
        regime: marketState.regime ? {
          structure_type: marketState.regime.structure,
          structure_quality: marketState.regime.structure_quality
        } : undefined,
        adv: marketState.adversarial ? {
          lvl: marketState.adversarial.level
        } : undefined
      }), 'Omega Confirmation'),

      safeEvaluate(() => omegaReversal.evaluate({
        p: snapshot.price,
        rsi: snapshot.rsi,
        st: snapshot.stochRsi,
        mom: snapshot.momentum,
        e20: snapshot.ema20,
        e50: snapshot.ema50,
        tr: snapshot.trend,
        vol: snapshot.volatility,
        tradeStyle: resolvedOmegaStyle,
        regime: marketState.regime ? {
          atr_compression: marketState.regime.atr_compression,
          wick_risk: marketState.regime.wick_risk,
          structure: marketState.regime.structure
        } : undefined,
        adv: marketState.adversarial ? {
          lvl: marketState.adversarial.level,
          pat: marketState.adversarial.patterns.slice(0, 2)
        } : undefined
      }), 'Omega Reversal'),

      safeEvaluate(() => omegaVolatility.evaluate({
        atr: snapshot.atr,
        atr_avg: snapshot.atr,
        vol: snapshot.volatility,
        c: snapshot.candles.slice(-5).map(c => [c.open, c.high, c.low, c.close]),
        wick_ratio: this.calculateWickRatio(snapshot.candles.slice(-5).map(c => [c.open, c.high, c.low, c.close])),
        trend: snapshot.trend,
        tradeStyle: resolvedOmegaStyle,
        regime: marketState.regime ? {
          market_bias: marketState.regime.market_bias,
          volatility_trend: marketState.regime.volatility_trend
        } : undefined
      }), 'Omega Volatility'),

      safeEvaluate(() => omega8Hybrid.runOmega8({
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
      }), 'Omega-8 Hybrid')
    ]);

    const omegaTime = Date.now() - startTime;
    console.log(`[Alpha+Omega] ✅ Omega Council complete (${omegaTime}ms) - All votes computed from SAME snapshot`);

    // Log Omega votes (Risk is now a pre-flight gate, not a voting Omega)
    this.logOmegaVotes({
      trend: trendVote,
      scalper: scalperVote,
      confirmation: confirmationVote,
      reversal: reversalVote,
      volatility: volatilityVote,
      risk: null, // Risk is now a pre-flight gate
      omega8: omega8Vote
    });

    // ✅ Snapshot freshness check (snapshot already validated by cache)
    const snapshotAge = Date.now() - snapshot.createdAt;
    const snapshotAgeSeconds = Math.round(snapshotAge / 1000);

    // Create freshness advisory for confidence penalty system
    let freshnessAdvisory: { confidenceReduction: number; overallSeverity: string } | null = null;
    if (snapshotAgeSeconds > 30) {
      const confidenceReduction = Math.min(50, Math.round((snapshotAgeSeconds - 30) * 1.5));
      const overallSeverity = snapshotAgeSeconds > 60 ? 'high' : snapshotAgeSeconds > 45 ? 'medium' : 'low';
      freshnessAdvisory = { confidenceReduction, overallSeverity };
      console.warn(`[Alpha+Omega] ⚠️ Snapshot staleness: ${snapshotAgeSeconds}s old (${overallSeverity} severity, -${confidenceReduction}% confidence)`);
    }

    if (snapshotAgeSeconds > 60) {
      console.warn(`[Alpha+Omega] Snapshot is ${snapshotAgeSeconds}s old - may need refresh`);
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

    // ✅ WORST-CASE WINS: Calculate single unified confidence penalty
    const confidencePenaltyResult = this.collectConfidencePenalties(
      conflictCheck,
      freshnessAdvisory || undefined,
      marketState.adversarial,
      marketState.regime
    );

    // Build market context for Alpha
    const marketContext: MarketContext = {
      symbol: marketState.symbol,
      regime: marketState.trend,
      volatility: marketState.volatility,
      price: marketState.price,
      atr: marketState.atr
    };

    // Estimate typical spread for the symbol (in pips)
    const TYPICAL_SPREADS_PIPS: Record<string, number> = {
      'EURUSD': 1.0, 'GBPUSD': 1.5, 'USDJPY': 1.0, 'AUDUSD': 1.2, 'USDCAD': 1.5,
      'NZDUSD': 1.8, 'USDCHF': 1.5, 'XAUUSD': 3.0, 'BTCUSD': 10.0, 'ETHUSD': 2.0,
      'EURJPY': 1.5, 'GBPJPY': 2.5, 'AUDJPY': 1.8, 'EURGBP': 1.2, 'USDMXN': 3.0,
      'SPX500': 0.5, 'US30': 2.0, 'NAS100': 1.0, 'GER40': 1.0, 'UK100': 1.0,
    };
    const estimatedSpreadPips = TYPICAL_SPREADS_PIPS[snapshot.symbol] ?? 2.0;

    // Build market briefing from raw snapshot data (replaces vote-based context)
    const briefingSessionContext = calculateSessionContext();
    const snapshotInput: MarketSnapshotInput = {
      symbol: snapshot.symbol,
      price: snapshot.price,
      ema20: snapshot.ema20,
      ema50: snapshot.ema50,
      ema200: snapshot.ema200,
      rsi: snapshot.rsi,
      momentum: snapshot.momentum,
      stochastic: snapshot.stochRsi,
      macd: snapshot.omegaSensors.mdif,
      macdSignal: 0,
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
      spreadPips: estimatedSpreadPips,
      sensors: snapshot.omegaSensors,
      candles: snapshot.candles.map(c => ({ open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })),
    };
    const marketBriefing = buildMarketBriefing(snapshotInput, omega8Vote as any);

    // Alpha coordinates the decision (with full authority)
    console.log('[Alpha+Omega] 🧠 Alpha making final decision...');
    const alphaStart = Date.now();

    const decision = await alphaCoordinator.coordinate(
      marketBriefing,
      {
        trend: trendVote,
        scalper: scalperVote,
        confirmation: confirmationVote,
        reversal: reversalVote,
        volatility: volatilityVote,
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
      snapshot.candles
    );

    const alphaTime = Date.now() - alphaStart;
    const totalTime = Date.now() - startTime;

    const originalConfidence = decision.confidence;

    // ✅ BUILD CONFIDENCE MODIFIERS FOR NEW SSOT ENGINE
    const confidenceModifiers: ConfidenceModifier[] = [];

    // EQS Penalty (0-15%, additive)
    if (decision.eqs_penalty !== undefined && decision.eqs_penalty > 0) {
      confidenceModifiers.push({
        domain: 'eqs',
        domain_owner: 'EQS Quality Gate',
        penalty_type: 'additive',
        value: Math.min(decision.eqs_penalty / 100, 0.15),
        reason: decision.eqs_reason || 'Entry quality score penalty',
        source_file: 'alpha-omega-orchestrator.ts',
        severity: decision.eqs_penalty > 10 ? 'high' : 'medium'
      });
    }

    // Narrative Penalty (0-12%, additive)
    if (decision.narrative_penalty !== undefined && decision.narrative_penalty > 0) {
      confidenceModifiers.push({
        domain: 'narrative',
        domain_owner: 'Narrative Validator',
        penalty_type: 'additive',
        value: Math.min(decision.narrative_penalty / 100, 0.12),
        reason: decision.narrative_reason || 'Narrative coherence penalty',
        source_file: 'alpha-omega-orchestrator.ts',
        severity: decision.narrative_penalty > 8 ? 'high' : 'medium'
      });
    }

    // Regime Oracle Penalties (regime + volatility + session, max 15% total)
    if (marketState.regime) {
      const regimePenalty = marketState.regime.confidence_penalty_percent || 0;
      if (regimePenalty > 0) {
        confidenceModifiers.push({
          domain: 'regime_oracle',
          domain_owner: 'RegimeOracle',
          penalty_type: 'additive',
          value: Math.min(regimePenalty / 100, 0.15),
          reason: `Market regime: ${marketState.regime.regime_classification} - ${marketState.regime.reason || ''}`,
          source_file: 'alpha-omega-orchestrator.ts',
          severity: regimePenalty > 10 ? 'high' : 'medium'
        });
      }
    }

    // Adversarial Penalty (0-10%, hard cap)
    if (marketState.adversarial && marketState.adversarial.is_adversarial) {
      let adversarialPenalty = 0.05; // Default 5%
      if (marketState.adversarial.stop_run_classification?.should_block) {
        adversarialPenalty = 0.1; // Max 10% for blocks
      } else if (marketState.adversarial.stop_run_classification?.type === 'active_stop_run') {
        adversarialPenalty = 0.08;
      }
      confidenceModifiers.push({
        domain: 'adversarial',
        domain_owner: 'Adversarial Detector',
        penalty_type: 'additive',
        value: adversarialPenalty,
        reason: `Adversarial detection: ${marketState.adversarial.stop_run_classification?.reasoning || 'manipulation risk'}`,
        source_file: 'alpha-omega-orchestrator.ts',
        severity: adversarialPenalty > 0.05 ? 'high' : 'medium'
      });
    }

    // Session Advisory Penalty (0-15% max, advisory)
    // Graduated penalty based on fill-time-to-session-remaining ratio
    // SSOT: SessionAdvisor is the sole authority for time-based confidence adjustments
    const sessionPenalty = this.calculateSessionAdvisoryPenalty(
      marketState.regime,
      decision.expectedFillTimeHours
    );
    if (sessionPenalty.value > 0) {
      confidenceModifiers.push({
        domain: 'session_advisor',
        domain_owner: 'Session Advisor',
        penalty_type: 'additive',
        value: sessionPenalty.value,
        reason: sessionPenalty.reason,
        source_file: 'alpha-omega-orchestrator.ts',
        severity: sessionPenalty.severity
      });
    }

    // Pattern Confidence Adjustment (±5-10%)
    if (decision.pattern_confidence_penalty !== undefined) {
      const patternVal = Math.abs(decision.pattern_confidence_penalty) / 100;
      if (patternVal > 0) {
        confidenceModifiers.push({
          domain: 'pattern_confidence',
          domain_owner: 'Pattern Confidence',
          penalty_type: 'additive',
          value: Math.min(patternVal, 0.1),
          reason: decision.pattern_reason || 'Technical pattern quality adjustment',
          source_file: 'alpha-omega-orchestrator.ts',
          severity: patternVal > 0.05 ? 'medium' : 'low'
        });
      }
    }

    // ✅ USE NEW SSOT ENGINE TO CALCULATE FINAL CONFIDENCE
    // Rewards are optional - confidence engine will use defaults if not provided
    const confidenceResult = await confidenceCalculationEngine.calculateFinalConfidence({
      base_confidence: originalConfidence,
      symbol: marketState.symbol,
      risk_mode: riskMode as RiskMode,
      session_id: undefined,
      trade_id: undefined,
      user_id: userId,
      rewards: undefined, // Rewards will be calculated by the engine if needed
      modifiers: confidenceModifiers
    });

    const finalConfidence = confidenceResult.final_confidence;
    const rewardedConfidence = confidenceResult.after_rewards;
    const preCapConfidence = confidenceResult.pre_cap_confidence;
    const advisoryConfidence = confidenceResult.advisory_adjusted_confidence;

    console.log(`[Alpha+Omega] Alpha decision complete (${alphaTime}ms)`);
    console.log(`[Alpha+Omega] Total pipeline: ${totalTime}ms`);
    console.log(`[Alpha+Omega] Alpha decided: ${decision.action} @ ${originalConfidence}%`);
    console.log(`[Alpha+Omega] Execution confidence: ${finalConfidence}% | Advisory-adjusted: ${advisoryConfidence}% (audit: ${confidenceResult.audit_id?.substring(0, 8)})`);

    if (confidenceResult.is_degraded) {
      console.log(`[Alpha+Omega] Advisory penalties would degrade to ${advisoryConfidence}% (logged, not enforced): ${confidenceResult.degradation_reason}`);
    }

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

    console.log(`[Alpha+Omega] 📝 Conflict Info: detected=${conflictInfo.detected}, type=${conflictInfo.type}, severity=${conflictInfo.severity}`);

    return {
      ...decision,
      confidence: finalConfidence,
      confidenceAdjustments: confidenceResult.all_modifiers.map(m => ({
        source: m.domain_owner,
        penalty: m.value,
        reason: m.reason,
        domain: m.domain,
        severity: m.severity
      })),
      confidenceRewards: [], // Rewards will be tracked in audit trail
      confidenceCalculationAudit: {
        base: originalConfidence,
        afterRewards: rewardedConfidence,
        preCapConfidence,
        finalConfidence,
        isDegraded: confidenceResult.is_degraded,
        degradationReason: confidenceResult.degradation_reason,
        auditId: confidenceResult.audit_id,
        riskMode: riskMode.toUpperCase(),
        passesThreshold: confidenceResult.passes_threshold,
        executionThreshold: confidenceResult.execution_threshold
      },
      conflictInfo // SSOT: Conflict detection flows from orchestrator → learning system
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
    goalContext?: import('../brains/coordinator-alpha').GoalContext
  ): Promise<Map<string, AlphaDecision>> {
    const config = getConcurrentExecutionConfig();
    const isConcurrent = isConcurrentExecutionEnabled();
    const mode = isConcurrent ? 'CONCURRENT' : 'SEQUENTIAL';

    console.log(`[Alpha+Omega] 🔍 Evaluating ${marketStates.length} symbols in ${mode} mode...`);
    console.log(formatConcurrentConfigForLogging());

    const startTime = Date.now();

    // GOVERNANCE: Track execution start
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    if (config.governance.enabled) {
      console.log(`[Alpha+Omega] 📊 Governance Tracking ID: ${executionId}`);
    }

    // Route to appropriate evaluation strategy
    const decisionMap = isConcurrent
      ? await this.evaluateConcurrently(marketStates, traderScore, userId, goalContext, executionId)
      : await this.evaluateSequentially(marketStates, traderScore, userId, goalContext, executionId);

    const duration = Date.now() - startTime;
    const evaluatedCount = decisionMap.size;

    console.log(`[Alpha+Omega] ✅ Multi-symbol evaluation complete in ${duration}ms (${mode})`);
    console.log(`[Alpha+Omega] 📊 Evaluated ${evaluatedCount}/${marketStates.length} symbols`);

    // GOVERNANCE: Alert if execution exceeded threshold
    if (config.governance.enabled && duration > config.governance.alertThresholdMs) {
      console.warn(`[Alpha+Omega] ⚠️ GOVERNANCE ALERT: Execution took ${duration}ms (threshold: ${config.governance.alertThresholdMs}ms)`);
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
    total?: number
  ): Promise<{ symbol: string; decision: AlphaDecision; timing: number }> {
    const symbolStartTime = Date.now();

    return new Promise(async (resolve) => {
      try {
        console.log(`[Alpha+Omega Batch ${(index || 0) + 1}/${total || '?'}] ${marketState.symbol} | Price: ${marketState.price}, ATR: ${marketState.atr}`);

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

        const { stopLossMultiplier, takeProfitMultiplier } = this.calculateDynamicMultipliers(marketState);
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
            console.warn(`[Alpha+Omega] ${marketState.symbol}: 50% timeout (${Math.round(sessionTimeout * 0.5)}ms)`);
          }, sessionTimeout * 0.5);

          warn75Id = setTimeout(() => {
            console.warn(`[Alpha+Omega] ${marketState.symbol}: 75% timeout (${Math.round(sessionTimeout * 0.75)}ms) - approaching limit`);
          }, sessionTimeout * 0.75);

          timeoutId = setTimeout(() => {
            reject(new Error(`Symbol evaluation timeout (${sessionTimeout}ms - ${currentSession} session)`));
          }, sessionTimeout);
        });

        const decision = await Promise.race([
          this.makeTradeDecision(marketState, traderScore, proposedSL, proposedTP, goalContext, userId),
          timeoutPromise
        ]);

        clearTimers();
        const timing = Date.now() - symbolStartTime;
        console.log(`[Alpha+Omega] ${marketState.symbol}: ${decision.action} @ ${decision.confidence}% (${timing}ms)`);
        resolve({ symbol: marketState.symbol, decision, timing });

      } catch (error) {
        const timing = Date.now() - symbolStartTime;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const isTimeout = errorMessage.includes('timeout');

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

  private async evaluateConcurrently(
    marketStates: FullMarketState[],
    traderScore: TraderScore,
    userId?: string,
    goalContext?: import('../brains/coordinator-alpha').GoalContext,
    executionId?: string
  ): Promise<Map<string, AlphaDecision>> {
    const config = getConcurrentExecutionConfig();
    const minConfidence = goalContext?.minConfidence || config.earlyExit.minConfidenceThreshold;
    const maxConcurrent = config.concurrency.maxConcurrentSymbols || marketStates.length;

    const currentSession = marketScheduleService.getCurrentMarketSession();
    const sessionTimeout = getSessionTimeout(currentSession);
    const sessionDescription = marketScheduleService.getSessionDescription(currentSession);

    console.log(`[Alpha+Omega] CONCURRENT MODE: ${marketStates.length} symbols, ${maxConcurrent} at a time`);
    console.log(`[Alpha+Omega] Session: ${sessionDescription} | Timeout: ${sessionTimeout}ms/symbol`);
    console.log(`[Alpha+Omega] Early-exit: ${config.earlyExit.enabled ? `YES (${minConfidence}%+)` : 'NO'}`);

    const decisionMap = new Map<string, AlphaDecision>();
    const symbolTimings = new Map<string, number>();

    const chunks: FullMarketState[][] = [];
    for (let i = 0; i < marketStates.length; i += maxConcurrent) {
      chunks.push(marketStates.slice(i, i + maxConcurrent));
    }

    console.log(`[Alpha+Omega] Processing ${chunks.length} batch(es) of up to ${maxConcurrent} symbols`);

    let foundViableTrade = false;
    let viableTradeSymbol = '';

    for (let batchIdx = 0; batchIdx < chunks.length; batchIdx++) {
      const chunk = chunks[batchIdx];

      if (foundViableTrade && config.earlyExit.enabled) {
        console.log(`[Alpha+Omega] Skipping batch ${batchIdx + 1}/${chunks.length} - viable trade already found (${viableTradeSymbol})`);
        break;
      }

      console.log(`[Alpha+Omega] Batch ${batchIdx + 1}/${chunks.length}: [${chunk.map(s => s.symbol).join(', ')}]`);

      const batchPromises = chunk.map((marketState, idx) =>
        this.createSymbolEvaluationPromise(
          marketState,
          traderScore,
          sessionTimeout,
          currentSession,
          sessionDescription,
          goalContext,
          userId,
          batchIdx * maxConcurrent + idx,
          marketStates.length
        )
      );

      const results = await Promise.allSettled(batchPromises);

      for (const result of results) {
        if (result.status === 'fulfilled') {
          const { symbol, decision, timing } = result.value;
          decisionMap.set(symbol, decision);
          symbolTimings.set(symbol, timing);

          const isViableTrade = decision.action !== 'NO_TRADE' && decision.confidence >= minConfidence;

          if (isViableTrade && !foundViableTrade) {
            foundViableTrade = true;
            viableTradeSymbol = symbol;
            console.log(`[Alpha+Omega] VIABLE TRADE: ${symbol} @ ${decision.confidence}% confidence`);
          }
        } else {
          console.error(`[Alpha+Omega] Symbol evaluation rejected:`, result.reason);
        }
      }
    }

    if (foundViableTrade) {
      console.log(`[Alpha+Omega] Best trade: ${viableTradeSymbol} | Evaluated: ${decisionMap.size}/${marketStates.length}`);
    }

    if (config.governance.enabled) {
      const errorCount = Array.from(decisionMap.values()).filter(d => d.action === 'NO_TRADE' && d.confidence === 0).length;
      const errorRate = (errorCount / marketStates.length) * 100;

      if (errorRate > config.governance.alertErrorRatePercent) {
        console.warn(`[Alpha+Omega] GOVERNANCE ALERT: Error rate ${errorRate.toFixed(1)}% exceeds ${config.governance.alertErrorRatePercent}%`);
      }
    }

    if (config.tracking.logDetailedTimings) {
      console.log(`[Alpha+Omega] Symbol Timings:`);
      symbolTimings.forEach((timing, symbol) => {
        const decision = decisionMap.get(symbol);
        console.log(`  ${symbol}: ${timing}ms (${decision?.action || 'UNKNOWN'})`);
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
    executionId?: string
  ): Promise<Map<string, AlphaDecision>> {
    const config = getConcurrentExecutionConfig();
    const minConfidence = goalContext?.minConfidence || config.earlyExit.minConfidenceThreshold;

    console.log(`[Alpha+Omega] 🔄 SEQUENTIAL MODE: Analyzing symbols one by one`);
    console.log(`[Alpha+Omega] 🎯 Early-exit threshold: ${minConfidence}% confidence`);

    const decisionMap = new Map<string, AlphaDecision>();

    // Sequential evaluation with early-exit logic
    for (let i = 0; i < marketStates.length; i++) {
      const marketState = marketStates[i];

      try {
        console.log(`%c[Alpha+Omega Pre-Check ${i + 1}/${marketStates.length}] ${marketState.symbol}`, 'color: #00aaff; font-weight: bold');
        console.log(`  Price: ${marketState.price}, ATR: ${marketState.atr}`);

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

        const { stopLossMultiplier, takeProfitMultiplier } = this.calculateDynamicMultipliers(marketState);
        const proposedSL = marketState.price - (marketState.atr * stopLossMultiplier);
        const proposedTP = marketState.price + (marketState.atr * takeProfitMultiplier);

        const { calculatePipDistance } = await import('../utils/currencyHelpers');
        const slDistancePips = calculatePipDistance(marketState.symbol, marketState.price, proposedSL);

        console.log(`[Alpha+Omega] Dynamic SL/TP for ${marketState.symbol}:`);
        console.log(`  Multipliers: ${stopLossMultiplier.toFixed(2)}x SL / ${takeProfitMultiplier.toFixed(2)}x TP`);
        console.log(`  Proposed SL: ${proposedSL.toFixed(5)} (${slDistancePips.toFixed(1)} pips from entry)`);

        const decision = await this.makeTradeDecision(
          marketState,
          traderScore,
          proposedSL,
          proposedTP,
          goalContext,
          userId
        );

        decisionMap.set(marketState.symbol, decision);

        // EARLY EXIT: Stop scanning if viable trade found
        if (config.earlyExit.enabled) {
          const isViableTrade = decision.action !== 'NO_TRADE' && decision.confidence >= minConfidence;

          if (isViableTrade) {
            const remainingSymbols = marketStates.length - (i + 1);
            console.log(`[Alpha+Omega] ✅ EARLY EXIT: Found viable trade on ${marketState.symbol} (${decision.confidence}% confidence)`);
            console.log(`[Alpha+Omega] 🚀 Stopped scanning - skipped ${remainingSymbols} remaining symbols`);
            console.log(`[Alpha+Omega] 💰 Savings: ~${remainingSymbols * 3} LLM calls avoided`);
            break;
          } else {
            console.log(`[Alpha+Omega] ⏭️  ${marketState.symbol}: ${decision.action} @ ${decision.confidence}% - continuing scan...`);
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
      console.log(`[MidTrade] 🚨 EMERGENCY check @ ${(drawdownPct * 100).toFixed(0)}% drawdown`);
      return await midTradeMonitor.evaluateEmergency(snapshot, traderScore, userId, sessionId);
    } else if (drawdownPct >= HARD_TRIGGER) {
      console.log(`[MidTrade] ⚠️ HARD check @ ${(drawdownPct * 100).toFixed(0)}% drawdown`);
      return await midTradeMonitor.evaluateHard(snapshot, traderScore, userId, sessionId);
    } else {
      console.log(`[MidTrade] ℹ️ SOFT check @ ${(drawdownPct * 100).toFixed(0)}% drawdown`);
      return await midTradeMonitor.evaluateSoft(snapshot, traderScore, userId, sessionId);
    }
  }

  /**
   * Calculate dynamic stop loss and take profit multipliers based on market conditions
   */
  private calculateDynamicMultipliers(marketState: FullMarketState): {
    stopLossMultiplier: number;
    takeProfitMultiplier: number;
  } {
    let slMultiplier = 1.8; // Base: 1.8x ATR (increased from 1.5x for more breathing room)
    let tpMultiplier = 3.0; // Base: 3.0x ATR (increased from 2.5x for better R:R)

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

  /**
   * Log Omega votes
   */
  /**
   * Detect high-confidence directional conflicts between Omega brains
   * REFINED: Distinguishes between HARD BLOCK and SOFT WARNING
   * PERSONALITY-AWARE: Respects trader personality and risk mode
   */
  private detectOmegaConflicts(votes: OmegaCouncilVotes, traderScore: TraderScore): {
    hasConflict: boolean;
    conflictType: 'HARD' | 'SOFT' | 'NONE';
    severity: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
    conflictDescription: string;
    confidencePenalty: number; // Multiplier to apply (0.8 = -20%, 1.0 = no change)
  } {
    const HIGH_CONFIDENCE = 70;

    // Personality settings influence conflict resolution
    const isAggressive = traderScore.personality === 'AGGRESSIVE';
    const isHighScore = traderScore.score >= 80;
    const isAggressiveMode = isAggressive && isHighScore;

    // Define conflicting domain pairs (Swing Omega removed)
    const conflictingDomains: Record<string, string[]> = {
      'Trend': ['OrderFlow', 'Reversal'],
      'OrderFlow': ['Trend', 'Reversal'],
      'Reversal': ['Trend', 'OrderFlow'],
      'Scalper': [] // Scalper can disagree with anyone without being critical
    };

    // Collect ALL directional votes (not just high confidence)
    const allVotes: Array<{ brain: string; direction: 'BUY' | 'SELL'; confidence: number; domain: string }> = [];

    if (votes.trend && (votes.trend.vote === 'BUY' || votes.trend.vote === 'SELL')) {
      allVotes.push({ brain: 'Trend', direction: votes.trend.vote, confidence: votes.trend.confidence, domain: 'Trend' });
    }
    if (votes.scalper && (votes.scalper.vote === 'BUY' || votes.scalper.vote === 'SELL')) {
      allVotes.push({ brain: 'Scalper', direction: votes.scalper.vote, confidence: votes.scalper.confidence, domain: 'Scalper' });
    }
    if (votes.reversal && (votes.reversal.vote === 'BUY' || votes.reversal.vote === 'SELL')) {
      allVotes.push({ brain: 'Reversal', direction: votes.reversal.vote, confidence: votes.reversal.confidence, domain: 'Reversal' });
    }
    if (votes.omega8 && (votes.omega8.vote === 'BUY' || votes.omega8.vote === 'SELL')) {
      allVotes.push({ brain: 'OrderFlow', direction: votes.omega8.vote, confidence: votes.omega8.confidence, domain: 'OrderFlow' });
    }

    // Check for conflicts
    if (allVotes.length < 2) {
      return {
        hasConflict: false,
        conflictType: 'NONE',
        severity: 'NONE',
        conflictDescription: 'No conflict',
        confidencePenalty: 1.0
      };
    }

    const buyVotes = allVotes.filter(v => v.direction === 'BUY');
    const sellVotes = allVotes.filter(v => v.direction === 'SELL');

    if (buyVotes.length === 0 || sellVotes.length === 0) {
      return {
        hasConflict: false,
        conflictType: 'NONE',
        severity: 'NONE',
        conflictDescription: 'No conflict',
        confidencePenalty: 1.0
      };
    }

    // We have conflicting directions - now determine HARD vs SOFT

    // Filter for high-confidence votes
    const highConfBuyVotes = buyVotes.filter(v => v.confidence >= HIGH_CONFIDENCE);
    const highConfSellVotes = sellVotes.filter(v => v.confidence >= HIGH_CONFIDENCE);

    // Check for conflicting domains
    const hasConflictingDomains = highConfBuyVotes.some(buy =>
      highConfSellVotes.some(sell =>
        conflictingDomains[buy.domain]?.includes(sell.domain) ||
        conflictingDomains[sell.domain]?.includes(buy.domain)
      )
    );

    const buyBrains = buyVotes.map(v => `${v.brain}(${v.confidence}%)`).join(', ');
    const sellBrains = sellVotes.map(v => `${v.brain}(${v.confidence}%)`).join(', ');
    const description = `BUY: [${buyBrains}] vs SELL: [${sellBrains}]`;

    // Check for overwhelming majority (5+ vs 1 or 1 vs 5+)
    const hasOverwhelmingMajority =
      (buyVotes.length >= 5 && sellVotes.length === 1) ||
      (sellVotes.length >= 5 && buyVotes.length === 1);

    // HARD CONFLICT CONDITIONS (ADVISORY - NO LONGER BLOCKING):
    // 1. At least 2 Omegas disagree in direction
    // 2. Their disagreement confidence >= 70%
    // 3. They are from conflicting domains
    // 4. NOT in aggressive mode with overwhelming majority
    const hardConflictCondition1 = highConfBuyVotes.length >= 1 && highConfSellVotes.length >= 1;
    const hardConflictCondition2 = hardConflictCondition1; // Already filtered for >= 70%
    const hardConflictCondition3 = hasConflictingDomains;
    const hardConflictCondition4 = !(isAggressiveMode && hasOverwhelmingMajority);

    if (hardConflictCondition1 && hardConflictCondition2 && hardConflictCondition3 && hardConflictCondition4) {
      // CRITICAL FIX: HARD conflicts now use confidence penalties instead of blocking
      // This allows Alpha to make the final decision with strong advisory input
      const majorityDirection = buyVotes.length > sellVotes.length ? 'BUY' : 'SELL';
      const majorityCount = Math.max(buyVotes.length, sellVotes.length);
      const minorityCount = Math.min(buyVotes.length, sellVotes.length);

      // Calculate penalty based on conflict severity (REFINED for fairness)
      let penalty = 0.75; // Base: 25% penalty for HARD conflict

      // Equal split (2v2 or 3v3) - signals Alpha's arbitration is needed, but not fatal
      if (majorityCount === minorityCount) {
        penalty = 0.90; // 10% penalty for equal split - let Alpha decide
        console.log(`[Omega Conflict] HARD conflict - EQUAL SPLIT (${majorityCount}v${minorityCount}) - Alpha arbitration needed (${((1 - penalty) * 100).toFixed(0)}% penalty)`);
      }
      // Clear majority (3+ vs 1-2) - minimal penalty
      else if (majorityCount >= 3 && minorityCount <= 2) {
        penalty = 0.90; // 10% penalty when clear majority exists
        console.log(`[Omega Conflict] HARD conflict with ${majorityCount}v${minorityCount} majority - applying minimal penalty (${((1 - penalty) * 100).toFixed(0)}% penalty)`);
      }
      // Slight majority (3v2, 2v1) - moderate penalty
      else {
        penalty = 0.75; // 25% penalty for slight majority
        console.log(`[Omega Conflict] HARD conflict (${majorityCount}v${minorityCount}) - applying moderate penalty (${((1 - penalty) * 100).toFixed(0)}% penalty)`);
      }

      console.log(`[Omega Conflict] ⚠️ HIGH SEVERITY: Conflicting high-confidence signals from opposing domains`);
      console.log(`[Omega Conflict] ${description}`);
      console.log(`[Omega Conflict] Recommended: Follow ${majorityDirection} majority with ${penalty}x confidence (${(penalty * 100).toFixed(0)}%)`);

      return {
        hasConflict: true,
        conflictType: 'HARD',
        severity: 'HIGH',
        conflictDescription: description,
        confidencePenalty: penalty // Apply penalty instead of blocking
      };
    }

    // AGGRESSIVE MODE OVERRIDE: Further reduce penalty when overwhelming majority exists
    if (isAggressiveMode && hasOverwhelmingMajority && hardConflictCondition1 && hardConflictCondition2 && hardConflictCondition3) {
      const majorityDirection = buyVotes.length > sellVotes.length ? 'BUY' : 'SELL';
      const majorityCount = Math.max(buyVotes.length, sellVotes.length);
      const minorityCount = Math.min(buyVotes.length, sellVotes.length);

      console.log(`[Omega Conflict] 🔥 AGGRESSIVE MODE OVERRIDE: ${majorityCount} vs ${minorityCount} - Taking ${majorityDirection} with minimal penalty`);
      console.log('[Omega Conflict] Personality: AGGRESSIVE | Score: ' + traderScore.score + ' | Respecting overwhelming majority');

      return {
        hasConflict: true,
        conflictType: 'SOFT',
        severity: 'MEDIUM',
        conflictDescription: `${description} (Aggressive: Following ${majorityCount}-vote majority)`,
        confidencePenalty: 0.85 // -15% penalty for aggressive override with overwhelming majority
      };
    }

    // SOFT WARNING CONDITIONS:
    // - Only one Omega disagrees
    // - OR confidence < 70%
    // - OR disagreement is between similar-domain Omegas
    if (highConfBuyVotes.length <= 1 || highConfSellVotes.length <= 1 || !hasConflictingDomains) {
      const lowConfCount = buyVotes.filter(v => v.confidence < HIGH_CONFIDENCE).length +
                           sellVotes.filter(v => v.confidence < HIGH_CONFIDENCE).length;

      let penalty = 1.0;
      let severityLevel: 'LOW' | 'MEDIUM' = 'LOW';

      if (lowConfCount > 0) {
        penalty = isAggressiveMode ? 0.95 : 0.9; // Aggressive: -5%, Normal: -10%
        severityLevel = 'LOW';
      } else if (!hasConflictingDomains) {
        penalty = isAggressiveMode ? 0.92 : 0.85; // Aggressive: -8%, Normal: -15%
        severityLevel = 'LOW';
      } else {
        penalty = isAggressiveMode ? 0.88 : 0.8; // Aggressive: -12%, Normal: -20%
        severityLevel = 'MEDIUM';
      }

      const modeLabel = isAggressiveMode ? 'AGGRESSIVE' : 'STANDARD';
      console.warn(`[Omega Conflict] SOFT conflict (${modeLabel}), applying ${penalty}x confidence penalty`);
      return {
        hasConflict: true,
        conflictType: 'SOFT',
        severity: severityLevel,
        conflictDescription: description,
        confidencePenalty: penalty
      };
    }

    // Default: no conflict
    return {
      hasConflict: false,
      conflictType: 'NONE',
      severity: 'NONE',
      conflictDescription: 'No conflict',
      confidencePenalty: 1.0
    };
  }

  /**
   * WORST-CASE WINS: Apply only the single worst confidence penalty
   * Prevents multiplicative stacking that leads to hidden confidence drops
   */
  private calculateWorstCasePenalty(penalties: ConfidencePenalty[]): ConfidencePenaltyResult {
    const validPenalties = penalties.filter(p => p.multiplier < 1.0);

    if (validPenalties.length === 0) {
      const noPenalty: ConfidencePenalty = {
        source: 'none',
        multiplier: 1.0,
        reason: 'No penalties applied'
      };
      return {
        appliedPenalty: noPenalty,
        allProposedPenalties: penalties,
        finalMultiplier: 1.0
      };
    }

    const worstPenalty = validPenalties.reduce((worst, current) =>
      current.multiplier < worst.multiplier ? current : worst
    );

    console.log(`[Alpha+Omega] 📊 CONFIDENCE PENALTIES (worst-case wins):`);
    penalties.forEach(p => {
      const marker = p === worstPenalty ? '→ APPLIED' : '  (not applied)';
      const pctReduction = ((1 - p.multiplier) * 100).toFixed(1);
      console.log(`  ${marker} ${p.source}: ${p.multiplier.toFixed(2)}x (-${pctReduction}%) - ${p.reason}`);
    });
    console.log(`[Alpha+Omega] 🎯 Final multiplier: ${worstPenalty.multiplier.toFixed(2)}x from ${worstPenalty.source}`);

    return {
      appliedPenalty: worstPenalty,
      allProposedPenalties: penalties,
      finalMultiplier: worstPenalty.multiplier
    };
  }

  /**
   * Calculate confidence rewards for optimal conditions
   * This creates a balanced incentive structure - not all trades get penalized!
   */
  private calculateConfidenceRewards(
    votes: OmegaCouncilVotes,
    marketState: FullMarketState,
    regimeSnapshot?: RegimeSnapshot,
    adversarialSignal?: AdversarialSignal
  ): ConfidenceRewardResult {
    const rewards: ConfidenceReward[] = [];

    // ✅ REWARD 1: Strong Omega Consensus (low disagreement, high alignment)
    const directionalVotes = [
      votes.trend?.vote,
      votes.scalper?.vote,
      votes.reversal?.vote,
      votes.omega8?.vote,
      votes.volatility?.vote
    ].filter(v => v === 'BUY' || v === 'SELL');

    if (directionalVotes.length >= 3) {
      const buyVotes = directionalVotes.filter(v => v === 'BUY').length;
      const sellVotes = directionalVotes.filter(v => v === 'SELL').length;
      const majorityCount = Math.max(buyVotes, sellVotes);
      const totalVotes = directionalVotes.length;

      // Unanimous alignment (all agree)
      if (majorityCount === totalVotes && totalVotes >= 4) {
        rewards.push({
          source: 'Omega Consensus',
          bonus: 8,
          reason: `Unanimous ${directionalVotes[0]} alignment across ${totalVotes} Omegas - exceptional setup`
        });
      }
      // Strong majority (5+ votes, 1-2 disagree)
      else if (majorityCount >= 5 && totalVotes - majorityCount <= 2) {
        rewards.push({
          source: 'Omega Consensus',
          bonus: 10,
          reason: `Strong ${majorityCount}v${totalVotes - majorityCount} consensus - high-conviction setup`
        });
      }
      // Clear majority (4v1 or 3v1)
      else if (majorityCount >= 4 && totalVotes - majorityCount === 1) {
        rewards.push({
          source: 'Omega Consensus',
          bonus: 5,
          reason: `Clear ${majorityCount}v${totalVotes - majorityCount} majority - solid setup`
        });
      }
    }

    // ✅ REWARD 2: Clean Order Flow (no manipulation detected)
    if (!adversarialSignal || !adversarialSignal.is_adversarial) {
      rewards.push({
        source: 'Clean Order Flow',
        bonus: 5,
        reason: 'No manipulation detected - healthy price action'
      });
    }

    // ✅ REWARD 3: Optimal Session Timing (within active market session)
    if (regimeSnapshot?.session && regimeSnapshot.session !== 'dead_zone') {
      // Check if we're in optimal session window (not at edges)
      const isOptimalTiming = regimeSnapshot.session_open === false; // Not just opened, stable session
      if (isOptimalTiming) {
        rewards.push({
          source: 'Session Timing',
          bonus: 5,
          reason: `Optimal ${regimeSnapshot.session} session timing - active market conditions`
        });
      }
    }

    // ✅ REWARD 4: Optimal ATR for Volatility (not too high, not too low)
    if (regimeSnapshot) {
      const volatilityScore = regimeSnapshot.volatility_score;
      // Goldilocks zone: 40-70 volatility score (not too hot, not too cold)
      if (volatilityScore >= 40 && volatilityScore <= 70) {
        rewards.push({
          source: 'Optimal Volatility',
          bonus: 5,
          reason: `Volatility at ${volatilityScore}% - ideal for trading (40-70% sweet spot)`
        });
      }
    }

    // ✅ REWARD 5: Strong Market Structure (clear trend with good structure quality)
    if (regimeSnapshot?.structure_quality && regimeSnapshot.structure_quality >= 70) {
      rewards.push({
        source: 'Market Structure',
        bonus: 5,
        reason: `Strong market structure (${regimeSnapshot.structure_quality}% quality) - clear directional bias`
      });
    }

    const totalBonus = rewards.reduce((sum, r) => sum + r.bonus, 0);

    return {
      rewards,
      totalBonus
    };
  }

  /**
   * Collect all confidence penalties from various sources
   */
  collectConfidencePenalties(
    conflictCheck: { confidencePenalty: number; conflictDescription: string },
    freshnessAdvisory?: { confidenceReduction: number; overallSeverity: string },
    adversarialSignal?: AdversarialSignal,
    regimeSnapshot?: RegimeSnapshot
  ): ConfidencePenaltyResult {
    const penalties: ConfidencePenalty[] = [];

    // Omega conflict penalties removed - omegas are intelligence providers, not voters

    if (freshnessAdvisory && freshnessAdvisory.confidenceReduction > 0) {
      const multiplier = 1 - (freshnessAdvisory.confidenceReduction / 100);
      penalties.push({
        source: 'Freshness Advisory',
        multiplier,
        reason: `${freshnessAdvisory.overallSeverity} severity data staleness`
      });
    }

    if (adversarialSignal && adversarialSignal.is_adversarial) {
      let multiplier = 1.0;
      let reason = '';

      // ═══════════════════════════════════════════════════════════════════
      // TIERED CONFIDENCE PENALTY SYSTEM
      // Uses detailed stop-run classification instead of flat level-based penalties
      // ═══════════════════════════════════════════════════════════════════

      // Use detailed stop-run classification if available
      if (adversarialSignal.stop_run_classification) {
        const classification = adversarialSignal.stop_run_classification;

        // TIER 1: Hard block scenarios (should_block = true)
        if (classification.should_block) {
          multiplier = 0.5; // 50% penalty
          reason = `BLOCKED: ${classification.reasoning}`;
        }
        // TIER 2: Active stop runs (happening NOW on current candle)
        else if (classification.type === 'active_stop_run') {
          multiplier = 0.55; // 45% penalty
          reason = `Active stop run (${classification.candles_ago} candles ago) - too volatile to trust`;
        }
        // TIER 3: Historical sweep WITH BOS confirmation = GOOD ENTRY (no penalty)
        else if (classification.type === 'historical_sweep' && classification.has_bos) {
          multiplier = 1.0; // NO PENALTY - this is a valid reversal setup
          reason = `Historical sweep with BOS confirmation - valid entry setup`;
        }
        // TIER 4: Very recent patterns without BOS (1-2 candles ago)
        else if (classification.candles_ago <= 2 && !classification.has_bos) {
          multiplier = 0.85; // 15% penalty
          reason = `Recent ${classification.type} (${classification.candles_ago} candles ago) without BOS - requires validation`;
        }
        // TIER 5: Historical patterns without BOS (3+ candles ago)
        else if (classification.candles_ago >= 3 && !classification.has_bos) {
          multiplier = 0.90; // 10% penalty - let Omega-9 handle final validation
          reason = `Historical ${classification.type} (${classification.candles_ago} candles ago) - Omega-9 validation needed`;
        }
        // TIER 6: Manipulation spikes (time-based decay)
        else if (classification.type === 'manipulation_spike') {
          if (classification.candles_ago <= 1) {
            multiplier = 0.55; // 45% penalty for very recent spikes
            reason = `Very recent manipulation spike (${classification.candles_ago} candles ago) - unstable conditions`;
          } else if (classification.candles_ago <= 4) {
            multiplier = 0.75; // 25% penalty for mid-aged spikes
            reason = `Mid-aged manipulation spike (${classification.candles_ago} candles ago) - checking stabilization`;
          } else {
            multiplier = 0.90; // 10% penalty for old spikes (market has stabilized)
            reason = `Historical manipulation spike (${classification.candles_ago} candles ago) - market stabilized`;
          }
        }
        // DEFAULT: Use classification reasoning with conservative penalty
        else {
          multiplier = 0.90; // 10% penalty as conservative default
          reason = classification.reasoning;
        }
      }
      // FALLBACK: Use legacy level-based penalties only if no classification available
      else {
        if (adversarialSignal.level === 'severe') {
          multiplier = 0.5;
          reason = `${adversarialSignal.level} manipulation detected (legacy): ${adversarialSignal.notes}`;
        }
        else if (adversarialSignal.level === 'moderate') {
          multiplier = 0.7;
          reason = `${adversarialSignal.level} manipulation detected (legacy): ${adversarialSignal.notes}`;
        }
        else if (adversarialSignal.level === 'mild') {
          multiplier = 0.85;
          reason = `${adversarialSignal.level} manipulation detected (legacy): ${adversarialSignal.notes}`;
        }
      }

      // ENFORCE 15% MAXIMUM PENALTY (per alpha-identity.ts config)
      // ALPHA_IDENTITY.ADVISORY_SYSTEMS.ADVERSARIAL_DETECTOR.maxConfidencePenalty = 15
      const MIN_MULTIPLIER = 0.85; // Max 15% penalty
      if (multiplier < MIN_MULTIPLIER) {
        const originalPenalty = Math.round((1 - multiplier) * 100);
        multiplier = MIN_MULTIPLIER;
        reason = `${reason} [Originally ${originalPenalty}% penalty, capped at 15% per Alpha Authority config]`;
      }

      // Only add penalty if confidence is reduced
      if (multiplier < 1.0) {
        penalties.push({
          source: 'Adversarial Detector',
          multiplier,
          reason
        });
      }
    }

    // NEW: Use additive penalty system from Regime Oracle (0-15% max)
    if (regimeSnapshot && regimeSnapshot.confidence_penalty_percent > 0) {
      // ENFORCE 15% MAXIMUM PENALTY (per alpha-identity.ts config)
      const MAX_REGIME_PENALTY = 15;
      const cappedPenalty = Math.min(regimeSnapshot.confidence_penalty_percent, MAX_REGIME_PENALTY);

      // Convert additive penalty to multiplier format for compatibility
      // E.g., 15% penalty = 0.85 multiplier
      const multiplier = 1 - (cappedPenalty / 100);

      const penaltyNote = cappedPenalty < regimeSnapshot.confidence_penalty_percent
        ? ` [capped from ${regimeSnapshot.confidence_penalty_percent}%]`
        : '';

      penalties.push({
        source: 'Regime Oracle',
        multiplier,
        reason: `${regimeSnapshot.regime_classification} regime: ${regimeSnapshot.reason || 'Market conditions'} (-${cappedPenalty}% advisory penalty${penaltyNote})`
      });
    }

    return this.calculateWorstCasePenalty(penalties);
  }

  private logOmegaVotes(votes: OmegaCouncilVotes): void {
    console.log('[Omega Intelligence Reports]:');
    console.log(`  Trend:      ${votes.trend?.reasoning || 'N/A'}`);
    console.log(`  Scalper:    ${votes.scalper?.reasoning || 'N/A'}`);
    console.log(`  Reversal:   ${votes.reversal?.reasoning || 'N/A'}`);
    console.log(`  Volatility: ${votes.volatility?.reasoning || 'N/A'}`);
    if (votes.omega8) {
      const usedLLM = (votes.omega8 as any).usedLLM ? ' [LLM]' : ' [DET]';
      console.log(`  OrderFlow:  ${votes.omega8.reasoning || 'N/A'}${usedLLM} | Liq: ${votes.omega8.liquidity_bias}`);
    } else {
      console.log(`  OrderFlow:  N/A`);
    }
  }

  private readonly SESSION_DURATIONS_MIN: Record<string, number> = {
    asian: 420,
    london: 480,
    ny: 480,
    dead: 180,
    dead_zone: 180,
  };

  private calculateSessionAdvisoryPenalty(
    regime: RegimeSnapshot | undefined,
    expectedFillTimeHours: number | undefined
  ): { value: number; reason: string; severity: 'low' | 'medium' | 'high' } {
    if (!regime) {
      return { value: 0, reason: '', severity: 'low' };
    }

    const session = regime.session;
    const minutesIntoSession = regime.minutes_into_session || 0;

    const sessionDurationMin = this.SESSION_DURATIONS_MIN[session] || 420;
    const sessionRemainingMin = Math.max(0, sessionDurationMin - minutesIntoSession);

    const expectedFillMin = (expectedFillTimeHours || 0) * 60;

    if (expectedFillMin <= 0) {
      if (session === 'dead' || session === 'dead_zone') {
        return {
          value: 0.05,
          reason: `Dead zone trading - reduced liquidity (${session} session, ${minutesIntoSession}min in)`,
          severity: 'low'
        };
      }
      return { value: 0, reason: '', severity: 'low' };
    }

    const fillTimeRatio = sessionRemainingMin / expectedFillMin;

    if (fillTimeRatio >= 1.0) {
      return { value: 0, reason: '', severity: 'low' };
    }

    let penalty: number;
    let severity: 'low' | 'medium' | 'high';
    let label: string;

    if (fillTimeRatio >= 0.75) {
      penalty = 0.03;
      severity = 'low';
      label = 'tight';
    } else if (fillTimeRatio >= 0.50) {
      penalty = 0.07;
      severity = 'medium';
      label = 'constrained';
    } else if (fillTimeRatio >= 0.25) {
      penalty = 0.12;
      severity = 'high';
      label = 'severely constrained';
    } else {
      penalty = 0.15;
      severity = 'high';
      label = 'critically insufficient';
    }

    if (session === 'dead' || session === 'dead_zone') {
      penalty = Math.max(penalty, 0.05);
    }

    return {
      value: penalty,
      reason: `Session time ${label}: ${Math.round(sessionRemainingMin)}min remaining vs ${Math.round(expectedFillMin)}min expected fill (ratio: ${fillTimeRatio.toFixed(2)}, ${session} session)`,
      severity
    };
  }
}

export const alphaOmegaOrchestrator = new AlphaOmegaOrchestrator();
