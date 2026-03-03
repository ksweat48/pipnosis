/**
 * Alpha Coordinator - The Decision Maker
 *
 * Responsibilities:
 * - Receive raw market intelligence briefing (not pre-digested votes)
 * - Analyze all indicators, sensors, and market structure directly
 * - Make final trading decision with full market context
 * - Handle conflicts intelligently
 *
 * Uses ultra-compressed prompts for cost efficiency
 *
 * ═══════════════════════════════════════════════════════════════════
 * ALPHA FINAL AUTHORITY PRINCIPLE
 * ═══════════════════════════════════════════════════════════════════
 *
 * Alpha is the ONLY decision-maker. No rule-based system may block trades.
 *
 * Authority Hierarchy:
 * 0. Freshness Gate = P0 CIRCUIT BREAKER (operates BEFORE Alpha)
 *    - Validates intelligence age (Omega/Alpha cache)
 *    - Validates price drift (signal vs current)
 *    - Validates realtime price freshness
 *    - BLOCKS execution if data is stale (P0 safety)
 *    - This is NOT a trading decision, it's data integrity
 *
 * 1. Rule-based modules (Regime Oracle, Adversarial Detector) = ADVISORS ONLY
 *    - Provide risk modifiers (0.55x - 1.0x confidence)
 *    - Flag dangerous conditions
 *    - CANNOT block trades
 *
 * 2. Omega Council (6 specialists) = Technical advisors
 *    - Vote with confidence levels
 *    - Provide domain expertise
 *    - CANNOT block trades
 *
 * 3. Alpha Coordinator = FINAL AUTHORITY (THIS MODULE)
 *    - Synthesizes ALL inputs
 *    - Chooses symbol, direction, SL/TP
 *    - Decides IF trade should happen
 *    - Can override any recommendation if justified
 *
 * 4. Omega-9 Hallucination = ONLY safety module allowed to block (after Alpha)
 *    - Validates execution parameters AFTER Alpha decides
 *    - Blocks only catastrophic errors
 *    - Ensures R:R ratios, position sizing
 *
 * Dead Zone Example:
 * - EURUSD at 22:00 UTC (dead zone):
 *   - Regime Oracle: "55% confidence multiplier (low liquidity)"
 *   - Omega Risk: "NO_TRADE - spread risk high"
 *   - Alpha: Sees full context, decides trade is still valid
 *   - Result: Trade executes with reduced position size
 *
 * - USDJPY at 23:00 UTC (Tokyo active):
 *   - Regime Oracle: "100% confidence (Tokyo session active)"
 *   - No dead zone penalty applied
 *   - Alpha proceeds normally
 *
 * ═══════════════════════════════════════════════════════════════════
 */

import { openAIClient } from '../services/openai-client';
import { sanitizeAndParse, tryParseLLMResponse } from '../services/llm-response-sanitizer';
import type { OmegaVote } from './omega/trend';
import type { Omega8Vote, Omega9ValidationResult } from '../types/omega';
import type { TraderScore } from '../services/ai-identity';
import { omega9Hallucination, type Omega9Input } from './omega9-hallucination-brain';
import { omega10Scheduler } from '../services/omega10-scheduler';
import { llmTokenTracker } from '../services/llm-token-tracker';
import { globalIntelligenceProvider } from '../services/global-intelligence-provider';
import { professionalRiskManager } from '../services/professional-risk-manager';
import { alphaIntelligenceAggregator, type AlphaIntelligenceSnapshot } from '../services/alpha-intelligence-aggregator';
import { alphaLearningFeedback } from '../services/alpha-learning-feedback';
import { alphaThoughtStream } from '../services/alpha-thought-stream';
import type { ATRValue } from '../types/atr';
import { supabase } from '../lib/supabase';
import type { AdversarialSignal } from '../services/adversarial-detector';
import type { RegimeSnapshot } from '../services/regime-oracle';
import { rrSuccessTracker } from '../services/rr-success-tracker';
import { formatRiskProfileForLLM } from '../config/risk-strategy-profiles';
import type { MarketBriefing } from '../types/market-briefing';
import { timeToFillCalculator, type TimeToFillInput } from '../services/time-to-fill-calculator';
import { dailyNarrativeBuilder, type DailyNarrative } from '../services/daily-narrative-builder';
import { multiSymbolRanker, type SymbolScore } from '../services/multi-symbol-ranker';
import { riskAwareStopCalculator, type StopLossCalculation, type SweepContext } from '../services/risk-aware-stop-calculator';
import { multiTimeframePatternIntelligence, type PatternIntelligenceResult } from '../services/multi-timeframe-pattern-intelligence';
import { patternLiquidityAdapter } from '../services/pattern-liquidity-adapter';
import { eliteProfitTargetCalculator, type LiquidityZone, type TPCalculationResult } from '../services/profit-target-calculator';
// tp1ProbabilityCalculator REMOVED (CCIP 2026-02-16): Alpha is sole TP authority
// System never computes TP values. All TP decisions come from Alpha's LLM response.
import { calculatePipDistance, getCurrencyPipInfo } from '../utils/currencyHelpers';
import { EntryIntentClassifier } from '../services/entry-intent-classifier';
import { omega9ConstraintProvider } from '../services/omega9-constraint-provider';
// alphaRevisionHandler removed - dual-arena wall check replaces revision loop
import type { Omega9Constraints, DualArenaWalls } from '../types/omega9-constraints';
import { tradeExecutionFreshnessGate } from '../services/trade-execution-freshness-gate';
import { tradeFeasibilityResolver } from '../services/trade-feasibility-resolver';
import type { AssetClass, TradeStyle as FeasibilityTradeStyle } from '../types/trade-feasibility-resolver.types';
import { isCrypto, isIndex, isXAUUSD } from '../utils/currencyHelpers';
import type { ConflictInfo } from '../types/alpha-thesis';
import {
  REGIME_STYLE_ADAPTATIONS,
  SESSION_PROFILES,
  LIQUIDITY_PLAYBOOK,
  type RegimeType,
  type SessionName,
  type LiquidityPosition
} from '../config/alpha-advanced-patterns';
import { calculateSessionContext } from '../utils/marketHours';
import type { EntrySpec, AlphaOutputFormat, StyleDisplayName } from '../types/entry';
import { ALPHA_IDENTITY, getAlphaSystemPromptForStyle, getEntryMode } from '../config/alpha-identity';
import { getDisplayNameFromStyle } from '../config/trade-styles';
import { getStylePromptContext } from '../config/style-personalities';
import { microRegimeClassifier, type MicroRegimeClassification, type MicroRegimeCandle } from '../services/micro-regime-classifier';
import { liquidityIntentAnalyzer, type LiquidityIntentModel } from '../services/liquidity-intent-analyzer';
import { narrativeCoherenceValidator, type NarrativeValidation } from '../services/narrative-coherence-validator';
import { logViolation } from '../services/ssot-violation-logger';
import { sharedIntelligenceCoordinator } from '../services/shared-intelligence-coordinator';
import { extractRegimeSignature } from '../services/regime-signature-extractor';
import { parseStructuredAlphaResponse } from '../services/alpha-thesis-parser';
import type { AlphaMarketThesis, RegimeSignature } from '../types/alpha-thesis';
import { m5SwingAnalyzer, type M5SwingContext } from '../services/m5-swing-analyzer';
import { MarketDataService } from '../services/market-data-service';
import { alphaGeometryValidator } from '../services/alpha-geometry-validator';
import { getExecutionEnvelope, getAssetClassEnvelopeBounds, validateTPSLAgainstEnvelope, type EnvelopeAssetClass } from '../config/style-execution-envelopes';
import { TRADING_CONSTANTS, getMinRRForStyle, getMinTP1RRForStyle } from '../config/trading-constants';
import { wallCalibrationEngine } from '../services/wall-calibration-engine';

/**
 * Helper: Determine asset class from symbol
 */
function getAssetClass(symbol: string): AssetClass {
  if (isCrypto(symbol)) return 'CRYPTO';
  if (isIndex(symbol)) return 'INDEX';
  if (isXAUUSD(symbol)) return 'METAL';
  return 'FOREX';
}

/**
 * CCIP Governance: Write a structural alert row to the structural_alerts table.
 *
 * Called at each deterministic gate decision point (BOS check, sweep wick, conflict blocked).
 * Fire-and-forget — failures are logged but never block the trade decision.
 *
 * SSOT: structural_alerts is the single audit trail for structural gate decisions.
 * RLS: authenticated users can INSERT their own rows.
 */
async function writeStructuralAlert(params: {
  userId: string;
  sessionId: string;
  symbol: string;
  style: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';
  ruleType: string;
  direction: string;
  detailsText: string;
}): Promise<void> {
  try {
    await supabase.from('structural_alerts').insert({
      user_id: params.userId,
      session_id: params.sessionId,
      symbol: params.symbol,
      style: params.style,
      rule_type: params.ruleType,
      direction: params.direction,
      details_text: params.detailsText,
    });
  } catch (err) {
    console.warn('[Alpha Coordinator] writeStructuralAlert failed (non-blocking):', err instanceof Error ? err.message : String(err));
  }
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * DECOUPLED RISK AND STYLE
 * ═══════════════════════════════════════════════════════════════════
 *
 * CRITICAL ARCHITECTURAL CHANGE:
 * Risk and Style are now INDEPENDENT dimensions:
 *
 * RISK MODE (controls MONEY exposure):
 * - HIGH: 8-10% max session loss, 0.5:1 min R:R, 50% confidence penalty cap
 * - MEDIUM: 5-7% max session loss, 1.0:1 min R:R, 40% confidence penalty cap
 * - LOW: 2-4% max session loss, 1.2:1 min R:R, 30% confidence penalty cap
 *
 * TRADE STYLE (controls TIME preference):
 * - SCALP: 20 minutes to 2 hours expected duration
 * - MICRO_INTRADAY: 1 hour to 6 hours expected duration
 * - INTRADAY: 2 hours to 10 hours expected duration
 * - SWING: Multi-session (days)
 *
 * Philosophy:
 * - A user can be HIGH risk (aggressive money) with SWING style (patient timing)
 * - A user can be LOW risk (conservative money) with SCALP style (quick timing)
 * - Risk defines position size and loss tolerance
 * - Style defines hold time and session constraints (advisory only)
 *
 * Default Style Selection (when user doesn't specify):
 * - Based on session context and time availability
 * - NOT based on risk mode
 * ═══════════════════════════════════════════════════════════════════
 */

export interface OmegaCouncilVotes {
  trend: OmegaVote | null;
  scalper: OmegaVote | null;
  confirmation: OmegaVote | null;
  reversal: OmegaVote | null;
  volatility: OmegaVote | null;
  risk: OmegaVote | null;
  omega8: Omega8Vote | null;
}

export interface MarketContext {
  symbol: string;
  regime: string;      // bull/bear/side
  volatility: string;  // low/med/high
  price: number;
  /**
   * Average True Range with explicit timeframe tracking
   * Now uses typed ATRValue for SSOT compliance
   * See /src/types/atr.ts for details
   *
   * ⚠️ Always stored as price difference - convert to pips using: atrPips = atr / pipValue
   */
  atr: number | ATRValue; // Accept both during migration period
  atr20?: number | ATRValue;  // Short-term ATR (typically M5 or M15) for volatility regime detection
  atr100?: number | ATRValue; // Long-term ATR (typically H1 or H4) for volatility regime detection
}

export interface GoalContext {
  hasGoal: boolean;
  currentBalance: number;
  targetGoal: number;
  currentProgress: number;
  remainingGoal: number;
  goalPercentage: number; // e.g., 0.077% for $200 from $258k
  pipsNeededEstimate: number; // Rough estimate for context
  riskMode?: 'low' | 'medium' | 'high'; // User's selected risk tolerance
  riskPercent?: number; // Actual risk percentage (3%, 5%, 10%)
  sessionId?: string; // Goal session ID for progress thought emissions (optional)
  tradeStyle?: string; // User's selected trade style from goal session (scalper, micro, intraday)
}

export interface AlphaDecision {
  action: 'BUY' | 'SELL' | 'NO_TRADE';
  decision: 'BUY' | 'SELL' | 'NO_TRADE';
  entry: number;
  stopLoss: number;
  takeProfit: number; // Legacy field - maps to tp2Price
  tp1Price?: number | null; // Conservative high-probability target (80%+ likely)
  tp1Confidence?: number; // 0-100 probability score for TP1
  tp1Reasoning?: string; // Alpha's explanation for TP1 placement
  tp2Price?: number; // Full profit target (standard TP)
  tp2Reasoning?: string; // Alpha's explanation for TP2 placement
  confidence: number;
  reasoning: string;
  omega_summary: string;
  omega_votes?: OmegaCouncilVotes;
  omega8_liquidity_bias?: string;
  omega8_direction_support?: string;
  omega9_validation?: Omega9ValidationResult;
  omega10_applied?: boolean;
  symbol?: string;
  timestamp?: Date;
  risk_pct?: number;
  resolvedStyle?: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';
  expectedFillTimeHours?: number;
  atrPercent?: number;
  goal_context?: GoalContext;
  intelligence_snapshot?: Partial<AlphaIntelligenceSnapshot>;
  adversarial_advisory?: AdversarialSignal;
  regime_advisory?: RegimeSnapshot;
  conflictInfo?: ConflictInfo; // CCIP 2026-02-14: Omega conflict detection data from orchestrator
  entry_spec?: EntrySpec; // NEW: Alpha's explicit entry specification
  entry_mode?: 'EXECUTE_NOW' | 'WAIT_ENTRY' | 'WAIT_HIGHER_EDGE'; // Promoted from entry_spec for execution routing
  thesis?: string; // Trade thesis type (momentum_scalp, liquidity_sweep_reversal, etc.)
  style_intent?: string; // Style intent (SCALP, MICRO_INTRADAY, INTRADAY)
  execution_preference?: string; // Execution preference (IMMEDIATE, WAIT_PULLBACK, WAIT_CONFIRMATION)
  acceptable_profit_range?: { minUSD: number; idealUSD: number }; // Expected profit range
  entry_intent?: {
    intent_type: 'immediate_momentum' | 'pullback_to_vwap' | 'pullback_to_support' | 'break_and_retest' | 'range_extreme' | 'retest_structure';
    urgency: 'HIGH' | 'MEDIUM' | 'LOW';
    entry_zone_min: number;
    entry_zone_max: number;
    timeout_minutes: number;
  };
  wait_condition?: {
    target_entry_zone_min: number;
    target_entry_zone_max: number;
    invalidation_price: number;
    wait_reasoning: string;
    expected_wait_minutes?: number;
  };
  confidenceAdjustments?: Array<{
    source: string;
    proposedMultiplier: number;
    wasApplied: boolean;
    reason: string;
  }>;
  // Phase 1-4 Upgrades: Micro-regime, Liquidity Intent, Narrative Coherence
  microRegime?: MicroRegimeClassification;
  liquidityIntent?: LiquidityIntentModel;
  narrativeValidation?: NarrativeValidation;
  // Phase 5: Multi-Timeframe Pattern Intelligence
  patternIntelligence?: {
    htfPattern: string | null;
    htfIntent: string;
    mtfPattern: string | null;
    mtfIntent: string;
    ltfPattern: string | null;
    ltfIntent: string;
    alignmentScore: number;
    overallIntent: string;
    directionBias: string;
    confidenceBoosts: Array<{ reason: string; amount: number }>;
    confidencePenalties: Array<{ reason: string; amount: number }>;
    liquidityTargets: number[];
    invalidationPoint: { price: number; reasoning: string } | null;
    warnings: string[];
  };
  directionalStrengthResult?: {
    buyScore: number;
    sellScore: number;
    netStrength: number;
    winningDirection: 'BUY' | 'SELL';
    meetsThreshold: boolean;
    threshold: number;
    style: string;
  };
  arena_chosen?: 'LONG' | 'SHORT' | 'NO_TRADE';
  wall_violations?: string[];
  tp_nudged?: boolean;
  tp_nudge_reason?: string;
  entry_advisory?: {
    verdict: 'GOOD_ENTRY' | 'PULLBACK_EXPECTED';
    pullback_zone_min: number | null;
    pullback_zone_max: number | null;
    reasoning: string;
  };
  answer_sheet?: {
    Q1_trend_alignment: string;
    Q2_structure_level: string;
    Q3_prior_rejections: string;
    Q4_momentum_stage: string;
    Q5_failure_mode: string;
    Q5_failure_probability: number;
    Q5B_objective_alignment: string;
    Q6_entry_trigger: string;
    Q7_confluence_count: string;
    Q8_move_position_pct: number;
    Q8B_session_range_pct: number;
  };
}

/**
 * Helper: Extract ATR value from MarketContext (supports both legacy number and typed ATRValue)
 */
function extractATRValue(atr: number | ATRValue | undefined): number {
  if (atr === undefined) return 0;
  return typeof atr === 'number' ? atr : atr.value;
}

/**
 * Helper: Extract ATR timeframe from MarketContext (if available)
 */
function extractATRTimeframe(atr: number | ATRValue | undefined): string | undefined {
  if (atr === undefined || typeof atr === 'number') return undefined;
  return atr.timeframe;
}

/**
 * Helper: Log ATR usage with timeframe info
 */
function logATRUsage(context: string, atr: number | ATRValue | undefined): void {
  const value = extractATRValue(atr);
  const timeframe = extractATRTimeframe(atr);

  if (timeframe) {
    console.log(`[Alpha Coordinator] ${context}: ${value.toFixed(5)} (${timeframe})`);
  } else {
    console.warn(`[Alpha Coordinator] ${context}: ${value.toFixed(5)} (legacy raw ATR - update to typed ATRValue)`);
  }
}

class AlphaCoordinatorBrain {
  /**
   * Detect volatility expansion/compression
   * Expanding volatility = trending market, wider TP viable
   * Compressing volatility = ranging market, tighten TP
   */
  private detectVolatilityRegime(marketContext: MarketContext): {
    regime: 'expanding' | 'compressing' | 'stable';
    ratio: number;
    recommendation: string;
  } {
    // Extract ATR values (support both legacy number and typed ATRValue)
    const atr20Value = extractATRValue(marketContext.atr20);
    const atr100Value = extractATRValue(marketContext.atr100);

    // If we don't have ATR20/ATR100, return stable
    if (!atr20Value || !atr100Value) {
      return {
        regime: 'stable',
        ratio: 1.0,
        recommendation: 'Use standard R:R (2.0-2.5:1)'
      };
    }

    const ratio = atr20Value / atr100Value;

    // Log timeframe info for debugging
    const atr20Timeframe = extractATRTimeframe(marketContext.atr20);
    const atr100Timeframe = extractATRTimeframe(marketContext.atr100);
    if (atr20Timeframe && atr100Timeframe) {
      console.log(`[Alpha Volatility Regime] ATR20 (${atr20Timeframe}): ${atr20Value.toFixed(5)} | ATR100 (${atr100Timeframe}): ${atr100Value.toFixed(5)} | Ratio: ${ratio.toFixed(2)}`);
    }

    // Expanding: ATR20 > ATR100 by 15%+
    if (ratio > 1.15) {
      return {
        regime: 'expanding',
        ratio,
        recommendation: 'Volatility expanding - wider TP viable (2.5-3.5:1)'
      };
    }

    // Compressing: ATR20 < ATR100 by 15%+
    if (ratio < 0.85) {
      return {
        regime: 'compressing',
        ratio,
        recommendation: 'Volatility compressing - tighten TP (1.5-2.0:1)'
      };
    }

    return {
      regime: 'stable',
      ratio,
      recommendation: 'Volatility stable - standard R:R (2.0-2.5:1)'
    };
  }

  /**
   * Consolidate stop quality score from Omega-8 and Omega-9
   * Returns a unified quality score 0-100
   */
  private calculateStopQualityScore(
    omega8Vote: Omega8Vote | null,
    omega9Validation: Omega9ValidationResult | null
  ): {
    score: number;
    recommendation: string;
  } {
    let qualityScore = 50; // Start neutral

    // Omega-8 liquidity assessment
    if (omega8Vote) {
      if (omega8Vote.liquidity_bias === 'clean') {
        qualityScore += 25; // Well-protected stop
      } else if (omega8Vote.liquidity_bias === 'stoprun_risk') {
        qualityScore -= 30; // Exposed stop
      } else if (omega8Vote.liquidity_bias === 'reaccumulation') {
        qualityScore += 10; // Decent protection
      } else if (omega8Vote.liquidity_bias === 'distribution') {
        qualityScore -= 15; // Risky area
      }
    }

    // Omega-9 validation flags
    if (omega9Validation) {
      if (omega9Validation.pass) {
        qualityScore += 15; // Passed validation
      }
      // Penalize for each flag
      qualityScore -= (omega9Validation.flags.length * 5);
    }

    // Clamp to 0-100
    qualityScore = Math.max(0, Math.min(100, qualityScore));

    // Generate recommendation
    let recommendation = '';
    if (qualityScore >= 70) {
      recommendation = 'High quality stop - use wider TP (2.5-3.5:1)';
    } else if (qualityScore >= 40) {
      recommendation = 'Moderate stop quality - standard TP (2.0-2.5:1)';
    } else {
      recommendation = 'Exposed stop - tighten TP (1.5-2.0:1)';
    }

    return { score: qualityScore, recommendation };
  }

  /**
   * Coordinate Omega votes and make final decision
   * Alpha has FULL AUTHORITY - can override any Omega recommendation
   */
  async coordinate(
    briefing: MarketBriefing,
    votes: OmegaCouncilVotes,
    marketContext: MarketContext,
    traderScore: TraderScore,
    userId?: string,
    conflictInfo?: {
      hasConflict: boolean;
      conflictType: 'HARD' | 'SOFT' | 'NONE';
      severity: string;
      conflictDescription: string;
    },
    goalContext?: GoalContext,
    adversarialSignal?: AdversarialSignal,
    regimeSnapshot?: RegimeSnapshot,
    fullCandles?: any[],
    imSignal?: Record<string, unknown>
  ): Promise<AlphaDecision> {
    // Extract sessionId from goalContext for progress thoughts (optional)
    const sessionId = goalContext?.sessionId;

    // Load full intelligence snapshot for comprehensive decision-making
    let intelligenceSnapshot: AlphaIntelligenceSnapshot | null = null;
    if (userId) {
      // Emit progress thought (non-blocking, advisory only)
      if (sessionId) {
        alphaThoughtStream.emitAlphaLoadingSnapshot(sessionId, userId, marketContext.symbol).catch(err => {
          console.warn('[Alpha Coordinator] Failed to emit loading snapshot thought:', err);
        });
      }

      try {
        intelligenceSnapshot = await alphaIntelligenceAggregator.getFullIntelligenceSnapshot(userId, marketContext.symbol);
        console.log('[Alpha Coordinator] 🧠 Loaded full intelligence snapshot');
      } catch (error) {
        console.error('[Alpha Coordinator] Failed to load intelligence snapshot:', error);
      }
    }

    // Declare risk mode at function scope (used throughout function)
    const riskMode = goalContext?.riskMode || 'medium';

    const EARLY_STYLE_MAP: Record<string, 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY'> = {
      'scalper': 'SCALP', 'SCALPER': 'SCALP', 'scalp': 'SCALP', 'SCALP': 'SCALP',
      'micro': 'MICRO_INTRADAY', 'MICRO': 'MICRO_INTRADAY', 'MICRO_INTRADAY': 'MICRO_INTRADAY',
      'intraday': 'INTRADAY', 'INTRADAY': 'INTRADAY', 'day': 'INTRADAY',
    };
    const resolvedTradeStyle = goalContext?.tradeStyle ? EARLY_STYLE_MAP[goalContext.tradeStyle] : undefined;
    const tradeStyle: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY' = resolvedTradeStyle || 'SCALP';

    if (!resolvedTradeStyle) {
      console.warn(`[Alpha Coordinator] No tradeStyle provided in goalContext — defaulting to SCALP. Active style: SCALP. Symbol: ${marketContext.symbol}`);
    }

    console.log(`[Alpha Coordinator] Dual-Arena mode [Style: ${tradeStyle}] - Alpha chooses direction`);

    // Fire-and-forget thought stream emissions
    if (sessionId && userId) {
      alphaThoughtStream.emitAlphaPlatformIntel(sessionId, userId, marketContext.symbol).catch(() => {});
      alphaThoughtStream.emitAlphaNarrative(sessionId, userId, marketContext.symbol).catch(() => {});
      if (goalContext) {
        alphaThoughtStream.emitAlphaRiskCheck(sessionId, userId, marketContext.symbol).catch(() => {});
      }
    }

    // Parallelize all independent data fetches (bidirectional for dual-arena)
    const [, dailyNarrative, riskResultLong, riskResultShort, rrResult] = await Promise.all([
      this.fetchPlatformIntelligence(marketContext.symbol),
      dailyNarrativeBuilder.build(marketContext.symbol, marketContext.price),
      (userId && goalContext) ? professionalRiskManager.evaluateTrade({
        userId,
        symbol: marketContext.symbol,
        direction: 'long',
        currentBalance: goalContext.currentBalance,
        baseRiskPercent: 0.01,
        currentATR: extractATRValue(marketContext.atr),
        goalSessionId: undefined
      }).catch(err => { console.error('[Alpha Coordinator] Failed to get long risk assessment:', err); return null; }) : Promise.resolve(null),
      (userId && goalContext) ? professionalRiskManager.evaluateTrade({
        userId,
        symbol: marketContext.symbol,
        direction: 'short',
        currentBalance: goalContext.currentBalance,
        baseRiskPercent: 0.01,
        currentATR: extractATRValue(marketContext.atr),
        goalSessionId: undefined
      }).catch(err => { console.error('[Alpha Coordinator] Failed to get short risk assessment:', err); return null; }) : Promise.resolve(null),
      userId ? rrSuccessTracker.getRecentPerformanceSummary(userId, marketContext.symbol)
        .catch(err => { console.error('[Alpha Coordinator] Failed to fetch R:R performance:', err); return null; }) : Promise.resolve(null)
    ]);

    let riskContext = '';
    const riskAssessment = riskResultLong || riskResultShort;
    if (riskAssessment) {
      riskContext = `\nPROFESSIONAL RISK ASSESSMENT (Advisory):\n`;
      riskContext += `Risk Score: ${riskAssessment.riskScore.toFixed(0)}/100 | Confidence: ${riskAssessment.confidenceScore.toFixed(0)}/100\n`;
      riskContext += `Recommended Lot Size: ${riskAssessment.recommendedLotSize.toFixed(2)} lots\n`;
      riskContext += `Adjusted Risk: ${(riskAssessment.adjustedRiskPercent * 100).toFixed(2)}%\n`;
      if (riskAssessment.criticalWarnings.length > 0) {
        riskContext += `WARNINGS:\n`;
        riskAssessment.criticalWarnings.slice(0, 3).forEach((w: string) => {
          riskContext += `  - ${w}\n`;
        });
      }
      riskContext += `Reasoning: ${riskAssessment.overallReasoning}\n`;
    }

    const correlationExposure: DualArenaWalls['correlationExposure'] = (riskResultLong || riskResultShort) ? {
      longWarnings: riskResultLong?.criticalWarnings?.filter((w: string) => w.toLowerCase().includes('correlat')) || [],
      shortWarnings: riskResultShort?.criticalWarnings?.filter((w: string) => w.toLowerCase().includes('correlat')) || [],
    } : null;

    let conflictContext = '';
    if (conflictInfo && conflictInfo.hasConflict) {
      conflictContext = `\nOMEGA CONFLICT DETECTED:\nType: ${conflictInfo.conflictType} | Severity: ${conflictInfo.severity}\n${conflictInfo.conflictDescription}\n\nYou have authority to override if justified.\n`;
    }

    // Build advisory context (Adversarial Detector + Regime Oracle)
    let advisoryContext = this.buildAdvisoryContext(adversarialSignal, regimeSnapshot);

    // CCIP 2026-02-17: Build Advanced Patterns Context (Priority 1 & 2 Upgrades)
    let advancedPatternsContext = this.buildAdvancedPatternsContext(
      tradeStyle,
      regimeSnapshot,
      dailyNarrative,
      votes.omega8
    );

    // Build R:R performance context from parallel result
    let rrPerformanceContext = '';
    if (rrResult && rrResult.length > 100) {
      rrPerformanceContext = `\n${rrResult}\n`;
    }

    const volatilityRegime = this.detectVolatilityRegime(marketContext);
    const stopQuality = this.calculateStopQualityScore(votes.omega8, null);

    // Build goal context with RISK PROFILE STRATEGY (if trading with a goal)
    let goalContextText = '';
    let riskProfileText = '';
    if (goalContext && goalContext.hasGoal) {
      const riskPercent = goalContext.riskPercent || 5;
      const recentATR = extractATRValue(marketContext.atr) || 60; // Extract value with fallback

      // Add comprehensive risk profile strategy (riskMode already declared at function scope)
      riskProfileText = formatRiskProfileForLLM(riskMode);

      const styleDirective = goalContext.tradeStyle
        ? `\nTRADE STYLE: ${goalContext.tradeStyle.toUpperCase()} (full style identity and duration constraints provided below)\n`
        : '';
      goalContextText = `\nGOAL: $${goalContext.currentBalance.toFixed(0)} -> +$${goalContext.targetGoal.toFixed(0)} (${goalContext.goalPercentage.toFixed(3)}% gain) | Progress: $${goalContext.currentProgress.toFixed(0)}/${goalContext.targetGoal.toFixed(0)} | Remaining: $${goalContext.remainingGoal.toFixed(0)}\n${riskProfileText}${styleDirective}\n`;
    }

    // Build intelligence context
    let intelligenceContext = this.buildIntelligenceContext(intelligenceSnapshot, marketContext.symbol);

    // Build symbol diagnostic context from trade learning history (min 5 trades on this symbol)
    let recentTradesContext = '';
    if (userId) {
      try {
        const symbol = marketContext.symbol;

        // Query ai_trade_analysis for learning data on this specific symbol
        const { data: symbolTrades } = await supabase
          .from('ai_trade_analysis')
          .select('outcome, pnl, exit_reason, direction, key_learnings, mistakes_identified, what_worked, what_failed, entry_confidence, entry_time')
          .eq('user_id', userId)
          .eq('symbol', symbol)
          .order('entry_time', { ascending: false })
          .limit(20);

        const tradeCount = symbolTrades?.length ?? 0;

        if (tradeCount >= 5) {
          const losses = symbolTrades!.filter(t => t.outcome === 'loss' || (t.pnl !== null && t.pnl < 0));
          const wins = symbolTrades!.filter(t => t.outcome === 'win' || (t.pnl !== null && t.pnl > 0));
          const recentLosses = losses.slice(0, 5);
          const recentWins = wins.slice(0, 5);

          recentTradesContext = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          recentTradesContext += `YOUR TRADE HISTORY ON ${symbol} (${tradeCount} trades analyzed)\n`;
          recentTradesContext += `Record: ${wins.length} wins / ${losses.length} losses (win rate: ${Math.round((wins.length / tradeCount) * 100)}%)\n`;
          recentTradesContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

          if (recentLosses.length > 0) {
            recentTradesContext += `\nRECENT LOSSES ON ${symbol} — KNOWN FAILURE PATTERNS:\n`;
            recentLosses.forEach((trade, idx) => {
              recentTradesContext += `${idx + 1}. ${trade.direction?.toUpperCase() || '?'} → LOSS ($${Number(trade.pnl || 0).toFixed(2)}) | Exit: ${trade.exit_reason || 'unknown'}\n`;
              if (Array.isArray(trade.mistakes_identified) && trade.mistakes_identified.length > 0) {
                recentTradesContext += `   Mistake: ${trade.mistakes_identified.slice(0, 2).join(', ')}\n`;
              }
              if (trade.what_failed) {
                recentTradesContext += `   What failed: ${trade.what_failed}\n`;
              }
            });
          }

          if (recentWins.length > 0) {
            recentTradesContext += `\nRECENT WINS ON ${symbol} — KNOWN SUCCESS FACTORS:\n`;
            recentWins.forEach((trade, idx) => {
              recentTradesContext += `${idx + 1}. ${trade.direction?.toUpperCase() || '?'} → WIN ($${Number(trade.pnl || 0).toFixed(2)}) | Exit: ${trade.exit_reason || 'unknown'}\n`;
              if (trade.what_worked) {
                recentTradesContext += `   What worked: ${trade.what_worked}\n`;
              }
              if (Array.isArray(trade.key_learnings) && trade.key_learnings.length > 0) {
                recentTradesContext += `   Key factor: ${trade.key_learnings.slice(0, 1).join(', ')}\n`;
              }
            });
          }

          recentTradesContext += `\nLEARNING OBLIGATION: You must address the above history in your reasoning. If this setup matches a known failure pattern, explicitly state why it is different this time. If it matches a known winning pattern, confirm the conditions are present. Do not ignore this data.\n`;
          recentTradesContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        } else if (tradeCount > 0) {
          // Under minimum sample — show basic recent summary only, no obligation
          recentTradesContext = `\nRECENT TRADES ON ${symbol} (${tradeCount} trades — insufficient history for diagnostics):\n`;
          symbolTrades!.slice(0, 3).forEach((trade, idx) => {
            const result = trade.outcome === 'win' ? 'WIN' : trade.outcome === 'loss' ? 'LOSS' : (Number(trade.pnl || 0) > 0 ? 'WIN' : 'LOSS');
            recentTradesContext += `${idx + 1}. ${trade.direction?.toUpperCase() || '?'} → ${result} ($${Number(trade.pnl || 0).toFixed(2)}) | ${trade.exit_reason || 'unknown'}\n`;
          });
        }
      } catch (error) {
        console.error('[Alpha Coordinator] Failed to fetch symbol diagnostic context:', error);
      }
    }

    // Build daily narrative context for institutional intelligence
    let dailyNarrativeContext = '';
    if (dailyNarrative) {
      dailyNarrativeContext = `\n📅 DAILY NARRATIVE (Institutional Context):\n`;
      dailyNarrativeContext += `Range: ${dailyNarrative.dailyRange.toFixed(1)} pips | Position: ${dailyNarrative.rangePosition.toFixed(0)}% of range\n`;
      dailyNarrativeContext += `Daily Bias: ${dailyNarrative.dailyBias.toUpperCase()} | Structure: ${dailyNarrative.structureQuality}\n`;
      dailyNarrativeContext += `Session: ${dailyNarrative.currentSession} | ${dailyNarrative.intradayContext}\n`;
      if (dailyNarrative.liquiditySweeps.asianLowSwept || dailyNarrative.liquiditySweeps.asianHighSwept) {
        dailyNarrativeContext += `Liquidity: ${dailyNarrative.liquiditySweeps.asianLowSwept ? 'Asian low swept' : ''} ${dailyNarrative.liquiditySweeps.asianHighSwept ? 'Asian high swept' : ''}\n`;
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 1: MICRO-REGIME CLASSIFICATION
    // ═══════════════════════════════════════════════════════════════════
    let microRegime: MicroRegimeClassification | null = null;
    let microRegimeContext = '';

    if (fullCandles && fullCandles.length >= 50) {
      if (sessionId && userId) {
        alphaThoughtStream.emitAlphaMicroRegime(sessionId, userId, marketContext.symbol).catch(err => {
          console.warn('[Alpha Coordinator] Failed to emit micro-regime thought:', err);
        });
      }
      try {
        // Convert candles to format expected by classifier
        const regimeCandles: MicroRegimeCandle[] = fullCandles.map(c => ({
          time: new Date(c.open_time).getTime(),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume || 0
        }));

        microRegime = await microRegimeClassifier.classify(regimeCandles);

        if (microRegime) {
          console.log(`[Alpha Coordinator] 🎯 Micro-Regime: ${microRegime.regime} | Direction: ${microRegime.direction} | Classification Confidence: ${microRegime.confidence}%`);

          microRegimeContext = `\n🎯 MICRO-REGIME CLASSIFICATION:\n`;
          microRegimeContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          microRegimeContext += `Regime: ${microRegime.regime.toUpperCase().replace(/_/g, ' ')} (${microRegime.confidence}% classification confidence)\n`;
          microRegimeContext += `Direction: ${microRegime.direction.toUpperCase()}\n\n`;
          microRegimeContext += `📈 Raw Sensor Readings:\n`;
          microRegimeContext += `  • ATR Expansion: ${microRegime.indicators.atrExpansion.toFixed(2)}x vs 20-period avg\n`;
          microRegimeContext += `  • EMA50 Displacement: ${microRegime.indicators.emaDisplacement.toFixed(2)}%\n`;
          microRegimeContext += `  • RSI: ${microRegime.indicators.rsi.toFixed(0)}\n`;
          microRegimeContext += `  • Volume Profile: ${microRegime.indicators.volumeProfile}\n`;
          microRegimeContext += `  • Range Compression: ${microRegime.indicators.rangeCompression.toFixed(2)}x vs 20-period avg\n`;
          microRegimeContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        }
      } catch (error) {
        console.error('[Alpha Coordinator] Failed to classify micro-regime:', error);
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 2: LIQUIDITY INTENT ANALYSIS
    // ═══════════════════════════════════════════════════════════════════
    let liquidityIntent: LiquidityIntentModel | null = null;
    let liquidityIntentContext = '';

    // Analyze liquidity intent if Omega-8 detected patterns
    if (votes.omega8 && votes.omega8.patterns && fullCandles && fullCandles.length >= 10) {
      if (sessionId && userId) {
        alphaThoughtStream.emitAlphaLiquidityIntent(sessionId, userId, marketContext.symbol).catch(err => {
          console.warn('[Alpha Coordinator] Failed to emit liquidity intent thought:', err);
        });
      }
      try {
        const omega8Candles = fullCandles.slice(-20).map(c => ({
          time: new Date(c.open_time).getTime(),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume || 0
        }));

        const atrValue = extractATRValue(marketContext.atr);

        liquidityIntent = liquidityIntentAnalyzer.analyzeLiquidityIntent(
          votes.omega8.patterns,
          omega8Candles,
          atrValue,
          votes.omega8.sweep_details
        );

        if (liquidityIntent && liquidityIntent.overallConviction > 0) {
          console.log(`[Alpha Coordinator] 🎯 Liquidity Intent: ${liquidityIntent.trapped} | Predator: ${liquidityIntent.predatorDirection} | Conviction: ${liquidityIntent.overallConviction}%`);

          liquidityIntentContext = `\n🎯 LIQUIDITY INTENT ANALYSIS:\n`;
          liquidityIntentContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          liquidityIntentContext += `Trapped Participants: ${liquidityIntent.trapped.toUpperCase().replace(/_/g, ' ')}\n`;
          liquidityIntentContext += `Vulnerability: ${liquidityIntent.vulnerability.toUpperCase().replace(/_/g, ' ')}\n`;
          liquidityIntentContext += `Predator Direction: ${liquidityIntent.predatorDirection.toUpperCase()}\n`;
          liquidityIntentContext += `Hunt Zone Status: ${liquidityIntent.huntZoneStatus.toUpperCase()}\n`;
          liquidityIntentContext += `Cascade Distance: ${liquidityIntent.expectedCascadeDistance.toFixed(1)} ATR\n`;
          liquidityIntentContext += `Cascade Confidence: ${liquidityIntent.cascadeConfidence}%\n`;
          liquidityIntentContext += `Sweep Recency: ${liquidityIntent.sweepRecency} candles ago\n`;
          liquidityIntentContext += `Entry Window: ${liquidityIntent.optimalEntryWindow.toUpperCase().replace(/_/g, ' ')}\n`;
          liquidityIntentContext += `Overall Conviction: ${liquidityIntent.overallConviction}%\n\n`;
          liquidityIntentContext += `💡 Stop Placement Guidance:\n${liquidityIntent.stopPlacementGuidance}\n`;
          if (liquidityIntent.sweepExtremePrice) {
            liquidityIntentContext += `Sweep Extreme Price: ${liquidityIntent.sweepExtremePrice.toFixed(5)} (stop calculator has been repositioned beyond this level)\n`;
          }
          if (liquidityIntent.nearestClusterPrice) {
            liquidityIntentContext += `Nearest Liquidity Cluster: ${liquidityIntent.nearestClusterPrice.toFixed(5)}\n`;
          }
          liquidityIntentContext += `\n🔮 Reasoning:\n${liquidityIntent.reasoning}\n`;
          liquidityIntentContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        }
      } catch (error) {
        console.error('[Alpha Coordinator] Failed to analyze liquidity intent:', error);
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 5: MULTI-TIMEFRAME PATTERN INTELLIGENCE
    // ═══════════════════════════════════════════════════════════════════
    let patternIntelligence: PatternIntelligenceResult | null = null;
    let patternContext = '';
    {
      if (sessionId && userId) {
        alphaThoughtStream.emitAlphaPatternAnalysis(sessionId, userId, marketContext.symbol).catch(err => {
          console.warn('[Alpha Coordinator] Failed to emit pattern analysis thought:', err);
        });
      }
      try {
        const tradeDirection = 'long' as const;

        console.log('[Alpha Coordinator] Analyzing multi-timeframe patterns (structural)...');

        patternIntelligence = await multiTimeframePatternIntelligence.analyzePatterns({
          symbol: marketContext.symbol,
          riskMode,
          baseConfidence: 55,
          tradeDirection,
          liquidityIntentConfirms: liquidityIntent ? liquidityIntent.overallConviction >= 70 : false,
        });

        console.log(`[Alpha Coordinator] 📊 Pattern Analysis Complete:`, {
          htfIntent: patternIntelligence.intentAnalysis.htf.intent,
          mtfIntent: patternIntelligence.intentAnalysis.mtf.intent,
          ltfIntent: patternIntelligence.intentAnalysis.ltf.intent,
          alignment: patternIntelligence.intentAnalysis.alignmentScore,
          confidenceAdjustment: patternIntelligence.confidenceAdjustment.totalAdjustment,
          finalConfidence: patternIntelligence.finalConfidence,
        });

        // Format for LLM prompt
        patternContext = '\n' + multiTimeframePatternIntelligence.formatForAlphaPrompt(patternIntelligence);

      } catch (error) {
        console.error('[Alpha Coordinator] Failed to analyze patterns:', error);
      }
    }

    let longLiquidityZones: LiquidityZone[] = [];
    let shortLiquidityZones: LiquidityZone[] = [];
    let liquidityZones: LiquidityZone[] = [];
    let liquidityContext = '';
    if (fullCandles && fullCandles.length > 0) {
      longLiquidityZones = eliteProfitTargetCalculator.detectLiquidityZones(
        fullCandles, marketContext.price, 'long', marketContext.symbol
      );
      shortLiquidityZones = eliteProfitTargetCalculator.detectLiquidityZones(
        fullCandles, marketContext.price, 'short', marketContext.symbol
      );
      liquidityZones = [...longLiquidityZones, ...shortLiquidityZones];

      if (patternIntelligence && patternIntelligence.liquidityTargets.length > 0) {
        const patternZones = patternLiquidityAdapter.convertToLiquidityZones(
          patternIntelligence, marketContext.symbol, marketContext.price
        );
        for (const patternZone of patternZones) {
          const isDuplicate = liquidityZones.some(
            z => Math.abs(z.price - patternZone.price) < patternZone.price * 0.001
          );
          if (!isDuplicate) {
            liquidityZones.push(patternZone);
            if (patternZone.price > marketContext.price) longLiquidityZones.push(patternZone);
            else shortLiquidityZones.push(patternZone);
          }
        }
        console.log(`[Alpha Coordinator] Added ${patternZones.length} pattern liquidity zones`);
      }

      if (liquidityZones.length > 0) {
        liquidityContext = `\nLIQUIDITY ZONES (Both Directions):\n`;
        liquidityContext += `ABOVE PRICE (Long targets):\n`;
        longLiquidityZones.slice(0, 3).forEach((zone, idx) => {
          liquidityContext += `  ${idx + 1}. ${zone.type.toUpperCase()} @ ${zone.price.toFixed(5)} (${zone.distance_pips.toFixed(1)} pips, ${zone.strength})\n`;
        });
        liquidityContext += `BELOW PRICE (Short targets):\n`;
        shortLiquidityZones.slice(0, 3).forEach((zone, idx) => {
          liquidityContext += `  ${idx + 1}. ${zone.type.toUpperCase()} @ ${zone.price.toFixed(5)} (${zone.distance_pips.toFixed(1)} pips, ${zone.strength})\n`;
        });
      }
    }

    // Detect market volatility level (needed by both SL and TP calculations)
    let marketVolatilityLevel: 'low' | 'normal' | 'high' = 'normal';
    if (marketContext.volatility === 'high') {
      marketVolatilityLevel = 'high';
    } else if (marketContext.volatility === 'low') {
      marketVolatilityLevel = 'low';
    }

    let stopLossAnchor: StopLossCalculation | null = null;
    let buyStopAnchor: StopLossCalculation | null = null;
    let sellStopAnchor: StopLossCalculation | null = null;
    let stopLossDirective = '';
    {
      if (sessionId && userId) {
        alphaThoughtStream.emitAlphaStopCalculation(sessionId, userId, marketContext.symbol).catch(err => {
          console.warn('[Alpha Coordinator] Failed to emit stop calculation thought:', err);
        });
      }
      const entryPrice = marketContext.price;
      const atrForStopLoss = extractATRValue(marketContext.atr);
      logATRUsage('Stop-Loss calculation', marketContext.atr);

      // Build sweep context from Omega-8 for sweep-aware stop placement (SSOT)
      // Applies to all 3 trade styles: SCALP, MICRO_INTRADAY, INTRADAY
      let sweepContextForStop: SweepContext | undefined;
      if (
        votes.omega8?.sweep_details &&
        votes.omega8.sweep_details.type !== 'none' &&
        votes.omega8.sweep_details.sweep_extreme_price
      ) {
        sweepContextForStop = {
          type: votes.omega8.sweep_details.type,
          has_bos: votes.omega8.sweep_details.has_bos,
          sweep_extreme_price: votes.omega8.sweep_details.sweep_extreme_price,
          nearest_cluster_price: votes.omega8.sweep_details.nearest_cluster_price,
          candles_ago: votes.omega8.sweep_details.candles_ago,
          liquidity_bias: votes.omega8.liquidity_bias as SweepContext['liquidity_bias']
        };
        console.log(`[Alpha Coordinator] Sweep context wired: ${sweepContextForStop.type} sweep extreme @ ${sweepContextForStop.sweep_extreme_price.toFixed(5)}, BOS:${sweepContextForStop.has_bos}`);
      }

      // Resolve trade style for stop calculator buffer calibration
      const STYLE_FOR_STOP: Record<string, 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY'> = {
        'SCALP': 'SCALP', 'MICRO_INTRADAY': 'MICRO_INTRADAY', 'INTRADAY': 'INTRADAY'
      };
      const stopCalcStyle = STYLE_FOR_STOP[tradeStyle] ?? 'SCALP';

      buyStopAnchor = riskAwareStopCalculator.calculateStopLoss({
        symbol: marketContext.symbol, entryPrice, direction: 'buy',
        riskMode, atr: atrForStopLoss, marketVolatility: marketVolatilityLevel,
        sweepContext: sweepContextForStop,
        tradeStyle: stopCalcStyle
      });
      sellStopAnchor = riskAwareStopCalculator.calculateStopLoss({
        symbol: marketContext.symbol, entryPrice, direction: 'sell',
        riskMode, atr: atrForStopLoss, marketVolatility: marketVolatilityLevel,
        sweepContext: sweepContextForStop,
        tradeStyle: stopCalcStyle
      });
      stopLossAnchor = buyStopAnchor;

      if (buyStopAnchor.sweepAwareAdjustment?.applied) {
        console.log(`[Alpha Coordinator] SWEEP-AWARE SL: BUY ${buyStopAnchor.sweepAwareAdjustment.originalStopPips.toFixed(1)}p → ${buyStopAnchor.stopLossPips.toFixed(1)}p (beyond sweep extreme ${buyStopAnchor.sweepAwareAdjustment.sweepExtremePrice.toFixed(5)})`);
      }
      if (sellStopAnchor.sweepAwareAdjustment?.applied) {
        console.log(`[Alpha Coordinator] SWEEP-AWARE SL: SELL ${sellStopAnchor.sweepAwareAdjustment.originalStopPips.toFixed(1)}p → ${sellStopAnchor.stopLossPips.toFixed(1)}p (beyond sweep extreme ${sellStopAnchor.sweepAwareAdjustment.sweepExtremePrice.toFixed(5)})`);
      }
      console.log(`[Alpha Coordinator] Stop Anchors: BUY SL=${buyStopAnchor.stopLossPrice.toFixed(5)} (${buyStopAnchor.stopLossPips.toFixed(1)}p) | SELL SL=${sellStopAnchor.stopLossPrice.toFixed(5)} (${sellStopAnchor.stopLossPips.toFixed(1)}p)`);
    }

    // ✅ FEASIBILITY RESOLVER (SSOT) - Runs BEFORE constraint generation
    // Validates if requested style/risk is feasible given current market conditions
    let feasibilityResult = null;
    let resolvedPlan = null;
    let computedAtrPercent = 0;

    {
      const assetClass = getAssetClass(marketContext.symbol);

      // SSOT: Use user's chosen style for feasibility check (same as tradeStyle resolved above)
      const PRE_STYLE_MAP: Record<string, 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY'> = {
        'scalper': 'SCALP', 'SCALPER': 'SCALP', 'scalp': 'SCALP', 'SCALP': 'SCALP',
        'micro': 'MICRO_INTRADAY', 'MICRO': 'MICRO_INTRADAY', 'MICRO_INTRADAY': 'MICRO_INTRADAY',
        'intraday': 'INTRADAY', 'INTRADAY': 'INTRADAY', 'day': 'INTRADAY',
      };
      const requestedStyle = goalContext?.tradeStyle
        ? (PRE_STYLE_MAP[goalContext.tradeStyle] || 'SCALP')
        : 'SCALP';

      const atrValue = extractATRValue(marketContext.atr);
      const atrPercent = (atrValue / marketContext.price) * 100;
      computedAtrPercent = atrPercent;
      logATRUsage('Feasibility check', marketContext.atr);

      if (sessionId && userId) {
        alphaThoughtStream.emitAlphaFeasibility(sessionId, userId, marketContext.symbol).catch(err => {
          console.warn('[Alpha Coordinator] Failed to emit feasibility thought:', err);
        });
      }

      console.log(`[Alpha Coordinator] 🔍 Feasibility Check: ${requestedStyle} style with ${riskMode.toUpperCase()} risk on ${assetClass}`);
      console.log(`[Alpha Coordinator] 📊 Market ATR: ${atrValue.toFixed(5)} (${atrPercent.toFixed(3)}%)`);

      feasibilityResult = tradeFeasibilityResolver.resolve({
        symbol: marketContext.symbol,
        assetClass,
        requestedStyle,
        requestedRiskMode: riskMode.toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH',
        price: marketContext.price,
        atrAbs: atrValue, // Use already extracted atrValue from above
        atrPercent,
        goalContext: goalContext ? {
          targetProfitUsd: goalContext.remainingGoal,
          maxTrades: 5,
          timeHorizon: 'TODAY'
        } : undefined,
        policy: {
          minRR: getMinRRForStyle(requestedStyle),
          maxTpAtrMultiple: 12,
          minSlPercentByAssetRisk: {
            'CRYPTO:HIGH': 0.50,
            'CRYPTO:MEDIUM': 1.00,
            'CRYPTO:LOW': 2.00,
            'FOREX:HIGH': 0.05,
            'FOREX:MEDIUM': 0.08,
            'FOREX:LOW': 0.12,
            'METAL:HIGH': 0.15,
            'METAL:MEDIUM': 0.25,
            'METAL:LOW': 0.40,
            'INDEX:HIGH': 0.10,
            'INDEX:MEDIUM': 0.15,
            'INDEX:LOW': 0.25
          },
          allowAutoDowngradeRisk: true,
          allowBoundedSlRelaxation: true
        }
      });

      console.log(`[Alpha Coordinator] Feasibility Status: ${feasibilityResult.status} (advisory)`);
      console.log(`[Alpha Coordinator] ${feasibilityResult.userMessage}`);

      if (feasibilityResult.status === 'NO_TRADE') {
        console.warn(`[Alpha Coordinator] Feasibility advisory: NO_TRADE recommended - ${feasibilityResult.blockers?.map(b => b.detail).join('; ')}`);
      }

      if (feasibilityResult.status === 'ADJUSTED') {
        console.log('[Alpha Coordinator] ⚙️ Auto-adjustments applied:');
        feasibilityResult.adjustments.forEach(adj => {
          console.log(`  • ${adj.field}: ${adj.from} → ${adj.to} (${adj.reason})`);
        });
      }

      resolvedPlan = feasibilityResult.plan;
    }

    let omega9Constraints: Omega9Constraints | null = null;
    let dualArenaWalls: DualArenaWalls | null = null;
    let constraintsText = '';

    if (resolvedPlan?.style && resolvedPlan.style !== tradeStyle) {
      console.warn(`[Alpha Coordinator] [GOVERNANCE VIOLATION BLOCKED] Feasibility resolver attempted style promotion: ${tradeStyle} -> ${resolvedPlan.style}. User style is IMMUTABLE.`);
      resolvedPlan.style = tradeStyle;
    }

    console.log(`[Alpha Coordinator] [Style SSOT] User chose: ${goalContext?.tradeStyle || 'none'} => Canonical: ${tradeStyle} (IMMUTABLE)`);

    {
      if (sessionId && userId) {
        alphaThoughtStream.emitAlphaConstraints(sessionId, userId, marketContext.symbol).catch(err => {
          console.warn('[Alpha Coordinator] Failed to emit constraints thought:', err);
        });
      }

      const sessionContext = calculateSessionContext();
      console.log(`[Alpha Coordinator] Session Context: ${sessionContext.sessionName} (${sessionContext.sessionTimeRemainingMinutes}min remaining)`);

      const STYLE_TO_TRADE_STYLE: Record<string, 'scalper' | 'micro' | 'intraday'> = {
        'SCALP': 'scalper', 'MICRO_INTRADAY': 'micro', 'INTRADAY': 'intraday',
      };

      // CCIP (2026-02-18): Dynamic Wall Calibration
      // Run BEFORE generateDualArenaWalls to adapt the ATR multiplier and TP floor
      // to live market conditions. Walls breathe with the market instead of blocking
      // Alpha when volatility compresses or session time shortens.
      // SSOT: wallCalibrationEngine is the single authority for corridor adaptation.
      const canonicalTradeStyle = STYLE_TO_TRADE_STYLE[tradeStyle] || 'scalper';
      const wallCalibration = wallCalibrationEngine.calibrate({
        symbol: marketContext.symbol,
        entry: marketContext.price,
        atr: extractATRValue(marketContext.atr),
        tradeStyle: canonicalTradeStyle,
        riskMode,
        currentSession: sessionContext.currentSession,
        sessionTimeRemainingMinutes: sessionContext.sessionTimeRemainingMinutes,
        volatilityRegime: marketContext.volatility as 'low' | 'medium' | 'high',
        userId: userId || undefined,
        sessionId: sessionId || undefined,
      });

      if (wallCalibration.wasCalibrated) {
        console.log(`[Alpha Coordinator] [WallCalibration] ${marketContext.symbol}: ATR multiplier ${wallCalibration.originalAtrMultiple}x → ${wallCalibration.calibratedAtrMultiple}x (${wallCalibration.calibrationReason})`);
      }

      // Merge calibrated plan with any existing resolvedPlan.
      // Precedence: resolvedPlan (from feasibility resolver) takes priority over
      // calibration for tpMaxAtrMultiple — the feasibility resolver already did
      // its own analysis. If no resolvedPlan exists, calibration provides the base.
      const calibratedResolvedPlan = {
        slMinPercent: resolvedPlan?.sl.minPercent,
        tpMaxAtrMultiple: resolvedPlan?.tp.maxAtrMultiple ?? wallCalibration.calibratedResolvedPlan.tpMaxAtrMultiple,
        minRR: resolvedPlan?.rr.min,
      };

      dualArenaWalls = omega9ConstraintProvider.generateDualArenaWalls({
        symbol: marketContext.symbol,
        entry: marketContext.price,
        atr: extractATRValue(marketContext.atr),
        tradeStyle: canonicalTradeStyle,
        riskMode,
        currentSession: sessionContext.currentSession,
        sessionTimeRemainingMinutes: sessionContext.sessionTimeRemainingMinutes,
        volatilityRegime: marketContext.volatility as 'low' | 'medium' | 'high',
        resolvedPlan: calibratedResolvedPlan,
      });

      // Attach calibration metadata to the walls for downstream visibility
      dualArenaWalls.wallCalibration = {
        wasCalibrated: wallCalibration.wasCalibrated,
        calibrationReason: wallCalibration.calibrationReason,
        originalAtrMultiple: wallCalibration.originalAtrMultiple,
        calibratedAtrMultiple: wallCalibration.calibratedAtrMultiple,
        assetClass: wallCalibration.diagnostics.assetClass,
        safetyCapApplied: wallCalibration.diagnostics.safetyCapApplied,
        sessionExpansionApplied: wallCalibration.diagnostics.sessionExpansionApplied,
        corridorWidthPips: wallCalibration.diagnostics.corridorWidthPips,
      };

      if (correlationExposure) {
        dualArenaWalls.correlationExposure = correlationExposure;
      }

      constraintsText = omega9ConstraintProvider.formatDualArenaForPrompt(dualArenaWalls);

      omega9Constraints = omega9ConstraintProvider.generateConstraints({
        symbol: marketContext.symbol,
        entry: marketContext.price,
        direction: 'BUY',
        atr: extractATRValue(marketContext.atr),
        riskMode,
        tradeStyle,
        currentSession: sessionContext.currentSession,
        sessionTimeRemainingMinutes: sessionContext.sessionTimeRemainingMinutes,
        volatilityRegime: marketContext.volatility as 'low' | 'medium' | 'high',
        proposedStopLoss: buyStopAnchor?.stopLossPrice,
        resolvedPlan: calibratedResolvedPlan,
      });
    }

    const styleEnvelope = getExecutionEnvelope(tradeStyle);
    const promptAssetClass = getAssetClass(marketContext.symbol) as EnvelopeAssetClass;

    const styleIdentityPrompt = '';

    if (buyStopAnchor && sellStopAnchor) {
      const pipInfo = getCurrencyPipInfo(marketContext.symbol);
      const atrPips = (extractATRValue(marketContext.atr) / pipInfo.pipValue).toFixed(1);
      const wallSlMin = dualArenaWalls ? Math.min(dualArenaWalls.long.slPips.min, dualArenaWalls.short.slPips.min) : buyStopAnchor.profileMinPips;
      const wallSlMax = dualArenaWalls ? Math.max(dualArenaWalls.long.slPips.max, dualArenaWalls.short.slPips.max) : buyStopAnchor.profileMaxPips;
      const wallTpMin = dualArenaWalls ? Math.min(dualArenaWalls.long.tpPips.min, dualArenaWalls.short.tpPips.min) : 0;
      const wallTpMax = dualArenaWalls ? Math.max(dualArenaWalls.long.tpPips.max, dualArenaWalls.short.tpPips.max) : 999;

      // CCIP (2026-02-17): Lift SL anchor recommendations to wall minimum if they fall below.
      // The Stop Calculator uses profile min/max (e.g., 10-20 pips from risk strategy) but the
      // Omega-9 envelope alignment may raise the wall minimum higher (e.g., 12.2 pips for XAUUSD).
      // Without this lift, Alpha receives a recommendation below the wall minimum and gets rejected.
      let buyAnchorPips = buyStopAnchor.stopLossPips;
      let buyAnchorPrice = buyStopAnchor.stopLossPrice;
      let sellAnchorPips = sellStopAnchor.stopLossPips;
      let sellAnchorPrice = sellStopAnchor.stopLossPrice;

      if (dualArenaWalls) {
        if (buyAnchorPips < dualArenaWalls.long.slPips.min) {
          buyAnchorPips = dualArenaWalls.long.slPips.min;
          buyAnchorPrice = marketContext.price - (buyAnchorPips * pipInfo.pipValue);
          console.log(`[Alpha Coordinator] Lifted BUY SL anchor from ${buyStopAnchor.stopLossPips.toFixed(1)} to ${buyAnchorPips.toFixed(1)} pips (wall minimum)`);
        }
        if (sellAnchorPips < dualArenaWalls.short.slPips.min) {
          sellAnchorPips = dualArenaWalls.short.slPips.min;
          sellAnchorPrice = marketContext.price + (sellAnchorPips * pipInfo.pipValue);
          console.log(`[Alpha Coordinator] Lifted SELL SL anchor from ${sellStopAnchor.stopLossPips.toFixed(1)} to ${sellAnchorPips.toFixed(1)} pips (wall minimum)`);
        }
      }

      const sweepZoneDirective = (() => {
        const buyAdj = buyStopAnchor.sweepAwareAdjustment;
        const sellAdj = sellStopAnchor.sweepAwareAdjustment;
        const adj = buyAdj?.applied ? buyAdj : (sellAdj?.applied ? sellAdj : null);
        if (!adj || !sweepContextForStop) return '';

        const sweepTypeLabel = sweepContextForStop.type === 'low' ? 'LOW SWEEP' : 'HIGH SWEEP';
        const candlesLabel = sweepContextForStop.candles_ago === 0 ? 'just now' : `${sweepContextForStop.candles_ago} candle(s) ago`;
        const bosLabel = sweepContextForStop.has_bos ? 'BOS CONFIRMED' : 'awaiting BOS';
        const pipInfo = getCurrencyPipInfo(marketContext.symbol);
        const bufferPips = adj.bufferPips;
        const sweepPrice = adj.sweepExtremePrice;
        const forbiddenZoneBuy = (sweepPrice + bufferPips * pipInfo.pipValue).toFixed(5);
        const forbiddenZoneSell = (sweepPrice - bufferPips * pipInfo.pipValue).toFixed(5);

        return `
SWEEP ZONE DETECTED (${tradeStyle}): ${sweepTypeLabel} confirmed ${candlesLabel} [${bosLabel}]. Sweep extreme: ${sweepPrice.toFixed(5)}.
The SL anchors above have been MATHEMATICALLY REPOSITIONED beyond the swept zone (buffer: ${bufferPips.toFixed(1)} pips).
BINDING RULE: You MUST NOT place your stop inside the swept zone.
  - If LONG: SL must be BELOW ${forbiddenZoneBuy} (below sweep extreme + buffer). Any stop above ${sweepPrice.toFixed(5)} is a liquidity target.
  - If SHORT: SL must be ABOVE ${forbiddenZoneSell} (above sweep extreme - buffer). Any stop below ${sweepPrice.toFixed(5)} is a liquidity target.
Stops placed inside the swept zone will be auto-rejected by Omega-9. Use the anchors provided — they already clear the sweep zone.`;
      })();

      stopLossDirective = `
ATR: ${extractATRValue(marketContext.atr).toFixed(5)} (${atrPips} pips) | Volatility: ${marketVolatilityLevel.toUpperCase()} | Risk: ${riskMode.toUpperCase()}
IF LONG SL Anchor: ${buyAnchorPrice.toFixed(5)} (${buyAnchorPips.toFixed(1)}p, ${buyStopAnchor.atrMultiplier.toFixed(2)}x ATR)
IF SHORT SL Anchor: ${sellAnchorPrice.toFixed(5)} (${sellAnchorPips.toFixed(1)}p, ${sellStopAnchor.atrMultiplier.toFixed(2)}x ATR)
HARD WALLS (${tradeStyle} ${promptAssetClass} @ ${marketContext.price.toFixed(2)}): SL MUST be ${wallSlMin.toFixed(1)}-${wallSlMax.toFixed(1)} pips | TP MUST be ${wallTpMin.toFixed(1)}-${wallTpMax.toFixed(1)} pips. Trades outside these walls are AUTO-REJECTED. You have FULL authority inside these bounds.${sweepZoneDirective}
`;
    }

    // ═══════════════════════════════════════════════════════════════════
    // REGIME-BASED THESIS CACHING INTEGRATION
    // ═══════════════════════════════════════════════════════════════════
    // Generate regime signature from market context
    const regimeSignature = extractRegimeSignature(
      marketContext.symbol,
      marketContext,
      votes,
      regimeSnapshot
    );

    // Check cache for existing thesis
    let cachedThesis: AlphaMarketThesis | null = null;
    let cachedThesisPrompt = '';

    try {
      // Attempt to get cached thesis from database
      cachedThesis = await sharedIntelligenceCoordinator.getAlphaThesis(
        marketContext.symbol,
        regimeSignature,
        null, // First call to check cache only
        async () => {
          // This won't be called on cache hit - we'll handle fresh generation separately
          throw new Error('Cache check only');
        }
      );

      if (cachedThesis && cachedThesis.fromCache) {
        const ageMinutes = Math.round(cachedThesis.cacheAgeSeconds / 60);

        // CCIP-2026-02-24: detectOmegaThesisConflict removed (was counting Omega votes).
        // Thesis validation now uses the raw market briefing — Alpha reads current
        // price action data and decides if the cached thesis still holds.
        cachedThesisPrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CACHED MARKET THESIS (Age: ${ageMinutes}min)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The following thesis was generated ${ageMinutes} minutes ago for the same regime:

Direction Bias: ${cachedThesis.directionBias}
Regime: ${cachedThesis.regime}
Narrative: ${cachedThesis.narrative}
Liquidity Context: ${cachedThesis.liquidityContext || 'Not specified'}
Confidence Band: ${cachedThesis.confidenceBand}

INSTRUCTIONS:
Compare the cached thesis against the CURRENT MARKET INTELLIGENCE BRIEFING below.
If current price action and structure SUPPORT the thesis direction → Accept (say "ACCEPTED_THESIS")
If current data CONTRADICTS the thesis → Reject (say "REJECT_THESIS: [reason]")

Be conservative. If in doubt, reject and generate fresh analysis.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        console.log(`[Alpha Coordinator] Cached thesis available (${ageMinutes}min old), raw briefing attached for validation`);
      }
    } catch (error) {
      // Cache miss or error - will generate fresh
      console.log('[Alpha Coordinator] 💭 No cached thesis - will generate fresh');
      cachedThesis = null;
    }

    // ═══════════════════════════════════════════════════════════════════
    // M5 SCALP CONTEXT (ADVISORY - ONLY FOR SCALP STYLE)
    // ═══════════════════════════════════════════════════════════════════
    let m5ContextPrompt = '';
    if (getDisplayNameFromStyle(tradeStyle) === 'SCALP') {
      try {
        const m5Context = await m5SwingAnalyzer.getRecentSwings(
          marketContext.symbol,
          50
        );

        m5ContextPrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 M5 SCALP CONTEXT (${marketContext.symbol}) - ADVISORY GUIDANCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are trading M5 price action. Use this context to inform your TP/SL decisions:

M5 Statistics (Recent Behavior):
• Avg M5 Swing: ${m5Context.avgSwingPips} pips
• Recent M5 Swings: ${m5Context.recentSwings.join(', ')} pips
• Current M5 Progress: ${(m5Context.currentSwingProgress * 100).toFixed(0)}% through typical swing
• M5 ATR: ${m5Context.m5ATR} pips (baseline stop size)

Session Context:
• Session: ${m5Context.session}
• Typical ${m5Context.session} M5 Range: ${m5Context.sessionTypicalRange}

Reference Ranges (GUIDANCE, not limits):
• Suggested TP Range: ${m5Context.suggestedTPRange[0]}-${m5Context.suggestedTPRange[1]} pips
• Suggested SL Range: ${m5Context.suggestedSLRange[0]}-${m5Context.suggestedSLRange[1]} pips

IMPORTANT REMINDERS:
- These are REFERENCE RANGES based on recent M5 behavior
- You have FULL AUTHORITY to exceed them with justification
- Think in M5 terms: target ONE M5 leg, not H1 pools
- If you exceed typical M5 range (>60 pips TP), explain why
- EQS may be adjusted for unusual ranges (soft penalty, not block)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        console.log(`[Alpha Coordinator] 📊 M5 Context: ${m5Context.avgSwingPips} pip avg, ${m5Context.session} session`);
      } catch (error) {
        console.warn('[Alpha Coordinator] ⚠️ Failed to fetch M5 context:', error);
        // Non-blocking - continue without M5 context
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // PRIMARY TIMEFRAME CANDLE CONTEXT (STYLE-AWARE - for entry advisory)
    // SSOT: MarketDataService is the single authority for candle data
    // CCIP 2026-02-18: Entry advisory MUST analyze the trade's primary
    // timeframe first. M1 is timing refinement only, not the primary signal.
    // SCALP=M5, MICRO_INTRADAY=M15, INTRADAY=H1
    // ═══════════════════════════════════════════════════════════════════
    const PRIMARY_TF_MAP: Record<string, { timeframe: string; label: string; candleCount: number }> = {
      'SCALP': { timeframe: 'M5', label: 'M5', candleCount: 15 },
      'MICRO_INTRADAY': { timeframe: 'M15', label: 'M15', candleCount: 12 },
      'INTRADAY': { timeframe: 'H1', label: 'H1', candleCount: 10 },
    };
    const styleName = getDisplayNameFromStyle(tradeStyle);
    const primaryTfConfig = PRIMARY_TF_MAP[styleName] || PRIMARY_TF_MAP['SCALP'];

    let primaryTfCandlePrompt = '';
    try {
      const mds = MarketDataService.getInstance();
      const primaryCandles = await mds.getCandles(marketContext.symbol, primaryTfConfig.timeframe, primaryTfConfig.candleCount);

      if (primaryCandles && primaryCandles.length >= 5) {
        const recentPrimary = primaryCandles.slice(0, primaryTfConfig.candleCount).reverse();
        const pipInfo = getCurrencyPipInfo(marketContext.symbol);

        const primaryLines: string[] = recentPrimary.map((c, i) => {
          const dir = c.close > c.open ? 'UP' : c.close < c.open ? 'DN' : 'FLAT';
          const bodyPips = Math.abs(c.close - c.open) / pipInfo.pipValue;
          const upperWick = (c.high - Math.max(c.open, c.close)) / pipInfo.pipValue;
          const lowerWick = (Math.min(c.open, c.close) - c.low) / pipInfo.pipValue;
          return `  ${i + 1}. ${dir} O:${c.open.toFixed(pipInfo.decimalPlaces)} H:${c.high.toFixed(pipInfo.decimalPlaces)} L:${c.low.toFixed(pipInfo.decimalPlaces)} C:${c.close.toFixed(pipInfo.decimalPlaces)} body:${bodyPips.toFixed(1)}p wicks:${upperWick.toFixed(1)}/${lowerWick.toFixed(1)}p`;
        });

        let consecutiveSameDir = 1;
        for (let i = recentPrimary.length - 2; i >= 0; i--) {
          const prevDir = recentPrimary[i].close > recentPrimary[i].open ? 'UP' : 'DN';
          const lastDir = recentPrimary[recentPrimary.length - 1].close > recentPrimary[recentPrimary.length - 1].open ? 'UP' : 'DN';
          if (prevDir === lastDir) consecutiveSameDir++;
          else break;
        }

        const tfHigh = Math.max(...recentPrimary.map(c => c.high));
        const tfLow = Math.min(...recentPrimary.map(c => c.low));
        const tfRangePips = (tfHigh - tfLow) / pipInfo.pipValue;

        const lastCandle = recentPrimary[recentPrimary.length - 1];
        const lastBody = Math.abs(lastCandle.close - lastCandle.open) / pipInfo.pipValue;
        const lastUpperWick = (lastCandle.high - Math.max(lastCandle.open, lastCandle.close)) / pipInfo.pipValue;
        const lastLowerWick = (Math.min(lastCandle.open, lastCandle.close) - lastCandle.low) / pipInfo.pipValue;
        const hasRejectionWick = lastUpperWick > lastBody * 1.5 || lastLowerWick > lastBody * 1.5;

        primaryTfCandlePrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${primaryTfConfig.label} PRIMARY TIMEFRAME CANDLES (${marketContext.symbol}) — ENTRY ADVISORY PRIMARY SIGNAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THIS IS YOUR PRIMARY DATA for the entry_advisory verdict. Your trade lives on the ${primaryTfConfig.label} timeframe.
Analyze these ${primaryTfConfig.label} candles FIRST before considering M1 micro-data.

${primaryLines.join('\n')}

${primaryTfConfig.label} STRUCTURE SUMMARY:
- ${primaryTfConfig.label} Range: ${tfRangePips.toFixed(1)} pips (High: ${tfHigh.toFixed(pipInfo.decimalPlaces)}, Low: ${tfLow.toFixed(pipInfo.decimalPlaces)})
- Consecutive same-direction ${primaryTfConfig.label} candles: ${consecutiveSameDir}
- Last ${primaryTfConfig.label} candle: ${hasRejectionWick ? 'REJECTION WICK detected' : 'Normal candle'} (body: ${lastBody.toFixed(1)}p)
- ${primaryTfConfig.label} Momentum: ${consecutiveSameDir >= 3 ? 'IMPULSIVE MOVE — ' + consecutiveSameDir + ' consecutive same-direction ' + primaryTfConfig.label + ' candles. Pullback is highly probable before continuation.' : consecutiveSameDir >= 2 ? 'Developing trend — 2 consecutive candles, monitor for continuation or pullback' : 'Mixed/consolidating — no impulsive leg detected'}

PULLBACK ASSESSMENT RULE (${primaryTfConfig.label} TIMEFRAME):
${consecutiveSameDir >= 3
  ? `STRONG GUIDELINE: ${consecutiveSameDir} consecutive same-direction ${primaryTfConfig.label} candles detected. This is an impulsive ${primaryTfConfig.label} leg without pullback. A retracement is highly probable. Your entry_advisory verdict should be PULLBACK_EXPECTED unless you have exceptional evidence (breakaway gap, news catalyst) that no pullback will occur. A single M1 rejection wick does NOT override an impulsive ${primaryTfConfig.label} move.`
  : `No impulsive ${primaryTfConfig.label} leg detected. Assess structural levels, VWAP distance, and EMA alignment to determine entry quality.`}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        console.log(`[Alpha Coordinator] ${primaryTfConfig.label} Primary TF: ${recentPrimary.length} candles, ${consecutiveSameDir} consecutive same-dir, range ${tfRangePips.toFixed(1)} pips`);
      }
    } catch (error) {
      console.warn(`[Alpha Coordinator] ${primaryTfConfig.label} primary TF candles unavailable (non-blocking):`, error instanceof Error ? error.message : 'Unknown');
    }

    // ═══════════════════════════════════════════════════════════════════
    // HTF CONTROLLING TIMEFRAME CANDLES (MICRO_INTRADAY + INTRADAY ONLY)
    // CCIP 2026-02-19: Controlling timeframe is the structural authority.
    // MICRO_INTRADAY: H1 is the controlling TF (validates M15 entries)
    // INTRADAY: H4 is the controlling TF (validates H1 entries)
    // GOVERNANCE: Missing controlling TF data = hard NO_TRADE (MTF_DATA_MISSING)
    // Alpha cannot reason about HTF structure without HTF data.
    // ═══════════════════════════════════════════════════════════════════
    const HTF_VALIDATION_MAP: Record<string, { timeframe: string; label: string; candleCount: number } | null> = {
      'SCALP': null,
      'MICRO_INTRADAY': { timeframe: 'H1', label: 'H1', candleCount: 10 },
      'INTRADAY': { timeframe: 'H4', label: 'H4', candleCount: 8 },
    };
    const htfConfig = HTF_VALIDATION_MAP[styleName] ?? null;

    let htfCandlePrompt = '';

    if (htfConfig !== null) {
      try {
        const mds = MarketDataService.getInstance();
        const htfCandles = await mds.getCandles(marketContext.symbol, htfConfig.timeframe, htfConfig.candleCount);

        if (!htfCandles || htfCandles.length < 5) {
          console.error(`[Alpha Coordinator] HTF_DATA_MISSING: ${htfConfig.label} candles unavailable for ${styleName}. Returning NO_TRADE.`);
          if (userId && sessionId) {
            writeStructuralAlert({
              userId,
              sessionId,
              symbol: marketContext.symbol,
              style: tradeStyle,
              ruleType: 'HTF_DATA_MISSING',
              direction: '',
              detailsText: `${htfConfig.label} controlling timeframe candle data unavailable for ${styleName}. Found ${htfCandles?.length ?? 0} candles (need ≥5). Cannot assess structural bias.`,
            });
          }
          return {
            action: 'NO_TRADE',
            decision: 'NO_TRADE',
            entry: marketContext.price,
            stopLoss: marketContext.price,
            takeProfit: marketContext.price,
            confidence: 0,
            reasoning: `MTF_DATA_MISSING: ${htfConfig.label} controlling timeframe candle data is required for ${styleName} analysis but is unavailable. Cannot assess structural bias without ${htfConfig.label} context.`,
          };
        }

        const recentHtf = htfCandles.slice(0, htfConfig.candleCount).reverse();
        const pipInfo = getCurrencyPipInfo(marketContext.symbol);

        const htfLines: string[] = recentHtf.map((c, i) => {
          const dir = c.close > c.open ? 'UP' : c.close < c.open ? 'DN' : 'FLAT';
          const bodyPips = Math.abs(c.close - c.open) / pipInfo.pipValue;
          const upperWick = (c.high - Math.max(c.open, c.close)) / pipInfo.pipValue;
          const lowerWick = (Math.min(c.open, c.close) - c.low) / pipInfo.pipValue;
          return `  ${i + 1}. ${dir} O:${c.open.toFixed(pipInfo.decimalPlaces)} H:${c.high.toFixed(pipInfo.decimalPlaces)} L:${c.low.toFixed(pipInfo.decimalPlaces)} C:${c.close.toFixed(pipInfo.decimalPlaces)} body:${bodyPips.toFixed(1)}p wicks:${upperWick.toFixed(1)}/${lowerWick.toFixed(1)}p`;
        });

        const htfHigh = Math.max(...recentHtf.map(c => c.high));
        const htfLow = Math.min(...recentHtf.map(c => c.low));
        const htfRangePips = (htfHigh - htfLow) / pipInfo.pipValue;

        const lastHtfCandle = recentHtf[recentHtf.length - 1];
        const prevHtfCandle = recentHtf.length >= 2 ? recentHtf[recentHtf.length - 2] : lastHtfCandle;
        const htfTrendDir = lastHtfCandle.close > prevHtfCandle.close ? 'BULLISH' : lastHtfCandle.close < prevHtfCandle.close ? 'BEARISH' : 'NEUTRAL';

        let htfConsecutive = 1;
        for (let i = recentHtf.length - 2; i >= 0; i--) {
          const prevDir = recentHtf[i].close > recentHtf[i].open ? 'UP' : 'DN';
          const lastDir = lastHtfCandle.close > lastHtfCandle.open ? 'UP' : 'DN';
          if (prevDir === lastDir) htfConsecutive++;
          else break;
        }

        // ═══════════════════════════════════════════════════════════════════
        // HTF REGIME CONFLICT PRE-LLM GATE (CCIP 2026-03-02, v2 2026-03-02)
        //
        // GOVERNANCE: When the controlling HTF trend conflicts with Omega-8's
        // structural direction bias, Alpha has repeatedly overridden the conflict
        // and produced losing entries without structural qualification.
        //
        // CCIP FIX (2026-03-02): The original gate only triggered when
        // htfConsecutive >= 3.  This meant that ALL counter-trend trades against
        // a 1-2 candle developing trend bypassed the gate entirely — exactly the
        // case most likely to produce a wrong-direction loss.  A 1-2 candle
        // trend is not too weak to block; it is too weak to trade against safely.
        //
        // This gate now fires for ALL directional conflicts, regardless of how
        // many consecutive candles confirm the HTF trend.  The qualification
        // evidence requirements (BOS or sweep wick) are unchanged.
        //
        // Deterministic rules checked BEFORE LLM call (no LLM required):
        //   1. HTF BOS: last closed HTF candle closes ABOVE (bull) or BELOW
        //      (bear) the prior candle's HIGH / LOW — a confirmed structural break.
        //   2. Sweep wick: last 2 HTF candles contain a wick-to-body ratio
        //      >= 1.5 in the counter-trend direction (institutional reversal signal).
        //
        // If NEITHER rule is met → NO_TRADE before the LLM call.
        // If EITHER rule is met → allow the call and let Alpha reason through it.
        //
        // SSOT: Omega-8 direction_support is the structural directional bias.
        //       htfTrendDir is the computed HTF candle bias (this module).
        // ═══════════════════════════════════════════════════════════════════
        const omega8DirectionSupport: string | undefined = votes.omega8?.direction_support;
        const conflictingBuy  = htfTrendDir === 'BEARISH' && omega8DirectionSupport === 'buy';
        const conflictingSell = htfTrendDir === 'BULLISH' && omega8DirectionSupport === 'sell';

        if (conflictingBuy || conflictingSell) {
          // Check for counter-trend qualification evidence in HTF candle data
          const counterDir = conflictingBuy ? 'bull' : 'bear';

          // Rule 1: BOS — last closed HTF candle breaks above (bull) or below (bear) prior candle's extreme
          const htfBOS = conflictingBuy
            ? (recentHtf.length >= 2 && lastHtfCandle.close > recentHtf[recentHtf.length - 2].high)
            : (recentHtf.length >= 2 && lastHtfCandle.close < recentHtf[recentHtf.length - 2].low);

          // Rule 2: Sweep wick — check last 2 candles for a wick-to-body ratio >= 1.5 in the right direction
          const htfSweepWick = recentHtf.slice(-2).some(c => {
            const body = Math.abs(c.close - c.open);
            const wick = conflictingBuy
              ? (Math.min(c.open, c.close) - c.low)    // lower wick for bull reversal
              : (c.high - Math.max(c.open, c.close));   // upper wick for bear reversal
            return body > 0 && wick / body >= 1.5;
          });

          if (!htfBOS && !htfSweepWick) {
            console.error(
              `[Alpha Coordinator] HTF_CONFLICT_NO_COUNTER_TREND_QUALIFICATION: ` +
              `${htfConfig.label} trend is ${htfTrendDir} (${htfConsecutive} consecutive candles) ` +
              `but Omega-8 direction_support=${omega8DirectionSupport}. ` +
              `No ${counterDir} BOS or sweep wick found in last ${htfConfig.candleCount} ${htfConfig.label} candles. ` +
              `Returning NO_TRADE before LLM call.`
            );
            const blockedDir = omega8DirectionSupport?.toLowerCase() === 'buy' ? 'BUY' : 'SELL';
            const blockedRuleType = `${htfConfig.label}_CONFLICT_BLOCKED` as
              'H1_CONFLICT_BLOCKED' | 'H4_CONFLICT_BLOCKED' | 'M15_CONFLICT_BLOCKED';
            if (userId && sessionId) {
              writeStructuralAlert({
                userId,
                sessionId,
                symbol: marketContext.symbol,
                style: tradeStyle,
                ruleType: blockedRuleType,
                direction: blockedDir,
                detailsText: `${htfConfig.label} trend ${htfTrendDir} (${htfConsecutive} consecutive candles) conflicts with Omega-8 direction ${omega8DirectionSupport?.toUpperCase()}. No ${counterDir} BOS or sweep-wick reversal found in last ${htfConfig.candleCount} candles. NO_TRADE.`,
              });
            }
            return {
              action: 'NO_TRADE',
              decision: 'NO_TRADE',
              entry: marketContext.price,
              stopLoss: marketContext.price,
              takeProfit: marketContext.price,
              confidence: 0,
              reasoning: `HTF_CONFLICT_NO_COUNTER_TREND_QUALIFICATION: ${htfConfig.label} trend is ${htfTrendDir} ` +
                `(${htfConsecutive} consecutive candles) while Omega-8 structural bias is ${omega8DirectionSupport?.toUpperCase()}. ` +
                `Zero counter-trend qualification evidence found in last ${htfConfig.candleCount} ${htfConfig.label} candles ` +
                `(no ${counterDir} BOS, no sweep-wick reversal). ` +
                `Require at least one of: HTF BOS through prior extreme OR prominent lower/upper wick reversal before entering counter-trend.`,
            };
          } else {
            console.log(
              `[Alpha Coordinator] HTF_CONFLICT_QUALIFIED: ${htfConfig.label} ${htfTrendDir} (${htfConsecutive} consecutive) vs ` +
              `Omega-8 ${omega8DirectionSupport} — qualification evidence present ` +
              `(BOS=${htfBOS} SweepWick=${htfSweepWick}). Allowing LLM call.`
            );
            const qualifiedDir = omega8DirectionSupport?.toLowerCase() === 'buy' ? 'BUY' : 'SELL';
            const bosRuleType = `${htfConfig.label}_BOS` as 'H1_BOS' | 'H4_BOS' | 'M15_BOS';
            const wickRuleType = `${htfConfig.label}_SWEEP_WICK` as 'H1_SWEEP_WICK' | 'H4_SWEEP_WICK' | 'M15_SWEEP_WICK';
            if (userId && sessionId) {
              if (htfBOS) {
                writeStructuralAlert({
                  userId,
                  sessionId,
                  symbol: marketContext.symbol,
                  style: tradeStyle,
                  ruleType: bosRuleType,
                  direction: qualifiedDir,
                  detailsText: `${htfConfig.label} BOS confirmed: last close breaks ${counterDir === 'bull' ? 'above prior high' : 'below prior low'}. Counter-trend entry qualified for ${qualifiedDir}. ${htfConfig.label} trend was ${htfTrendDir} (${htfConsecutive} consecutive candles).`,
                });
              }
              if (htfSweepWick) {
                writeStructuralAlert({
                  userId,
                  sessionId,
                  symbol: marketContext.symbol,
                  style: tradeStyle,
                  ruleType: wickRuleType,
                  direction: qualifiedDir,
                  detailsText: `${htfConfig.label} sweep wick confirmed: wick-to-body ratio ≥1.5 in ${counterDir} direction. Counter-trend entry qualified for ${qualifiedDir}. ${htfConfig.label} trend was ${htfTrendDir}.`,
                });
              }
            }
          }
        }

        htfCandlePrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${htfConfig.label} CONTROLLING TIMEFRAME CANDLES (${marketContext.symbol}) — STRUCTURAL AUTHORITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THIS IS YOUR STRUCTURAL CONTEXT for ${styleName} trades. The ${htfConfig.label} sets the directional bias.
Your ${primaryTfConfig.label} entry must align with or have a justified counter-thesis to this ${htfConfig.label} structure.
MANDATORY: Reference this ${htfConfig.label} data in your QUESTION 1 TREND ALIGNMENT answer.

${htfLines.join('\n')}

${htfConfig.label} STRUCTURAL SUMMARY:
- ${htfConfig.label} Range (last ${htfConfig.candleCount} candles): ${htfRangePips.toFixed(1)} pips (High: ${htfHigh.toFixed(pipInfo.decimalPlaces)}, Low: ${htfLow.toFixed(pipInfo.decimalPlaces)})
- ${htfConfig.label} Directional bias: ${htfTrendDir}
- Consecutive same-direction ${htfConfig.label} candles: ${htfConsecutive}
- ${htfConfig.label} Key resistance: ${htfHigh.toFixed(pipInfo.decimalPlaces)} | Key support: ${htfLow.toFixed(pipInfo.decimalPlaces)}

${htfConfig.label} STRUCTURAL AUTHORITY RULE:
${htfTrendDir === 'BULLISH' ? `${htfConfig.label} trend is BULLISH. ${primaryTfConfig.label} BUY entries have structural tailwind. ${primaryTfConfig.label} SELL entries are counter-trend — require explicit H${htfConfig.label === 'H1' ? '1' : '4'}-level reversal evidence.` : htfTrendDir === 'BEARISH' ? `${htfConfig.label} trend is BEARISH. ${primaryTfConfig.label} SELL entries have structural tailwind. ${primaryTfConfig.label} BUY entries are counter-trend — require explicit ${htfConfig.label}-level reversal evidence.` : `${htfConfig.label} is NEUTRAL/RANGING. Both directions require structural confirmation at the range boundaries.`}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        console.log(`[Alpha Coordinator] ${htfConfig.label} Controlling TF: ${recentHtf.length} candles, bias ${htfTrendDir}, range ${htfRangePips.toFixed(1)} pips`);
      } catch (error) {
        console.error(`[Alpha Coordinator] HTF_DATA_MISSING: ${htfConfig.label} candles fetch failed for ${styleName}:`, error instanceof Error ? error.message : 'Unknown');
        if (userId && sessionId) {
          writeStructuralAlert({
            userId,
            sessionId,
            symbol: marketContext.symbol,
            style: tradeStyle,
            ruleType: 'HTF_DATA_MISSING',
            direction: '',
            detailsText: `${htfConfig.label} candle fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}. Cannot assess structural context for ${styleName}.`,
          });
        }
        return {
          action: 'NO_TRADE',
          decision: 'NO_TRADE',
          entry: marketContext.price,
          stopLoss: marketContext.price,
          takeProfit: marketContext.price,
          confidence: 0,
          reasoning: `MTF_DATA_MISSING: ${htfConfig.label} controlling timeframe data fetch failed for ${styleName}. Cannot proceed without structural context.`,
        };
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // M15 STRUCTURAL REFERENCE (SCALP ONLY — advisory, non-blocking)
    // CCIP-2026-02-19: SCALP trades play out over 15-60 minutes — the M15
    // timeframe governs where price stalls or reverses within that window.
    // Alpha must know M15 trend and nearest S/R to place scalp TPs correctly.
    // This is NOT a controlling TF gate (no MTF_DATA_MISSING block).
    // Missing M15 data is non-blocking. Present data is advisory context.
    // SSOT: MarketDataService is the single authority for candle data
    // ═══════════════════════════════════════════════════════════════════
    let m15ReferencePrompt = '';
    if (styleName === 'SCALP') {
      try {
        const mds = MarketDataService.getInstance();
        const m15Candles = await mds.getCandles(marketContext.symbol, 'M15', 8);

        if (m15Candles && m15Candles.length >= 4) {
          const recentM15 = m15Candles.slice(0, 8).reverse();
          const pipInfo = getCurrencyPipInfo(marketContext.symbol);

          const m15Lines: string[] = recentM15.map((c, i) => {
            const dir = c.close > c.open ? 'UP' : c.close < c.open ? 'DN' : 'FLAT';
            const bodyPips = Math.abs(c.close - c.open) / pipInfo.pipValue;
            const upperWick = (c.high - Math.max(c.open, c.close)) / pipInfo.pipValue;
            const lowerWick = (Math.min(c.open, c.close) - c.low) / pipInfo.pipValue;
            return `  ${i + 1}. ${dir} O:${c.open.toFixed(pipInfo.decimalPlaces)} H:${c.high.toFixed(pipInfo.decimalPlaces)} L:${c.low.toFixed(pipInfo.decimalPlaces)} C:${c.close.toFixed(pipInfo.decimalPlaces)} body:${bodyPips.toFixed(1)}p wicks:${upperWick.toFixed(1)}/${lowerWick.toFixed(1)}p`;
          });

          const m15High = Math.max(...recentM15.map(c => c.high));
          const m15Low = Math.min(...recentM15.map(c => c.low));
          const m15RangePips = (m15High - m15Low) / pipInfo.pipValue;

          const lastM15 = recentM15[recentM15.length - 1];
          const prevM15 = recentM15.length >= 2 ? recentM15[recentM15.length - 2] : lastM15;
          const m15TrendDir = lastM15.close > prevM15.close ? 'BULLISH' : lastM15.close < prevM15.close ? 'BEARISH' : 'NEUTRAL';

          let m15Consecutive = 1;
          for (let i = recentM15.length - 2; i >= 0; i--) {
            const prevDir = recentM15[i].close > recentM15[i].open ? 'UP' : 'DN';
            const lastDir = lastM15.close > lastM15.open ? 'UP' : 'DN';
            if (prevDir === lastDir) m15Consecutive++;
            else break;
          }

          // ═══════════════════════════════════════════════════════════════════
          // M15 CONFLICT GATE FOR SCALP (CCIP 2026-03-02)
          //
          // GOVERNANCE: SCALP trades play out over 15-60 minutes. M15 is the
          // de-facto structural authority for that window. A SCALP entry that
          // conflicts with M15 trend direction requires the same counter-trend
          // qualification evidence that MICRO_INTRADAY requires against H1.
          //
          // Qualification rules mirror the HTF conflict gate above:
          //   1. M15 BOS: last M15 candle closes above (bull) or below (bear)
          //      the prior candle's HIGH / LOW.
          //   2. M15 sweep wick: last 2 M15 candles contain a wick >= 1.5x body
          //      in the counter-trend direction.
          //
          // If neither rule is met → NO_TRADE before the LLM call.
          // SSOT: Omega-8 direction_support is the structural directional bias.
          // ═══════════════════════════════════════════════════════════════════
          const m15TrendDirForGate = m15TrendDir;
          const m15Omega8DirectionSupport: string | undefined = votes.omega8?.direction_support;
          const m15ConflictingBuy  = m15TrendDirForGate === 'BEARISH' && m15Omega8DirectionSupport === 'buy';
          const m15ConflictingSell = m15TrendDirForGate === 'BULLISH' && m15Omega8DirectionSupport === 'sell';

          if (m15ConflictingBuy || m15ConflictingSell) {
            const m15CounterDir = m15ConflictingBuy ? 'bull' : 'bear';
            const lastM15ForGate = recentM15[recentM15.length - 1];

            // Rule 1: M15 BOS
            const m15BOS = m15ConflictingBuy
              ? (recentM15.length >= 2 && lastM15ForGate.close > recentM15[recentM15.length - 2].high)
              : (recentM15.length >= 2 && lastM15ForGate.close < recentM15[recentM15.length - 2].low);

            // Rule 2: M15 sweep wick
            const m15SweepWick = recentM15.slice(-2).some(c => {
              const body = Math.abs(c.close - c.open);
              const wick = m15ConflictingBuy
                ? (Math.min(c.open, c.close) - c.low)
                : (c.high - Math.max(c.open, c.close));
              return body > 0 && wick / body >= 1.5;
            });

            if (!m15BOS && !m15SweepWick) {
              console.error(
                `[Alpha Coordinator] SCALP_M15_CONFLICT_NO_QUALIFICATION: ` +
                `M15 trend is ${m15TrendDirForGate} (${m15Consecutive} consecutive candles) ` +
                `but Omega-8 direction_support=${m15Omega8DirectionSupport}. ` +
                `No ${m15CounterDir} BOS or sweep wick found in last 8 M15 candles. ` +
                `Returning NO_TRADE before LLM call.`
              );
              return {
                action: 'NO_TRADE',
                decision: 'NO_TRADE',
                entry: marketContext.price,
                stopLoss: marketContext.price,
                takeProfit: marketContext.price,
                confidence: 0,
                reasoning: `SCALP_M15_CONFLICT_NO_QUALIFICATION: M15 trend is ${m15TrendDirForGate} ` +
                  `(${m15Consecutive} consecutive candles) while Omega-8 structural bias is ${m15Omega8DirectionSupport?.toUpperCase()}. ` +
                  `Zero counter-trend qualification evidence found in last 8 M15 candles ` +
                  `(no ${m15CounterDir} BOS, no sweep-wick reversal). ` +
                  `SCALP counter-trend entries require: M15 BOS through prior extreme OR prominent M15 sweep wick reversal.`,
              };
            } else {
              console.log(
                `[Alpha Coordinator] SCALP_M15_CONFLICT_QUALIFIED: M15 ${m15TrendDirForGate} (${m15Consecutive} consecutive) vs ` +
                `Omega-8 ${m15Omega8DirectionSupport} — qualification evidence present ` +
                `(BOS=${m15BOS} SweepWick=${m15SweepWick}). Allowing LLM call.`
              );
            }
          }

          m15ReferencePrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M15 STRUCTURAL REFERENCE (${marketContext.symbol}) — ADVISORY CONTEXT FOR SCALP TP PLACEMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This is NOT your primary execution timeframe. M15 is advisory — it shows where price is likely to stall
within your 15-60 min scalp window. Use it to place TP before M15 resistance (BUY) or above M15 support (SELL).
M15 does NOT validate or block your M5 entry. M5 is your execution timeframe.

${m15Lines.join('\n')}

M15 STRUCTURAL SUMMARY:
- M15 Range (last 8 candles): ${m15RangePips.toFixed(1)} pips (High: ${m15High.toFixed(pipInfo.decimalPlaces)}, Low: ${m15Low.toFixed(pipInfo.decimalPlaces)})
- M15 Directional bias: ${m15TrendDir}
- Consecutive same-direction M15 candles: ${m15Consecutive}
- M15 Nearest resistance (scalp BUY ceiling): ${m15High.toFixed(pipInfo.decimalPlaces)}
- M15 Nearest support (scalp SELL floor): ${m15Low.toFixed(pipInfo.decimalPlaces)}

SCALP TP PLACEMENT USING M15:
- Place TP at the CONSERVATIVE EDGE of the nearest M15 structural zone — where candle bodies first cluster, not the extreme.
- If your M5 entry is bullish and M15 shows strong bearish structure (3+ consecutive DN candles), note this as potential headwind.
- If your M5 entry is bearish and M15 shows strong bullish structure (3+ consecutive UP candles), note this as potential headwind.
- M15 S/R within your scalp TP range (12-25 pips) = your TP target zone. M15 S/R beyond that range = context only.
- A scalp TP placed directly INTO a M15 structural cluster has a lower fill probability. Position it at the near edge.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.log(`[Alpha Coordinator] M15 Reference (SCALP): ${recentM15.length} candles, bias ${m15TrendDir}, range ${m15RangePips.toFixed(1)} pips`);
        }
      } catch (error) {
        console.warn('[Alpha Coordinator] M15 reference unavailable (non-blocking):', error instanceof Error ? error.message : 'Unknown');
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // D1 PREVIOUS DAY CONTEXT (ALL STYLES)
    // CCIP 2026-02-19: Previous day high/low are institutional reference
    // levels. All styles must account for PDH/PDL as liquidity magnets.
    //
    // SCALP framing: PDH/PDL are M5-scale TP obstacles and liquidity sweep
    // targets. Alpha must know if the scalp TP crosses a daily level.
    // MICRO_INTRADAY/INTRADAY framing: Full structural authority reference.
    //
    // SSOT: MarketDataService is the single authority for candle data
    // ═══════════════════════════════════════════════════════════════════
    let d1ContextPrompt = '';
    try {
      const mds = MarketDataService.getInstance();
      const d1Candles = await mds.getCandles(marketContext.symbol, 'D1', 3);

      if (d1Candles && d1Candles.length >= 2) {
        const pipInfo = getCurrencyPipInfo(marketContext.symbol);
        const prevDayCandle = d1Candles[1];
        const prevDayHigh = prevDayCandle.high;
        const prevDayLow = prevDayCandle.low;
        const prevDayClose = prevDayCandle.close;
        const prevDayOpen = prevDayCandle.open;
        const prevDayRange = (prevDayHigh - prevDayLow) / pipInfo.pipValue;
        const prevDayDir = prevDayClose > prevDayOpen ? 'BULLISH' : 'BEARISH';
        const prevDayDate = prevDayCandle.time
          ? new Date(prevDayCandle.time * 1000).toISOString().split('T')[0]
          : 'N/A';

        const currentPrice = marketContext.price;
        const distToPDH = Math.abs(currentPrice - prevDayHigh) / pipInfo.pipValue;
        const distToPDL = Math.abs(currentPrice - prevDayLow) / pipInfo.pipValue;
        const pdRangePips = prevDayHigh - prevDayLow;
        const pricePositionInPDRange = pdRangePips > 0
          ? ((currentPrice - prevDayLow) / pdRangePips * 100).toFixed(0)
          : '50';

        const abovePDH = currentPrice > prevDayHigh;
        const belowPDL = currentPrice < prevDayLow;
        const nearPDH = distToPDH < prevDayRange * 0.05;
        const nearPDL = distToPDL < prevDayRange * 0.05;

        let positionContext = '';
        if (abovePDH) positionContext = `Price is ABOVE Previous Day High by ${distToPDH.toFixed(1)} pips — potential continuation OR false breakout zone.`;
        else if (belowPDL) positionContext = `Price is BELOW Previous Day Low by ${distToPDL.toFixed(1)} pips — potential continuation OR false breakdown zone.`;
        else if (nearPDH) positionContext = `Price is approaching Previous Day High (${distToPDH.toFixed(1)} pips away) — strong institutional resistance. Expect rejection or breakout.`;
        else if (nearPDL) positionContext = `Price is approaching Previous Day Low (${distToPDL.toFixed(1)} pips away) — strong institutional support. Expect bounce or breakdown.`;
        else positionContext = `Price is in mid-range of previous day (${pricePositionInPDRange}% up from PDL). PDH and PDL are ${distToPDH.toFixed(1)}p / ${distToPDL.toFixed(1)}p away respectively.`;

        const isScalp = styleName === 'SCALP';

        d1ContextPrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PREVIOUS DAY CONTEXT (${marketContext.symbol}) — INSTITUTIONAL REFERENCE LEVELS${isScalp ? ' [ADVISORY]' : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Previous Day Date: ${prevDayDate}
Previous Day High (PDH): ${prevDayHigh.toFixed(pipInfo.decimalPlaces)}
Previous Day Low (PDL): ${prevDayLow.toFixed(pipInfo.decimalPlaces)}
Previous Day Close: ${prevDayClose.toFixed(pipInfo.decimalPlaces)} (${prevDayDir} day, range: ${prevDayRange.toFixed(1)} pips)

Current Position: ${positionContext}
Price vs PD Range: ${pricePositionInPDRange}% from PDL (0%=at PDL, 100%=at PDH)

${isScalp ? `SCALP PDH/PDL RULES (advisory — do not block on these alone):
- PDH and PDL are frequent M5-scale liquidity sweep targets. Market makers hunt these levels.
- If your scalp TP would cross PDH (for BUY) or PDL (for SELL), state whether you are targeting the level or using it as your TP ceiling.
- If price is within 5 pips of PDH/PDL, assess whether this is a breakout setup (TP beyond the level) or a rejection setup (TP before the level). Both are valid — you must state which.
- PDH/PDL within your scalp range (typical 12-25 pips) = the level is in play. PDH/PDL beyond your range = context only.
- DO NOT avoid all trades near daily levels. A clean M5 liquidity sweep of PDH/PDL followed by reversal is one of the highest-probability scalp setups available.` : `INSTITUTIONAL LEVEL RULES:
- PDH and PDL are MAJOR institutional reference levels. Market makers target these for liquidity sweeps.
- A TP placed at or beyond PDH/PDL without accounting for its magnetic pull is structurally weak.
- If your TP target is BEYOND PDH (for BUY) or below PDL (for SELL), acknowledge this in your reasoning.
- If your entry is NEAR PDH/PDL (within 5% of range), explain whether this is a breakout or rejection setup.
- PDH/PDL are NOT hard TP targets. They are context layers — use them to calibrate where liquidity pools.`}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        console.log(`[Alpha Coordinator] D1 Previous Day (${styleName}): H=${prevDayHigh.toFixed(pipInfo.decimalPlaces)} L=${prevDayLow.toFixed(pipInfo.decimalPlaces)} range=${prevDayRange.toFixed(1)}p, price at ${pricePositionInPDRange}% of PD range`);
      }
    } catch (error) {
      console.warn('[Alpha Coordinator] D1 context unavailable (non-blocking):', error instanceof Error ? error.message : 'Unknown');
    }

    // ═══════════════════════════════════════════════════════════════════
    // M1 MICRO PRICE ACTION CONTEXT (ALL STYLES - timing refinement)
    // SSOT: MarketDataService is the single authority for candle data
    // CCIP 2026-02-18: M1 is SECONDARY to the primary timeframe.
    // Use M1 to refine entry timing WITHIN a primary-TF-confirmed zone.
    // M1 signals alone do NOT override primary TF structure.
    // ═══════════════════════════════════════════════════════════════════
    let m1MicroContextPrompt = '';
    try {
      const mds = MarketDataService.getInstance();
      const m1Candles = await mds.getCandles(marketContext.symbol, 'M1', 20);

      if (m1Candles && m1Candles.length >= 5) {
        const recentM1 = m1Candles.slice(0, 20).reverse();
        const pipInfo = getCurrencyPipInfo(marketContext.symbol);

        const m1Lines: string[] = recentM1.map((c, i) => {
          const dir = c.close > c.open ? 'UP' : c.close < c.open ? 'DN' : 'FLAT';
          const bodyPips = Math.abs(c.close - c.open) / pipInfo.pipValue;
          const upperWick = (c.high - Math.max(c.open, c.close)) / pipInfo.pipValue;
          const lowerWick = (Math.min(c.open, c.close) - c.low) / pipInfo.pipValue;
          return `  ${i + 1}. ${dir} O:${c.open.toFixed(pipInfo.decimalPlaces)} H:${c.high.toFixed(pipInfo.decimalPlaces)} L:${c.low.toFixed(pipInfo.decimalPlaces)} C:${c.close.toFixed(pipInfo.decimalPlaces)} body:${bodyPips.toFixed(1)}p wicks:${upperWick.toFixed(1)}/${lowerWick.toFixed(1)}p`;
        });

        let consecutiveSameDir = 1;
        for (let i = recentM1.length - 2; i >= 0; i--) {
          const prevDir = recentM1[i].close > recentM1[i].open ? 'UP' : 'DN';
          const lastDir = recentM1[recentM1.length - 1].close > recentM1[recentM1.length - 1].open ? 'UP' : 'DN';
          if (prevDir === lastDir) consecutiveSameDir++;
          else break;
        }

        const lastCandle = recentM1[recentM1.length - 1];
        const lastBody = Math.abs(lastCandle.close - lastCandle.open) / pipInfo.pipValue;
        const lastUpperWick = (lastCandle.high - Math.max(lastCandle.open, lastCandle.close)) / pipInfo.pipValue;
        const lastLowerWick = (Math.min(lastCandle.open, lastCandle.close) - lastCandle.low) / pipInfo.pipValue;
        const hasRejectionWick = lastUpperWick > lastBody * 1.5 || lastLowerWick > lastBody * 1.5;

        const m1High = Math.max(...recentM1.map(c => c.high));
        const m1Low = Math.min(...recentM1.map(c => c.low));
        const m1RangePips = (m1High - m1Low) / pipInfo.pipValue;

        m1MicroContextPrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M1 MICRO PRICE ACTION (${marketContext.symbol}) — TIMING REFINEMENT (SECONDARY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Use M1 data to REFINE entry timing AFTER you have assessed the ${primaryTfConfig.label} structure above.
M1 signals alone do NOT determine your entry_advisory verdict. The ${primaryTfConfig.label} timeframe is primary.

${m1Lines.join('\n')}

M1 MICRO SUMMARY:
- M1 Range: ${m1RangePips.toFixed(1)} pips (High: ${m1High.toFixed(pipInfo.decimalPlaces)}, Low: ${m1Low.toFixed(pipInfo.decimalPlaces)})
- Consecutive same-direction M1 candles: ${consecutiveSameDir}
- Last M1 candle: ${hasRejectionWick ? 'REJECTION WICK detected (possible reversal/exhaustion)' : 'Normal candle'}
- Momentum assessment: ${consecutiveSameDir >= 4 ? 'STRONG one-way momentum - retrace likely imminent' : consecutiveSameDir >= 3 ? 'Building momentum - watch for exhaustion' : 'Mixed/choppy - normal price action'}

HIERARCHY REMINDER: A single M1 rejection wick does NOT override an impulsive ${primaryTfConfig.label} leg.
If the ${primaryTfConfig.label} shows 3+ consecutive same-direction candles, the entry_advisory should be PULLBACK_EXPECTED
regardless of what M1 shows — unless there is exceptional breakaway evidence.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        console.log(`[Alpha Coordinator] M1 Micro: ${recentM1.length} candles, ${consecutiveSameDir} consecutive same-dir, range ${m1RangePips.toFixed(1)} pips`);
      }
    } catch (error) {
      console.warn('[Alpha Coordinator] M1 micro context unavailable (non-blocking):', error instanceof Error ? error.message : 'Unknown');
    }

    // ═══════════════════════════════════════════════════════════════════
    // IM SIGNAL CONTEXT: Pre-computed per-symbol intelligence from the
    // session_intelligence_data table. Applies to ALL trade styles.
    // Advisory only — Alpha retains full decision authority.
    // ═══════════════════════════════════════════════════════════════════
    let imSignalContext = '';
    if (imSignal && typeof imSignal === 'object') {
      const direction = imSignal.direction as string | undefined;
      const imConfidence = imSignal.confidence as number | undefined;
      const alignment = imSignal.alignment as string | undefined;
      const momentumPhase = imSignal.momentumPhase as string | undefined;
      const subMode = imSignal.scalpSubMode as string | undefined;
      const pattern = imSignal.scalpPattern as string | undefined;
      const imScore = imSignal.score as number | undefined;

      const hasUsefulData = direction || momentumPhase || subMode || pattern;
      if (hasUsefulData) {
        imSignalContext = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INTELLIGENCE MONITOR SIGNAL (${marketContext.symbol}) — ADVISORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pre-computed signal from the server-side intelligence monitor. This is advisory context — your analysis takes precedence, but you MUST address any contradictions explicitly in your reasoning.
${direction ? `Directional Bias: ${direction.toUpperCase()}` : ''}${imConfidence !== undefined ? ` | Signal Confidence: ${(imConfidence * 100).toFixed(0)}%` : ''}${imScore !== undefined ? ` | Pair Score: ${imScore.toFixed(1)}` : ''}
${alignment ? `Alignment: ${alignment}` : ''}
${momentumPhase ? `Momentum Phase: ${momentumPhase.toUpperCase()}` : ''}${subMode ? ` | Sub-Mode: ${subMode}` : ''}
${pattern ? `Detected Pattern: ${pattern}` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // SCALP INTELLIGENCE CONTEXT — Inject pre-detected scalp signals
    // CCIP GOVERNANCE: This is advisory context only. Alpha has FINAL
    // AUTHORITY to confirm, reject, or override these pre-detections.
    // The intelligence monitor detected patterns using M5 candle data.
    // Alpha may have additional context that changes the assessment.
    //
    // CCIP-2026-02-19: When no session intelligence snapshot is available,
    // a self-assessment block is injected so Alpha applies the same
    // momentum phase framework using the M5 data already provided above.
    // This ensures scalp governance rules are always active regardless of
    // whether the intelligence pipeline has pre-computed signals.
    // ═══════════════════════════════════════════════════════════════════
    let scalpIntelligencePrompt = '';
    if (getDisplayNameFromStyle(tradeStyle) === 'SCALP' && !intelligenceSnapshot) {
      scalpIntelligencePrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCALP MOMENTUM SELF-ASSESSMENT (${marketContext.symbol}) — MANDATORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
No pre-computed intelligence snapshot is available for this scan cycle.
You MUST self-assess the following from the M5 candle data provided above:

1. ATR PHASE: Calculate how far price has moved from the last swing point.
   - FRESH / STARTING (< 0.75x ATR): Ideal window — full confidence permitted
   - DEVELOPING (0.75-1.5x ATR): Acceptable — assess remaining runway to TP explicitly. State: "Remaining range: ~X pips to nearest structure." If runway does not support TP, tighten TP or return NO_TRADE.
   - EXHAUSTED / EXTENDED (> 1.5x ATR): HARD BLOCK — return NO_TRADE immediately, no exceptions

2. SUB-MODE: Identify which of these applies to the current M5 structure:
   - MOMENTUM_CONTINUATION: Fresh directional move, enter now or on first micro-pullback
   - PULLBACK_ENTRY: Impulse already moved, price retracing — wait for pullback completion
   - CONSOLIDATION_BREAKOUT: Tight compression range — wait for body close outside range

3. STRUCTURE: Identify which of the 8 valid scalp structures is present (or none):
   momentum_breakout | bos_retest | ema_rejection | double_bottom | double_top |
   range_breakout | liquidity_sweep | engulfing_at_structure | trend_pullback_ema

If the move is EXHAUSTED: return NO_TRADE. No exceptions.
If no named structure matches: return NO_TRADE. A directional bet without structure is not a scalp.

MANDATORY JSON FIELDS — Include these regardless of action:
  "scalp_pattern": "<one of the 8 structures above, or 'none'>",
  "scalp_sub_mode": "momentum_continuation|pullback_entry|consolidation_breakout",
  "scalp_momentum_phase": "starting|developing|exhausted",
  "scalp_atr_traveled": <number — your estimate of ATR multiples traveled from last swing>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
    } else if (getDisplayNameFromStyle(tradeStyle) === 'SCALP' && intelligenceSnapshot) {
      try {
        const scalpSignal = (imSignal && (imSignal.scalpSubMode || imSignal.scalpPattern || imSignal.momentumPhase))
          ? {
              scalpSubMode: imSignal.scalpSubMode as string | undefined,
              scalpPattern: imSignal.scalpPattern as string | undefined,
              momentumPhase: imSignal.momentumPhase as string | undefined,
              atrTraveled: imSignal.atrTraveled as number | undefined
            }
          : null;

        if (scalpSignal?.scalpSubMode) {
          const subModeLabels: Record<string, string> = {
            momentum_continuation: 'MOMENTUM CONTINUATION — fresh directional move, enter aggressively',
            pullback_entry: 'PULLBACK ENTRY — impulse detected, wait for pullback completion before entry',
            consolidation_breakout: 'CONSOLIDATION BREAKOUT — compression detected, wait for clean body close outside range',
          };
          const patternLabels: Record<string, string> = {
            momentum_breakout: 'Momentum Breakout',
            bos_retest: 'Break of Structure Retest',
            ema_rejection: 'EMA Rejection',
            double_bottom: 'Double Bottom',
            double_top: 'Double Top',
            range_breakout: 'Range Breakout',
            liquidity_sweep: 'Liquidity Sweep Reversal',
            engulfing_at_structure: 'Engulfing at Structure',
            trend_pullback_ema: 'Trend Pullback to EMA',
            none: 'No specific pattern — general confluence',
          };
          const phaseLabels: Record<string, string> = {
            starting: 'STARTING / FRESH (< 0.75x ATR traveled — ideal scalp window, full confidence)',
            developing: 'DEVELOPING (0.75-1.5x ATR traveled — assess remaining runway to TP explicitly; tighten TP to nearest structure if runway is insufficient)',
            exhausted: 'EXHAUSTED / EXTENDED (> 1.5x ATR traveled — HARD BLOCK, return NO_TRADE immediately, no exceptions)',
          };

          scalpIntelligencePrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCALP INTELLIGENCE — MANDATORY COMPLIANCE GATE (${marketContext.symbol})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The real-time intelligence monitor analyzed ${marketContext.symbol} M5 data and produced the following pre-detection.
You MUST address each field in your reasoning and include all three fields in your JSON output.

Sub-Mode Detected: ${subModeLabels[scalpSignal.scalpSubMode] ?? scalpSignal.scalpSubMode}
Pattern Detected: ${patternLabels[scalpSignal.scalpPattern ?? 'none'] ?? scalpSignal.scalpPattern}
Momentum Phase: ${phaseLabels[scalpSignal.momentumPhase ?? 'developing'] ?? scalpSignal.momentumPhase}
ATR Traveled: ~${scalpSignal.atrTraveled?.toFixed(2) ?? 'unknown'}x ATR from last swing

${scalpSignal.momentumPhase === 'exhausted'
  ? `HARD BLOCK — EXHAUSTED MOMENTUM: ATR traveled > 1.5x. This move is EXTENDED. Return NO_TRADE immediately. Do NOT downgrade style. Do NOT justify entry. There are no exceptions.`
  : scalpSignal.momentumPhase === 'developing'
    ? `DEVELOPING MOMENTUM: ~${scalpSignal.atrTraveled?.toFixed(2) ?? '?'}x ATR consumed. Range is partially used. You MUST assess whether sufficient runway exists between current price and your TP. State explicitly: "Remaining runway: ~X pips to nearest structure. TP placed at [level] — the [near/far] edge of that zone." If remaining range does not support the required R:R, tighten TP to the nearest achievable structure or return NO_TRADE. Do NOT apply an arbitrary confidence penalty — reason about the runway directly.`
    : `FRESH MOMENTUM: < 0.75x ATR consumed. Full confidence permitted. Enter early in the leg.`
}

${scalpSignal.scalpSubMode === 'pullback_entry'
  ? `PULLBACK ENTRY RULE: Do NOT enter during the retrace. If pullback completion is not confirmed by a continuation candle on M5, use WAIT_ENTRY — not EXECUTE_NOW. Entering mid-retrace is the #1 scalp failure mode.`
  : scalpSignal.scalpSubMode === 'consolidation_breakout'
    ? `CONSOLIDATION BREAKOUT RULE: A candle BODY close outside the compression range is required. A wick touch is NOT a breakout. If body close has not occurred, use WAIT_ENTRY.`
    : `MOMENTUM CONTINUATION: Fresh directional move. Enter on the breakout or within the first 1-2 candle pullback.`
}

${scalpSignal.scalpPattern === 'none' || !scalpSignal.scalpPattern
  ? `NO NAMED STRUCTURE DETECTED: The pre-detector found no match to the 8 valid scalp structures. You MUST either (a) identify which named structure applies and explain in your reasoning, or (b) return NO_TRADE. A scalp without a named structure is a directional bet, not a trade. "scalp_pattern" in your JSON output must NOT be "none" if you execute.`
  : `PATTERN CONFIRMED: ${patternLabels[scalpSignal.scalpPattern]} was detected. Confirm this matches what you see or correct it in your reasoning. Include "scalp_pattern": "${scalpSignal.scalpPattern}" in your JSON output (or correct to a valid structure name).`
}

MANDATORY JSON FIELDS — Include these in your response regardless of action:
  "scalp_pattern": "momentum_breakout|bos_retest|ema_rejection|double_bottom|double_top|range_breakout|liquidity_sweep|engulfing_at_structure|trend_pullback_ema|none"
  "scalp_sub_mode": "momentum_continuation|pullback_entry|consolidation_breakout"
  "scalp_momentum_phase": "starting|developing|exhausted"
  "scalp_atr_traveled": (number, e.g. 0.82)

These fields are required for audit and mid-trade monitoring. Missing or null values are a governance violation.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.log(`[Alpha Coordinator] Scalp intelligence: ${scalpSignal.scalpSubMode} | ${scalpSignal.scalpPattern} | ${scalpSignal.momentumPhase}`);
        }
      } catch (err) {
        console.warn('[Alpha Coordinator] Scalp intelligence context unavailable (non-blocking):', err instanceof Error ? err.message : 'Unknown');
      }
    }

    const prompt = `${styleIdentityPrompt}
${cachedThesisPrompt}
${m5ContextPrompt}
${primaryTfCandlePrompt}
${htfCandlePrompt}
${m15ReferencePrompt}
${d1ContextPrompt}
${m1MicroContextPrompt}
${scalpIntelligencePrompt}

PROFESSIONAL REASONING CONTRACT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are a professional trader, not a rule executor. The market intelligence below is your briefing. Read it, reason through it, and make the best decision available. The eight analytical questions in your system prompt are your mental checklist — work through them using the data provided.

Your decision framework:
- Execute (BUY/SELL) when a genuine edge exists with sound structure and acceptable risk
- Return NO_TRADE when no structural edge is present or the setup has critical unresolved weaknesses
- Your confidence score must honestly reflect the quality of the setup — not what you wish it were
- The scanner re-evaluates every cycle. A NO_TRADE now is not a missed trade — it is disciplined execution
- When analyzing multiple pairs, execute the best opportunity available, not every opportunity

ADVISORY INTELLIGENCE (context, not constraints):
- Regime Oracle: ${ALPHA_IDENTITY.ADVISORY_SYSTEMS.REGIME_ORACLE.name} — session and volatility regime context
- Adversarial Detector: ${ALPHA_IDENTITY.ADVISORY_SYSTEMS.ADVERSARIAL_DETECTOR.name} — manipulation and trap pattern warnings
- Session Constraints: ${ALPHA_IDENTITY.ADVISORY_SYSTEMS.SESSION_CONSTRAINTS.name} — time-based liquidity context
- These advisories inform your confidence. They do not block your decision. Max combined advisory effect: ${ALPHA_IDENTITY.MAX_ADVISORY_PENALTY}%

ONLY THESE CONDITIONS PRODUCE A HARD BLOCK:
${ALPHA_IDENTITY.LEGITIMATE_BLOCK_CONDITIONS.map(c => `- ${c}`).join('\n')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MARKET INTELLIGENCE BRIEFING:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${briefing.briefingText}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Risk Mode: ${riskMode.toUpperCase()}

${conflictContext}${advisoryContext}${advancedPatternsContext}${riskContext}${rrPerformanceContext}${recentTradesContext}${dailyNarrativeContext}${microRegimeContext}${liquidityIntentContext}${patternContext}${intelligenceContext}${imSignalContext}${goalContextText}${liquidityContext}${constraintsText}${stopLossDirective}

MARKET CONDITIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Volatility: ${volatilityRegime.regime.toUpperCase()} ${volatilityRegime.ratio !== 1.0 ? `(${volatilityRegime.ratio.toFixed(2)}x)` : ''} | ${volatilityRegime.recommendation}
  Stop Quality: ${stopQuality.score}/100 | ${stopQuality.recommendation}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NARRATIVE (MANDATORY for BUY/SELL):
Include "market_narrative" — single sentence stating: what caused this move + where price is going + what participants are doing.
Example: "Swept Asian lows, trapped retail shorts, BOS confirms long — targeting 1.0850 resistance."
A weak or missing narrative indicates incomplete reasoning. Your narrative must reflect that you have worked through the analytical questions.

COUNTER-THESIS (MANDATORY for BUY/SELL):
Include "counter_thesis" — single sentence naming the primary reason this trade fails.
Example: "Prior resistance at 1.0870 may reject price before TP is reached."
If you cannot identify a credible failure mode, re-examine your conviction level. A professional who cannot name what could go wrong is overconfident.

Actions: BUY (bullish edge), SELL (bearish edge), NO_TRADE (no structural edge or hard block condition met).
When analyzing multiple pairs, execute the best opportunity. Scanner re-evaluates every cycle.
BUY: SL < Entry < TP | SELL: TP < Entry < SL

TAKE-PROFIT RULES (ALPHA SOLE AUTHORITY):
You choose ALL profit targets. The system never calculates TP for you.
- SCALP: ONE take-profit ("takeProfit"). Place TP at the CONSERVATIVE EDGE (near side) of the target S/R zone.
  SELL: TP at the TOP of the support zone (upper boundary where candles first cluster), NOT the bottom.
  BUY: TP at the BOTTOM of the resistance zone (lower boundary where candles first cluster), NOT the top.
  A filled TP at the near edge always beats an unfilled TP at the far edge.
- MICRO_INTRADAY: TWO take-profits.
  "tp1" = Conservative partial target at the CONSERVATIVE EDGE of the nearest M15 structural zone (not M5 micro-structure). TP1 R:R vs SL MUST be >= 1.5:1 (hard floor — violations auto-blocked).
  "tp2" = Full target at the CONSERVATIVE EDGE of the nearest H1 structural zone. TP2 R:R vs SL MUST be >= 2.0:1 (hard floor).
  tp1 must be closer to entry than tp2. Both must be within arena walls.
  If no M15 structure exists at >= 1.5:1 distance, either tighten SL to a structural level that achieves ratio, or NO_TRADE.
  SL must be behind a genuine M15 structural level — scalp-sized stops on MICRO trades are auto-rejected.
- INTRADAY: TWO take-profits.
  "tp1" = Conservative partial target at the CONSERVATIVE EDGE of the nearest H1 structural zone (not M15 micro-structure). TP1 R:R vs SL MUST be >= 2.0:1 (hard floor).
  "tp2" = Full target at the CONSERVATIVE EDGE of the nearest H4 structural zone. TP2 R:R vs SL MUST be >= 2.5:1 (hard floor).
  tp1 must be closer to entry than tp2. Both must be within arena walls.
  If no H1 structure exists at >= 2.0:1 distance, either tighten SL to a structural level that achieves ratio, or NO_TRADE.

Return PURE JSON only:
${tradeStyle === 'SCALP' ? `{
  "action": "BUY|SELL|NO_TRADE",
  "entry": 12345.67,
  "stopLoss": 12300.00,
  "takeProfit": 12400.00,
  "trade_confidence": 75,
  "entry_mode": "execute_now",
  "style": "SCALP",
  "marketThesis": "Brief market analysis (30-50 words)",
  "reasoning": "Your full analytical reasoning — trend context, structural space, prior rejections, timing assessment",
  "market_narrative": "Single-sentence cause-effect-destination thesis",
  "counter_thesis": "Single sentence: the primary reason this trade fails",
  "scalp_pattern": "momentum_breakout|bos_retest|ema_rejection|double_bottom|double_top|range_breakout|liquidity_sweep|engulfing_at_structure|trend_pullback_ema|none",
  "scalp_sub_mode": "momentum_continuation|pullback_entry|consolidation_breakout",
  "scalp_momentum_phase": "starting|developing|exhausted",
  "scalp_atr_traveled": 0.82,
  "entry_advisory": { "verdict": "GOOD_ENTRY|PULLBACK_EXPECTED", "pullback_zone_min": null_or_price, "pullback_zone_max": null_or_price, "reasoning": "MUST use 50% DISTANCE RULE. E.g. SELL: 'Nearest resistance at 4963 is 10 pips above entry. 50% distance = 5 pips. Zone: 4958-4960. Realistic ~5 pip improvement.' BUY: 'Support at 1.0838 is 4 pips below (0.2 ATR). M1 pullback already happened - good entry now.'" },
  "override": { "type": "none", "justification": "" }
}` : `{
  "action": "BUY|SELL|NO_TRADE",
  "entry": 12345.67,
  "stopLoss": 12300.00,
  "tp1": 12370.00,
  "tp2": 12400.00,
  "trade_confidence": 75,
  "entry_mode": "execute_now",
  "style": "${tradeStyle}",
  "marketThesis": "Brief market analysis (30-50 words)",
  "reasoning": "Your full analytical reasoning — trend context, structural space, prior rejections, timing assessment",
  "market_narrative": "Single-sentence cause-effect-destination thesis",
  "counter_thesis": "Single sentence: the primary reason this trade fails",
  "entry_advisory": { "verdict": "GOOD_ENTRY|PULLBACK_EXPECTED", "pullback_zone_min": null_or_price, "pullback_zone_max": null_or_price, "reasoning": "MUST use 50% DISTANCE RULE. E.g. 'Nearest resistance at 1.0870 is 15 pips above. 50% distance = ~7.5 pips. Zone: 1.0849-1.0852. Realistic ~8 pip improvement.'" },
  "override": { "type": "none", "justification": "" }
}`}`;

    // Emit final progress thought before LLM call (this is the 6.3s phase)
    if (sessionId && userId) {
      alphaThoughtStream.emitAlphaFinalDecision(sessionId, userId, marketContext.symbol).catch(err => {
        console.warn('[Alpha Coordinator] Failed to emit final decision thought:', err);
      });
    }

    try {
      const response = await openAIClient.chat(
        [
          {
            role: 'system',
            content: getAlphaSystemPromptForStyle(styleName)
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        {
          model: 'gpt-4o-mini',
          temperature: 0.3,
          max_tokens: 900,
          requestType: 'alpha_coordination',
          endpoint: 'alpha-coordinator'
        }
      );

      // Log token usage
      await llmTokenTracker.logUsage({
        brainName: 'Alpha',
        model: 'gpt-4o-mini',
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        contextType: 'alpha_coordination',
        userId: userId,
        sessionId: undefined
      });

      const content = response.choices[0]?.message?.content || '{}';

      // ═══════════════════════════════════════════════════════════════════
      // EXTRACT AND CACHE MARKET THESIS
      // ═══════════════════════════════════════════════════════════════════
      let parsedJSON: any = {};
      try {
        // ✅ SSOT FIX: Use centralized sanitizer
        parsedJSON = sanitizeAndParse(content, 'alpha market thesis');

        // Extract market thesis from response
        const marketThesisText = parsedJSON.marketThesis || parsedJSON.reasoning || '';

        // Check if Alpha accepted or rejected the cached thesis
        const thesisAccepted = marketThesisText.includes('ACCEPTED_THESIS');
        const thesisRejected = marketThesisText.includes('REJECT_THESIS');

        if (cachedThesis && thesisRejected) {
          console.log('[Alpha Coordinator] ❌ Alpha rejected cached thesis');
          // Rejection logging handled by shared intelligence coordinator
        } else if (cachedThesis && thesisAccepted) {
          console.log('[Alpha Coordinator] ✅ Alpha accepted cached thesis');
        } else if (!cachedThesis && marketThesisText) {
          // Fresh thesis generation - cache it
          const directionBias = parsedJSON.action === 'BUY' ? 'BUY' :
                               parsedJSON.action === 'SELL' ? 'SELL' : 'NEUTRAL';

          // Store thesis in cache (fire-and-forget to avoid blocking execution)
          sharedIntelligenceCoordinator.getAlphaThesis(
            marketContext.symbol,
            regimeSignature,
            cachedThesis,
            async () => ({
              thesis: {
                directionBias: directionBias as 'BUY' | 'SELL' | 'NEUTRAL',
                narrative: marketThesisText,
                regime: regimeSnapshot?.category || 'unknown',
                liquidityContext: parsedJSON.market_narrative || undefined,
                confidenceBand: parsedJSON.trade_confidence > 70 ? 'strong' as const :
                               parsedJSON.trade_confidence > 50 ? 'medium' as const : 'weak' as const,
                thesisSummary: marketThesisText.substring(0, 100)
              },
              thesisRejected: false
            })
          ).catch(err => {
            logger.error('[Alpha Coordinator] Failed to cache thesis', { error: err });
          });

          console.log('[Alpha Coordinator] 💾 Caching fresh market thesis');
        }
      } catch (parseError) {
        logger.warn('[Alpha Coordinator] Failed to parse thesis from response', {
          error: parseError instanceof Error ? parseError.message : 'Unknown error'
        });
      }

      let decision = this.parseDecision(
        content,
        marketContext.price,
        extractATRValue(marketContext.atr),
        marketContext.symbol,
        stopLossAnchor,
        liquidityZones,
        fullCandles,
        marketContext,
        riskMode,
        goalContext,
        regimeSnapshot,
        userId,
        sessionId,
        tradeStyle,
        dualArenaWalls
      );

      // DUAL-ARENA WALL CHECK — Pure binary pass/fail enforcement
      // CCIP (2026-02-17): Walls are physics. Alpha's values are NEVER auto-adjusted.
      // If Alpha proposes values outside walls, the trade is blocked. Period.
      // Alpha must learn to propose correct values within the arena boundaries.
      // SSOT: Dual-arena walls are the single validation authority.
      //
      // CCIP (2026-02-18): Floating-point tolerance applied to all boundary comparisons.
      // calculatePipDistance returns unrounded floats; wall bounds are rounded to 1dp.
      // This produces false violations when values are imperceptibly below the boundary
      // (e.g., 9.9999... < 10.0). A tolerance of 0.05 pips (half of 0.1 display precision)
      // absorbs the rounding gap without meaningfully relaxing the wall constraints.
      // Applies to ALL styles (SCALP, MICRO_INTRADAY, INTRADAY, SWING).
      const WALL_COMPARISON_EPSILON = 0.05; // pips — absorbs floating-point rounding only
      if (decision.action !== 'NO_TRADE' && dualArenaWalls) {
        decision.arena_chosen = decision.action === 'BUY' ? 'LONG' : 'SHORT';
        const arena = decision.action === 'BUY' ? dualArenaWalls.long : dualArenaWalls.short;
        const slPips = calculatePipDistance(marketContext.symbol, decision.entry, decision.stopLoss);
        const tpPips = calculatePipDistance(marketContext.symbol, decision.entry, decision.takeProfit);

        const wallViolations: string[] = [];

        if (slPips < arena.slPips.min - WALL_COMPARISON_EPSILON) {
          wallViolations.push(`SL ${slPips.toFixed(1)} pips below wall min ${arena.slPips.min.toFixed(1)}`);
        }
        if (slPips > arena.slPips.max + WALL_COMPARISON_EPSILON) {
          wallViolations.push(`SL ${slPips.toFixed(1)} pips above wall max ${arena.slPips.max.toFixed(1)}`);
        }

        // CCIP (2026-02-20): TP NUDGE REPAIR — mirrors the existing SL logic.
        // When Alpha places TP below the wall minimum, we lift it to the minimum
        // and re-check R:R before issuing a hard NO_TRADE.
        // This is SSOT-compliant: Alpha remains the sole TP authority; the nudge
        // is a geometric correction, not an override of Alpha's market thesis.
        // Only block if the nudged TP still cannot satisfy the style's minimum R:R.
        let effectiveTpPips = tpPips;
        if (tpPips < arena.tpPips.min - WALL_COMPARISON_EPSILON) {
          const pipInfo = getCurrencyPipInfo(marketContext.symbol);
          const nudgedTpPrice = decision.action === 'BUY'
            ? decision.entry + arena.tpPips.min * pipInfo.pipValue
            : decision.entry - arena.tpPips.min * pipInfo.pipValue;

          const nudgedRR = arena.tpPips.min / Math.max(slPips, 0.1);
          const minRR = resolvedPlan?.rr?.min ?? 1.0;

          if (nudgedRR >= minRR - WALL_COMPARISON_EPSILON) {
            console.log(
              `[Alpha Coordinator] TP NUDGE REPAIR: ${tpPips.toFixed(1)} pips → ${arena.tpPips.min.toFixed(1)} pips (wall min). ` +
              `Nudged R:R ${nudgedRR.toFixed(2)}:1 >= required ${minRR}:1. Applying repair.`
            );
            decision.takeProfit = nudgedTpPrice;
            decision.tp_nudged = true;
            decision.tp_nudge_reason = `TP lifted from ${tpPips.toFixed(1)} to ${arena.tpPips.min.toFixed(1)} pips to meet wall minimum. R:R ${nudgedRR.toFixed(2)}:1.`;
            effectiveTpPips = arena.tpPips.min;
          } else {
            wallViolations.push(
              `TP ${tpPips.toFixed(1)} pips below wall min ${arena.tpPips.min.toFixed(1)}. ` +
              `Nudged R:R ${nudgedRR.toFixed(2)}:1 insufficient (need ${minRR}:1).`
            );
          }
        }

        if (effectiveTpPips > arena.tpPips.max + WALL_COMPARISON_EPSILON) {
          wallViolations.push(`TP ${effectiveTpPips.toFixed(1)} pips above wall max ${arena.tpPips.max.toFixed(1)}`);
        }

        // CCIP (2026-02-17): TP1 is a partial-profit target — it must be positive and <= TP2.
        // TP1 is NOT validated against arena.tpPips.min because that minimum represents the
        // full-target R:R floor (e.g., 2.0:1 for MICRO_INTRADAY). TP1 by design sits between
        // entry and TP2, so applying the full-target minimum would block all partial-profit strategies.
        if (decision.tp1Price != null) {
          const tp1Pips = calculatePipDistance(marketContext.symbol, decision.entry, decision.tp1Price);
          if (tp1Pips <= 0) {
            wallViolations.push(`TP1 ${tp1Pips.toFixed(1)} pips is non-positive`);
          }
          if (tp1Pips > effectiveTpPips) {
            wallViolations.push(`TP1 ${tp1Pips.toFixed(1)} pips exceeds TP2 ${effectiveTpPips.toFixed(1)} pips`);
          }
        }

        decision.wall_violations = wallViolations;

        if (wallViolations.length > 0) {
          console.warn(`[Alpha Coordinator] WALL VIOLATION: ${wallViolations.join('; ')}`);
          decision.action = 'NO_TRADE';
          decision.decision = 'NO_TRADE';
          decision.confidence = 0;
          decision.reasoning = `Blocked: Decision outside arena walls. ${wallViolations.join('; ')}`;

          logViolation({
            violationType: 'ALPHA_WALL_VIOLATION',
            symbol: marketContext.symbol,
            attemptedOperation: 'wall_check',
            callLocation: 'coordinator-alpha.wall_check',
            blocked: true,
            errorDetails: {
              wallViolations,
              slPips,
              tpPips,
              arenaMin: { sl: arena.slPips.min, tp: arena.tpPips.min },
              arenaMax: { sl: arena.slPips.max, tp: arena.tpPips.max },
              userId: userId || null,
              sessionId: goalContext?.sessionId || null,
            }
          }).catch(error => {
            console.error('[Alpha Coordinator] Failed to log wall violation:', error);
          });
        } else {
          console.log(`[Alpha Coordinator] Decision within arena walls`);
        }
      }

      // Add decision field for compatibility
      decision.decision = decision.action;
      decision.symbol = marketContext.symbol;
      decision.timestamp = new Date();

      // Add Phase 1-4 upgrades to decision
      if (microRegime) {
        decision.microRegime = microRegime;
      }
      if (liquidityIntent && liquidityIntent.overallConviction > 0) {
        decision.liquidityIntent = liquidityIntent;
      }
      // Note: narrativeValidation is already set by parseDecision()

      // Add Phase 5: Pattern Intelligence
      if (patternIntelligence) {
        decision.patternIntelligence = {
          htfPattern: patternIntelligence.htfScan.primaryPattern?.patternType || null,
          htfIntent: patternIntelligence.intentAnalysis.htf.intent,
          mtfPattern: patternIntelligence.mtfScan.primaryPattern?.patternType || null,
          mtfIntent: patternIntelligence.intentAnalysis.mtf.intent,
          ltfPattern: patternIntelligence.ltfScan.primaryPattern?.patternType || null,
          ltfIntent: patternIntelligence.intentAnalysis.ltf.intent,
          alignmentScore: patternIntelligence.intentAnalysis.alignmentScore,
          overallIntent: patternIntelligence.intentAnalysis.overallIntent,
          directionBias: patternIntelligence.intentAnalysis.directionBias,
          confidenceBoosts: patternIntelligence.confidenceAdjustment.boosts,
          confidencePenalties: patternIntelligence.confidenceAdjustment.penalties,
          liquidityTargets: patternIntelligence.liquidityTargets,
          invalidationPoint: patternIntelligence.invalidationPoint,
          warnings: patternIntelligence.intentAnalysis.conflictWarnings,
        };
        console.log('[Alpha Coordinator] ✅ Pattern intelligence attached to decision');
      }

      // Log Alpha's stop placement vs anchor (Enhanced Stop Tracking)
      if (decision.action !== 'NO_TRADE' && stopLossAnchor) {
        // Use centralized pip calculation for consistency across all symbols (forex, crypto, indices)
        const alphaSLPips = calculatePipDistance(marketContext.symbol, decision.entry, decision.stopLoss);
        const anchorSLPips = stopLossAnchor.stopLossPips;
        const deviation = alphaSLPips - anchorSLPips;
        const deviationPercent = (deviation / anchorSLPips) * 100;

        console.log('[Alpha Stop Analysis] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`[Stop Anchor]  Provided: ${stopLossAnchor.stopLossPrice.toFixed(5)} (${anchorSLPips.toFixed(1)} pips, ${stopLossAnchor.atrMultiplier.toFixed(2)}x ATR)`);
        console.log(`[Alpha Choice] Chose:    ${decision.stopLoss.toFixed(5)} (${alphaSLPips.toFixed(1)} pips)`);

        if (Math.abs(deviationPercent) < 5) {
          console.log(`[Validation]   ✅ ACCEPTED ANCHOR (deviation: ${deviationPercent.toFixed(1)}%)`);
        } else if (deviation > 0) {
          console.log(`[Validation]   ⬆️  WIDENED by ${Math.abs(deviation).toFixed(1)} pips (+${deviationPercent.toFixed(1)}%)`);
        } else {
          console.log(`[Validation]   ⬇️  TIGHTENED by ${Math.abs(deviation).toFixed(1)} pips (${deviationPercent.toFixed(1)}%)`);
        }

        // Check if within profile range
        if (alphaSLPips < stopLossAnchor.profileMinPips) {
          console.log(`[Validation]   ⚠️  BELOW profile minimum (${stopLossAnchor.profileMinPips} pips) - risky`);
        } else if (alphaSLPips > stopLossAnchor.profileMaxPips) {
          console.log(`[Validation]   ⚠️  ABOVE profile maximum (${stopLossAnchor.profileMaxPips} pips) - too wide`);
        } else {
          console.log(`[Validation]   ✅ Within profile range (${stopLossAnchor.profileMinPips}-${stopLossAnchor.profileMaxPips} pips)`);
        }

        console.log('[Alpha Stop Analysis] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      }

      decision.omega_summary = this.generateOmegaSummary(votes);
      decision.omega_votes = votes;
      decision.atrPercent = computedAtrPercent;

      // Add goal context if provided
      if (goalContext) {
        decision.goal_context = goalContext;
      }

      // Add advisory signals to decision
      if (adversarialSignal) {
        decision.adversarial_advisory = adversarialSignal;
      }
      if (regimeSnapshot) {
        decision.regime_advisory = regimeSnapshot;
      }

      // Add intelligence snapshot summary
      if (intelligenceSnapshot) {
        decision.intelligence_snapshot = {
          calibrationData: intelligenceSnapshot.calibrationData,
          reasoningPatterns: intelligenceSnapshot.reasoningPatterns.slice(0, 3),
          executionQuality: intelligenceSnapshot.executionQuality
        };
      }

      // Omega-10 risk horizon (ADVISORY ONLY - no confidence modification)
      if (userId) {
        const omega10Analysis = await omega10Scheduler.getLatestAnalysis(userId);
        if (omega10Analysis && omega10Analysis.riskHorizon.level === 'high') {
          console.log('[Alpha Coordinator] Omega-10 risk horizon: HIGH (advisory only, no confidence change)');
          decision.omega10_applied = true;
        }
      }

      if (votes.omega8) {
        decision.omega8_liquidity_bias = votes.omega8.liquidity_bias;
        decision.omega8_direction_support = votes.omega8.direction_support;
        // Omega-8 data attached for telemetry only - no confidence manipulation
      }

      // Omega-9 validation (final safety check) - skip for WAIT since we're not executing yet
      if (decision.action !== 'NO_TRADE') {
        console.log('[Alpha Coordinator] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('[Alpha Coordinator] 📋 ALPHA\'S DECISION (Before Omega-9):');
        console.log(`[Alpha Coordinator]   Action: ${decision.action}`);
        console.log(`[Alpha Coordinator]   Entry: ${decision.entry.toFixed(5)}`);
        console.log(`[Alpha Coordinator]   Stop Loss: ${decision.stopLoss.toFixed(5)}`);
        console.log(`[Alpha Coordinator]   Take Profit: ${decision.takeProfit.toFixed(5)}`);
        console.log(`[Alpha Coordinator]   Confidence: ${decision.confidence}%`);
        console.log(`[Alpha Coordinator]   R:R Ratio: ${(Math.abs(decision.takeProfit - decision.entry) / Math.abs(decision.entry - decision.stopLoss)).toFixed(2)}`);
        console.log('[Alpha Coordinator] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('[Alpha Coordinator] 🛡️ Running Omega-9 validation (Mathematical Safety Only)...');

        const omega9Input: Omega9Input = {
          alphaDecision: decision,
          omegaVotes: votes,
          marketContext: {
            price: marketContext.price,
            atr: marketContext.atr,
            symbol: marketContext.symbol
          },
          safetyRules: {
            maxRiskPct: 5,
            minRR: getMinRRForStyle(tradeStyle),
            maxExposure: 10
          }
        };

        const validation = await omega9Hallucination.validate(omega9Input);
        decision.omega9_validation = validation;

        // Recalculate stop quality now that we have Omega-9 results
        const finalStopQuality = this.calculateStopQualityScore(votes.omega8, validation);
        console.log(`[Alpha Coordinator] 🛡️ Final Stop Quality: ${finalStopQuality.score}/100`);

        // Omega-9 hard block - CANNOT BE OVERRIDDEN
        if (!validation.pass) {
          console.log('[Alpha Coordinator] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('[Alpha Coordinator] OMEGA-9 HARD BLOCK');
          console.log(`[Alpha Coordinator] Reason: ${validation.reasoning}`);
          console.log('[Alpha Coordinator] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          return {
            action: 'NO_TRADE',
            decision: 'NO_TRADE',
            entry: marketContext.price,
            stopLoss: marketContext.price,
            takeProfit: marketContext.price,
            confidence: 0,
            reasoning: `OMEGA-9 VETO: ${validation.reasoning}. Alpha's decision blocked due to mathematical survival violation.`,
            omega_summary: decision.omega_summary,
            omega8_liquidity_bias: decision.omega8_liquidity_bias,
            omega8_direction_support: decision.omega8_direction_support,
            omega9_validation: validation
          };
        }

        console.log('[Alpha Coordinator] Omega-9 validation complete (catastrophic-only enforcement)');
      }

      // Time-to-Fill: advisory duration estimate only — no penalties, no blocking
      if (decision.action !== 'NO_TRADE') {
        const tpDistancePips = calculatePipDistance(marketContext.symbol, decision.entry, decision.takeProfit);
        const pipInfo = getCurrencyPipInfo(marketContext.symbol);
        const atrPips = extractATRValue(marketContext.atr) / pipInfo.pipValue;
        const { currentSession } = calculateSessionContext();

        const timeToFill = timeToFillCalculator.calculate({
          tpDistancePips,
          atrPips,
          currentSession,
          symbol: marketContext.symbol
        });

        decision.expectedFillTimeHours = timeToFill.expectedMinutes / 60;
        decision.reasoning += ` [Expected fill: ${timeToFill.expectedMinutes}min]`;
      }

      console.log('[Alpha Coordinator] Decision:', decision.action);
      console.log('[Alpha Coordinator] Confidence:', decision.confidence);
      console.log('[Alpha Coordinator] Reasoning:', decision.reasoning);
      console.log('[Alpha Coordinator] Omega Summary:', decision.omega_summary);

      if (decision.action !== 'NO_TRADE') {
        try {
          // Extract recent candles and calculate VWAP for entry quality analysis
          let recentCandles: Array<{
            open: number;
            high: number;
            low: number;
            close: number;
            timestamp: number;
          }> | undefined = undefined;
          let vwap: number | undefined = undefined;

          if (fullCandles && fullCandles.length > 0) {
            // Take last 10 candles for analysis
            const candleSlice = fullCandles.slice(-10);

            // Convert to entry quality format
            recentCandles = candleSlice.map((c: any) => ({
              open: c.open || c.o || 0,
              high: c.high || c.h || 0,
              low: c.low || c.l || 0,
              close: c.close || c.c || 0,
              timestamp: c.timestamp || c.time || Date.now()
            }));

            // Calculate VWAP from recent candles (volume-weighted average price)
            // If volume not available, use typical price average as approximation
            let sumTypicalPrice = 0;
            let sumVolume = 0;

            for (const candle of candleSlice) {
              const typicalPrice = ((candle.high || candle.h || 0) + (candle.low || candle.l || 0) + (candle.close || candle.c || 0)) / 3;
              const volume = candle.volume || candle.v || 1; // Default to 1 if no volume
              sumTypicalPrice += typicalPrice * volume;
              sumVolume += volume;
            }

            vwap = sumVolume > 0 ? sumTypicalPrice / sumVolume : undefined;

            if (vwap) {
              console.log(`[Alpha Coordinator] 📊 Calculated VWAP: ${vwap.toFixed(5)} from ${candleSlice.length} candles`);
            }
          }

          // Classify entry intent with quality rules (async with adaptive zones)
          const entryIntent = await EntryIntentClassifier.classifyEntryIntent(
            decision,
            marketContext,
            votes,
            vwap,
            microRegime?.regime
          );

          if (entryIntent) {
            decision.entry_intent = entryIntent;
            console.log(`[Alpha Coordinator] 🎯 Entry intent: ${entryIntent.intent_type} (${entryIntent.urgency})`);

            // Log adaptive zone details if available
            if (entryIntent.zone_type && entryIntent.micro_regime_used) {
              console.log(`[Alpha Coordinator] 🎯 Adaptive Zones: ${entryIntent.zone_type.toUpperCase()} zone for ${entryIntent.micro_regime_used} regime`);
              console.log(`[Alpha Coordinator]    Primary Zone: ${entryIntent.primary_zone_min?.toFixed(5)} - ${entryIntent.primary_zone_max?.toFixed(5)}`);
              console.log(`[Alpha Coordinator]    Secondary Zone: ${entryIntent.secondary_zone_min?.toFixed(5)} - ${entryIntent.secondary_zone_max?.toFixed(5)}`);
              console.log(`[Alpha Coordinator]    Reachability: ${entryIntent.zone_reachability_distance_pips?.toFixed(2)} pips from current price`);
              console.log(`[Alpha Coordinator]    Position Size: ${((entryIntent.position_size_multiplier || 1.0) * 100).toFixed(0)}% of standard size`);
              if (entryIntent.zone_downgrade_applied) {
                console.log(`[Alpha Coordinator]    ⚠️ Zone downgraded due to reachability constraints`);
              }
            }

            // Log entry quality violations
            if (entryIntent.quality_violations && entryIntent.quality_violations.length > 0) {
              console.log(`[Alpha Coordinator] 🛡️ Entry Quality Assessment:`);
              entryIntent.quality_violations.forEach(violation => {
                const emoji = violation.severity === 'BLOCK' ? '🚫' : violation.severity === 'WARN' ? '⚠️' : '📉';
                console.log(`[Alpha Coordinator]   ${emoji} ${violation.rule}: ${violation.reason}`);
                console.log(`[Alpha Coordinator]      → Suggested: ${violation.suggestedAction}`);
              });

              if (entryIntent.adjusted_by_quality_rules) {
                console.log(`[Alpha Coordinator] ✅ Entry parameters adjusted by quality rules`);
              }
            }
          }
        } catch (error) {
          console.error('[Alpha Coordinator] Failed to classify entry intent:', error);
        }
      }

      // Historical accuracy data is now fed INTO the prompt (buildIntelligenceContext)
      // Alpha's confidence output is final - no post-LLM calibration

      return decision;
    } catch (error) {
      console.error('[Alpha Coordinator] Error:', error);
      return {
        action: 'NO_TRADE',
        decision: 'NO_TRADE',
        entry: marketContext.price,
        stopLoss: marketContext.price,
        takeProfit: marketContext.price,
        confidence: 0,
        reasoning: 'Coordination failed',
        omega_summary: 'Error in coordination'
      };
    }
  }

  /**
   * Fetch platform-wide intelligence for symbol
   */
  private async fetchPlatformIntelligence(symbol: string): Promise<string> {
    try {
      const [symbolIntel, topPatterns, platformStats] = await Promise.all([
        globalIntelligenceProvider.getSymbolIntelligence(symbol),
        globalIntelligenceProvider.getGlobalPatternsForSymbol(symbol, 20),
        globalIntelligenceProvider.getPlatformStats()
      ]);

      const parts: string[] = [];
      parts.push('📊 PLATFORM INTELLIGENCE (Collective Learning from All Users):');

      if (symbolIntel && symbolIntel.total_trades_platform_wide >= 30) {
        parts.push(`${symbol}: ${symbolIntel.total_trades_platform_wide} trades platform-wide | WR: ${symbolIntel.platform_win_rate.toFixed(1)}% | PF: ${symbolIntel.platform_profit_factor.toFixed(2)}`);

        if (symbolIntel.intelligence_quality_score >= 70) {
          parts.push(`✅ High-quality intelligence (Score: ${symbolIntel.intelligence_quality_score})`);
        }
      } else {
        parts.push(`${symbol}: Limited platform data (new symbol or low volume)`);
      }

      if (topPatterns && topPatterns.length > 0) {
        const validated = topPatterns.filter(p => p.sample_size_adequate);
        if (validated.length > 0) {
          const best = validated[0];
          parts.push(`Top Pattern: ${best.pattern_name} | WR: ${best.win_rate.toFixed(1)}% | PF: ${best.profit_factor.toFixed(2)} (${best.total_occurrences} samples)`);
        }
      }

      if (platformStats) {
        parts.push(`Platform: ${platformStats.total_trades_analyzed} trades analyzed | ${platformStats.total_patterns_discovered} patterns discovered`);
      }

      return parts.join('\n');
    } catch (error) {
      console.error('[Alpha] Error fetching platform intelligence:', error);
      return '📊 Platform intelligence unavailable';
    }
  }

  private generateOmegaSummary(votes: OmegaCouncilVotes): string {
    if (!votes.omega8) return '';
    const liquidityLabel = votes.omega8.liquidity_bias === 'stoprun_risk' ? 'Stop-run risk detected' :
                           votes.omega8.liquidity_bias === 'clean' ? 'Clean liquidity' :
                           votes.omega8.liquidity_bias;
    return `OrderFlow: ${liquidityLabel}`;
  }

  /**
   * Parse Alpha decision with MINIMAL corrections (only catastrophic errors)
   * Elite Trader Directive educates Alpha - we trust professional judgment
   */
  private parseDecision(
    response: string,
    currentPrice: number,
    atr: number,
    symbol: string,
    stopLossAnchor: StopLossCalculation | null = null,
    liquidityZones: LiquidityZone[] = [],
    fullCandles: any[] = [],
    marketContext?: MarketContext,
    riskMode: 'low' | 'medium' | 'high' = 'medium',
    goalContext?: GoalContext,
    regimeSnapshot?: RegimeSnapshot,
    userId?: string,
    sessionId?: string,
    tradeStyle: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY' = 'SCALP',
    dualArenaWalls?: DualArenaWalls | null
  ): AlphaDecision {
    try {
      // ✅ SSOT FIX: Use centralized sanitizer (handles markdown, comment removal, and JSON extraction)
      // Step 1: Remove JavaScript-style comments before sanitization
      let cleaned = response
        .replace(/\/\/[^\n]*/g, '')           // Remove single-line comments
        .replace(/\/\*[\s\S]*?\*\//g, '');    // Remove multi-line comments

      // Step 2: Sanitize with centralized logic (handles markdown, JSON extraction)
      let parsed: any;
      try {
        parsed = sanitizeAndParse(cleaned, 'alpha decision response');
      } catch (parseError) {
        // Enhanced error logging
        console.error('[Alpha Coordinator] Failed to parse Alpha decision response');
        console.error('Raw response preview:', response.substring(0, 500));
        console.error('After comment removal:', cleaned.substring(0, 500));
        throw parseError;
      }

      // Validate and sanitize action
      let action = parsed.action || 'NO_TRADE';
      if (!['BUY', 'SELL', 'NO_TRADE'].includes(action)) {
        console.warn(`[Alpha Coordinator] Invalid action "${action}" - converting to NO_TRADE`);
        action = 'NO_TRADE';
      }

      // Extract new Alpha output format fields
      const tradeConfidence = parsed.trade_confidence ?? parsed.confidence ?? 0;
      const entryQualityScore = parsed.entry_quality_score ?? 0;
      const entryMode = parsed.entry_mode ?? 'wait_pullback';

      // SSOT: User's chosen style is IMMUTABLE - LLM cannot override it
      // tradeStyle was already resolved from user's choice at function scope
      const resolvedStyle = tradeStyle;

      // Extract thesis-aware fields (Phase 2: Integration)
      const thesis = parsed.thesis || null;
      const styleIntent = parsed.style_intent || null;
      const executionPreference = parsed.execution_preference || null;
      const acceptableProfitRange = parsed.acceptable_profit_range || null;

      // CCIP 2026-02-17: Extract Alpha's entry advisory (SSOT for Entry Monitor)
      const rawAdvisory = parsed.entry_advisory;
      const entryAdvisory = rawAdvisory && typeof rawAdvisory === 'object' ? {
        verdict: rawAdvisory.verdict === 'PULLBACK_EXPECTED' ? 'PULLBACK_EXPECTED' as const : 'GOOD_ENTRY' as const,
        pullback_zone_min: typeof rawAdvisory.pullback_zone_min === 'number' ? rawAdvisory.pullback_zone_min : null,
        pullback_zone_max: typeof rawAdvisory.pullback_zone_max === 'number' ? rawAdvisory.pullback_zone_max : null,
        reasoning: typeof rawAdvisory.reasoning === 'string' ? rawAdvisory.reasoning : ''
      } : null;

      // ═══════════════════════════════════════════════════════════════════
      // CALCULATE RISK PERCENTAGE (SSOT)
      // ═══════════════════════════════════════════════════════════════════
      // Risk percentage calculation priority:
      // 1. LLM response (if provided)
      // 2. Goal context risk percentage (dollar risk / balance)
      // 3. Risk mode defaults (LOW=0.5%, MEDIUM=1%, HIGH=2%)
      let riskPct: number;

      if (parsed.risk_pct !== undefined && parsed.risk_pct > 0) {
        // LLM provided risk percentage
        riskPct = parsed.risk_pct;
        console.log(`[Alpha Coordinator] 📊 Risk: ${riskPct.toFixed(2)}% (from LLM)`);
      } else if (goalContext?.riskPercent) {
        // Use goal context risk percentage
        riskPct = goalContext.riskPercent;
        console.log(`[Alpha Coordinator] 📊 Risk: ${riskPct.toFixed(2)}% (from goal context)`);
      } else {
        // Use risk mode defaults
        const riskDefaults = { low: 0.5, medium: 1.0, high: 2.0 };
        riskPct = riskDefaults[riskMode];
        console.log(`[Alpha Coordinator] 📊 Risk: ${riskPct.toFixed(2)}% (${riskMode} mode default)`);
      }

      // ═══════════════════════════════════════════════════════════════════
      // PHASE 4: NARRATIVE COHERENCE VALIDATION
      // ═══════════════════════════════════════════════════════════════════
      let narrativeValidation: NarrativeValidation | null = null;
      let adjustedConfidence = tradeConfidence;

      // Narrative validation for telemetry (no confidence modification)
      if (action === 'BUY' || action === 'SELL') {
        const marketNarrative = parsed.market_narrative;
        narrativeValidation = narrativeCoherenceValidator.validate(marketNarrative);
        console.log(`[Alpha Coordinator] Narrative Quality: ${narrativeValidation.qualityTier.toUpperCase()} | Strength: ${narrativeValidation.strengthScore}/100`);
        // Alpha's confidence is final - no penalties or caps applied
      }

      // If NO_TRADE, return simple response
      if (action === 'NO_TRADE') {
        return {
          action,
          decision: action,
          entry: currentPrice,
          stopLoss: currentPrice,
          takeProfit: currentPrice,
          confidence: Math.min(100, Math.max(0, tradeConfidence)),
          reasoning: parsed.reasoning || 'No reasoning provided',
          omega_summary: '',
          resolvedStyle,
          risk_pct: riskPct, // SSOT: Always provide risk percentage
          thesis: thesis || undefined,
          style_intent: styleIntent || undefined,
          execution_preference: executionPreference || undefined,
          acceptable_profit_range: acceptableProfitRange || undefined,
          entry_mode: entryMode as 'EXECUTE_NOW' | 'WAIT_ENTRY' | 'WAIT_HIGHER_EDGE' | undefined,
        entry_spec: {
            entry_quality_score: entryQualityScore,
            entry_mode: entryMode,
            style: resolvedStyle,
          },
          narrativeValidation: narrativeValidation || undefined
        };
      }

      // REMOVED: WAIT action handling
      // Alpha now only returns BUY, SELL, or NO_TRADE
      // If setup not ready, return NO_TRADE and scanner will re-evaluate

      // CCIP GOVERNANCE (2026-02-16): Alpha is SOLE AUTHORITY for all trade parameters
      // Alpha chooses entry, SL, and ALL take-profit levels. System never computes TP.
      // SCALP: Alpha returns "takeProfit" (single TP target)
      // MICRO_INTRADAY/INTRADAY: Alpha returns "tp1" (conservative) and "tp2" (full target)
      let entry = (parsed.entry !== null && parsed.entry !== undefined) ? parsed.entry : currentPrice;
      let stopLoss = parsed.stopLoss;
      let takeProfit: number;
      const isBuy = action === 'BUY';

      // Extract Alpha's TP decisions based on style
      if (tradeStyle === 'SCALP') {
        takeProfit = parsed.takeProfit;
      } else {
        // MICRO_INTRADAY / INTRADAY: Alpha provides tp1 and tp2
        // Backward compat: if Alpha returns old format with takeProfit, use it as tp2
        takeProfit = parsed.tp2 || parsed.takeProfit;
      }

      // Additional safety check: ensure entry is a valid number
      if (typeof entry !== 'number' || isNaN(entry) || entry <= 0) {
        console.error(`[Alpha Coordinator] 🚨 INVALID ENTRY PRICE: ${entry} (type: ${typeof entry})`);
        console.error(`[Alpha Coordinator] Falling back to currentPrice: ${currentPrice}`);
        entry = currentPrice;
      }

      // ═══════════════════════════════════════════════════════════════════
      // GEOMETRY VALIDATION (SSOT: alpha-geometry-validator.ts)
      // ═══════════════════════════════════════════════════════════════════
      // CRITICAL: This layer ONLY validates + logs + blocks. NO auto-correction.
      // Alpha's decision authority is maintained - we detect errors but never modify values.

      const geometryValidation = alphaGeometryValidator.validate({
        symbol,
        direction: action as 'BUY' | 'SELL',
        entryPrice: entry,
        stopLoss,
        takeProfit,
        currentMarketPrice: currentPrice,

        // Context for learning
        alphaConfidence: parsed.confidence || 0,
        narrativeQuality: narrativeValidation?.quality,
        narrativeText: parsed.reasoning,
        eqsScore: undefined, // Will be calculated later
        tradeStyle: parsed.style,
        marketRegime: regimeSnapshot?.currentRegime,
        volatilityLevel: regimeSnapshot?.volatilityRegime,
        sessionContext: undefined, // Could add if available

        // Tracking
        userId: userId,
        sessionId: sessionId,
        scanAttemptId: undefined,

        // LLM metadata
        promptVersion: 'v2.0-geometry-reinforced',
        modelUsed: 'gpt-4o-mini',
        tokensUsed: undefined // Track if available
      });

      // No auto-correction of geometry errors. Block instead.
      if (geometryValidation.corrected) {
        console.error(`[Alpha Coordinator] GEOMETRY ERROR (would-be correction blocked): ${action} ${symbol} SL=${stopLoss?.toFixed(5)}, TP=${takeProfit?.toFixed(5)}`);
      }

      if (!geometryValidation.valid) {
        console.error(`[Alpha Coordinator] GEOMETRY ERROR: ${geometryValidation.errorMessage}`);
        console.error(`[Alpha Coordinator] ${action} trade: Entry=${entry.toFixed(5)}, SL=${stopLoss?.toFixed(5)}, TP=${takeProfit?.toFixed(5)}`);
        console.error(`[Alpha Coordinator] Expected: SL ${geometryValidation.expectedGeometry?.slSide}, TP ${geometryValidation.expectedGeometry?.tpSide}`);
        console.error(`[Alpha Coordinator] Error logged to alpha_geometry_errors: ${geometryValidation.errorLogId}`);

        logViolation({
          violationType: `ALPHA_${geometryValidation.errorType}`,
          symbol,
          attemptedOperation: 'parse_decision',
          callLocation: 'coordinator-alpha.parseDecision',
          blocked: true,
          errorDetails: {
            severity: geometryValidation.severity,
            action,
            direction: isBuy ? 'BUY' : 'SELL',
            entry,
            stopLoss,
            takeProfit,
            expectedGeometry: geometryValidation.expectedGeometry,
            errorMessage: geometryValidation.errorMessage,
            resolution: 'hard_blocked'
          }
        }).catch(error => {
          console.error('[Alpha Coordinator] Failed to log geometry violation to SSOT:', error);
        });

        return {
          action: 'NO_TRADE',
          decision: 'NO_TRADE',
          entry: currentPrice,
          stopLoss: currentPrice,
          takeProfit: currentPrice,
          confidence: 0,
          reasoning: `BLOCKED: ${geometryValidation.errorMessage}`,
          omega_summary: '',
          risk_pct: riskPct,
          narrativeValidation: narrativeValidation || undefined
        };
      }

      console.log(`[Alpha Coordinator] Geometry validation passed`);

      // Additional sanity check for minimum pip distance (< 5 pips survival minimum)
      const MIN_SURVIVAL_PIPS = 5;
      if (stopLoss) {
        const stopDistancePips = calculatePipDistance(symbol, entry, stopLoss);
        if (stopDistancePips < MIN_SURVIVAL_PIPS) {
          console.error(`[Alpha Coordinator] 🚨 Stop distance ${stopDistancePips.toFixed(1)} pips < ${MIN_SURVIVAL_PIPS} pips minimum`);
          return {
            action: 'NO_TRADE',
            decision: 'NO_TRADE',
            entry: currentPrice,
            stopLoss: currentPrice,
            takeProfit: currentPrice,
            confidence: 0,
            reasoning: `BLOCKED: Stop distance ${stopDistancePips.toFixed(1)} pips below ${MIN_SURVIVAL_PIPS} pip survival minimum`,
            omega_summary: '',
            risk_pct: riskPct,
            narrativeValidation: narrativeValidation || undefined
          };
        }
      }

      let slDistance = Math.abs(entry - stopLoss);
      let tpDistance = Math.abs(takeProfit - entry);
      let rr = slDistance > 0 ? tpDistance / slDistance : 0;
      let slPips = calculatePipDistance(symbol, entry, stopLoss);
      let tpPips = calculatePipDistance(symbol, entry, takeProfit);

      console.log(`[Alpha Decision] Stop: ${slPips.toFixed(1)} pips | TP: ${tpPips.toFixed(1)} pips | R:R: ${rr.toFixed(2)}:1`);

      // CCIP (2026-02-17): Envelope check is now DIAGNOSTIC ONLY (not blocking).
      // SSOT: Dual-arena wall check in coordinate() is the single validation authority.
      // The dual-arena walls already incorporate envelope bounds + noise floor.
      // This check logs discrepancies for monitoring but does NOT block trades.
      const envelopeAssetClass = getAssetClass(symbol) as EnvelopeAssetClass;
      const dynamicBounds = getAssetClassEnvelopeBounds(resolvedStyle, envelopeAssetClass, symbol, currentPrice);
      const envelopeValidation = validateTPSLAgainstEnvelope(resolvedStyle, tpPips, slPips, envelopeAssetClass, symbol, currentPrice);
      if (!envelopeValidation.valid) {
        console.warn(`[Alpha Envelope DIAGNOSTIC] ${envelopeValidation.violations.join('; ')} (non-blocking, dual-arena is SSOT)`);
      }

      // CCIP GOVERNANCE (2026-02-16): Alpha is SOLE AUTHORITY for TP placement.
      // System NEVER computes, overrides, or fallback-calculates TP values.
      // tp1ProbabilityCalculator call REMOVED - violated Alpha's decision authority.
      // All TP values come directly from Alpha's LLM response.
      let tp1Price: number | null = null;
      let tp1Reasoning: string | null = null;
      let tp2Price: number | null = null;
      let tp2Reasoning: string | null = null;

      if (tradeStyle === 'SCALP') {
        // SCALP: Alpha chose ONE target (takeProfit). This is TP1 (the sole target).
        tp1Price = takeProfit;
        tp1Reasoning = parsed.reasoning || `Alpha SCALP target at ${tpPips.toFixed(1)} pips`;
        tp2Price = null;
        tp2Reasoning = null;
        console.log(`[Alpha TP Authority] SCALP: Single target at ${tpPips.toFixed(1)} pips (${rr.toFixed(2)}:1 R:R)`);
      } else {
        const alphaTP1 = parsed.tp1;
        const minTP1RR = getMinTP1RRForStyle(tradeStyle);
        if (alphaTP1 != null && Number.isFinite(alphaTP1)) {
          tp1Price = alphaTP1;
          const tp1Pips = calculatePipDistance(symbol, entry, alphaTP1);
          const tp1Distance = Math.abs(alphaTP1 - entry);
          const tp1RR = slDistance > 0 ? tp1Distance / slDistance : 0;
          tp1Reasoning = `Alpha conservative target at ${tp1Pips.toFixed(1)} pips (${tp1RR.toFixed(2)}:1 R:R)`;
          console.log(`[Alpha TP Authority] ${tradeStyle}: TP1=${tp1Pips.toFixed(1)} pips (${tp1RR.toFixed(2)}:1) | TP2=${tpPips.toFixed(1)} pips (${rr.toFixed(2)}:1)`);

          // CCIP (2026-02-17): TP1 R:R check is DIAGNOSTIC ONLY.
          // SSOT: Dual-arena wall check in coordinate() is the single validation authority for TP1 pip distance.
          // The R:R hard block was removed because noise-floor-inflated SL values made the 1.5:1 minimum
          // structurally impossible -- TP1 (a partial-profit target) was required to exceed TP2.
          if (minTP1RR != null && tp1RR < minTP1RR) {
            console.warn(`[Alpha TP1 DIAGNOSTIC] TP1 R:R ${tp1RR.toFixed(2)}:1 below ${tradeStyle} advisory ${minTP1RR.toFixed(1)}:1 (TP1=${tp1Pips.toFixed(1)} pips, SL=${slPips.toFixed(1)} pips) — NOT blocking, dual-arena wall is SSOT`);
          }
        } else {
          console.log(`[Alpha TP Authority] ${tradeStyle}: No TP1 in response, using single TP at ${tpPips.toFixed(1)} pips`);
        }
        tp2Price = takeProfit;
        tp2Reasoning = `Alpha full target at ${tpPips.toFixed(1)} pips (${rr.toFixed(2)}:1 R:R)`;
      }

      return {
        action,
        decision: action,
        entry,
        stopLoss,
        takeProfit,
        tp1Price,
        tp1Confidence: tp1Price != null ? 80 : null,
        tp1Reasoning,
        tp2Price,
        tp2Reasoning,
        confidence: Math.round(Math.min(100, Math.max(0, adjustedConfidence))),
        reasoning: parsed.reasoning || 'No reasoning provided',
        omega_summary: '',
        resolvedStyle,
        risk_pct: riskPct, // SSOT: Always provide risk percentage
        thesis: thesis || undefined,
        style_intent: styleIntent || undefined,
        execution_preference: executionPreference || undefined,
        acceptable_profit_range: acceptableProfitRange || undefined,
        entry_mode: entryMode as 'EXECUTE_NOW' | 'WAIT_ENTRY' | 'WAIT_HIGHER_EDGE' | undefined,
        entry_spec: {
          entry_quality_score: entryQualityScore,
          entry_mode: entryMode,
          style: resolvedStyle,
        },
        narrativeValidation: narrativeValidation || undefined,
        entry_advisory: entryAdvisory || undefined
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[Alpha Coordinator] ❌ Parse error:', errorMsg);
      console.error('[Alpha Coordinator] Symbol:', symbol);
      console.error('[Alpha Coordinator] This is likely an LLM response formatting issue');

      return {
        action: 'NO_TRADE',
        decision: 'NO_TRADE',
        entry: currentPrice,
        stopLoss: currentPrice,
        takeProfit: currentPrice,
        confidence: 0,
        reasoning: `LLM response parse failed: ${errorMsg.substring(0, 100)}`,
        omega_summary: '',
        risk_pct: 1.0, // Default for error case
        narrativeValidation: undefined
      };
    }
  }

  /**
   * Build advisory context from Adversarial Detector and Regime Oracle
   *
   * CCIP CONTRACT (2026-02-24):
   * Exposes raw sensor observations only. Alpha is the sole authority
   * for interpreting these measurements into trading decisions.
   * No pre-synthesized verdicts, levels, or recommended actions.
   */
  private buildAdvisoryContext(adversarial?: AdversarialSignal, regime?: RegimeSnapshot): string {
    if (!adversarial && !regime) {
      return '';
    }

    const parts: string[] = ['\n📡 RAW SENSOR READINGS (Interpret and decide):'];

    if (adversarial) {
      parts.push(`\nAdversarial Detector (raw measurements):`);
      parts.push(`  Suspicion Score: ${adversarial.suspicion_score}/100`);
      parts.push(`  Whipsaw Flips (last 10 candles): ${adversarial.whipsaw_flip_count}`);
      parts.push(`  Avg Candle Range: ${adversarial.avg_candle_range.toFixed(5)}`);
      if (adversarial.patterns.length > 0) {
        parts.push(`  Observed Patterns: ${adversarial.patterns.join(', ')}`);
      }
      if (adversarial.stop_run_classification && adversarial.stop_run_classification.type !== 'none') {
        parts.push(`  Stop-Run Type: ${adversarial.stop_run_classification.type} (${adversarial.stop_run_classification.candles_ago} candles ago)`);
        parts.push(`  BOS Confirmed: ${adversarial.stop_run_classification.has_bos ? 'Yes' : 'No'}`);
        parts.push(`  Reasoning: ${adversarial.stop_run_classification.reasoning}`);
      }
    }

    if (regime) {
      parts.push(`\nRegime Oracle (raw observations):`);
      parts.push(`  Session: ${regime.session} | Open: ${regime.session_open} | ${regime.minutes_into_session}min in`);
      parts.push(`  Structure: ${regime.structure} | Bias: ${regime.market_bias}`);
      parts.push(`  Volatility Score: ${regime.volatility_score}/100`);
      parts.push(`  ATR State: ${regime.atr_compression ? 'compressed' : regime.atr_expansion ? 'expanding' : 'normal'}`);
      parts.push(`  Wick Risk: ${regime.wick_risk} | Spread Risk: ${regime.spread_risk}`);
      parts.push(`  Is Dead Zone: ${regime.is_dead_zone} | Session Overlap: ${regime.is_session_overlap}`);
      if (regime.trend_regime) {
        parts.push(`  Trend Strength: ${regime.trend_regime.trend_strength_score}/100`);
        parts.push(`  Structure Quality: ${regime.trend_regime.structure_quality}`);
        parts.push(`  EMA Alignment: ${regime.trend_regime.ema_alignment}`);
      }
      if (regime.volatility_regime) {
        parts.push(`  Avg Wick Size: ${regime.volatility_regime.avg_wick_size.toFixed(5)}`);
        parts.push(`  Volatility Trend: ${regime.volatility_regime.volatility_trend}`);
      }
      if (regime.reason) {
        parts.push(`  Oracle Note: ${regime.reason}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Build intelligence context from platform-wide learning
   *
   * CCIP CONTRACT (2026-02-24):
   * Exposes raw historical counts and measurements only.
   * Alpha is the sole authority for computing rates, drawing comparisons,
   * and deciding what these counts mean for the current trade.
   * No pre-synthesized win rates, recommendations, or actionable adjustments.
   */
  private buildIntelligenceContext(intelligence?: AlphaIntelligenceSnapshot | null, symbol?: string): string {
    if (!intelligence) {
      return '';
    }

    const parts: string[] = ['\n🧠 ALPHA INTELLIGENCE (Raw Historical Data — Interpret yourself):'];

    // Symbol-specific performance block (shown first, highest priority)
    if (symbol && intelligence.symbolIntelligence && intelligence.symbolIntelligence[symbol]) {
      const si = intelligence.symbolIntelligence[symbol];
      parts.push(`\n📍 YOUR RECORD ON ${symbol}:`);
      if (si.recentWinRate > 0) {
        parts.push(`  Recent win rate: ${si.recentWinRate.toFixed(0)}%`);
      }
      if (si.bestSessions && si.bestSessions.length > 0) {
        parts.push(`  Best sessions: ${si.bestSessions.join(', ')}`);
      }
      if (si.bestTimeframes && si.bestTimeframes.length > 0) {
        parts.push(`  Best timeframes: ${si.bestTimeframes.join(', ')}`);
      }
      if (si.avgSlippage > 0) {
        parts.push(`  Avg slippage on this pair: ${si.avgSlippage.toFixed(2)} pips — account for this in SL placement`);
      }
      parts.push(`  Volatility level: ${si.volatilityLevel}`);
    }

    if (intelligence.platformPatterns.topPerformingPatterns.length > 0 || intelligence.platformPatterns.failingPatterns.length > 0) {
      parts.push('\n📊 PATTERN HISTORY (Raw counts):');

      const topPatterns = intelligence.platformPatterns.topPerformingPatterns.slice(0, 3);
      if (topPatterns.length > 0) {
        parts.push('  High-performance patterns (platform-wide):');
        topPatterns.forEach(p => {
          parts.push(`    • ${p.patternId}: wins=${Math.round(p.winRate * p.sampleSize / 100)}/${p.sampleSize} trades, avg_R=${p.avgRMultiple.toFixed(2)}`);
        });
      }

      const failingPatterns = intelligence.platformPatterns.failingPatterns.slice(0, 3);
      if (failingPatterns.length > 0) {
        parts.push('  Low-performance patterns (platform-wide):');
        failingPatterns.forEach(p => {
          parts.push(`    • ${p.patternId}: wins=${Math.round(p.winRate * p.sampleSize / 100)}/${p.sampleSize} trades, avg_R=${p.avgRMultiple.toFixed(2)}`);
        });
      }
    }

    const calibrationKeys = Object.keys(intelligence.calibrationData);
    if (calibrationKeys.length > 0) {
      parts.push('\n🎯 CONFIDENCE CALIBRATION (Actual vs Predicted):');
      for (const [bucketStr, data] of Object.entries(intelligence.calibrationData)) {
        if (data.sampleSize >= 10) {
          const predicted = parseInt(bucketStr);
          const actual = data.actualWinRate;
          parts.push(`    • Predicted ${predicted}% confidence: actual wins=${Math.round(actual * data.sampleSize / 100)}/${data.sampleSize} (${actual.toFixed(0)}% actual)`);
        }
      }
    }

    if (intelligence.metaInsights.length > 0) {
      parts.push('\n💡 META INSIGHTS (Validated observations):');
      intelligence.metaInsights.slice(0, 3).forEach(insight => {
        if (insight.validated) {
          parts.push(`  [${insight.confidence}% confidence] ${insight.type}: ${insight.description}`);
        }
      });
    }

    if (intelligence.executionQuality.avgSlippage > 0) {
      parts.push(`\nExecution Quality:`);
      parts.push(`  Avg slippage: ${intelligence.executionQuality.avgSlippage.toFixed(2)} pips`);
      parts.push(`  SL hunting suspected: ${intelligence.executionQuality.slHuntingSuspected}`);
      parts.push(`  Recent rejections: ${intelligence.executionQuality.recentRejections}`);
    }

    if (intelligence.counterfactualInsights.sampleSize >= 5) {
      const cf = intelligence.counterfactualInsights;
      parts.push('\n🔄 COUNTERFACTUAL DATA (What-if counts):');
      if (cf.bestSlMultiplier !== null) {
        parts.push(`  Avg optimal SL multiplier: ${cf.bestSlMultiplier.toFixed(2)}x`);
      }
      if (cf.bestTpMultiplier !== null) {
        parts.push(`  Avg optimal TP multiplier: ${cf.bestTpMultiplier.toFixed(2)}x`);
      }
      parts.push(`  Trades where earlier exit was better: ${cf.earlyExitCount}/${cf.totalSampled}`);
      parts.push(`  Trades where holding longer was better: ${cf.holdLongerCount}/${cf.totalSampled}`);
      parts.push(`  Avg improvement potential: ${cf.avgImprovementPct.toFixed(1)}%`);
    }

    const zml = intelligence.zoneMetaLearning;
    const hasZoneData = Object.keys(zml.zoneTypeSuccessRates).length > 0 || zml.reachabilityRate > 0;
    if (hasZoneData) {
      parts.push('\n📍 ZONE DATA (Entry zone historical execution):');
      const successRates = Object.entries(zml.zoneTypeSuccessRates);
      if (successRates.length > 0) {
        successRates.forEach(([zoneType, rate]) => {
          parts.push(`    • ${zoneType}: ${(rate * 100).toFixed(0)}% execution rate`);
        });
      }
      if (zml.reachabilityRate > 0) {
        parts.push(`  Zone reachability: ${(zml.reachabilityRate * 100).toFixed(0)}% | Downgrade rate: ${(zml.downgradeRate * 100).toFixed(0)}%`);
      }
      const unreachable = Object.entries(zml.unreachableByRegime).filter(([, rate]) => rate > 0.3);
      if (unreachable.length > 0) {
        unreachable.forEach(([regime, rate]) => {
          parts.push(`    • ${regime}: ${(rate * 100).toFixed(0)}% unreachable historically`);
        });
      }
    }

    if (intelligence.tpCalibration) {
      parts.push('\n' + intelligence.tpCalibration);
    }

    const dm = intelligence.decisionMetrics;
    if (dm.totalDecisions >= 5) {
      parts.push('\n📈 DECISION HISTORY (Raw counts):');
      parts.push(`  Total decisions: ${dm.totalDecisions}`);
      parts.push(`  Wins: ${dm.totalWins} | Losses: ${dm.totalLosses}`);
      parts.push(`  Total profit R: ${dm.totalProfitR.toFixed(2)} | Total loss R: ${dm.totalLossR.toFixed(2)}`);
      if (dm.consensusResolved > 0) {
        parts.push(`  Resolved decisions: ${dm.consensusResolved} | Successful: ${dm.consensusSuccessful}`);
      }
    }

    const tp1 = intelligence.tp1Learning;
    if (tp1.totalTP1Events >= 3) {
      parts.push('\n🎯 TP1 DECISION DATA (Raw counts):');
      parts.push(`  Total TP1 events: ${tp1.totalTP1Events}`);
      parts.push(`  Close early: wins=${tp1.closeEarlyWins}/${tp1.closeEarlyTotal}, avg_pnl=$${tp1.avgPnlCloseEarly.toFixed(2)}`);
      parts.push(`  Hold to TP2: wins=${tp1.holdToTP2Wins}/${tp1.holdToTP2Total}, avg_pnl=$${tp1.avgPnlHoldToTP2.toFixed(2)}`);
    }

    if (intelligence.validatedInsights.length > 0) {
      parts.push('\n🔬 VALIDATED INSIGHTS:');
      intelligence.validatedInsights.slice(0, 3).forEach(insight => {
        parts.push(`  [${insight.confidence.toFixed(0)}% confidence, n=${insight.sampleSize}] ${insight.title}: ${insight.description}`);
        if (insight.winRate > 0 && insight.sampleSize >= 5) {
          parts.push(`    wins=${Math.round(insight.winRate * insight.sampleSize / 100)}/${insight.sampleSize}`);
        }
      });
    }

    if (intelligence.patternWeights && intelligence.patternWeights.length > 0) {
      const topPatterns = intelligence.patternWeights
        .filter(p => p.totalTrades >= 5)
        .sort((a, b) => b.advisoryWeight - a.advisoryWeight)
        .slice(0, 5);
      if (topPatterns.length > 0) {
        parts.push('\n⚖️ PATTERN ADVISORY WEIGHTS (historical win-rate derived):');
        topPatterns.forEach(p => {
          parts.push(`  ${p.patternId}: weight=${p.advisoryWeight.toFixed(2)} WR=${(p.winRate * 100).toFixed(0)}% (n=${p.totalTrades})`);
        });
      }
    }

    if (intelligence.slHuntCorrections && symbol && intelligence.slHuntCorrections[symbol]) {
      const hunt = intelligence.slHuntCorrections[symbol];
      if (hunt.totalSlHits >= 3 && hunt.huntRate >= 0.3) {
        parts.push(`\n⚠️ SL HUNT BIAS (${symbol}): Hunt rate=${(hunt.huntRate * 100).toFixed(0)}% across ${hunt.totalSlHits} SL hits.`);
        if (hunt.recommendedWidenPct > 0) {
          parts.push(`  RECOMMENDATION: Widen SL by ~${(hunt.recommendedWidenPct * 100).toFixed(0)}% to avoid premature stop-outs. (confidence=${(hunt.confidence * 100).toFixed(0)}%)`);
        }
      }
    }

    if (intelligence.sessionStreakState && intelligence.sessionStreakState.sessionTrades >= 2) {
      const streak = intelligence.sessionStreakState;
      parts.push(`\n📊 TODAY'S SESSION: ${streak.sessionTrades} trades | WR=${streak.sessionTrades > 0 ? ((streak.sessionWins / streak.sessionTrades) * 100).toFixed(0) : 0}% | PnL=${streak.sessionPnlR >= 0 ? '+' : ''}${streak.sessionPnlR.toFixed(2)}R`);
      if (streak.currentStreak >= 3 && streak.streakType === 'loss') {
        parts.push(`  ⚠️ LOSS STREAK: ${streak.currentStreak} consecutive losses today. Consider reducing size or pausing.`);
      } else if (streak.currentStreak >= 3 && streak.streakType === 'win') {
        parts.push(`  ✅ WIN STREAK: ${streak.currentStreak} consecutive wins today. Confidence validated.`);
      }
    }

    if (intelligence.tpDistributionStats && symbol) {
      const symStats = intelligence.tpDistributionStats[symbol];
      if (symStats) {
        const styleKeys = Object.keys(symStats).filter(k => symStats[k].totalTrades >= 5);
        if (styleKeys.length > 0) {
          parts.push(`\n📈 TP DISTRIBUTION (${symbol}):`);
          styleKeys.forEach(style => {
            const s = symStats[style];
            parts.push(`  ${style}: TP_full=${(s.tpFullRate * 100).toFixed(0)}% | TP1_only=${(s.tp1OnlyRate * 100).toFixed(0)}% | SL=${(s.slRate * 100).toFixed(0)}% (n=${s.totalTrades})`);
          });
        }
      }
    }

    if (intelligence.counterThesisAccuracy && symbol && intelligence.counterThesisAccuracy[symbol]) {
      const ct = intelligence.counterThesisAccuracy[symbol];
      if (ct.totalTrades >= 5) {
        const calibErr = (ct.calibrationError * 100).toFixed(0);
        parts.push(`\n🔍 COUNTER-THESIS CALIBRATION (${symbol}): Predicted failure=${(ct.avgPredictedFailureRate * 100).toFixed(0)}% | Actual failure=${(ct.actualFailureRate * 100).toFixed(0)}% | Error=${calibErr}% (n=${ct.totalTrades})`);
        if (ct.calibrationError > 0.2) {
          if (ct.avgPredictedFailureRate > ct.actualFailureRate) {
            parts.push(`  NOTE: Alpha is being overly cautious on ${symbol} — actual failure rate is lower than predicted.`);
          } else {
            parts.push(`  NOTE: Alpha is underestimating failure risk on ${symbol} — actual failure rate is higher than predicted.`);
          }
        }
      }
    }

    return parts.join('\n');
  }

  /**
   * CCIP 2026-02-17: Build Advanced Patterns Context
   * Priority 1 & 2 Upgrades: Regime Adaptations + Session Profiles + Liquidity Playbook
   *
   * This provides Alpha with context-aware guidance based on:
   * - Current regime type (trending, ranging, volatile, compressed)
   * - Current session (London open, NY open, overlap, dead zone, etc.)
   * - Liquidity positioning (pools above/below, clean zones)
   *
   * SSOT: All pattern definitions come from alpha-advanced-patterns.ts
   */
  private buildAdvancedPatternsContext(
    tradeStyle: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY',
    regimeSnapshot?: RegimeSnapshot,
    dailyNarrative?: DailyNarrative | null,
    omega8Vote?: Omega8Vote
  ): string {
    const parts: string[] = ['\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'];
    parts.push('🎯 ADVANCED CONTEXT-AWARE INTELLIGENCE');
    parts.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    try {
      // Regime Adaptation Context
      if (regimeSnapshot && regimeSnapshot.structure) {
        const regimeType = this.mapRegimeToType(regimeSnapshot.structure, regimeSnapshot.atr_compression, regimeSnapshot.atr_expansion);
        const adaptation = REGIME_STYLE_ADAPTATIONS[tradeStyle]?.[regimeType];

        if (adaptation) {
          parts.push(`\nREGIME ADAPTATION (${tradeStyle} in ${regimeType}):`);
          parts.push(`  Strategy: ${adaptation.strategy}`);
          parts.push(`  TP Target Range: ${adaptation.tp_target_range}`);
          parts.push(`  Entry Bias: ${adaptation.entry_bias}`);
          parts.push(`  Stop Adjustment: ${adaptation.stop_adjustment}`);
          if (adaptation.confidence_adjustment !== 0) {
            parts.push(`  Confidence Adjustment: ${adaptation.confidence_adjustment > 0 ? '+' : ''}${adaptation.confidence_adjustment}%`);
          }
          parts.push(`  Notes: ${adaptation.notes}`);
        }
      }

      // Session Behavior Profile
      if (dailyNarrative && dailyNarrative.currentSession) {
        const sessionProfiles = SESSION_PROFILES[tradeStyle];
        if (sessionProfiles) {
          const sessionName = this.mapSessionName(dailyNarrative.currentSession);
          const sessionProfile = Object.values(sessionProfiles).find(p => p.session === sessionName);

          if (sessionProfile) {
            parts.push(`\nSESSION PROFILE (${sessionProfile.session}):`);
            parts.push(`  Time: ${sessionProfile.time_utc} UTC`);
            parts.push(`  Characteristics: ${sessionProfile.characteristics}`);
            if ('typical_m5_leg' in sessionProfile) {
              parts.push(`  Typical Move: ${(sessionProfile as { typical_m5_leg: string }).typical_m5_leg}`);
            }
            parts.push(`  Strategy: ${sessionProfile.strategy}`);
            if (sessionProfile.confidence_adjustment !== 0) {
              parts.push(`  Confidence Adjustment: ${sessionProfile.confidence_adjustment > 0 ? '+' : ''}${sessionProfile.confidence_adjustment}%`);
            }
            parts.push(`  Notes: ${sessionProfile.notes}`);
          }
        }
      }

      // Liquidity Positioning Playbook
      if (omega8Vote && omega8Vote.liquidity_bias) {
        const liquidityPosition = this.determineLiquidityPosition(omega8Vote);
        const playbook = LIQUIDITY_PLAYBOOK[liquidityPosition];

        if (playbook) {
          parts.push(`\nLIQUIDITY PLAYBOOK (Position: ${liquidityPosition}):`);
          parts.push(`  Context: ${playbook.description}`);
          parts.push(`  Bullish View: ${playbook.bullish_interpretation}`);
          parts.push(`  Bearish View: ${playbook.bearish_interpretation}`);
          parts.push(`  Long Strategy: ${playbook.recommended_strategy.for_longs}`);
          parts.push(`  Short Strategy: ${playbook.recommended_strategy.for_shorts}`);
          parts.push(`  TP Placement: ${playbook.tp_placement}`);
          parts.push(`  Stop Placement: ${playbook.stop_placement}`);
        }
      }
    } catch (err) {
      // Non-blocking: advanced context is advisory only, Alpha must never be blocked
      console.warn('[Alpha] Advanced patterns context build failed (non-blocking):', err instanceof Error ? err.message : err);
    }

    parts.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return parts.join('\n');
  }

  private mapRegimeToType(
    structure: 'trend' | 'range' | 'accumulation' | 'distribution',
    atrCompression?: boolean,
    atrExpansion?: boolean,
  ): RegimeType {
    if (structure === 'trend') return 'TRENDING';
    if (structure === 'range') {
      if (atrCompression) return 'COMPRESSED';
      return 'RANGING';
    }
    if (structure === 'accumulation') return 'COMPRESSED';
    if (structure === 'distribution') {
      if (atrExpansion) return 'VOLATILE_EXPANSION';
      return 'RANGING';
    }
    return 'RANGING';
  }

  private mapSessionName(session: string): SessionName {
    const lower = session.toLowerCase();
    if (lower === 'overlap') return 'OVERLAP';
    if (lower === 'asian') return 'ASIA_CONSOLIDATION';
    if (lower === 'london') return 'LONDON_ACTIVE';
    if (lower === 'ny') return 'NY_OPEN';
    if (lower === 'closed') return 'DEAD_ZONE';
    if (lower.includes('london') && lower.includes('open')) return 'LONDON_OPEN';
    if (lower.includes('london')) return 'LONDON_ACTIVE';
    if (lower.includes('overlap')) return 'OVERLAP';
    if (lower.includes('afternoon')) return 'NY_AFTERNOON';
    if (lower.includes('lunch')) return 'NY_LUNCH';
    if (lower.includes('dead') || lower.includes('quiet')) return 'DEAD_ZONE';
    if (lower.includes('asia')) return 'ASIA_CONSOLIDATION';
    if (lower.includes('ny')) return 'NY_OPEN';
    return 'LONDON_ACTIVE';
  }

  private determineLiquidityPosition(omega8Vote: Omega8Vote): LiquidityPosition {
    const bias = omega8Vote.liquidity_bias;
    if (!bias) return 'DISPERSED';

    switch (bias) {
      case 'clean': return 'DISPERSED';
      case 'stoprun_risk': return 'AT_LEVEL';
      case 'stoprun_entry': return 'AT_LEVEL';
      case 'reaccumulation': return 'BELOW';
      case 'distribution': return 'ABOVE';
      default: return 'DISPERSED';
    }
  }

}

export const alphaCoordinator = new AlphaCoordinatorBrain();
