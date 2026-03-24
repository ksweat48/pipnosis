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
import { buildStreakContext } from '../services/ai-identity';
import { rewardEngine } from '../services/reward-engine';
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
import { dailyNarrativeBuilder, type DailyNarrative } from '../services/daily-narrative-builder';
import { multiSymbolRanker, type SymbolScore } from '../services/multi-symbol-ranker';
import { riskAwareStopCalculator, type StopLossCalculation, type SweepContext } from '../services/risk-aware-stop-calculator';
import { multiTimeframePatternIntelligence, type PatternIntelligenceResult } from '../services/multi-timeframe-pattern-intelligence';
import { patternLiquidityAdapter } from '../services/pattern-liquidity-adapter';
import { eliteProfitTargetCalculator, type LiquidityZone, type TPCalculationResult } from '../services/profit-target-calculator';
// tp1ProbabilityCalculator REMOVED (CCIP 2026-02-16): Alpha is sole TP authority
// System never computes TP values. All TP decisions come from Alpha's LLM response.
import { calculatePipDistance, getCurrencyPipInfo } from '../utils/currencyHelpers';
import { calculateEMA } from '../strategies/indicators';
import { EntryIntentClassifier } from '../services/entry-intent-classifier';
import { omega9ConstraintProvider } from '../services/omega9-constraint-provider';
// alphaRevisionHandler removed - dual-arena wall check replaces revision loop
import type { Omega9Constraints, DualArenaWalls } from '../types/omega9-constraints';
import { tradeExecutionFreshnessGate } from '../services/trade-execution-freshness-gate';
import { tradeFeasibilityResolver } from '../services/trade-feasibility-resolver';
import type { AssetClass, TradeStyle as FeasibilityTradeStyle } from '../types/trade-feasibility-resolver.types';
import { isCrypto, isIndex, isXAUUSD } from '../utils/currencyHelpers';
import type { ConflictInfo } from '../types/alpha-thesis';
import { calculateSessionContext } from '../utils/marketHours';
import type { EntrySpec, AlphaOutputFormat, StyleDisplayName } from '../types/entry';
import { ALPHA_IDENTITY, getAlphaSystemPromptForStyle, getEntryMode } from '../config/alpha-identity';
import { getDisplayNameFromStyle } from '../config/trade-styles';
import { getStylePromptContext } from '../config/style-personalities';
import { microRegimeClassifier, type MicroRegimeClassification, type MicroRegimeCandle } from '../services/micro-regime-classifier';
import { liquidityIntentAnalyzer, type LiquiditySweepFacts } from '../services/liquidity-intent-analyzer';
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
import { resolveCanonicalStyle } from '../config/timeframe-hierarchy';

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
  atr100?: number | ATRValue; // Long-period ATR for volatility regime detection (H4-scale reference, currently not populated)
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
  // CCIP-MULTI-TRADE-TOP-N: When true, the orchestrator must evaluate ALL symbols
  // (no early-exit) so the best-symbol-selector can rank and return top N.
  // SSOT: driven by goal_sessions.max_concurrent_trades > 1.
  multiTradeMode?: boolean;
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
  entry_mode?: 'execute_now' | 'wait_pullback' | 'push_confirmation'; // Promoted from entry_spec for execution routing — SSOT: EntryMode from alpha-identity.ts
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
    intent_mode?: 'pullback_to_zone' | 'push_confirmation_zone';
  };
  confidenceAdjustments?: Array<{
    source: string;
    proposedMultiplier: number;
    wasApplied: boolean;
    reason: string;
  }>;
  // Phase 1-4 Upgrades: Micro-regime, Liquidity Sweep Facts, Narrative Coherence
  microRegime?: MicroRegimeClassification;
  sweepFacts?: LiquiditySweepFacts;
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
  estimated_duration_minutes?: string | number;
  thesis_coherence_statement?: string;
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
    /**
     * @deprecated Use Q7_confluence_confirmed + Q7_confluence_judgment instead.
     * Retained for backward-compatibility with stored records from before CCIP-2026-0316A.
     */
    Q7_confluence_count?: string;
    /** X/7 — each confirmed dimension with the specific data point that confirms it */
    Q7_confluence_confirmed?: string;
    /** Alpha's self-determined threshold, confirmed count, and PROCEED/NO_TRADE decision */
    Q7_confluence_judgment?: string;
    Q8_move_position_pct: number;
    Q8B_session_range_pct: number;
    /**
     * Q8C: Price location zone within control TF range.
     * DISCOUNT (<38%) / EQUILIBRIUM (38-62%) / PREMIUM (>62%)
     */
    Q8C_price_location_zone?: string;
    /**
     * Q8D: Weekly narrative context.
     * DELIVERY_BULLISH / DELIVERY_BEARISH / REBALANCING / UNCERTAIN
     */
    Q8D_weekly_narrative?: string;
    /** Kill zone alignment at entry time */
    kill_zone?: string;
    /** News event status at entry time */
    news_status?: string;
    /** Equal highs/lows within 2x ATR — unswept liquidity pools */
    equal_highs_lows?: string;
    /** Trap signature assessment */
    trap_signature?: string;
    /** Failed auction assessment */
    failed_auction?: string;
    /** Intermarket correlation: CONFLUENT / DIVERGENT / UNKNOWN */
    intermarket_correlation?: string;
    /**
     * Q9: SL wick proximity self-check.
     * Alpha scans recent primary-timeframe wick extremes and states whether
     * his SL price is within 1 pip of any wick. This is advisory — Alpha
     * reasons about proximity risk and explains his placement.
     * Format: "CLEAR — nearest wick extreme at [price] is [X] pips from SL"
     *      or "PROXIMITY_RISK — SL at [price] is [X] pips from wick at [price]. [reasoning]"
     */
    Q9_sl_wick_proximity?: string;
    /**
     * Q10: Entry conviction self-rating — SCALP ONLY.
     *
     * CCIP-2026-0323A: Independent of trade_confidence. Assesses whether THIS SPECIFIC
     * ENTRY MOMENT is well-timed within the identified structure.
     * SNIPER = exact anchor + trigger fired.
     * ACCEPTABLE = valid but not ideal — justification required in trader_statement.
     * FORCED = timing wrong — execute_now PROHIBITED, must use wait_pullback/push_confirmation.
     *
     * SSOT: alpha-identity.ts is the authoritative definition. This interface mirrors it.
     */
    Q10_entry_conviction?: 'SNIPER' | 'ACCEPTABLE' | 'FORCED';
    /**
     * Q11: Zone entry quality self-rating — MICRO_INTRADAY and INTRADAY ONLY.
     *
     * CCIP-2026-0323B: Independent of trade_confidence. Assesses whether Alpha is entering
     * at the STRUCTURALLY OPTIMAL POSITION within the M15/H1 structural zone.
     * PRECISE = near edge of zone — best RR preservation, highest structural clarity.
     * MID_ZONE = mid-zone — valid but SL/RR must reflect the consumed structural buffer.
     * DEEP_ZONE = far edge of zone, near invalidation — execute_now PROHIBITED, must use
     *   wait_pullback or push_confirmation targeting the near zone edge.
     *
     * SSOT: alpha-identity.ts is the authoritative definition. This interface mirrors it.
     */
    Q11_zone_entry_quality?: 'PRECISE' | 'MID_ZONE' | 'DEEP_ZONE';
    /**
     * liquidity_sweep_read: Alpha's structured sweep analysis.
     * MANDATORY when sweep sensor data was present in the briefing (sweepFacts.sweep_detected).
     * Contains: wick quality, BOS impact, recency judgment, volume ratio interpretation,
     * and net edge judgment. Value "NONE" means no sweep data was provided.
     *
     * CCIP-2026-0324C: Missing when sweep data was present is a governance violation.
     * SSOT: alpha-identity.ts defines the mandatory format. coordinator-alpha.ts enforces presence.
     */
    liquidity_sweep_read?: string;
  };
  // CCIP-2026-0321A: Alpha-owned entry deviation tolerance.
  // Max pips the live fill may drift from Alpha's planned entry before the setup is
  // cancelled outright (no trade placed, no rescan). Alpha states this per-trade based
  // on pair speed and structural precision of the entry. System never computes or overrides it.
  max_entry_deviation_pips?: number;
  /**
   * trader_statement: Alpha's 80+ word human-readable trade narrative.
   * MANDATORY in the output schema. Extracted for audit trail and UI display.
   * Validated post-LLM: short or missing statements are flagged as governance violations.
   *
   * CCIP-2026-0324G: coordinator-alpha.ts is the SSOT for extraction and enforcement.
   */
  trader_statement?: string;
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

/**
 * CCIP-2026-03-15: Parse Alpha's own estimated_duration_minutes output.
 * Alpha's field may be a number (e.g. 35) or a descriptive string (e.g. "20-35 minutes based on M5 ATR...").
 * Extract the first numeric value found. Alpha is SSOT for duration — no system calculation.
 */
function parseAlphaDurationMinutes(raw: string | number | undefined): number {
  if (!raw) return 0;
  if (typeof raw === 'number') return raw > 0 ? raw : 0;
  const match = String(raw).match(/(\d+(?:\.\d+)?)/);
  if (match) return parseFloat(match[1]);
  return 0;
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

    // CCIP-STYLE-TF-2026: Use SSOT resolver from timeframe-hierarchy.ts (single alias map for entire system)
    const tradeStyle = resolveCanonicalStyle(goalContext?.tradeStyle, 'SCALP');

    if (!goalContext?.tradeStyle) {
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
    // Load platform streak context (non-blocking, advisory only)
    let streakContextLine = 'Platform streak context: no active streak. Confidence adjustment: 0%.';
    try {
      const platformScore = await rewardEngine.loadPlatformScore();
      streakContextLine = buildStreakContext(platformScore);
    } catch { /* Non-blocking — streak context is advisory only */ }

    }

    // Load platform streak context (advisory — non-blocking)
    let streakContextLine = 'Platform streak context: no active streak. Confidence adjustment: 0%.';
    try {
      const platformScore = await rewardEngine.loadPlatformScore();
      streakContextLine = buildStreakContext(platformScore);
    } catch {
      // Non-blocking — default to neutral
    }

    // Parallelize all independent data fetches (bidirectional for dual-arena)
    // CCIP-TIMEOUT-FIX-2026-03-12: Symbol trade history query moved INTO this Promise.all
    // to eliminate a sequential Supabase round-trip that previously blocked pre-LLM setup.
    // All 6 fetches are independent — they share no data dependencies with each other.
    // CCIP-2026-0322A: Fetch entry monitor status in parallel with other data sources.
    // Alpha must know the live monitor state BEFORE reasoning about entry_mode so he can
    // make a fully informed choice between execute_now, wait_pullback, and push_confirmation
    // without conservative bias toward execute_now. SSOT: coordinator-alpha.ts owns this fetch.
    const [, dailyNarrative, riskResultLong, riskResultShort, rrResult, symbolTradesRaw, monitorPrefRaw] = await Promise.all([
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
        .catch(err => { console.error('[Alpha Coordinator] Failed to fetch R:R performance:', err); return null; }) : Promise.resolve(null),
      userId ? supabase
        .from('ai_trade_analysis')
        .select('outcome, pnl, exit_reason, direction, key_learnings, mistakes_identified, what_worked, what_failed, entry_confidence, entry_time')
        .eq('user_id', userId)
        .eq('symbol', marketContext.symbol)
        .order('entry_time', { ascending: false })
        .limit(20)
        .then(({ data }) => data)
        .catch(err => { console.error('[Alpha Coordinator] Failed to fetch symbol diagnostic context:', err); return null; }) : Promise.resolve(null),
      userId ? supabase
        .from('user_monitor_preferences')
        .select('entry_price_monitor_enabled')
        .eq('user_id', userId)
        .maybeSingle()
        .then(({ data }) => data)
        .catch(() => null) : Promise.resolve(null)
    ]);

    // CCIP-2026-0322A: Resolve monitor status from parallel fetch.
    // This is injected into the prompt so Alpha knows exactly whether wait modes are available
    // before he reasons about entry_mode. Default to false (safe: deny wait if unreadable).
    const entryMonitorActive = monitorPrefRaw?.entry_price_monitor_enabled === true;
    const entryMonitorStatusLine = entryMonitorActive
      ? 'Entry monitor status: ACTIVE — "wait_pullback" and "push_confirmation" are available.'
      : 'Entry monitor status: OFFLINE — "wait_pullback" and "push_confirmation" are UNAVAILABLE. Use "execute_now" or NO_TRADE only.';

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

    // CCIP-2026-0324A: Regime-Location Conflict Advisory
    // Computed deterministically from regime data before Alpha sees candles.
    // Injected as a named advisory Alpha must address in thesis_coherence_statement.
    // This is informational — it does not block any trade. It ensures Alpha cannot
    // silently proceed on a location conflict without naming the override reason.
    let regimeLocationConflictAdvisory = '';
    {
      const regimeCategory = marketContext.regime || regimeSnapshot?.currentRegime || regimeSnapshot?.category || '';
      const currentPx = marketContext.price;
      const swingHigh = briefing?.intelligence?.swingHigh;
      const swingLow = briefing?.intelligence?.swingLow;
      if (swingHigh && swingLow && swingHigh > swingLow) {
        const rangeSize = swingHigh - swingLow;
        const positionInRange = (currentPx - swingLow) / rangeSize;
        const locationZone = positionInRange > 0.62 ? 'PREMIUM' : positionInRange < 0.38 ? 'DISCOUNT' : 'EQUILIBRIUM';
        const positionPct = Math.round(positionInRange * 100);
        const conflictAdvisories: string[] = [];
        if (locationZone === 'PREMIUM') {
          conflictAdvisories.push(`LOCATION ADVISORY: Price is at ${positionPct}% of the swing range (swing H: ${swingHigh}, swing L: ${swingLow}) — PREMIUM zone. A BUY here is trading against location. To proceed on a BUY, thesis_coherence_statement MUST name the specific structural override: sweep above swing highs, confirmed liquidity grab, or BOS in BUY direction. Restating direction without naming the override is insufficient.`);
        } else if (locationZone === 'DISCOUNT') {
          conflictAdvisories.push(`LOCATION ADVISORY: Price is at ${positionPct}% of the swing range (swing H: ${swingHigh}, swing L: ${swingLow}) — DISCOUNT zone. A SELL here is trading against location. To proceed on a SELL, thesis_coherence_statement MUST name the specific structural override: sweep below swing lows, confirmed liquidity grab, or BOS in SELL direction. Restating direction without naming the override is insufficient.`);
        }
        if (regimeCategory && (regimeCategory.toLowerCase().includes('range') || regimeCategory.toLowerCase().includes('chop') || regimeCategory.toLowerCase().includes('side'))) {
          conflictAdvisories.push(`REGIME ADVISORY: Market regime is ${regimeCategory.toUpperCase()}. Momentum continuation trades in a ranging/choppy regime require named evidence that the range boundary is breaking with committed volume — otherwise mean-reversion thesis is structurally favoured.`);
        }
        if (conflictAdvisories.length > 0) {
          regimeLocationConflictAdvisory = `\nPRE-ANALYSIS CONFLICT ADVISORIES (resolve these in thesis_coherence_statement before finalising your action):\n${conflictAdvisories.join('\n')}\n`;
        }
      } else {
        // CCIP-2026-0324F: Swing data unavailable — inject fallback location advisory.
        // When swingHigh/swingLow are absent (data gap or intelligence miss), the regime-location
        // conflict advisory is silently skipped. Alpha receives no location context and Q8C
        // is computed entirely from its own candle read with no external anchor.
        // This fallback note ensures Alpha is aware of the data gap and uses EMA structure
        // or recent pivot extremes as a substitute location reference. It does not block execution.
        regimeLocationConflictAdvisory = `\nLOCATION CONTEXT NOTE: Swing high/low data is unavailable for this scan cycle — no external range anchor can be computed. ` +
          `Derive Q8C (DISCOUNT/EQUILIBRIUM/PREMIUM) from the recent pivot structure visible in the candle data: ` +
          `identify the most recent confirmed swing high and swing low manually, compute price position, and state your boundaries explicitly. ` +
          `Do not leave Q8C as UNCERTAIN when candle data is present — a structural read from candles is sufficient.\n`;
      }
    }

    // Build advisory context (Adversarial Detector + Regime Oracle)
    let advisoryContext = this.buildAdvisoryContext(adversarialSignal, regimeSnapshot);

    // CCIP 2026-02-17: Build Advanced Patterns Context (Priority 1 & 2 Upgrades)
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
    // CCIP-TIMEOUT-FIX-2026-03-12: symbolTradesRaw was fetched in parallel above — no await needed here.
    let recentTradesContext = '';
    if (userId) {
      try {
        const symbol = marketContext.symbol;
        const symbolTrades = symbolTradesRaw;

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

    // Build daily context — raw measurements only (CCIP-2026-03-20)
    // No bias labels, no strategy guidance, no directional implications.
    let dailyNarrativeContext = '';
    if (dailyNarrative) {
      dailyNarrativeContext = `\nDAILY CONTEXT (raw measurements):\n`;
      dailyNarrativeContext += `Daily high: ${dailyNarrative.dailyHigh} | Daily low: ${dailyNarrative.dailyLow} | Daily open: ${dailyNarrative.dailyOpen}\n`;
      dailyNarrativeContext += `Daily range: ${dailyNarrative.dailyRange.toFixed(1)} pips | Price position in range: ${dailyNarrative.rangePosition.toFixed(0)}% (0=low end, 100=high end)\n`;
      dailyNarrativeContext += `Total daily displacement: ${dailyNarrative.dailyDisplacement.toFixed(1)} pips | Structure: ${dailyNarrative.structureQuality}\n`;
      dailyNarrativeContext += `Current session: ${dailyNarrative.currentSession}\n`;
      if (dailyNarrative.asianRange) {
        dailyNarrativeContext += `Asian session range: high=${dailyNarrative.asianRange.high} low=${dailyNarrative.asianRange.low}\n`;
      }
      if (dailyNarrative.liquiditySweeps.asianLowSwept) {
        dailyNarrativeContext += `Observation: Asian session low has been traded through\n`;
      }
      if (dailyNarrative.liquiditySweeps.asianHighSwept) {
        dailyNarrativeContext += `Observation: Asian session high has been traded through\n`;
      }
      if (dailyNarrative.liquiditySweeps.dailyHighTested) {
        dailyNarrativeContext += `Observation: Current daily high is being tested\n`;
      }
      if (dailyNarrative.liquiditySweeps.dailyLowTested) {
        dailyNarrativeContext += `Observation: Current daily low is being tested\n`;
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
    // PHASE 2: LIQUIDITY SWEEP FACT EXTRACTION
    //
    // CCIP-2026-0320-LIA: This phase extracts raw measurable facts from
    // Omega-8 sweep detection. No verdicts, no interpretations, no guidance.
    // Alpha reads the sensor output and draws his own conclusions.
    // ═══════════════════════════════════════════════════════════════════
    let sweepFacts: LiquiditySweepFacts | null = null;
    let liquidityIntentContext = '';

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

        sweepFacts = liquidityIntentAnalyzer.extractSweepFacts(
          votes.omega8.patterns,
          omega8Candles,
          votes.omega8.sweep_details
        );

        if (sweepFacts.sweep_detected) {
          const priceDecimals = marketContext.price > 100 ? 2 : 5;
          console.log(`[Alpha Coordinator] Sweep facts extracted: ${sweepFacts.sweep_type.toUpperCase()} sweep | extreme @ ${sweepFacts.sweep_extreme_price.toFixed(priceDecimals)} | BOS:${sweepFacts.has_bos} | ${sweepFacts.candles_since_sweep} candles ago | wick:body ${sweepFacts.wick_to_body_ratio.toFixed(2)} | vol ratio ${sweepFacts.volume_ratio.toFixed(2)}x`);

          liquidityIntentContext = `\nLIQUIDITY SWEEP SENSOR DATA (Omega-8 observation — raw measurements only):\n`;
          liquidityIntentContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          liquidityIntentContext += `Sweep type: ${sweepFacts.sweep_type.toUpperCase()} sweep\n`;
          liquidityIntentContext += `Candles since sweep: ${sweepFacts.candles_since_sweep}\n`;
          liquidityIntentContext += `Sweep wick extreme: ${sweepFacts.sweep_extreme_price.toFixed(priceDecimals)}\n`;
          if (sweepFacts.nearest_cluster_price) {
            liquidityIntentContext += `Nearest equal-${sweepFacts.sweep_type}s cluster: ${sweepFacts.nearest_cluster_price.toFixed(priceDecimals)}\n`;
          }
          liquidityIntentContext += `BOS confirmed post-sweep: ${sweepFacts.has_bos ? 'YES' : 'NO'}\n`;
          liquidityIntentContext += `Sweep candle wick-to-body ratio: ${sweepFacts.wick_to_body_ratio.toFixed(2)}x (${sweepFacts.wick_to_body_ratio >= 2 ? 'strong wick — aggressive liquidity take' : sweepFacts.wick_to_body_ratio >= 1 ? 'moderate wick' : 'shallow wick'})\n`;
          liquidityIntentContext += `Sweep candle volume vs average: ${sweepFacts.volume_ratio > 0 ? sweepFacts.volume_ratio.toFixed(2) + 'x average' : 'no volume data'}\n`;
          liquidityIntentContext += `Equal-highs clusters swept: ${sweepFacts.equal_highs_count}\n`;
          liquidityIntentContext += `Equal-lows clusters swept: ${sweepFacts.equal_lows_count}\n`;
          liquidityIntentContext += `FVG present in sweep direction: ${sweepFacts.fvg_present_in_sweep_direction ? 'YES' : 'NO'}\n`;
          liquidityIntentContext += `Stop anchor: repositioned beyond sweep extreme (stop calculator — see SL anchor block below)\n`;
          liquidityIntentContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          liquidityIntentContext += `Note: The above are sensor readings. You interpret what this sweep means — direction, timing, and stop placement are your judgment.\n`;
        }
      } catch (error) {
        console.error('[Alpha Coordinator] Failed to extract sweep facts:', error);
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
          tradeStyle,
          baseConfidence: 55,
          tradeDirection,
          liquidityIntentConfirms: sweepFacts ? sweepFacts.sweep_detected && sweepFacts.has_bos : false,
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

        // CCIP 2026-03: Hard gate — Alpha requires all three MTF layers to reason correctly.
        // If any layer is below minimum, log the gap. The gate below enforces this.
        const dc = patternIntelligence.dataCompleteness;
        if (!dc.htfComplete || !dc.mtfComplete || !dc.ltfComplete) {
          const missingLayers: string[] = [];
          if (!dc.htfComplete) missingLayers.push(`HTF ${dc.htfTimeframe} (${dc.htfCandles} candles)`);
          if (!dc.mtfComplete) missingLayers.push(`MTF ${dc.mtfTimeframe} (${dc.mtfCandles} candles)`);
          if (!dc.ltfComplete) missingLayers.push(`LTF ${dc.ltfTimeframe} (${dc.ltfCandles} candles)`);
          console.error(`[Alpha Coordinator] MTF_PATTERN_DATA_INCOMPLETE: ${missingLayers.join(', ')}`);
        }

      } catch (error) {
        console.error('[Alpha Coordinator] Failed to analyze patterns:', error);
      }
    }

    // CCIP 2026-03: MTF data gate — Alpha cannot reason about structure without candle data.
    // patternIntelligence === null means the entire PHASE 5 threw (e.g., DB outage).
    // Incomplete layers in dataCompleteness mean retries failed to fill the required minimum.
    if (patternIntelligence === null) {
      console.error('[Alpha Coordinator] MTF_PATTERN_FETCH_FAILED: Pattern analysis returned null — NO_TRADE');
      return {
        action: 'NO_TRADE',
        decision: 'NO_TRADE',
        entry: marketContext.price,
        stopLoss: marketContext.price,
        takeProfit: marketContext.price,
        confidence: 0,
        reasoning: 'MTF_PATTERN_FETCH_FAILED: Multi-timeframe pattern analysis could not complete. Cannot assess structural alignment without HTF/MTF/LTF candle data.',
      };
    }
    {
      const dc = patternIntelligence.dataCompleteness;
      if (!dc.htfComplete && !dc.mtfComplete) {
        console.error('[Alpha Coordinator] MTF_PATTERN_DATA_ABSENT: Both HTF and MTF layers have insufficient data — NO_TRADE');
        return {
          action: 'NO_TRADE',
          decision: 'NO_TRADE',
          entry: marketContext.price,
          stopLoss: marketContext.price,
          takeProfit: marketContext.price,
          confidence: 0,
          reasoning: `MTF_PATTERN_DATA_ABSENT: HTF (${dc.htfTimeframe}: ${dc.htfCandles} candles) and MTF (${dc.mtfTimeframe}: ${dc.mtfCandles} candles) data insufficient. Alpha requires structural context to assess trade validity.`,
        };
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
    // CCIP-FIX: sweepContextForStop declared at function scope so it is accessible
    // inside the sweepZoneDirective closure at line ~1222, outside the stop-calc block.
    let sweepContextForStop: SweepContext | undefined;
    // CCIP-FIX: Hoisted to function scope — referenced in ATR legend at line ~2236/2249/2252-2254,
    // which is outside the stop-calc block { } that closes at line ~1058.
    let atrForStopLoss: number = 0;
    let preferredAtrField: string = 'atr';
    {
      if (sessionId && userId) {
        alphaThoughtStream.emitAlphaStopCalculation(sessionId, userId, marketContext.symbol).catch(err => {
          console.warn('[Alpha Coordinator] Failed to emit stop calculation thought:', err);
        });
      }
      const entryPrice = marketContext.price;

      // CCIP 2026-03: Style-differentiated ATR timeframe for SL width.
      // SCALP → M5 ATR (atr20), MICRO_INTRADAY → M15 ATR (atr), INTRADAY → M15 ATR (atr).
      // Note: atr100 (long-period H4-based) is not populated in marketContext and is therefore
      // not usable for stop sizing. INTRADAY uses the same M15 ATR field as MICRO_INTRADAY as
      // the baseline stop reference. The intradayMovePhaseContext block further refines move stage
      // diagnosis using H1 candle-derived ATR (atrForStopLoss recalculated from H1 OHLC data).
      const styleAtrMap: Record<string, 'atr20' | 'atr'> = {
        SCALP: 'atr20',
        MICRO_INTRADAY: 'atr',
        INTRADAY: 'atr',
      };
      preferredAtrField = styleAtrMap[tradeStyle] ?? 'atr';
      const preferredAtrRaw = marketContext[preferredAtrField as keyof typeof marketContext] as number | import('../types/atr').ATRValue | undefined;
      const preferredAtrValue = extractATRValue(preferredAtrRaw);

      if (preferredAtrValue > 0) {
        atrForStopLoss = preferredAtrValue;
        const preferredTf = extractATRTimeframe(preferredAtrRaw);
        console.log(`[Alpha Coordinator] [Stop ATR Selection] ${tradeStyle}: using ${preferredAtrField} ATR=${atrForStopLoss.toFixed(5)}${preferredTf ? ` (${preferredTf})` : ''}`);
      } else {
        atrForStopLoss = extractATRValue(marketContext.atr);
        console.warn(`[Alpha Coordinator] [Stop ATR Selection] ${tradeStyle}: preferred ATR field ${preferredAtrField} unavailable — falling back to marketContext.atr`);
      }
      logATRUsage('Stop-Loss calculation', marketContext.atr);

      // Build sweep context from Omega-8 for sweep-aware stop placement (SSOT)
      // Applies to all 3 trade styles: SCALP, MICRO_INTRADAY, INTRADAY
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

      // CCIP-2026-03-18 ALPHA AUTHORITY: The sweep calculator may return a repositioned
      // anchor (sweepAwareAdjustment.applied = true). This anchor is presented to Alpha
      // as a RECOMMENDATION — Alpha retains full placement authority. Logged for
      // governance diagnostics only. No coordinator-side enforcement occurs.
      if (buyStopAnchor.sweepAwareAdjustment?.applied) {
        console.log(`[Alpha Coordinator] [SL Anchor Advisory] BUY sweep-informed anchor: ATR ${buyStopAnchor.sweepAwareAdjustment.originalStopPips.toFixed(1)}p → sweep-clear ${buyStopAnchor.stopLossPips.toFixed(1)}p (extreme @ ${buyStopAnchor.sweepAwareAdjustment.sweepExtremePrice.toFixed(5)}). Presented as advisory to Alpha.`);
      }
      if (sellStopAnchor.sweepAwareAdjustment?.applied) {
        console.log(`[Alpha Coordinator] [SL Anchor Advisory] SELL sweep-informed anchor: ATR ${sellStopAnchor.sweepAwareAdjustment.originalStopPips.toFixed(1)}p → sweep-clear ${sellStopAnchor.stopLossPips.toFixed(1)}p (extreme @ ${sellStopAnchor.sweepAwareAdjustment.sweepExtremePrice.toFixed(5)}). Presented as advisory to Alpha.`);
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
      //
      // CCIP-2026-03-10: Pass calibratedEnvelopeTpMinPips from WallCalibrationEngine
      // so omega9ConstraintProvider uses the regime-adjusted floor instead of the
      // raw envelope minimum. This prevents zero-width corridors during low-vol sessions.
      const calibratedResolvedPlan = {
        slMinPercent: resolvedPlan?.sl.minPercent,
        tpMaxAtrMultiple: resolvedPlan?.tp.maxAtrMultiple ?? wallCalibration.calibratedResolvedPlan.tpMaxAtrMultiple,
        minRR: resolvedPlan?.rr.min,
        calibratedEnvelopeTpMinPips: wallCalibration.calibratedResolvedPlan.calibratedEnvelopeTpMinPips,
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

    const styleIdentityPrompt = tradeStyle === 'SCALP'
      ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STYLE IDENTITY: SCALP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are operating as a M5 SCALP trader.
Timeframe stack: M5 (primary) | M1 (timing refinement) | M15/H1 (advisory context only).
You MUST name the specific M5 structural level you are trading from in scalp_structural_confirmation.
Format: "[structure type] at [exact price] — [what confirms it]". Example: "M5 BOS at 1.08230 confirmed long bias".
If you cannot identify and name a specific M5 anchor with a price, output NO_TRADE — a scalp without a structural anchor has no edge.
You MUST output scalp_momentum_phase (starting|developing|exhausted) and scalp_atr_traveled in your JSON response.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`
      : tradeStyle === 'MICRO_INTRADAY'
      ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STYLE IDENTITY: MICRO_INTRADAY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are operating as a M15 MICRO_INTRADAY trader. TP1 targets a conservative M15 structural level. TP2 targets an H1 structural level.
Timeframe stack: M15 (primary) | M5 (entry trigger confirmation) | H1 (campaign bias) | D1 (macro direction).
You MUST name the specific M15 structural level you are trading from in m15_structural_confirmation.
You MUST output m15_move_phase (fresh|developing|exhausted) and m15_atr_traveled in your JSON response.
The M5 sub-confirmation block below shows whether a closed M5 body in your direction has formed — use it to determine execute_now vs wait_pullback.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`
      : tradeStyle === 'INTRADAY'
      ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STYLE IDENTITY: INTRADAY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are operating as an H1 INTRADAY trader. TP1 targets a conservative H1 structural level. TP2 targets an H4 structural level.
Timeframe stack: H1 (primary) | M15 (precision entry layer) | H4 (campaign bias) | D1 (macro direction).
You MUST name the specific H1 structural level you are trading from in h1_structural_confirmation.
You MUST output h1_move_phase (fresh|developing|exhausted) and h1_atr_traveled in your JSON response.
You MUST provide a trade_management object defining your TP1/TP2 handling and trailing method.
The M15 precision entry block below shows whether a closed M15 body in your direction has formed at the H1 entry zone — use it to determine execute_now vs wait_pullback.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`
      : '';

    if (buyStopAnchor && sellStopAnchor) {
      const pipInfo = getCurrencyPipInfo(marketContext.symbol);
      const atrPips = (extractATRValue(marketContext.atr) / pipInfo.pipValue).toFixed(1);
      const wallSlMin = dualArenaWalls ? Math.min(dualArenaWalls.long.slPips.min, dualArenaWalls.short.slPips.min) : buyStopAnchor.profileMinPips;
      const wallSlMax = dualArenaWalls ? Math.max(dualArenaWalls.long.slPips.max, dualArenaWalls.short.slPips.max) : buyStopAnchor.profileMaxPips;
      const wallTpMin = dualArenaWalls ? Math.min(dualArenaWalls.long.tpPips.min, dualArenaWalls.short.tpPips.min) : 0;
      const wallTpMax = dualArenaWalls ? Math.max(dualArenaWalls.long.tpPips.max, dualArenaWalls.short.tpPips.max) : 999;

      // CCIP-2026-03-18 ALPHA AUTHORITY: SL anchors are presented to Alpha as-is from the
      // stop calculator. The coordinator MUST NOT pre-modify anchor values to comply with
      // wall minimums. If the ATR-derived anchor is below the wall minimum that is
      // information Alpha can see and act on — not a pre-decision correction.
      // Accountability requires Alpha's SL to be exactly what Alpha chose,
      // not what the coordinator silently lifted it to before Alpha saw the data.
      const buyAnchorPips = buyStopAnchor.stopLossPips;
      const buyAnchorPrice = buyStopAnchor.stopLossPrice;
      const sellAnchorPips = sellStopAnchor.stopLossPips;
      const sellAnchorPrice = sellStopAnchor.stopLossPrice;

      const sweepZoneDirective = (() => {
        const pipInfo = getCurrencyPipInfo(marketContext.symbol);
        const buyAdj = buyStopAnchor.sweepAwareAdjustment;
        const sellAdj = sellStopAnchor.sweepAwareAdjustment;
        const adj = buyAdj?.applied ? buyAdj : (sellAdj?.applied ? sellAdj : null);

        // Aligned sweep adjustment (anchor was computed beyond sweep extreme)
        let alignedSweepText = '';
        if (adj && sweepContextForStop) {
          const sweepTypeLabel = sweepContextForStop.type === 'low' ? 'LOW SWEEP' : 'HIGH SWEEP';
          const candlesLabel = sweepContextForStop.candles_ago === 0 ? 'just now' : `${sweepContextForStop.candles_ago} candle(s) ago`;
          const bosLabel = sweepContextForStop.has_bos ? 'BOS CONFIRMED' : 'awaiting BOS';
          const bufferPips = adj.bufferPips;
          const sweepPrice = adj.sweepExtremePrice;
          const clearanceBuy = (sweepPrice - bufferPips * pipInfo.pipValue).toFixed(5);
          const clearanceSell = (sweepPrice + bufferPips * pipInfo.pipValue).toFixed(5);
          alignedSweepText = `
SWEEP ZONE ADVISORY (${tradeStyle}): ${sweepTypeLabel} confirmed ${candlesLabel} [${bosLabel}]. Sweep extreme: ${sweepPrice.toFixed(5)}.
The SL anchor above was computed to clear the swept zone (buffer: ${bufferPips.toFixed(1)} pips). You retain full SL placement authority.
  - If LONG: structural best practice places SL below ${clearanceBuy} (sweep extreme minus buffer).
  - If SHORT: structural best practice places SL above ${clearanceSell} (sweep extreme plus buffer).
A stop inside the swept zone risks a liquidity-driven stopout. Factor this into your structural assessment.`;
        }

        // Cross-direction cluster proximity advisory (stop NOT adjusted — data for Alpha's reasoning)
        // CCIP-2026-0310-OMEGA8-BIDIRECTIONAL: Omega-8 saw a sweep in the opposite direction
        // and its cluster price is within proximity of the calculated SL anchor. This is advisory
        // data only — Alpha must reason about whether his SL sits in a liquidity magnet zone.
        const buyCross = buyStopAnchor.crossDirectionClusterWarning;
        const sellCross = sellStopAnchor.crossDirectionClusterWarning;
        const cross = buyCross ?? sellCross;
        let crossDirectionText = '';
        if (cross) {
          const sweepLabel = cross.sweepType === 'high' ? 'HIGH SWEEP' : 'LOW SWEEP';
          const dirLabel = cross.direction === 'buy' ? 'LONG' : 'SHORT';
          crossDirectionText = `
OMEGA-8 CLUSTER PROXIMITY ADVISORY (${dirLabel} SL): A ${sweepLabel} was detected. Its liquidity cluster at ${cross.clusterPrice.toFixed(pipInfo.decimalPlaces)} is only ${cross.clusterPipsFromStop.toFixed(1)} pips from your ${dirLabel} SL anchor.
This cluster was swept in the OPPOSITE direction — it is residual liquidity sitting near your stop zone. Your SL may be inside a magnet zone. This is advisory data, not a hard rule.
Consider in Q9: Is this cluster a risk to your SL? Should you widen to clear it, or does structure justify the current placement?`;
        }

        return alignedSweepText + crossDirectionText;
      })();

      const slMinPct = marketContext.price > 0
        ? ((wallSlMin * pipInfo.pipValue) / marketContext.price * 100).toFixed(3)
        : null;
      const slMaxPct = marketContext.price > 0
        ? ((wallSlMax * pipInfo.pipValue) / marketContext.price * 100).toFixed(3)
        : null;
      const tpMinPct = marketContext.price > 0
        ? ((wallTpMin * pipInfo.pipValue) / marketContext.price * 100).toFixed(3)
        : null;
      const tpMaxPct = marketContext.price > 0
        ? ((wallTpMax * pipInfo.pipValue) / marketContext.price * 100).toFixed(3)
        : null;
      const wallPctContext = (slMinPct && slMaxPct && tpMinPct && tpMaxPct)
        ? ` [SL: ${slMinPct}%-${slMaxPct}% of price | TP: ${tpMinPct}%-${tpMaxPct}% of price]`
        : '';

      stopLossDirective = `
ATR: ${extractATRValue(marketContext.atr).toFixed(5)} (${atrPips} pips) | Volatility: ${marketVolatilityLevel.toUpperCase()} | Risk: ${riskMode.toUpperCase()}
IF LONG SL Anchor: ${buyAnchorPrice.toFixed(5)} (${buyAnchorPips.toFixed(1)}p, ${buyStopAnchor.atrMultiplier.toFixed(2)}x ATR)
IF SHORT SL Anchor: ${sellAnchorPrice.toFixed(5)} (${sellAnchorPips.toFixed(1)}p, ${sellStopAnchor.atrMultiplier.toFixed(2)}x ATR)
EXPECTED ENVELOPE (${tradeStyle} ${promptAssetClass} @ ${marketContext.price.toFixed(2)}): SL expected ${wallSlMin.toFixed(1)}-${wallSlMax.toFixed(1)} pips | TP expected ${wallTpMin.toFixed(1)}-${wallTpMax.toFixed(1)} pips${wallPctContext}. These are structural guidelines derived from volatility and style. You have FULL authority to place SL and TP where structure justifies it. Placements outside the envelope are logged for analysis but are not rejected. Only Omega-9 (mathematical impossibility) can veto a trade.${sweepZoneDirective}
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

THESIS VALIDATION INSTRUCTIONS:
Compare the cached thesis against the CURRENT MARKET INTELLIGENCE BRIEFING below.

CRITICAL: You MUST return your final response as valid JSON regardless of your thesis decision.
DO NOT return plain text. DO NOT return REJECT_THESIS as a raw string outside of JSON.

If current price action and structure SUPPORT the thesis direction:
  → Include "thesis_status": "ACCEPTED_THESIS" in your JSON response
  → Proceed with BUY/SELL/NO_TRADE decision as normal

If current data CONTRADICTS the thesis:
  → Include "thesis_status": "REJECT_THESIS" and "thesis_rejection_reason": "[brief reason]" in your JSON
  → Set "action": "NO_TRADE" and explain in "reasoning" why the thesis is invalid
  → Example: {"action": "NO_TRADE", "thesis_status": "REJECT_THESIS", "thesis_rejection_reason": "Bearish reversal invalidates bullish thesis", "reasoning": "...", "confidence": 0, "stopLoss": 0, "takeProfit": 0}

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
    let intradayMovePhaseContext = '';
    let microIntradayMovePhaseContext = '';
    let scalpMovePhaseContext = '';
    // CCIP-2026-0310-SL-STRUCTURAL-DISTANCE: Computed inside the primary candle block
    // once recentPrimary is available. Appended to stopLossDirective after candles load.
    // Advisory data only — no mandate, no enforcement.
    let slStructuralDistanceNote = '';
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

        // ═══════════════════════════════════════════════════════════════════
        // EMA CONTEXT: Compute EMA20, EMA50, EMA200 on primary TF closes.
        // Uses the same calculateEMA used throughout the codebase (SSOT).
        // Provides direct pip-distance values so Alpha has concrete numbers.
        // ═══════════════════════════════════════════════════════════════════
        const primaryCloses = recentPrimary.map(c => c.close);
        const ema20Val = primaryCloses.length >= 20 ? calculateEMA(primaryCloses, 20) : (primaryCloses.length >= 5 ? calculateEMA(primaryCloses, primaryCloses.length) : 0);
        const ema50Val = primaryCloses.length >= 50 ? calculateEMA(primaryCloses, 50) : (primaryCloses.length >= 5 ? calculateEMA(primaryCloses, Math.min(50, primaryCloses.length)) : 0);
        const ema200Val = primaryCloses.length >= 200 ? calculateEMA(primaryCloses, 200) : (primaryCloses.length >= 5 ? calculateEMA(primaryCloses, Math.min(200, primaryCloses.length)) : 0);
        const currentPx = recentPrimary[recentPrimary.length - 1].close;
        const ema20Pips = ema20Val > 0 ? Math.abs(currentPx - ema20Val) / pipInfo.pipValue : null;
        const ema50Pips = ema50Val > 0 ? Math.abs(currentPx - ema50Val) / pipInfo.pipValue : null;
        const ema200Pips = ema200Val > 0 ? Math.abs(currentPx - ema200Val) / pipInfo.pipValue : null;
        const priceAboveEma20 = ema20Val > 0 && currentPx > ema20Val;
        const priceAboveEma50 = ema50Val > 0 && currentPx > ema50Val;
        const priceAboveEma200 = ema200Val > 0 && currentPx > ema200Val;
        const ema20AboveEma50 = ema20Val > 0 && ema50Val > 0 && ema20Val > ema50Val;
        const emaStack = (ema20Val > 0 && ema50Val > 0)
          ? (ema20AboveEma50 && priceAboveEma20 ? 'BULL' : !ema20AboveEma50 && !priceAboveEma20 ? 'BEAR' : 'MIXED')
          : 'UNKNOWN';
        // EMA convergence/divergence (last 3 closes vs EMA20 distance trend)
        const prevEma20 = primaryCloses.length >= 21 ? calculateEMA(primaryCloses.slice(0, -1), 20) : ema20Val;
        const ema20Slope = ema20Val > 0 && prevEma20 > 0 ? (ema20Val - prevEma20) / pipInfo.pipValue : 0;
        const ema20SlopeDir = Math.abs(ema20Slope) < 0.1 ? 'FLAT' : ema20Slope > 0 ? 'RISING' : 'FALLING';

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

        // ═══════════════════════════════════════════════════════════════════
        // SL STRUCTURAL DISTANCE NOTE (CCIP-2026-0310-SL-STRUCTURAL-DISTANCE)
        // Advisory data only — gives Alpha the measured distance between each
        // SL anchor and the nearest primary-TF wick extreme (swing low for BUY,
        // swing high for SELL). No enforcement, no mandate. Alpha self-assesses
        // using Q9 and sl_structural_reference.
        // ═══════════════════════════════════════════════════════════════════
        if (buyStopAnchor && sellStopAnchor) {
          // Find the N nearest distinct wick lows/highs within the last 6 primary candles
          const scanCandles = recentPrimary.slice(-6);

          // Nearest swing LOW: the lowest low-wick extreme in the scan window
          // (relevant for BUY SL, which sits below entry)
          let nearestSwingLow = scanCandles[0].low;
          let nearestSwingLowIdx = 0;
          for (let i = 1; i < scanCandles.length; i++) {
            if (scanCandles[i].low < nearestSwingLow) {
              nearestSwingLow = scanCandles[i].low;
              nearestSwingLowIdx = i;
            }
          }

          // Nearest swing HIGH: the highest high-wick extreme in the scan window
          // (relevant for SELL SL, which sits above entry)
          let nearestSwingHigh = scanCandles[0].high;
          let nearestSwingHighIdx = 0;
          for (let i = 1; i < scanCandles.length; i++) {
            if (scanCandles[i].high > nearestSwingHigh) {
              nearestSwingHigh = scanCandles[i].high;
              nearestSwingHighIdx = i;
            }
          }

          const buySLPrice = buyStopAnchor.stopLossPrice;
          const sellSLPrice = sellStopAnchor.stopLossPrice;

          const buySlToSwingLowPips = Math.abs(buySLPrice - nearestSwingLow) / pipInfo.pipValue;
          const sellSlToSwingHighPips = Math.abs(sellSLPrice - nearestSwingHigh) / pipInfo.pipValue;

          const buySLAboveSwingLow = buySLPrice > nearestSwingLow;
          const sellSLBelowSwingHigh = sellSLPrice < nearestSwingHigh;

          const buySLStatus = buySLAboveSwingLow
            ? `INSIDE the wick range (SL ${buySLPrice.toFixed(pipInfo.decimalPlaces)} > swing low ${nearestSwingLow.toFixed(pipInfo.decimalPlaces)} by ${buySlToSwingLowPips.toFixed(1)}p — SL may be swept)`
            : `BELOW the wick range (SL ${buySLPrice.toFixed(pipInfo.decimalPlaces)} < swing low ${nearestSwingLow.toFixed(pipInfo.decimalPlaces)} by ${buySlToSwingLowPips.toFixed(1)}p — SL clears the wick extreme)`;

          const sellSLStatus = sellSLBelowSwingHigh
            ? `INSIDE the wick range (SL ${sellSLPrice.toFixed(pipInfo.decimalPlaces)} < swing high ${nearestSwingHigh.toFixed(pipInfo.decimalPlaces)} by ${sellSlToSwingHighPips.toFixed(1)}p — SL may be swept)`
            : `ABOVE the wick range (SL ${sellSLPrice.toFixed(pipInfo.decimalPlaces)} > swing high ${nearestSwingHigh.toFixed(pipInfo.decimalPlaces)} by ${sellSlToSwingHighPips.toFixed(1)}p — SL clears the wick extreme)`;

          slStructuralDistanceNote = `
SL STRUCTURAL DISTANCE (${primaryTfConfig.label} — last 6 candles, advisory data):
- Nearest ${primaryTfConfig.label} swing low: ${nearestSwingLow.toFixed(pipInfo.decimalPlaces)} (candle ${nearestSwingLowIdx + 1} of 6)
- Nearest ${primaryTfConfig.label} swing high: ${nearestSwingHigh.toFixed(pipInfo.decimalPlaces)} (candle ${nearestSwingHighIdx + 1} of 6)
- IF LONG SL (${buySLPrice.toFixed(pipInfo.decimalPlaces)}): ${buySLStatus}
- IF SHORT SL (${sellSLPrice.toFixed(pipInfo.decimalPlaces)}): ${sellSLStatus}
Reason in Q9 and sl_structural_reference: does your chosen SL clear the nearest ${primaryTfConfig.label} wick extreme, or does it sit inside a zone that has already been probed? This data is for your self-assessment — not a system rule.
`;
          // Append to stopLossDirective so it appears next to the SL anchor context
          stopLossDirective += slStructuralDistanceNote;
        }

        // ═══════════════════════════════════════════════════════════════════
        // INTRADAY H1 MOVE PHASE & FAKEOUT ADVISORY
        // Mirrors the SCALP scalpIntelligencePrompt pattern.
        // Advisory only — Alpha retains full decision authority.
        // Computes ATR phase thresholds with real pip values so Alpha
        // knows exactly how many pips constitute each phase boundary.
        // ═══════════════════════════════════════════════════════════════════
        if (styleName === 'INTRADAY' && atrForStopLoss > 0) {
          const h1AtrPips = (atrForStopLoss / pipInfo.pipValue);
          const freshCeiling = (atrForStopLoss * 0.75 / pipInfo.pipValue).toFixed(1);
          const developingCeiling = (atrForStopLoss * 1.5 / pipInfo.pipValue).toFixed(1);

          // Estimate ATR traveled from H1 swing origin:
          // Find most recent directional swing origin (last candle that reversed direction)
          let swingOriginPrice = recentPrimary[0].close;
          const currentDir = lastCandle.close > lastCandle.open ? 'UP' : 'DN';
          for (let i = recentPrimary.length - 2; i >= 0; i--) {
            const cDir = recentPrimary[i].close > recentPrimary[i].open ? 'UP' : 'DN';
            if (cDir !== currentDir) {
              swingOriginPrice = currentDir === 'UP' ? recentPrimary[i].low : recentPrimary[i].high;
              break;
            }
          }
          const distFromSwingPips = Math.abs(marketContext.price - swingOriginPrice) / pipInfo.pipValue;
          const atrTraveled = h1AtrPips > 0 ? distFromSwingPips / h1AtrPips : 0;

          const h1MovePhase = atrTraveled < 0.75 ? 'FRESH' : atrTraveled < 1.5 ? 'DEVELOPING' : 'EXHAUSTED';

          // H1 fakeout detection: look for a candle that swept a recent extreme
          // then closed back inside the prior range (fakeout candle)
          let fakeoutType: string | null = null;
          let fakeoutCandlesAgo = 0;
          let fakeoutReversalConfirmed = false;
          if (recentPrimary.length >= 4) {
            const lookback = recentPrimary.slice(0, -1); // exclude current/last forming candle
            const windowHigh = Math.max(...lookback.slice(0, -1).map(c => c.high));
            const windowLow = Math.min(...lookback.slice(0, -1).map(c => c.low));
            const recentFew = lookback.slice(-3);
            for (let i = recentFew.length - 1; i >= 0; i--) {
              const c = recentFew[i];
              const bodyTop = Math.max(c.open, c.close);
              const bodyBot = Math.min(c.open, c.close);
              const sweptHigh = c.high > windowHigh && bodyTop < windowHigh;
              const sweptLow = c.low < windowLow && bodyBot > windowLow;
              if (sweptHigh) {
                fakeoutType = 'BEARISH_FAKEOUT';
                fakeoutCandlesAgo = recentFew.length - i;
                const nextCandles = recentPrimary.slice(recentPrimary.indexOf(c) + 1);
                fakeoutReversalConfirmed = nextCandles.some(nc => nc.close < nc.open);
                break;
              } else if (sweptLow) {
                fakeoutType = 'BULLISH_FAKEOUT';
                fakeoutCandlesAgo = recentFew.length - i;
                const nextCandles = recentPrimary.slice(recentPrimary.indexOf(c) + 1);
                fakeoutReversalConfirmed = nextCandles.some(nc => nc.close > nc.open);
                break;
              }
            }
          }

          const phaseLabel = h1MovePhase === 'FRESH'
            ? `FRESH — < 0.75x H1 ATR traveled (< ${freshCeiling} pips from swing origin). Full confidence range. Both continuation and pullback entries are valid.`
            : h1MovePhase === 'DEVELOPING'
              ? `DEVELOPING — 0.75–1.5x H1 ATR traveled (${freshCeiling}–${developingCeiling} pips from swing origin). Structural space to TP1 may be limited. Pullback re-entry is preferred. Continuation requires explicit justification that TP1 and TP2 remain achievable.`
              : `EXHAUSTED — > 1.5x H1 ATR traveled (> ${developingCeiling} pips from swing origin). The H1 leg is extended — look for a structural reversal, retest, or sweep setup rather than a continuation entry. Exhausted H1 moves often produce the best reversal entries. Recalculate R:R from CURRENT price. Only NO_TRADE if recalculated TP1 R:R cannot reach 1.0:1 from a named re-entry zone.`;

          const fakeoutBlock = fakeoutType
            ? `
H1 FAKEOUT DETECTION:
A ${fakeoutType} was detected ${fakeoutCandlesAgo} H1 candle(s) ago. A candle swept a recent H1 extreme but closed back inside the prior range. Reversal confirmed: ${fakeoutReversalConfirmed ? 'YES — subsequent H1 candles have printed in the reversal direction' : 'NOT YET — watch for reversal confirmation before entering in the faked direction'}.
${fakeoutType === 'BEARISH_FAKEOUT'
  ? 'BEARISH FAKEOUT: Price swept above a prior H1 high and rejected. This is a classic bull trap on the H1 chart. Entering LONG at current price carries fakeout-reversal risk — explicit structural justification required. A BUY entry must explain why the fakeout has been absorbed and the prior high has now become support.'
  : 'BULLISH FAKEOUT: Price swept below a prior H1 low and rejected. This is a classic bear trap on the H1 chart. Entering SHORT at current price carries fakeout-reversal risk — explicit structural justification required. A SELL entry must explain why the fakeout has been absorbed and the prior low has now become resistance.'}
`
            : '';

          intradayMovePhaseContext = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INTRADAY H1 MOVE STAGE ADVISORY (${marketContext.symbol})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pre-computed from H1 candle data. Advisory context — your analysis takes precedence.
ACTIVE H1 ATR: ${h1AtrPips.toFixed(1)} pips | Phase thresholds: Fresh < ${freshCeiling}p | Developing ${freshCeiling}–${developingCeiling}p | Exhausted > ${developingCeiling}p

Estimated ATR Traveled: ~${distFromSwingPips.toFixed(1)} pips from H1 swing origin (~${atrTraveled.toFixed(2)}x H1 ATR)
H1 Move Phase: ${h1MovePhase}
Assessment: ${phaseLabel}

${h1MovePhase === 'DEVELOPING'
  ? `DEVELOPING STAGE — MANDATORY RUNWAY CHECK: R:R must remain achievable from current price for both TP1 (H1 structural level) and TP2 (H4 structural level). State explicitly: "Remaining runway to TP1: ~X pips. Remaining runway to TP2: ~X pips. R:R from current price: TP1=X:1, TP2=X:1." If TP1 R:R falls below 1.0:1, tighten TP1 to the next achievable H1 structure or return NO_TRADE.`
  : h1MovePhase === 'EXHAUSTED'
    ? `EXHAUSTED STAGE — The H1 leg has traveled > 1.5x ATR. Look for a structural reversal, retest, or sweep setup rather than a continuation entry — exhausted H1 moves often produce the best reversal entries. Recalculate R:R from CURRENT price. If recalculated TP1 R:R cannot reach 1.0:1 from a named H1 re-entry zone, return NO_TRADE. State your structural assessment regardless of decision.`
    : `FRESH STAGE — Full confidence window. Structural space to TP1 and TP2 is available. Both continuation and pullback entries are valid.`
}
${fakeoutBlock}
MANDATORY JSON FIELD — Include in your response regardless of action:
  "h1_move_phase": "fresh|developing|exhausted"
  "h1_atr_traveled": ${atrTraveled.toFixed(2)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.log(`[Alpha Coordinator] INTRADAY H1 Move Phase: ${h1MovePhase} (~${atrTraveled.toFixed(2)}x ATR, ${distFromSwingPips.toFixed(1)} pips)${fakeoutType ? ` | Fakeout: ${fakeoutType}` : ''}`);
        }

        // ═══════════════════════════════════════════════════════════════════
        // MICRO_INTRADAY M15 MOVE PHASE & FAKEOUT ADVISORY
        // Mirrors the INTRADAY intradayMovePhaseContext pattern on M15.
        // Advisory only — EXHAUSTED phase is structural context for finding
        // a reversal or retest setup. Alpha retains full confidence authority.
        // No code-imposed confidence reduction. Alpha self-prices all signals.
        // SSOT: atrForStopLoss resolves to marketContext.atr (M15 14-period)
        // for MICRO_INTRADAY via styleAtrMap.
        // CCIP-2026-03-19: Stale "reduces confidence 15-25 points" language removed.
        // ═══════════════════════════════════════════════════════════════════
        if (styleName === 'MICRO_INTRADAY' && atrForStopLoss > 0) {
          const m15AtrPips = (atrForStopLoss / pipInfo.pipValue);
          const freshCeilingM15 = (atrForStopLoss * 0.75 / pipInfo.pipValue).toFixed(1);
          const developingCeilingM15 = (atrForStopLoss * 1.5 / pipInfo.pipValue).toFixed(1);

          let swingOriginPriceM15 = recentPrimary[0].close;
          const currentDirM15 = lastCandle.close > lastCandle.open ? 'UP' : 'DN';
          for (let i = recentPrimary.length - 2; i >= 0; i--) {
            const cDir = recentPrimary[i].close > recentPrimary[i].open ? 'UP' : 'DN';
            if (cDir !== currentDirM15) {
              swingOriginPriceM15 = currentDirM15 === 'UP' ? recentPrimary[i].low : recentPrimary[i].high;
              break;
            }
          }
          const distFromSwingPipsM15 = Math.abs(marketContext.price - swingOriginPriceM15) / pipInfo.pipValue;
          const atrTraveledM15 = m15AtrPips > 0 ? distFromSwingPipsM15 / m15AtrPips : 0;

          const m15MovePhase = atrTraveledM15 < 0.75 ? 'FRESH' : atrTraveledM15 < 1.5 ? 'DEVELOPING' : 'EXHAUSTED';

          let fakeoutTypeM15: string | null = null;
          let fakeoutCandlesAgoM15 = 0;
          let fakeoutReversalConfirmedM15 = false;
          if (recentPrimary.length >= 4) {
            const lookbackM15 = recentPrimary.slice(0, -1);
            const windowHighM15 = Math.max(...lookbackM15.slice(0, -1).map(c => c.high));
            const windowLowM15 = Math.min(...lookbackM15.slice(0, -1).map(c => c.low));
            const recentFewM15 = lookbackM15.slice(-3);
            for (let i = recentFewM15.length - 1; i >= 0; i--) {
              const c = recentFewM15[i];
              const bodyTop = Math.max(c.open, c.close);
              const bodyBot = Math.min(c.open, c.close);
              const sweptHighM15 = c.high > windowHighM15 && bodyTop < windowHighM15;
              const sweptLowM15 = c.low < windowLowM15 && bodyBot > windowLowM15;
              if (sweptHighM15) {
                fakeoutTypeM15 = 'BEARISH_FAKEOUT';
                fakeoutCandlesAgoM15 = recentFewM15.length - i;
                const nextCandles = recentPrimary.slice(recentPrimary.indexOf(c) + 1);
                fakeoutReversalConfirmedM15 = nextCandles.some(nc => nc.close < nc.open);
                break;
              } else if (sweptLowM15) {
                fakeoutTypeM15 = 'BULLISH_FAKEOUT';
                fakeoutCandlesAgoM15 = recentFewM15.length - i;
                const nextCandles = recentPrimary.slice(recentPrimary.indexOf(c) + 1);
                fakeoutReversalConfirmedM15 = nextCandles.some(nc => nc.close > nc.open);
                break;
              }
            }
          }

          const phaseLabelM15 = m15MovePhase === 'FRESH'
            ? `FRESH — < 0.75x M15 ATR traveled (< ${freshCeilingM15} pips from swing origin). Full confidence range. Both continuation and pullback entries are valid.`
            : m15MovePhase === 'DEVELOPING'
              ? `DEVELOPING — 0.75–1.5x M15 ATR traveled (${freshCeilingM15}–${developingCeilingM15} pips from swing origin). Structural space to TP1 may be narrowing. Pullback re-entry preferred. Continuation requires explicit justification that TP1 and TP2 remain achievable.`
              : `EXHAUSTED — > 1.5x M15 ATR traveled (> ${developingCeilingM15} pips from swing origin). The M15 leg is extended — look for a structural reversal, retest, or sweep setup rather than a continuation entry. Exhausted M15 moves often produce the best reversal entries. State your structural assessment. Only return NO_TRADE if no directional case exists at all.`;

          const fakeoutBlockM15 = fakeoutTypeM15
            ? `
M15 FAKEOUT DETECTION:
A ${fakeoutTypeM15} was detected ${fakeoutCandlesAgoM15} M15 candle(s) ago. A candle swept a recent M15 extreme but closed back inside the prior range. Reversal confirmed: ${fakeoutReversalConfirmedM15 ? 'YES — subsequent M15 candles have printed in the reversal direction' : 'NOT YET — watch for reversal confirmation before entering in the faked direction'}.
${fakeoutTypeM15 === 'BEARISH_FAKEOUT'
  ? 'BEARISH FAKEOUT: Price swept above a prior M15 high and rejected. This is a classic bull trap on the M15 chart. Entering LONG at current price carries fakeout-reversal risk — explicit structural justification required. A BUY entry must explain why the fakeout has been absorbed and the prior high has now become support.'
  : 'BULLISH FAKEOUT: Price swept below a prior M15 low and rejected. This is a classic bear trap on the M15 chart. Entering SHORT at current price carries fakeout-reversal risk — explicit structural justification required. A SELL entry must explain why the fakeout has been absorbed and the prior low has now become resistance.'}
`
            : '';

          microIntradayMovePhaseContext = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MICRO_INTRADAY M15 MOVE STAGE ADVISORY (${marketContext.symbol})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pre-computed from M15 candle data. Advisory context — your analysis takes precedence.
ACTIVE M15 ATR: ${m15AtrPips.toFixed(1)} pips | Phase thresholds: Fresh < ${freshCeilingM15}p | Developing ${freshCeilingM15}–${developingCeilingM15}p | Exhausted > ${developingCeilingM15}p

Estimated ATR Traveled: ~${distFromSwingPipsM15.toFixed(1)} pips from M15 swing origin (~${atrTraveledM15.toFixed(2)}x M15 ATR)
M15 Move Phase: ${m15MovePhase}
Assessment: ${phaseLabelM15}

${m15MovePhase === 'DEVELOPING'
  ? `DEVELOPING STAGE — RUNWAY CHECK: R:R must remain achievable from current price for both TP1 (M15 structural level) and TP2 (H1 structural level). State explicitly: "Remaining runway to TP1: ~X pips. Remaining runway to TP2: ~X pips. R:R from current price: TP1=X:1, TP2=X:1." If TP1 R:R falls below 1.0:1, tighten TP1 to the next achievable M15 structure or return NO_TRADE.`
  : m15MovePhase === 'EXHAUSTED'
    ? `EXHAUSTED STAGE — The M15 leg has traveled > 1.5x ATR. Look for a reversal, retest, or sweep setup rather than a continuation entry. If a valid structural re-entry zone exists and R:R reaches 1.0:1, the trade is valid. Only NO_TRADE if no directional structural case exists.`
    : `FRESH STAGE — Full confidence window. Structural space to TP1 and TP2 is available. Both continuation and pullback entries are valid.`
}
${fakeoutBlockM15}MANDATORY JSON FIELD — Include in your response regardless of action:
  "m15_move_phase": "fresh|developing|exhausted"
  "m15_atr_traveled": ${atrTraveledM15.toFixed(2)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.log(`[Alpha Coordinator] MICRO_INTRADAY M15 Move Phase: ${m15MovePhase} (~${atrTraveledM15.toFixed(2)}x ATR, ${distFromSwingPipsM15.toFixed(1)} pips)${fakeoutTypeM15 ? ` | Fakeout: ${fakeoutTypeM15}` : ''}`);
        }

        // ═══════════════════════════════════════════════════════════════════
        // SCALP M5 MOVE PHASE ADVISORY
        // Mirrors the INTRADAY intradayMovePhaseContext and MICRO_INTRADAY
        // microIntradayMovePhaseContext patterns on M5 primary candles.
        // Advisory only — Alpha retains full decision authority.
        // SSOT: atrForStopLoss resolves to marketContext.atr (M5 14-period)
        // for SCALP via styleAtrMap. recentPrimary is already loaded above.
        // ═══════════════════════════════════════════════════════════════════
        if (styleName === 'SCALP' && atrForStopLoss > 0) {
          const m5AtrPips = (atrForStopLoss / pipInfo.pipValue);
          const freshCeilingM5 = (atrForStopLoss * 0.75 / pipInfo.pipValue).toFixed(1);
          const developingCeilingM5 = (atrForStopLoss * 1.5 / pipInfo.pipValue).toFixed(1);

          let swingOriginPriceM5 = recentPrimary[0].close;
          const currentDirM5 = lastCandle.close > lastCandle.open ? 'UP' : 'DN';
          for (let i = recentPrimary.length - 2; i >= 0; i--) {
            const cDir = recentPrimary[i].close > recentPrimary[i].open ? 'UP' : 'DN';
            if (cDir !== currentDirM5) {
              swingOriginPriceM5 = currentDirM5 === 'UP' ? recentPrimary[i].low : recentPrimary[i].high;
              break;
            }
          }
          const distFromSwingPipsM5 = Math.abs(marketContext.price - swingOriginPriceM5) / pipInfo.pipValue;
          const atrTraveledM5 = m5AtrPips > 0 ? distFromSwingPipsM5 / m5AtrPips : 0;

          const m5MovePhase = atrTraveledM5 < 0.75 ? 'FRESH' : atrTraveledM5 < 1.5 ? 'DEVELOPING' : 'EXHAUSTED';

          let fakeoutTypeM5: string | null = null;
          let fakeoutCandlesAgoM5 = 0;
          let fakeoutReversalConfirmedM5 = false;
          if (recentPrimary.length >= 4) {
            const lookbackM5 = recentPrimary.slice(0, -1);
            const windowHighM5 = Math.max(...lookbackM5.slice(0, -1).map(c => c.high));
            const windowLowM5 = Math.min(...lookbackM5.slice(0, -1).map(c => c.low));
            const recentFewM5 = lookbackM5.slice(-3);
            for (let i = recentFewM5.length - 1; i >= 0; i--) {
              const c = recentFewM5[i];
              const bodyTop = Math.max(c.open, c.close);
              const bodyBot = Math.min(c.open, c.close);
              const sweptHighM5 = c.high > windowHighM5 && bodyTop < windowHighM5;
              const sweptLowM5 = c.low < windowLowM5 && bodyBot > windowLowM5;
              if (sweptHighM5) {
                fakeoutTypeM5 = 'BEARISH_FAKEOUT';
                fakeoutCandlesAgoM5 = recentFewM5.length - i;
                const nextCandles = recentPrimary.slice(recentPrimary.indexOf(c) + 1);
                fakeoutReversalConfirmedM5 = nextCandles.some(nc => nc.close < nc.open);
                break;
              } else if (sweptLowM5) {
                fakeoutTypeM5 = 'BULLISH_FAKEOUT';
                fakeoutCandlesAgoM5 = recentFewM5.length - i;
                const nextCandles = recentPrimary.slice(recentPrimary.indexOf(c) + 1);
                fakeoutReversalConfirmedM5 = nextCandles.some(nc => nc.close > nc.open);
                break;
              }
            }
          }

          const phaseLabelM5 = m5MovePhase === 'FRESH'
            ? `FRESH — < 0.75x M5 ATR traveled (< ${freshCeilingM5} pips from M5 swing origin). Full confidence range. Both continuation and pullback scalp entries are valid.`
            : m5MovePhase === 'DEVELOPING'
              ? `DEVELOPING — 0.75–1.5x M5 ATR traveled (${freshCeilingM5}–${developingCeilingM5} pips from M5 swing origin). Structural space to your single SCALP TP may be narrowing. Pullback scalp entry preferred. Continuation requires explicit justification that the single TP remains achievable.`
              : `EXHAUSTED — > 1.5x M5 ATR traveled (> ${developingCeilingM5} pips from M5 swing origin). The M5 leg is extended — look for a reversal scalp or M5 structural retest entry rather than a continuation. Exhausted M5 moves often produce the cleanest reversal scalps. Set your confidence based on the structural merit of the reversal or retest setup you find. Only return NO_TRADE if no M5 structural edge exists at all.`;

          const fakeoutBlockM5 = fakeoutTypeM5
            ? `
M5 FAKEOUT DETECTION:
A ${fakeoutTypeM5} was detected ${fakeoutCandlesAgoM5} M5 candle(s) ago. A candle swept a recent M5 extreme but closed back inside the prior range. Reversal confirmed: ${fakeoutReversalConfirmedM5 ? 'YES — subsequent M5 candles have printed in the reversal direction' : 'NOT YET — watch for reversal confirmation before entering in the faked direction'}.
${fakeoutTypeM5 === 'BEARISH_FAKEOUT'
  ? 'BEARISH FAKEOUT: Price swept above a prior M5 high and rejected. This is a classic bull trap on the M5 chart. Entering LONG at current price carries fakeout-reversal risk — explicit M5 structural justification required.'
  : 'BULLISH FAKEOUT: Price swept below a prior M5 low and rejected. This is a classic bear trap on the M5 chart. Entering SHORT at current price carries fakeout-reversal risk — explicit M5 structural justification required.'}
`
            : '';

          scalpMovePhaseContext = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCALP M5 MOVE STAGE ADVISORY (${marketContext.symbol})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pre-computed from M5 candle data. Advisory context — your analysis takes precedence.
ACTIVE M5 ATR: ${m5AtrPips.toFixed(1)} pips | Phase thresholds: Fresh < ${freshCeilingM5}p | Developing ${freshCeilingM5}–${developingCeilingM5}p | Exhausted > ${developingCeilingM5}p

Estimated ATR Traveled: ~${distFromSwingPipsM5.toFixed(1)} pips from M5 swing origin (~${atrTraveledM5.toFixed(2)}x M5 ATR)
M5 Move Phase: ${m5MovePhase}
Assessment: ${phaseLabelM5}

${m5MovePhase === 'DEVELOPING'
  ? `DEVELOPING STAGE — RUNWAY CHECK: Confirm your single SCALP TP remains achievable from current price. State: "Remaining runway to TP: ~X pips. R:R from current price: X:1." If TP R:R falls below 1.0:1, tighten TP to the next achievable M5 structure or return NO_TRADE.`
  : m5MovePhase === 'EXHAUSTED'
    ? `EXHAUSTED STAGE — The M5 leg has traveled > 1.5x ATR. Look for a reversal scalp or M5 structural retest setup rather than a continuation entry. If a valid M5 structural re-entry zone exists and R:R reaches 1.0:1, the scalp is valid — set confidence based on how strong the reversal structure is. Only NO_TRADE if no M5 structural case exists.`
    : `FRESH STAGE — Full confidence window. Structural space to your SCALP TP is available. Both continuation and pullback scalp entries are valid.`
}
${fakeoutBlockM5}MANDATORY JSON FIELDS — Include in your response regardless of action:
  "scalp_momentum_phase": "${m5MovePhase.toLowerCase()}"
  "scalp_atr_traveled": ${atrTraveledM5.toFixed(2)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.log(`[Alpha Coordinator] SCALP M5 Move Phase: ${m5MovePhase} (~${atrTraveledM5.toFixed(2)}x ATR, ${distFromSwingPipsM5.toFixed(1)} pips)${fakeoutTypeM5 ? ` | Fakeout: ${fakeoutTypeM5}` : ''}`);
        }

        const emaContextBlock = (ema20Val > 0 || ema50Val > 0) ? `
${primaryTfConfig.label} EMA CONTEXT (computed from candle closes):
- EMA20: ${ema20Val > 0 ? ema20Val.toFixed(pipInfo.decimalPlaces) : 'N/A'} | Price is ${ema20Val > 0 ? (priceAboveEma20 ? 'ABOVE' : 'BELOW') : '?'} EMA20${ema20Pips !== null ? ` by ${ema20Pips.toFixed(1)} pips` : ''}
- EMA50: ${ema50Val > 0 ? ema50Val.toFixed(pipInfo.decimalPlaces) : 'N/A'} | Price is ${ema50Val > 0 ? (priceAboveEma50 ? 'ABOVE' : 'BELOW') : '?'} EMA50${ema50Pips !== null ? ` by ${ema50Pips.toFixed(1)} pips` : ''}${ema200Val > 0 ? `
- EMA200: ${ema200Val.toFixed(pipInfo.decimalPlaces)} | Price is ${priceAboveEma200 ? 'ABOVE' : 'BELOW'} EMA200${ema200Pips !== null ? ` by ${ema200Pips.toFixed(1)} pips` : ''}` : ''}
- EMA Stack: ${emaStack}${ema20Val > 0 ? ` | EMA20 is ${ema20AboveEma50 ? 'ABOVE' : 'BELOW'} EMA50` : ''} | EMA20 Slope: ${ema20SlopeDir} (${ema20Slope.toFixed(2)} pips/candle)
EMA INTERPRETATION: body ratio >60% = directional conviction candle | body ratio <30% = indecision (inside bar / doji). Use EMA20 as the closest dynamic support/resistance. If price is within 3 pips of EMA20, this is an EMA rejection zone.` : '';

        primaryTfCandlePrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${primaryTfConfig.label} PRIMARY TIMEFRAME CANDLES (${marketContext.symbol}) — ENTRY ADVISORY PRIMARY SIGNAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THIS IS YOUR PRIMARY DATA for the entry_advisory verdict. Your trade lives on the ${primaryTfConfig.label} timeframe.
Analyze these ${primaryTfConfig.label} candles FIRST before considering M1 micro-data.
CANDLE FORMAT: direction | OHLC | body pips | upper/lower wick pips | body% of range | wick_bias
body ratio >60% = conviction candle | <30% = indecision | wick_bias = which side dominates (institutional rejection signal)

${primaryLines.join('\n')}

${primaryTfConfig.label} STRUCTURE SUMMARY:
- ${primaryTfConfig.label} Range: ${tfRangePips.toFixed(1)} pips (High: ${tfHigh.toFixed(pipInfo.decimalPlaces)}, Low: ${tfLow.toFixed(pipInfo.decimalPlaces)})
- Consecutive same-direction ${primaryTfConfig.label} candles: ${consecutiveSameDir}
- Last ${primaryTfConfig.label} candle: ${hasRejectionWick ? 'REJECTION WICK detected' : 'Normal candle'} (body: ${lastBody.toFixed(1)}p, upper wick: ${lastUpperWick.toFixed(1)}p, lower wick: ${lastLowerWick.toFixed(1)}p)
- ${primaryTfConfig.label} Momentum: ${consecutiveSameDir >= 3 ? 'IMPULSIVE MOVE — ' + consecutiveSameDir + ' consecutive same-direction ' + primaryTfConfig.label + ' candles. Pullback is highly probable before continuation.' : consecutiveSameDir >= 2 ? 'Developing trend — 2 consecutive ' + primaryTfConfig.label + ' candles, monitor for continuation or pullback' : 'Mixed/consolidating — no impulsive leg detected on ' + primaryTfConfig.label}
${emaContextBlock}
PULLBACK ASSESSMENT RULE (${primaryTfConfig.label} TIMEFRAME):
${consecutiveSameDir >= 3
  ? `STRONG GUIDELINE: ${consecutiveSameDir} consecutive same-direction ${primaryTfConfig.label} candles detected. This is an impulsive ${primaryTfConfig.label} leg without pullback. A retracement is highly probable. Your entry_advisory verdict should be PULLBACK_EXPECTED unless you have exceptional evidence (breakaway gap, news catalyst) that no pullback will occur. A single M1 rejection wick does NOT override an impulsive ${primaryTfConfig.label} move.`
  : `No impulsive ${primaryTfConfig.label} leg detected. Assess structural levels, EMA proximity, and wick bias to determine entry quality.`}
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
        // HTF STRUCTURAL EVIDENCE COMPUTATION (CCIP 2026-03-03, Alpha Authority)
        //
        // GOVERNANCE: Alpha is the sole trading decision authority (coordinator-alpha.ts
        // header, lines 36-39). No deterministic engine may block the LLM call based
        // on a direction proxy. The previous pre-LLM conflict gate violated this by
        // comparing Omega-8's pattern score (a pattern interpretation engine) against
        // HTF candle trend direction and returning NO_TRADE before Alpha could speak.
        //
        // FIX (CCIP-2026-03-03): BOS and sweep-wick evidence is computed here and
        // embedded directly into the Alpha prompt as pre-labeled structural facts.
        // Alpha reads this evidence and makes the counter-trend qualification decision.
        // The deterministic engines compute the facts. Alpha reasons about them.
        //
        // SSOT: This module owns HTF candle computation. Alpha owns the decision.
        // ═══════════════════════════════════════════════════════════════════
        const htfBOSBull = recentHtf.length >= 2 && lastHtfCandle.close > recentHtf[recentHtf.length - 2].high;
        const htfBOSBear = recentHtf.length >= 2 && lastHtfCandle.close < recentHtf[recentHtf.length - 2].low;
        const htfSweepWickBull = recentHtf.slice(-2).some(c => {
          const body = Math.abs(c.close - c.open);
          const wick = Math.min(c.open, c.close) - c.low;
          return body > 0 && wick / body >= 1.5;
        });
        const htfSweepWickBear = recentHtf.slice(-2).some(c => {
          const body = Math.abs(c.close - c.open);
          const wick = c.high - Math.max(c.open, c.close);
          return body > 0 && wick / body >= 1.5;
        });

        const htfStructuralEvidenceBlock = `
${htfConfig.label} STRUCTURAL EVIDENCE (pre-computed for Alpha):
- BOS BULL (last close > prior high): ${htfBOSBull ? 'YES — bullish break of structure confirmed' : 'NO'}
- BOS BEAR (last close < prior low): ${htfBOSBear ? 'YES — bearish break of structure confirmed' : 'NO'}
- SWEEP WICK BULL (lower wick ≥1.5x body in last 2 candles): ${htfSweepWickBull ? 'YES — institutional bullish reversal signal' : 'NO'}
- SWEEP WICK BEAR (upper wick ≥1.5x body in last 2 candles): ${htfSweepWickBear ? 'YES — institutional bearish reversal signal' : 'NO'}

COUNTER-TREND ENTRY REQUIREMENT: If your intended direction opposes the ${htfConfig.label} structural bias above,
you MUST cite at least one qualifying piece of evidence from the above (BOS or sweep wick in your direction).
If zero evidence exists for your counter-trend direction, return NO_TRADE with reason HTF_NO_COUNTER_TREND_QUALIFICATION.`;

        console.log(`[Alpha Coordinator] ${htfConfig.label} structural evidence: BOS_BULL=${htfBOSBull} BOS_BEAR=${htfBOSBear} WICK_BULL=${htfSweepWickBull} WICK_BEAR=${htfSweepWickBear}`);

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

${htfStructuralEvidenceBlock}
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
    // M5 SUB-CONFIRMATION CANDLES (MICRO_INTRADAY ONLY — advisory, non-blocking)
    //
    // SSOT: coordinator-alpha.ts is the single authority for LLM prompt assembly.
    // CCIP 2026-03-08: Closes the three-tier confluence gap identified in
    // architectural audit. MICRO_INTRADAY system prompt (alpha-identity.ts line 685)
    // requires M5 close confirmation before execute_now is valid. Without real
    // M5 candle data the LLM confabulates M5 structure using M15 primary candles.
    //
    // THREE-TIER ARCHITECTURE (now complete):
    //   SCALP:          M5 (primary) + M1 (sub-confirmation) + M15/H1 (advisory)
    //   MICRO_INTRADAY: M15 (primary) + M5 (sub-confirmation) + H1 (controlling)
    //   INTRADAY:       H1 (primary) + M15 (sub-confirmation) + H4 (controlling)
    //
    // GOVERNANCE: Missing M5 data is NON-BLOCKING. If M5 candles are unavailable,
    // the LLM is informed via a warning block and must treat any execute_now
    // decision as requiring explicit wait_pullback until M5 confirms. Alpha
    // retains full decision authority — this block is advisory, not a gate.
    // SSOT: MarketDataService is the single authority for candle data
    // ═══════════════════════════════════════════════════════════════════
    let m5SubConfirmationPrompt = '';
    if (styleName === 'MICRO_INTRADAY') {
      try {
        const mds = MarketDataService.getInstance();
        const m5SubCandles = await mds.getCandles(marketContext.symbol, 'M5', 10);

        if (m5SubCandles && m5SubCandles.length >= 5) {
          const recentM5Sub = m5SubCandles.slice(0, 10).reverse();
          const pipInfo = getCurrencyPipInfo(marketContext.symbol);

          const m5SubLines: string[] = recentM5Sub.map((c, i) => {
            const dir = c.close > c.open ? 'UP' : c.close < c.open ? 'DN' : 'FLAT';
            const bodyPips = Math.abs(c.close - c.open) / pipInfo.pipValue;
            const upperWick = (c.high - Math.max(c.open, c.close)) / pipInfo.pipValue;
            const lowerWick = (Math.min(c.open, c.close) - c.low) / pipInfo.pipValue;
            const totalRange = (c.high - c.low) / pipInfo.pipValue;
            const bodyRatio = totalRange > 0 ? Math.round((bodyPips / totalRange) * 100) : 0;
            const wickBias = upperWick > lowerWick * 1.5 ? 'upper' : lowerWick > upperWick * 1.5 ? 'lower' : 'balanced';
            return `  ${i + 1}. ${dir} O:${c.open.toFixed(pipInfo.decimalPlaces)} H:${c.high.toFixed(pipInfo.decimalPlaces)} L:${c.low.toFixed(pipInfo.decimalPlaces)} C:${c.close.toFixed(pipInfo.decimalPlaces)} body:${bodyPips.toFixed(1)}p wicks:${upperWick.toFixed(1)}/${lowerWick.toFixed(1)}p ratio:${bodyRatio}% wick_bias:${wickBias}`;
          });

          const lastM5Sub = recentM5Sub[recentM5Sub.length - 1];
          const prevM5Sub = recentM5Sub.length >= 2 ? recentM5Sub[recentM5Sub.length - 2] : lastM5Sub;
          const m5SubTrendDir = lastM5Sub.close > prevM5Sub.close ? 'BULLISH' : lastM5Sub.close < prevM5Sub.close ? 'BEARISH' : 'NEUTRAL';
          const lastM5Body = Math.abs(lastM5Sub.close - lastM5Sub.open) / pipInfo.pipValue;
          const lastM5UpperWick = (lastM5Sub.high - Math.max(lastM5Sub.open, lastM5Sub.close)) / pipInfo.pipValue;
          const lastM5LowerWick = (Math.min(lastM5Sub.open, lastM5Sub.close) - lastM5Sub.low) / pipInfo.pipValue;
          const m5HasRejectionWick = lastM5UpperWick > lastM5Body * 1.5 || lastM5LowerWick > lastM5Body * 1.5;

          const m5SubHigh = Math.max(...recentM5Sub.map(c => c.high));
          const m5SubLow = Math.min(...recentM5Sub.map(c => c.low));
          const m5SubRangePips = (m5SubHigh - m5SubLow) / pipInfo.pipValue;

          let m5SubConsecutive = 1;
          for (let i = recentM5Sub.length - 2; i >= 0; i--) {
            const prevDir = recentM5Sub[i].close > recentM5Sub[i].open ? 'UP' : 'DN';
            const lastDir = lastM5Sub.close > lastM5Sub.open ? 'UP' : 'DN';
            if (prevDir === lastDir) m5SubConsecutive++;
            else break;
          }

          // ═══════════════════════════════════════════════════════════════════
          // M5 BOS and sweep-wick evidence: pre-computed facts for Alpha.
          // Mirrors the HTF structural evidence pattern (lines 1751-1773).
          // Alpha is sole authority on whether these justify execute_now.
          // ═══════════════════════════════════════════════════════════════════
          const m5SubBOSBull = recentM5Sub.length >= 2 && lastM5Sub.close > recentM5Sub[recentM5Sub.length - 2].high;
          const m5SubBOSBear = recentM5Sub.length >= 2 && lastM5Sub.close < recentM5Sub[recentM5Sub.length - 2].low;
          const m5SubSweepWickBull = recentM5Sub.slice(-2).some(c => {
            const body = Math.abs(c.close - c.open);
            const wick = Math.min(c.open, c.close) - c.low;
            return body > 0 && wick / body >= 1.5;
          });
          const m5SubSweepWickBear = recentM5Sub.slice(-2).some(c => {
            const body = Math.abs(c.close - c.open);
            const wick = c.high - Math.max(c.open, c.close);
            return body > 0 && wick / body >= 1.5;
          });

          const m5SubEvidenceBlock = `
M5 SUB-CONFIRMATION EVIDENCE (pre-computed for Alpha):
- M5 BOS BULL (last M5 close > prior M5 high): ${m5SubBOSBull ? 'YES — bullish M5 break of structure confirmed' : 'NO'}
- M5 BOS BEAR (last M5 close < prior M5 low): ${m5SubBOSBear ? 'YES — bearish M5 break of structure confirmed' : 'NO'}
- M5 SWEEP WICK BULL (lower wick ≥1.5x body in last 2 M5 candles): ${m5SubSweepWickBull ? 'YES — bullish absorption signal on M5' : 'NO'}
- M5 SWEEP WICK BEAR (upper wick ≥1.5x body in last 2 M5 candles): ${m5SubSweepWickBear ? 'YES — bearish absorption signal on M5' : 'NO'}

M5 CLOSE RULE: A confirmed M5 candle CLOSE in your intended direction at the entry zone is the MICRO_INTRADAY entry trigger standard.
A wick, an open, or a partial move does not constitute confirmation — only a closed M5 body in your direction counts.
Assess the pre-computed signals above: if M5 BOS or sweep wick confirmation has NOT formed, state what trigger you are waiting for and select wait_pullback.
If M5 confirmation IS present, you may select execute_now — back your reasoning with the specific M5 signal that confirms it.`;

          m5SubConfirmationPrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M5 SUB-CONFIRMATION (${marketContext.symbol}) — MICRO_INTRADAY ENTRY TRIGGER TIMEFRAME
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This is your ENTRY TRIGGER timeframe. M15 defines the structure and setup. M5 is where you pull the trigger.
A confirmed M5 candle CLOSE in your intended direction at the entry zone is required before execute_now.
A wick touch, M5 open, or partial move is NOT confirmation — only a CLOSED M5 body in your direction counts.

${m5SubLines.join('\n')}

M5 SUB-CONFIRMATION SUMMARY:
- M5 Range (last ${recentM5Sub.length} candles): ${m5SubRangePips.toFixed(1)} pips (High: ${m5SubHigh.toFixed(pipInfo.decimalPlaces)}, Low: ${m5SubLow.toFixed(pipInfo.decimalPlaces)})
- M5 Current directional bias: ${m5SubTrendDir}
- Consecutive same-direction M5 candles: ${m5SubConsecutive}
- Last M5 candle: ${m5HasRejectionWick ? 'REJECTION WICK detected (possible exhaustion or reversal at level)' : 'Normal candle — no strong wick signal'}

${m5SubEvidenceBlock}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.log(`[Alpha Coordinator] M5 Sub-Confirmation (MICRO_INTRADAY): ${recentM5Sub.length} candles, bias ${m5SubTrendDir}, BOS_BULL=${m5SubBOSBull} BOS_BEAR=${m5SubBOSBear}`);
        } else {
          m5SubConfirmationPrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M5 SUB-CONFIRMATION (${marketContext.symbol}) — DATA UNAVAILABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WARNING: M5 candle data could not be retrieved (${m5SubCandles?.length ?? 0} candles found, need ≥5).
GOVERNANCE CONSEQUENCE: Without M5 confirmation data, you CANNOT select execute_now.
Your entry_mode must be wait_pullback. State the specific M5 trigger you are waiting for.
If you cannot define a specific M5 trigger level, return NO_TRADE.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.warn(`[Alpha Coordinator] M5 sub-confirmation data insufficient for MICRO_INTRADAY (${m5SubCandles?.length ?? 0} candles)`);
        }
      } catch (error) {
        m5SubConfirmationPrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M5 SUB-CONFIRMATION (${marketContext.symbol}) — FETCH ERROR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WARNING: M5 candle fetch failed. Without M5 data you CANNOT select execute_now.
entry_mode must be wait_pullback with a specific M5 trigger level stated.
If you cannot define a specific M5 trigger level, return NO_TRADE.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        console.warn('[Alpha Coordinator] M5 sub-confirmation fetch failed (non-blocking):', error instanceof Error ? error.message : 'Unknown');
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // M15 SUB-CONFIRMATION (INTRADAY ONLY — precision entry layer)
    // Mirrors the M5 sub-confirmation pattern for MICRO_INTRADAY.
    // INTRADAY: H1 is the primary TF. M15 is the precision entry layer —
    // it defines WHEN to pull the trigger on an H1-level setup.
    // Missing M15 data is NON-BLOCKING (advisory, not a gate).
    // Alpha retains full decision authority. If data is unavailable,
    // Alpha is informed and must use wait_pullback until M15 confirms.
    // SSOT: MarketDataService is the single authority for candle data
    // ═══════════════════════════════════════════════════════════════════
    if (styleName === 'INTRADAY') {
      try {
        const mds = MarketDataService.getInstance();
        const m15IntradayCandles = await mds.getCandles(marketContext.symbol, 'M15', 10);

        if (m15IntradayCandles && m15IntradayCandles.length >= 5) {
          const recentM15Intraday = m15IntradayCandles.slice(0, 10).reverse();
          const pipInfo = getCurrencyPipInfo(marketContext.symbol);

          const m15IntradayLines: string[] = recentM15Intraday.map((c, i) => {
            const dir = c.close > c.open ? 'UP' : c.close < c.open ? 'DN' : 'FLAT';
            const bodyPips = Math.abs(c.close - c.open) / pipInfo.pipValue;
            const upperWick = (c.high - Math.max(c.open, c.close)) / pipInfo.pipValue;
            const lowerWick = (Math.min(c.open, c.close) - c.low) / pipInfo.pipValue;
            const totalRange = (c.high - c.low) / pipInfo.pipValue;
            const bodyRatio = totalRange > 0 ? Math.round((bodyPips / totalRange) * 100) : 0;
            const wickBias = upperWick > lowerWick * 1.5 ? 'upper' : lowerWick > upperWick * 1.5 ? 'lower' : 'balanced';
            return `  ${i + 1}. ${dir} O:${c.open.toFixed(pipInfo.decimalPlaces)} H:${c.high.toFixed(pipInfo.decimalPlaces)} L:${c.low.toFixed(pipInfo.decimalPlaces)} C:${c.close.toFixed(pipInfo.decimalPlaces)} body:${bodyPips.toFixed(1)}p wicks:${upperWick.toFixed(1)}/${lowerWick.toFixed(1)}p ratio:${bodyRatio}% wick_bias:${wickBias}`;
          });

          const lastM15I = recentM15Intraday[recentM15Intraday.length - 1];
          const prevM15I = recentM15Intraday.length >= 2 ? recentM15Intraday[recentM15Intraday.length - 2] : lastM15I;
          const m15IntradayTrendDir = lastM15I.close > prevM15I.close ? 'BULLISH' : lastM15I.close < prevM15I.close ? 'BEARISH' : 'NEUTRAL';
          const lastM15IBody = Math.abs(lastM15I.close - lastM15I.open) / pipInfo.pipValue;
          const lastM15IUpperWick = (lastM15I.high - Math.max(lastM15I.open, lastM15I.close)) / pipInfo.pipValue;
          const lastM15ILowerWick = (Math.min(lastM15I.open, lastM15I.close) - lastM15I.low) / pipInfo.pipValue;
          const m15IHasRejectionWick = lastM15IUpperWick > lastM15IBody * 1.5 || lastM15ILowerWick > lastM15IBody * 1.5;

          const m15IHigh = Math.max(...recentM15Intraday.map(c => c.high));
          const m15ILow = Math.min(...recentM15Intraday.map(c => c.low));
          const m15IRangePips = (m15IHigh - m15ILow) / pipInfo.pipValue;

          let m15IConsecutive = 1;
          for (let i = recentM15Intraday.length - 2; i >= 0; i--) {
            const prevDir = recentM15Intraday[i].close > recentM15Intraday[i].open ? 'UP' : 'DN';
            const lastDir = lastM15I.close > lastM15I.open ? 'UP' : 'DN';
            if (prevDir === lastDir) m15IConsecutive++;
            else break;
          }

          const m15IBOSBull = recentM15Intraday.length >= 2 && lastM15I.close > recentM15Intraday[recentM15Intraday.length - 2].high;
          const m15IBOSBear = recentM15Intraday.length >= 2 && lastM15I.close < recentM15Intraday[recentM15Intraday.length - 2].low;
          const m15ISweepWickBull = recentM15Intraday.slice(-2).some(c => {
            const body = Math.abs(c.close - c.open);
            const wick = Math.min(c.open, c.close) - c.low;
            return body > 0 && wick / body >= 1.5;
          });
          const m15ISweepWickBear = recentM15Intraday.slice(-2).some(c => {
            const body = Math.abs(c.close - c.open);
            const wick = c.high - Math.max(c.open, c.close);
            return body > 0 && wick / body >= 1.5;
          });

          const m15IEvidenceBlock = `
M15 PRECISION ENTRY EVIDENCE (pre-computed for Alpha):
- M15 BOS BULL (last M15 close > prior M15 high): ${m15IBOSBull ? 'YES — bullish M15 break of structure confirmed' : 'NO'}
- M15 BOS BEAR (last M15 close < prior M15 low): ${m15IBOSBear ? 'YES — bearish M15 break of structure confirmed' : 'NO'}
- M15 SWEEP WICK BULL (lower wick ≥1.5x body in last 2 M15 candles): ${m15ISweepWickBull ? 'YES — bullish absorption signal on M15' : 'NO'}
- M15 SWEEP WICK BEAR (upper wick ≥1.5x body in last 2 M15 candles): ${m15ISweepWickBear ? 'YES — bearish absorption signal on M15' : 'NO'}

M15 CLOSE RULE: A confirmed M15 candle CLOSE in your intended direction at the H1 entry zone is the INTRADAY entry trigger standard.
A wick, an open, or a partial move does not constitute confirmation — only a closed M15 body in your direction counts.
Assess the pre-computed signals above: if M15 BOS or sweep wick confirmation has NOT formed, state what trigger you are waiting for and select wait_pullback.
If M15 confirmation IS present, you may select execute_now — back your reasoning with the specific M15 signal that confirms it.`;

          m5SubConfirmationPrompt += `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M15 PRECISION ENTRY (${marketContext.symbol}) — INTRADAY ENTRY TRIGGER TIMEFRAME
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This is your ENTRY TRIGGER timeframe. H1 defines the structure and setup. M15 is where you pull the trigger.
A confirmed M15 candle CLOSE in your intended direction at the H1 entry zone is required before execute_now.
A wick touch, M15 open, or partial move is NOT confirmation — only a CLOSED M15 body in your direction counts.

${m15IntradayLines.join('\n')}

M15 PRECISION ENTRY SUMMARY:
- M15 Range (last ${recentM15Intraday.length} candles): ${m15IRangePips.toFixed(1)} pips (High: ${m15IHigh.toFixed(pipInfo.decimalPlaces)}, Low: ${m15ILow.toFixed(pipInfo.decimalPlaces)})
- M15 Current directional bias: ${m15IntradayTrendDir}
- Consecutive same-direction M15 candles: ${m15IConsecutive}
- Last M15 candle: ${m15IHasRejectionWick ? 'REJECTION WICK detected (possible exhaustion or reversal at level)' : 'Normal candle — no strong wick signal'}

${m15IEvidenceBlock}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.log(`[Alpha Coordinator] M15 Precision Entry (INTRADAY): ${recentM15Intraday.length} candles, bias ${m15IntradayTrendDir}, BOS_BULL=${m15IBOSBull} BOS_BEAR=${m15IBOSBear}`);
        } else {
          m5SubConfirmationPrompt += `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M15 PRECISION ENTRY (${marketContext.symbol}) — DATA UNAVAILABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WARNING: M15 candle data could not be retrieved (${m15IntradayCandles?.length ?? 0} candles found, need ≥5).
GOVERNANCE CONSEQUENCE: Without M15 precision entry data, you CANNOT select execute_now.
Your entry_mode must be wait_pullback. State the specific M15 trigger you are waiting for.
If you cannot define a specific M15 trigger level on the H1 entry zone, return NO_TRADE.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.warn(`[Alpha Coordinator] M15 precision entry data insufficient for INTRADAY (${m15IntradayCandles?.length ?? 0} candles)`);
        }
      } catch (error) {
        m5SubConfirmationPrompt += `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M15 PRECISION ENTRY (${marketContext.symbol}) — FETCH ERROR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WARNING: M15 precision entry fetch failed. Without M15 data you CANNOT select execute_now.
entry_mode must be wait_pullback with a specific M15 trigger level stated.
If you cannot define a specific M15 trigger level, return NO_TRADE.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        console.warn('[Alpha Coordinator] M15 precision entry fetch failed (non-blocking):', error instanceof Error ? error.message : 'Unknown');
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
            const totalRange = (c.high - c.low) / pipInfo.pipValue;
            const bodyRatio = totalRange > 0 ? Math.round((bodyPips / totalRange) * 100) : 0;
            const wickBias = upperWick > lowerWick * 1.5 ? 'upper' : lowerWick > upperWick * 1.5 ? 'lower' : 'balanced';
            return `  ${i + 1}. ${dir} O:${c.open.toFixed(pipInfo.decimalPlaces)} H:${c.high.toFixed(pipInfo.decimalPlaces)} L:${c.low.toFixed(pipInfo.decimalPlaces)} C:${c.close.toFixed(pipInfo.decimalPlaces)} body:${bodyPips.toFixed(1)}p wicks:${upperWick.toFixed(1)}/${lowerWick.toFixed(1)}p ratio:${bodyRatio}% wick_bias:${wickBias}`;
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
          // M15 STRUCTURAL EVIDENCE COMPUTATION (CCIP 2026-03-03, Alpha Authority)
          //
          // GOVERNANCE: Mirrors HTF evidence computation above. BOS and sweep-wick
          // facts are computed and embedded into the Alpha prompt. Alpha is the sole
          // authority on whether these facts justify a counter-trend SCALP entry.
          // No blocking occurs here — Alpha reasons about the evidence.
          //
          // SSOT: This module computes M15 facts. Alpha owns the trade decision.
          // ═══════════════════════════════════════════════════════════════════
          const m15BOSBull = recentM15.length >= 2 && recentM15[recentM15.length - 1].close > recentM15[recentM15.length - 2].high;
          const m15BOSBear = recentM15.length >= 2 && recentM15[recentM15.length - 1].close < recentM15[recentM15.length - 2].low;
          const m15SweepWickBull = recentM15.slice(-2).some(c => {
            const body = Math.abs(c.close - c.open);
            const wick = Math.min(c.open, c.close) - c.low;
            return body > 0 && wick / body >= 1.5;
          });
          const m15SweepWickBear = recentM15.slice(-2).some(c => {
            const body = Math.abs(c.close - c.open);
            const wick = c.high - Math.max(c.open, c.close);
            return body > 0 && wick / body >= 1.5;
          });

          const m15StructuralEvidenceBlock = `
M15 STRUCTURAL EVIDENCE (pre-computed for Alpha):
- M15 BOS BULL (last close > prior high): ${m15BOSBull ? 'YES — bullish M15 break of structure confirmed' : 'NO'}
- M15 BOS BEAR (last close < prior low): ${m15BOSBear ? 'YES — bearish M15 break of structure confirmed' : 'NO'}
- M15 SWEEP WICK BULL (lower wick ≥1.5x body in last 2 M15 candles): ${m15SweepWickBull ? 'YES — bullish reversal signal on M15' : 'NO'}
- M15 SWEEP WICK BEAR (upper wick ≥1.5x body in last 2 M15 candles): ${m15SweepWickBear ? 'YES — bearish reversal signal on M15' : 'NO'}

M15 COUNTER-TREND SCALP REQUIREMENT: If your M5 entry direction opposes the M15 bias above,
cite at least one qualifying fact (M15 BOS or sweep wick in your direction) in your reasoning.
If zero evidence exists for your counter-trend M15 direction, return NO_TRADE with reason M15_NO_COUNTER_TREND_QUALIFICATION.`;

          console.log(`[Alpha Coordinator] M15 structural evidence: BOS_BULL=${m15BOSBull} BOS_BEAR=${m15BOSBear} WICK_BULL=${m15SweepWickBull} WICK_BEAR=${m15SweepWickBear}`);

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

${m15StructuralEvidenceBlock}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.log(`[Alpha Coordinator] M15 Reference (SCALP): ${recentM15.length} candles, bias ${m15TrendDir}, range ${m15RangePips.toFixed(1)} pips`);
        }
      } catch (error) {
        console.warn('[Alpha Coordinator] M15 reference unavailable (non-blocking):', error instanceof Error ? error.message : 'Unknown');
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // H1 CAMPAIGN CONTEXT (SCALP ONLY — advisory, non-blocking)
    // CCIP 2026-03: SCALP trades play out within the M15 swing, but that
    // swing exists inside an H1 campaign. Alpha needs to know whether the
    // H1 bias supports or opposes the M5 scalp direction, and where the
    // H1 EMA stack and swing structure sit relative to current price.
    //
    // This is advisory — NOT a controlling timeframe gate. Missing H1 data
    // does not block a scalp. Present data enriches Alpha's Q1 reasoning.
    // SSOT: MarketDataService is the single authority for candle data
    // ═══════════════════════════════════════════════════════════════════
    let h1CampaignPrompt = '';
    if (styleName === 'SCALP') {
      try {
        const mds = MarketDataService.getInstance();
        const h1Candles = await mds.getCandles(marketContext.symbol, 'H1', 6);

        if (h1Candles && h1Candles.length >= 3) {
          const recentH1 = h1Candles.slice(0, 6).reverse();
          const pipInfo = getCurrencyPipInfo(marketContext.symbol);

          const h1Lines: string[] = recentH1.map((c, i) => {
            const dir = c.close > c.open ? 'UP' : c.close < c.open ? 'DN' : 'FLAT';
            const bodyPips = Math.abs(c.close - c.open) / pipInfo.pipValue;
            const upperWick = (c.high - Math.max(c.open, c.close)) / pipInfo.pipValue;
            const lowerWick = (Math.min(c.open, c.close) - c.low) / pipInfo.pipValue;
            const totalRange = (c.high - c.low) / pipInfo.pipValue;
            const bodyRatio = totalRange > 0 ? Math.round((bodyPips / totalRange) * 100) : 0;
            const wickBias = upperWick > lowerWick * 1.5 ? 'upper' : lowerWick > upperWick * 1.5 ? 'lower' : 'balanced';
            return `  ${i + 1}. ${dir} O:${c.open.toFixed(pipInfo.decimalPlaces)} H:${c.high.toFixed(pipInfo.decimalPlaces)} L:${c.low.toFixed(pipInfo.decimalPlaces)} C:${c.close.toFixed(pipInfo.decimalPlaces)} body:${bodyPips.toFixed(1)}p wicks:${upperWick.toFixed(1)}/${lowerWick.toFixed(1)}p ratio:${bodyRatio}% wick_bias:${wickBias}`;
          });

          const h1High = Math.max(...recentH1.map(c => c.high));
          const h1Low = Math.min(...recentH1.map(c => c.low));
          const h1RangePips = (h1High - h1Low) / pipInfo.pipValue;
          const lastH1 = recentH1[recentH1.length - 1];
          const prevH1 = recentH1.length >= 2 ? recentH1[recentH1.length - 2] : lastH1;
          const h1TrendDir = lastH1.close > prevH1.close ? 'BULLISH' : lastH1.close < prevH1.close ? 'BEARISH' : 'NEUTRAL';

          h1CampaignPrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
H1 CAMPAIGN CONTEXT (${marketContext.symbol}) — ADVISORY CONTEXT FOR SCALP DIRECTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
This is NOT your primary execution timeframe. H1 is advisory — it shows the larger campaign bias your M5 scalp is operating within. Use it in your QUESTION 1 TREND ALIGNMENT assessment.

${h1Lines.join('\n')}

H1 CAMPAIGN SUMMARY:
- H1 Range (last ${recentH1.length} candles): ${h1RangePips.toFixed(1)} pips (High: ${h1High.toFixed(pipInfo.decimalPlaces)}, Low: ${h1Low.toFixed(pipInfo.decimalPlaces)})
- H1 Directional bias: ${h1TrendDir}
- H1 Key resistance (campaign ceiling): ${h1High.toFixed(pipInfo.decimalPlaces)}
- H1 Key support (campaign floor): ${h1Low.toFixed(pipInfo.decimalPlaces)}

SCALP DIRECTION ALIGNMENT USING H1:
- H1 bias ${h1TrendDir} SUPPORTS ${h1TrendDir === 'BULLISH' ? 'BUY' : h1TrendDir === 'BEARISH' ? 'SELL' : 'range extremes for'} scalp entries.
- If your M5 scalp direction OPPOSES the H1 bias, this is a counter-campaign scalp — state your structural justification in Q1.
- H1 swing high/low within your scalp TP range (12-25 pips) = the level may act as TP ceiling. Position TP at the near edge.
- This context is ADVISORY. M5 structure is your execution authority. H1 does not block your scalp decision.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.log(`[Alpha Coordinator] H1 Campaign Context (SCALP): ${recentH1.length} candles, bias ${h1TrendDir}, range ${h1RangePips.toFixed(1)} pips`);
        }
      } catch (error) {
        console.warn('[Alpha Coordinator] H1 campaign context unavailable (non-blocking):', error instanceof Error ? error.message : 'Unknown');
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
      // CCIP 2026-03-03: INTRADAY fetches 5 D1 candles for structural campaign context.
      // SCALP/MICRO_INTRADAY only need PDH/PDL reference (3 candles sufficient).
      const d1FetchCount = styleName === 'INTRADAY' ? 5 : 3;
      const d1Candles = await mds.getCandles(marketContext.symbol, 'D1', d1FetchCount);

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

        // ═══════════════════════════════════════════════════════════════════
        // WEEKLY HIGH/LOW: Derive PWH/PWL from D1 candles (Mon-Fri of prev week).
        // PWH/PWL are the most significant weekly liquidity reference levels.
        // SSOT: Computed inline here since W1 candle fetch is not always available.
        // ═══════════════════════════════════════════════════════════════════
        let pwhValue: number | null = null;
        let pwlValue: number | null = null;
        try {
          const mds = MarketDataService.getInstance();
          const w1Candles = await mds.getCandles(marketContext.symbol, 'W1', 3);
          if (w1Candles && w1Candles.length >= 2) {
            const prevWeekCandle = w1Candles[1];
            pwhValue = prevWeekCandle.high;
            pwlValue = prevWeekCandle.low;
          }
        } catch {
          // Weekly candles are optional — fall back to null (non-blocking)
        }
        const distToPWH = pwhValue !== null ? Math.abs(currentPrice - pwhValue) / pipInfo.pipValue : null;
        const distToPWL = pwlValue !== null ? Math.abs(currentPrice - pwlValue) / pipInfo.pipValue : null;
        const weeklyRefBlock = (pwhValue !== null && pwlValue !== null)
          ? `Previous Week High (PWH): ${pwhValue.toFixed(pipInfo.decimalPlaces)} — ${distToPWH !== null ? distToPWH.toFixed(1) : '?'} pips away | Price is ${currentPrice > pwhValue ? 'ABOVE' : 'below'} PWH
Previous Week Low (PWL): ${pwlValue.toFixed(pipInfo.decimalPlaces)} — ${distToPWL !== null ? distToPWL.toFixed(1) : '?'} pips away | Price is ${currentPrice < pwlValue ? 'BELOW' : 'above'} PWL`
          : '';
        // ROUND NUMBERS: Compute nearest round price levels for TP path audit.
        // For FX pairs: major round = 00-pip (X.XX00), minor round = 50-pip (X.XX50).
        // For indices/metals: nearest 100 and 50 levels.
        // For crypto: nearest 100 and 50 levels (prices >> 1000).
        const isIndexOrMetal = ['US30', 'NAS100', 'SP500', 'XAUUSD', 'XAGUSD'].includes(marketContext.symbol);
        const isCrypto = ['BTCUSD', 'ETHUSD'].includes(marketContext.symbol);
        let roundStep: number;
        let minorStep: number;
        if (isCrypto) {
          roundStep = 1000;
          minorStep = 500;
        } else if (isIndexOrMetal) {
          roundStep = marketContext.symbol === 'XAUUSD' || marketContext.symbol === 'XAGUSD' ? 50 : 100;
          minorStep = roundStep / 2;
        } else {
          const priceScale = Math.pow(10, pipInfo.decimalPlaces);
          roundStep = 100 / priceScale;
          minorStep = 50 / priceScale;
        }
        const nearestMajorAbove = Math.ceil(currentPrice / roundStep) * roundStep;
        const nearestMajorBelow = Math.floor(currentPrice / roundStep) * roundStep;
        const nearestMinorAbove = Math.ceil(currentPrice / minorStep) * minorStep === nearestMajorAbove
          ? nearestMajorAbove + minorStep
          : Math.ceil(currentPrice / minorStep) * minorStep;
        const nearestMinorBelow = Math.floor(currentPrice / minorStep) * minorStep === nearestMajorBelow
          ? nearestMajorBelow - minorStep
          : Math.floor(currentPrice / minorStep) * minorStep;
        const distToMajorAbove = Math.abs(currentPrice - nearestMajorAbove) / pipInfo.pipValue;
        const distToMajorBelow = Math.abs(currentPrice - nearestMajorBelow) / pipInfo.pipValue;
        const distToMinorAbove = Math.abs(currentPrice - nearestMinorAbove) / pipInfo.pipValue;
        const distToMinorBelow = Math.abs(currentPrice - nearestMinorBelow) / pipInfo.pipValue;
        const roundNumbersBlock = `ROUND NUMBERS (institutional reference — include in TP path audit):
  Major above: ${nearestMajorAbove.toFixed(pipInfo.decimalPlaces)} — ${distToMajorAbove.toFixed(1)} pips away
  Minor above: ${nearestMinorAbove.toFixed(pipInfo.decimalPlaces)} — ${distToMinorAbove.toFixed(1)} pips away
  Minor below: ${nearestMinorBelow.toFixed(pipInfo.decimalPlaces)} — ${distToMinorBelow.toFixed(1)} pips away
  Major below: ${nearestMajorBelow.toFixed(pipInfo.decimalPlaces)} — ${distToMajorBelow.toFixed(1)} pips away`;

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

        // CCIP 2026-03-03: INTRADAY D1 structural campaign block — shows multi-day trend
        // direction, swing highs/lows, and daily candle sequence for Alpha to assess
        // whether the H4 campaign aligns with the daily structural narrative.
        // This replaces the PDH/PDL-only view that was insufficient for INTRADAY.
        let intradayD1StructureBlock = '';
        if (styleName === 'INTRADAY' && d1Candles.length >= 3) {
          const structuralCandles = d1Candles.slice(1).reverse(); // oldest-to-newest, skip today's forming candle
          const d1Lines = structuralCandles.map((c, i) => {
            const dir = c.close > c.open ? 'BULL' : 'BEAR';
            const rangePips = (c.high - c.low) / pipInfo.pipValue;
            const bodyPips = Math.abs(c.close - c.open) / pipInfo.pipValue;
            const upperWick = (c.high - Math.max(c.open, c.close)) / pipInfo.pipValue;
            const lowerWick = (Math.min(c.open, c.close) - c.low) / pipInfo.pipValue;
            const bodyRatio = rangePips > 0 ? Math.round((bodyPips / rangePips) * 100) : 0;
            const dateStr = c.time ? new Date(c.time * 1000).toISOString().split('T')[0] : `D-${structuralCandles.length - i}`;
            const label = i === structuralCandles.length - 1 ? ' ← PREVIOUS DAY' : '';
            return `  ${dateStr}${label}: ${dir} O:${c.open.toFixed(pipInfo.decimalPlaces)} H:${c.high.toFixed(pipInfo.decimalPlaces)} L:${c.low.toFixed(pipInfo.decimalPlaces)} C:${c.close.toFixed(pipInfo.decimalPlaces)} range:${rangePips.toFixed(0)}p body:${bodyPips.toFixed(0)}p(${bodyRatio}%) wicks:↑${upperWick.toFixed(0)}p↓${lowerWick.toFixed(0)}p`;
          });

          // Determine D1 trend bias from the structural candles
          const bullDays = structuralCandles.filter(c => c.close > c.open).length;
          const bearDays = structuralCandles.length - bullDays;
          const d1SwingHigh = Math.max(...structuralCandles.map(c => c.high));
          const d1SwingLow = Math.min(...structuralCandles.map(c => c.low));
          const d1SwingHighPips = Math.abs(currentPrice - d1SwingHigh) / pipInfo.pipValue;
          const d1SwingLowPips = Math.abs(currentPrice - d1SwingLow) / pipInfo.pipValue;

          let d1Bias = 'NEUTRAL';
          if (bullDays >= Math.ceil(structuralCandles.length * 0.67)) d1Bias = 'BULLISH';
          else if (bearDays >= Math.ceil(structuralCandles.length * 0.67)) d1Bias = 'BEARISH';

          // Detect consecutive directional sequence (momentum)
          let consecutiveD1 = 1;
          let d1MomentumDir = structuralCandles[structuralCandles.length - 1].close > structuralCandles[structuralCandles.length - 1].open ? 'BULLISH' : 'BEARISH';
          for (let i = structuralCandles.length - 2; i >= 0; i--) {
            const dir = structuralCandles[i].close > structuralCandles[i].open ? 'BULLISH' : 'BEARISH';
            if (dir === d1MomentumDir) consecutiveD1++;
            else break;
          }
          const momentumNote = consecutiveD1 >= 2 ? `${consecutiveD1} consecutive ${d1MomentumDir} daily candles — strong daily momentum present.` : 'Mixed daily directional sequence — no clear daily momentum streak.';

          intradayD1StructureBlock = `
D1 DAILY STRUCTURAL CAMPAIGN (${structuralCandles.length}-day view — oldest to newest):
${d1Lines.join('\n')}

Daily Campaign Summary:
  Bullish days: ${bullDays} / Bearish days: ${bearDays} → D1 Structural Bias: ${d1Bias}
  ${momentumNote}
  D1 Swing High (${structuralCandles.length}d): ${d1SwingHigh.toFixed(pipInfo.decimalPlaces)} — ${d1SwingHighPips.toFixed(0)} pips ${currentPrice > d1SwingHigh ? 'BELOW (price above)' : 'above current price'}
  D1 Swing Low (${structuralCandles.length}d): ${d1SwingLow.toFixed(pipInfo.decimalPlaces)} — ${d1SwingLowPips.toFixed(0)} pips ${currentPrice < d1SwingLow ? 'ABOVE (price below)' : 'below current price'}

INTRADAY D1 STRUCTURAL RULES:
- Your INTRADAY trade must be ALIGNED with the D1 structural bias above. Counter-trend INTRADAY trades require an explicit structural reason (e.g., daily exhaustion, major reversal zone, or D1 swing high/low rejection).
- The D1 swing high and low define the CAMPAIGN BOUNDARIES for INTRADAY. TP targets that breach a D1 swing high (for BUY) or swing low (for SELL) without justification signal overreach.
- If D1 bias is BULLISH, prefer BUY setups on H4 pullbacks. SELL setups require D1-level rejection confirmation.
- If D1 bias is BEARISH, prefer SELL setups on H4 retracements. BUY setups require D1-level support confirmation.
- If D1 bias is NEUTRAL, both directions are valid but your H4 structure becomes the primary campaign authority.
- ALWAYS state how the D1 structural bias supports or challenges your intended direction in your reasoning.`;
        }

        d1ContextPrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSTITUTIONAL REFERENCE LEVELS (${marketContext.symbol})${isScalp ? ' [ADVISORY]' : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Previous Day Date: ${prevDayDate}
Previous Day High (PDH): ${prevDayHigh.toFixed(pipInfo.decimalPlaces)} — ${distToPDH.toFixed(1)} pips away
Previous Day Low (PDL): ${prevDayLow.toFixed(pipInfo.decimalPlaces)} — ${distToPDL.toFixed(1)} pips away
Previous Day Close: ${prevDayClose.toFixed(pipInfo.decimalPlaces)} (${prevDayDir} day, range: ${prevDayRange.toFixed(1)} pips)
${weeklyRefBlock ? weeklyRefBlock + '\n' : ''}${roundNumbersBlock}
Current Position: ${positionContext}
Price vs PD Range: ${pricePositionInPDRange}% from PDL (0%=at PDL, 100%=at PDH)${pwhValue !== null && pwlValue !== null ? `
WEEKLY LEVELS RULE: PWH and PWL are the MOST SIGNIFICANT weekly liquidity reference levels. Market makers run stops above PWH and below PWL. When price is within 10 pips of PWH or PWL, include these in your TP path audit as named obstacles or potential targets. A break above PWH or below PWL with a strong body close signals institutional commitment to the weekly direction.` : ''}

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
${intradayD1StructureBlock}
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
      const m1CandleCount = tradeStyle === 'SCALP' ? 20 : tradeStyle === 'MICRO_INTRADAY' ? 12 : 8;
      const m1Candles = await mds.getCandles(marketContext.symbol, 'M1', m1CandleCount);

      if (m1Candles && m1Candles.length >= 5) {
        const recentM1 = m1Candles.slice(0, m1CandleCount).reverse();
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
      // CCIP-2026-03-09: Prompt reframed from blocker-first to trade-finder.
      // Previously: "no named structure = NO_TRADE" and "exhausted = NO_TRADE" were hard rules.
      // Now: structure identification is guidance, exhausted momentum triggers confidence
      // reduction not automatic refusal. Alpha's objective is to find the best trade
      // available, not to refuse when conditions are less than textbook.
      scalpIntelligencePrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCALP MOMENTUM SELF-ASSESSMENT (${marketContext.symbol}) — MANDATORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
No pre-computed intelligence snapshot is available for this scan cycle.
Your PRIMARY OBJECTIVE is to find the best executable trade. Self-assess from the M5 candle data:

1. ATR PHASE: Calculate how far price has moved from the last swing point.
   - FRESH / STARTING (< 0.75x ATR): Ideal window — full confidence permitted
   - DEVELOPING (0.75-1.5x ATR): Acceptable — assess remaining runway to TP. State: "Remaining range: ~X pips to nearest structure." Tighten TP to nearest achievable structure if needed.
   - EXHAUSTED / EXTENDED (> 1.5x ATR): Move is extended — look for a structural reversal, retest, or sweep setup rather than a continuation entry. This is NOT an automatic NO_TRADE — exhausted moves often produce the highest-quality reversal entries. State your exhaustion assessment explicitly.

2. SUB-MODE: Identify which of these applies to the current M5 structure:
   - MOMENTUM_CONTINUATION: Fresh directional move, enter now or on first micro-pullback
   - PULLBACK_ENTRY: Impulse already moved, price retracing — wait for pullback completion
   - CONSOLIDATION_BREAKOUT: Tight compression range — wait for body close outside range

3. STRUCTURE: Identify which of the 8 named scalp structures is present (or closest match):
   momentum_breakout | bos_retest | ema_rejection | double_bottom | double_top |
   range_breakout | liquidity_sweep | engulfing_at_structure | trend_pullback_ema

   GUIDANCE (not a hard block): Identify which named structure best matches what you see,
   or describe the structure in plain terms if none of the 8 names apply. A valid scalp
   requires directional intent supported by price structure — it does not require a
   textbook named pattern. If 2+ dimensions align (ATR phase, structure, direction),
   that is a tradeable setup. Return NO_TRADE only when you cannot identify any
   directional reason with supporting structure.

MANDATORY JSON FIELDS — Include these regardless of action:
  "scalp_pattern": "<one of the 8 structures above, or describe the structure>",
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
          // CCIP-2026-03-09: Phase labels reframed — exhausted is now advisory, not a hard block.
          const phaseLabels: Record<string, string> = {
            starting: 'STARTING / FRESH (< 0.75x ATR traveled — ideal scalp window, full confidence)',
            developing: 'DEVELOPING (0.75-1.5x ATR traveled — assess remaining runway to TP explicitly; tighten TP to nearest structure if runway is insufficient)',
            exhausted: 'EXHAUSTED / EXTENDED (> 1.5x ATR traveled — move is extended. Look for a reversal, retest, or sweep setup rather than a continuation entry — exhausted moves often produce the best reversal entries. State your assessment. Only return NO_TRADE if no directional case exists at all)',
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
  ? `EXHAUSTED MOMENTUM: ATR traveled > 1.5x — this move is extended. Look for a structural reversal, retest, or sweep setup rather than a continuation entry. If a BOS, sweep extreme, EMA rejection, or level reaction is present, set your confidence based on the structural merit of that reversal setup. State your exhaustion assessment explicitly. Only return NO_TRADE if there is genuinely no directional case — not merely because conditions are imperfect. Do NOT change the trade style.`
  : scalpSignal.momentumPhase === 'developing'
    ? `DEVELOPING MOMENTUM: ~${scalpSignal.atrTraveled?.toFixed(2) ?? '?'}x ATR consumed. Range is partially used. You MUST assess whether sufficient runway exists between current price and your TP. State explicitly: "Remaining runway: ~X pips to nearest structure. TP placed at [level] — the [near/far] edge of that zone." Tighten TP to the nearest achievable structure rather than returning NO_TRADE unless the runway is genuinely insufficient for any viable R:R. Do NOT apply an arbitrary confidence penalty — reason about the runway directly.`
    : `FRESH MOMENTUM: < 0.75x ATR consumed. Full confidence permitted. Enter early in the leg.`
}

${scalpSignal.scalpSubMode === 'pullback_entry'
  ? `PULLBACK ENTRY RULE: Do NOT enter during the retrace. If pullback completion is not confirmed by a continuation candle on M5, use wait_pullback — not execute_now. Entering mid-retrace is the #1 scalp failure mode.`
  : scalpSignal.scalpSubMode === 'consolidation_breakout'
    ? `CONSOLIDATION BREAKOUT RULE: A candle BODY close outside the compression range is required. A wick touch is NOT a breakout. If body close has not occurred, use wait_pullback.`
    : `MOMENTUM CONTINUATION: Fresh directional move. Enter on the breakout or within the first 1-2 candle pullback.`
}


${scalpSignal.scalpPattern === 'none' || !scalpSignal.scalpPattern
  ? `NO NAMED STRUCTURE PRE-DETECTED: The intelligence monitor found no textbook match. GUIDANCE: Identify which of the 8 named structures best fits what you observe in the M5 data, or describe the structure you see. Valid scalps do not require textbook patterns — they require directional intent supported by price structure. If 2+ factors align (phase, direction, nearby level), that is a tradeable setup. If you find a structure, name it in "scalp_pattern". If you genuinely cannot identify any structural reason for a trade, set "scalp_pattern": "none" and return NO_TRADE.`
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

    // ═══════════════════════════════════════════════════════════════════
    // ATR FIELD LEGEND — Transparency block for Alpha
    // Alpha uses ATR-based move stage diagnosis and SL sizing throughout.
    // This block makes the ATR field mapping explicit so Alpha knows
    // WHICH timeframe's ATR is being referenced in each calculation.
    // SSOT: styleAtrMap (line ~994) is the authoritative field mapping.
    // ═══════════════════════════════════════════════════════════════════
    const pipInfoForLegend = getCurrencyPipInfo(marketContext.symbol);
    const atr20Value = extractATRValue(marketContext.atr20 as unknown as number | import('../types/atr').ATRValue | undefined);
    const atrValue = extractATRValue(marketContext.atr);
    const atr100Value = extractATRValue(marketContext.atr100 as unknown as number | import('../types/atr').ATRValue | undefined);
    const atr20Pips = atr20Value > 0 ? (atr20Value / pipInfoForLegend.pipValue).toFixed(1) : 'N/A';
    const atrPips = atrValue > 0 ? (atrValue / pipInfoForLegend.pipValue).toFixed(1) : 'N/A';
    const atr100Pips = atr100Value > 0 ? (atr100Value / pipInfoForLegend.pipValue).toFixed(1) : 'N/A';
    const activeAtrPips = atrForStopLoss > 0 ? (atrForStopLoss / pipInfoForLegend.pipValue).toFixed(1) : 'N/A';

    const atrLegendPrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MARKET DATA LEGEND — ATR FIELD REFERENCE (${marketContext.symbol})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ATR values in market context map to specific timeframes. When you reference "ATR" in move stage diagnosis, structural space requirements, and SL sizing, you are referring to the ACTIVE ATR for this session style.

  marketContext.atr20  = SCALP primary ATR (20-period, M5-based)         — SCALP stop sizing reference              | Current: ${atr20Pips} pips
  marketContext.atr    = MICRO/INTRADAY ATR (14-period, M15-based)        — MICRO_INTRADAY & INTRADAY stop reference | Current: ${atrPips} pips
  (atr100 is a long-period H4 regime reference field — NOT populated, NOT used for stop sizing in any style)

ACTIVE ATR for this session (${tradeStyle}): ${activeAtrPips} pips — this is your baseline ATR (using ${preferredAtrField} field)
For INTRADAY: move stage thresholds below are computed from the same baseline. The H1 MOVE STAGE ADVISORY block (if present above) uses H1 candle-derived ATR for finer phase accuracy.

Use the ACTIVE ATR value above for all move stage calculations in this scan cycle:
  - FRESH / STARTING:  price has traveled < 0.75 × ${activeAtrPips} pips = < ${atrForStopLoss > 0 ? ((atrForStopLoss * 0.75) / pipInfoForLegend.pipValue).toFixed(1) : 'N/A'} pips from swing origin
  - DEVELOPING:        0.75–1.5 × ${activeAtrPips} pips = ${atrForStopLoss > 0 ? ((atrForStopLoss * 0.75) / pipInfoForLegend.pipValue).toFixed(1) : 'N/A'}–${atrForStopLoss > 0 ? ((atrForStopLoss * 1.5) / pipInfoForLegend.pipValue).toFixed(1) : 'N/A'} pips from swing origin
  - EXHAUSTED:         > 1.5 × ${activeAtrPips} pips = > ${atrForStopLoss > 0 ? ((atrForStopLoss * 1.5) / pipInfoForLegend.pipValue).toFixed(1) : 'N/A'} pips from swing origin${tradeStyle === 'SCALP' ? ' → ADVISORY: reduce confidence 15-25pts. Assess structural justification (reversal/retest/sweep). Exhausted moves can produce strong reversals. Only NO_TRADE if no directional case exists' : tradeStyle === 'INTRADAY' ? ' → ADVISORY: reduce confidence 15-25pts. Reason about reversal/retest/sweep. Recalculate R:R from current price. Only NO_TRADE if recalculated TP1 R:R < 1.0:1' : tradeStyle === 'MICRO_INTRADAY' ? ' → ADVISORY: reduce confidence 15-25pts. Reason about structural reversal/retest/sweep setup. Exhausted M15 moves can produce strong reversals. Only NO_TRADE if no directional structural case exists' : ' → requires explicit continuation justification with R:R recalculation'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

    // ═══════════════════════════════════════════════════════════════════
    // CCIP-2026-03-16A: REASONING ORDER GOVERNANCE
    // ═══════════════════════════════════════════════════════════════════
    // The prompt is assembled in a deliberate cognitive sequence:
    //
    // LAYER 1 — IDENTITY & FRAMEWORK: Who Alpha is and how to decide.
    //   styleIdentityPrompt, atrLegendPrompt, PROFESSIONAL REASONING CONTRACT
    //
    // LAYER 2 — MACRO INTELLIGENCE: Market state BEFORE raw candles.
    //   Market Intelligence Briefing (Omega votes), advisory context,
    //   daily narrative, micro-regime, liquidity intent, pattern intelligence,
    //   conflict context, risk context, advanced patterns.
    //   Rationale: Alpha must form the macro context BEFORE interpreting
    //   individual candles — this mirrors how professional analysts work
    //   (top-down: macro → structure → entry).
    //
    // LAYER 3 — Q7 CONFLUENCE SCORING RUBRIC: Scoring instructions BEFORE
    //   the evidence that must be scored. Alpha knows what to look for before
    //   reading the data, not after.
    //
    // LAYER 4 — RAW CANDLE EVIDENCE: Candle data interpreted through the
    //   macro lens and Q7 rubric already established above.
    //   Includes SL directive immediately after candle data (SL placement
    //   requires structural context, not pre-knowledge of the anchor).
    //
    // LAYER 5 — OUTPUT SYNTHESIS GATE: Explicit reconciliation step
    //   BEFORE the JSON schema forces early commitment. Alpha must
    //   resolve contradictions before producing output.
    //
    // LAYER 6 — OUTPUT SCHEMA: JSON template.
    //
    // SSOT: This ordering is the ONLY authoritative reasoning sequence.
    //       Any change to this order is a CCIP governance event.
    //
    // CCIP-2026-03-16-PROMPT-COMPRESSION:
    //   Root cause fix for 504 Gateway Timeout on /.netlify/functions/openai-chat.
    //   The prompt was ~18,000 tokens causing LLM latency to exceed the 45s abort
    //   window under infrastructure load. This compression targets ~8,000-10,000 tokens.
    //   Changes made (SSOT-compliant, zero performance degradation):
    //   1. REMOVED duplicate Layer 3 Q7 rubric from user prompt — already in system prompt
    //      (getAlphaSystemPromptForStyle in alpha-identity.ts). Zero data loss.
    //   2. REMOVED duplicate output schema from user prompt — already in system prompt.
    //      User prompt now contains a single-line schema reference only.
    //   3. REMOVED ratio:% and wick_bias: from all 7 candle line builders — these are
    //      derivable by Alpha from the OHLC and body/wicks values already present.
    //      Candle counts are UNCHANGED (SCALP=15 M5 + 20 M1, etc.).
    //   4. COMPRESSED Market Intelligence Briefing from ~12 verbose multi-line sections
    //      to ~7 compact single-line sections. All data fields preserved.
    //   The system prompt (cached by OpenAI) holds all static instructional content.
    //   The user prompt holds only dynamic per-symbol market data.
    // ═══════════════════════════════════════════════════════════════════

    // CCIP-2026-0318A-ADVISORY: Opportunity-Seeker Mandate — replaces CCIP-2026-0317A "capital
    // preservation" philosophy. Alpha's standard is finding and executing the best available
    // opportunity every scan cycle. An ACCEPTABLE setup (50-69% confidence) with structural
    // basis and correct RR is a valid trade. NOT executing on a valid setup is a scan failure.
    // SSOT: System prompt (alpha-identity.ts) carries Alpha's identity and reasoning framework.
    // This section provides per-scan context: streak, advisory designations, hard block list,
    // confidence bands, and the active-scan mandate.
    const prompt = `${styleIdentityPrompt}
${cachedThesisPrompt}
${atrLegendPrompt}
SCAN CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${streakContextLine}

SCAN STANDARD (CCIP-2026-0324A): I read the market first and form a view from evidence. A valid trade requires: named structure, a fired entry trigger, genuine confluence of supporting dimensions, and entry positioned correctly within the structural zone. An ACCEPTABLE setup (50-69% confidence) that satisfies these criteria is a real trade. A scan that produces NO_TRADE because no setup meets these criteria is a successful and honest scan. Outputting a trade to avoid returning NO_TRADE is a worse outcome than NO_TRADE.

CONFIDENCE BANDS (for this scan):
- EXCELLENT (85-100%): Execute with maximum conviction
- SOLID (70-84%): Execute with standard sizing
- ACCEPTABLE (50-69%): Execute — this is the hidden gem category
- INSUFFICIENT (0-49%): Genuine NO_TRADE — no structural basis

I read macro intelligence first, then interpret candle evidence through that lens. My system prompt defines how I think. What follows is the market data for this scan.

ADVISORY SOURCES (context inputs — not decision gates):
- Regime Oracle: session and volatility regime context
- Adversarial Detector: manipulation and trap pattern warnings
- Session Constraints: time-based liquidity context
- Advisory signals inform my reasoning. Combined effect ceiling: ${ALPHA_IDENTITY.MAX_ADVISORY_PENALTY} points.
- Omega Council (Omega-7 through Omega-10): raw price-structure sensor data. Omega observations are inputs I reason about — not post-hoc deductions from my confidence. Omega disagreement is data, not a veto.

HARD BLOCK CONDITIONS (the only conditions that produce NO_TRADE automatically):
${ALPHA_IDENTITY.LEGITIMATE_BLOCK_CONDITIONS.map(c => `- ${c}`).join('\n')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LAYER 2 — MACRO INTELLIGENCE (Read before candles)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MARKET INTELLIGENCE BRIEFING:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${briefing.briefingText}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Risk Mode: ${riskMode.toUpperCase()}

${conflictContext}${regimeLocationConflictAdvisory}${advisoryContext}${riskContext}${rrPerformanceContext}${recentTradesContext}${dailyNarrativeContext}${microRegimeContext}${liquidityIntentContext}${patternContext}${intelligenceContext}${imSignalContext}${goalContextText}${liquidityContext}${constraintsText}

MARKET CONDITIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Volatility: ${volatilityRegime.regime.toUpperCase()} ${volatilityRegime.ratio !== 1.0 ? `(${volatilityRegime.ratio.toFixed(2)}x)` : ''} | ${volatilityRegime.recommendation}
  Stop Quality: ${stopQuality.score}/100 | ${stopQuality.recommendation}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LAYER 4 — RAW CANDLE EVIDENCE (Interpret through macro lens above)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${m5ContextPrompt}
${primaryTfCandlePrompt}
${htfCandlePrompt}
${m5SubConfirmationPrompt}
${m15ReferencePrompt}
${h1CampaignPrompt}
${d1ContextPrompt}
${m1MicroContextPrompt}
${scalpIntelligencePrompt}
${intradayMovePhaseContext}
${microIntradayMovePhaseContext}
${scalpMovePhaseContext}
${stopLossDirective}

Actions: BUY (bullish edge), SELL (bearish edge), NO_TRADE (no structural edge or hard block condition met).
When analyzing multiple pairs, execute the best opportunity. Scanner re-evaluates every cycle.
BUY: SL < Entry < TP | SELL: TP < Entry < SL

TAKE-PROFIT RULES (ALPHA SOLE AUTHORITY):
You choose ALL profit targets. The system never calculates TP for you. TP placement is driven by market structure — not by formula. The minimum is always 1.0:1 (negative expectancy is never acceptable). Above that, you place TP where structure supports.
- SCALP: ONE take-profit ("takeProfit"). Minimum R:R 1.0:1. Post-spread net R:R must still be >= 1.0:1 — account for spread cost explicitly.
  Place TP at the CONSERVATIVE EDGE (near side) of the target S/R zone.
  SELL: TP at the TOP of the support zone (upper boundary where candles first cluster), NOT the bottom.
  BUY: TP at the BOTTOM of the resistance zone (lower boundary where candles first cluster), NOT the top.
  A filled TP at the near edge always beats an unfilled TP at the far edge. Name the structural level in tp_structural_reference.
- MICRO_INTRADAY: TWO take-profits. Minimum R:R 1.0:1.
  "tp1" = Conservative partial target at the CONSERVATIVE EDGE of the nearest M15 structural zone (not M5 micro-structure). TP1 R:R vs SL must be >= 1.0:1.
  "tp2" = Full target at the CONSERVATIVE EDGE of the nearest H1 structural zone. TP2 R:R must be >= TP1 R:R.
  tp1 must be closer to entry than tp2. Both must be within arena walls.
  Alpha has full authority to place TP1 and TP2 based on what market structure is offering.
  TP1 IS MANDATORY for MICRO_INTRADAY. A response without a numeric "tp1" field is a malformed response — output NO_TRADE instead. There is no valid MICRO_INTRADAY trade without TP1.
  If no M15 structure exists at >= 1.0:1 distance, NO_TRADE. SL must be behind a genuine M15 structural level — scalp-sized stops on MICRO trades are auto-rejected.
- INTRADAY: TWO take-profits. Minimum R:R 1.0:1.
  "tp1" = Conservative partial target at the CONSERVATIVE EDGE of the nearest H1 structural zone (not M15 micro-structure). TP1 R:R vs SL must be >= 1.0:1.
  "tp2" = Full target at the CONSERVATIVE EDGE of the nearest H4 structural zone. TP2 R:R must be >= TP1 R:R.
  tp1 must be closer to entry than tp2. Both must be within arena walls.
  Alpha has full authority to place TP1 and TP2 based on what market structure is offering.
  TP1 IS MANDATORY for INTRADAY. A response without a numeric "tp1" field is a malformed response — output NO_TRADE instead. There is no valid INTRADAY trade without TP1.
  If no H1 structure exists at >= 1.0:1 distance, NO_TRADE.

ENTRY MODE — SMART WAITING SYSTEM:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The entry_mode field controls when the trade executes. You have full authority to choose the right mode based on market conditions.

  "execute_now"       → The full picture aligns NOW. Trend, structure, momentum, timing, and entry trigger
                        are all confirmed. Execute at current market price immediately.
                        REQUIRES: A named trigger that has already fired (candle close, BOS, sweep-reclaim,
                        structural rejection). Proximity alone is not a trigger.

  "wait_pullback"     → Equivalent to a LIMIT ORDER. The full picture aligns EXCEPT the current entry
                        price is overextended from the optimal zone. Thesis is valid; you are managing
                        timing, not conviction. The system places a limit-style entry that executes the
                        instant price touches your defined zone — no candle close required.
                        USE WHEN: Price is extended from structure, you want to buy at support or sell
                        at resistance, or you need a better risk/reward entry. The pullback zone must
                        be defined around a genuine structural level (e.g. prior support, VWAP retest,
                        50% retracement of the last impulse).
                        REQUIRES: "wait_condition" block. State the exact pullback target zone (min/max
                        price), the price that invalidates the thesis, and your reasoning.
                        COHERENCE: The pullback zone MUST be a lower price than current price for BUY
                        (price needs to come DOWN to you) or a higher price for SELL (price needs to
                        come UP to you). If price is already at or inside your zone, use "execute_now".
                        If the pullback would cross a structural invalidation level, use NO_TRADE.

  "push_confirmation" → STRONGER than a limit order — requires a candle close inside the zone.
                        The full picture will align IF price pushes into a specific zone AND closes
                        an M5 candle body INSIDE it. A wick touch or brief spike is NOT sufficient.
                        USE WHEN: Breakout entries, breakout retests, or when you need confirmed
                        commitment (a candle body close) before executing. This prevents false breakouts.
                        REQUIRES: "wait_condition" block. Set the zone tightly around the structural
                        level (1-3 pip width). The system monitors M5 candles and executes only after
                        a closed candle body confirms commitment.
                        COHERENCE: The zone must be at a price NOT YET reached — if price is already
                        inside your zone, use "execute_now" instead.

ENTRY MONITOR DEPENDENCY — LIVE STATUS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${entryMonitorStatusLine}

"wait_pullback" and "push_confirmation" require the entry monitor to be active.
If the entry monitor is OFFLINE, those modes will be blocked to NO_TRADE regardless
of your analysis — so use "execute_now" or NO_TRADE only in that case.
If the entry monitor is ACTIVE, all three entry modes are available and you should
choose the one that best matches the structural setup — including "wait_pullback" when
price is extended from your ideal entry zone, or "push_confirmation" for breakout retests.

RULE: Choose "wait_pullback" or "push_confirmation" only when you have a named structural
target zone with clear justification. Vague discomfort about current price is NOT grounds
for waiting. If no named structural zone exists for the wait, use "execute_now" or NO_TRADE.

NEVER output "wait_pullback" or "push_confirmation" as a fallback when you are uncertain
about the current entry. These modes require a specific, named target zone with clear
structural justification. Uncertainty is grounds for NO_TRADE.

BREAKOUT ENTRIES — MANDATORY RULE:
If Q6_entry_trigger is a breakout (price must trade THROUGH a level it has NOT YET reached —
e.g. "breakout above X", "break of structure above Y", "push through resistance Z") AND
Q4_momentum_stage is DEVELOPING, then "execute_now" is STRUCTURALLY INVALID.
The breakout has not fired yet. Executing now means entering BEFORE your own trigger.
You MUST use "push_confirmation" with a wait_condition zone set at the breakout level.
Failure to do so is a coherence violation — the system will flag it in governance logs.

WAIT_PULLBACK COHERENCE RULES — MANDATORY:
Before choosing "wait_pullback", verify all of the following or use NO_TRADE:
  - The pullback zone is in the CORRECT direction: lower than current price for BUY, higher for SELL.
  - The zone is anchored to a named structural level (support, VWAP, Fibonacci, prior swing high/low).
  - Price reaching the zone does NOT cross the thesis invalidation level.
  - The expected wait time is reasonable given market context (not more than 60 min for scalp/micro).
  - You are NOT choosing wait_pullback merely because current price feels "high" or "extended" without
    a specific structural target — vague discomfort is NOT a valid pullback thesis.

If none of these three apply: output NO_TRADE. There is no fourth option.

When using wait_pullback or push_confirmation, include a wait_condition block:
{
  "wait_condition": {
    "target_entry_zone_min": <lower bound of the wait zone>,
    "target_entry_zone_max": <upper bound of the wait zone>,
    "invalidation_price": <price that invalidates the thesis entirely>,
    "wait_reasoning": "Why you are waiting — what structural level defines the zone",
    "expected_wait_minutes": <your estimate of how long until price reaches the zone, e.g. 15>
  }
}

IMPORTANT: For push_confirmation, the zone defines where the M5 candle must CLOSE — not just touch.
Set the zone tightly around your structural level (1-3 pip width is appropriate for confirmation).
For wait_pullback, the zone defines the limit entry price range — execution triggers on first touch.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COHERENCE OBLIGATION — before producing JSON
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
My answer_sheet is an audit trail, not a scorecard. Before I write any JSON, I check every answer I gave against the action I am about to take.

The following contradictions require explicit resolution in thesis_coherence_statement — or NO_TRADE:
- Q8C = PREMIUM on a BUY action: I must name the specific catalyst (sweep, structural break, liquidity grab) that overrides premium-zone logic.
- Q8C = DISCOUNT on a SELL action: I must name the specific catalyst that overrides discount-zone logic.
- Q3 = prior rejections at my entry level: I must name what is different this time — what cleared those rejections.
- Q4 = EXHAUSTED momentum: I must explain whether this is a reversal or continuation thesis and why the exhaustion does not invalidate it.
- Q5_failure_probability within 15 points of trade_confidence: I must name the specific edge preserver — or I pass.
- Q1 = CONFLICT or COUNTER_TREND: I must explain why I am trading against the control timeframe structure.
- intermarket_correlation = DIVERGENT: I must acknowledge the divergence and name why the primary instrument's structure overrides it — or I reduce confidence accordingly.
- Q8D = DELIVERY_BEARISH on a BUY action: I must name the specific intraday or session-level structural reason that justifies trading against the weekly delivery narrative — or I reduce confidence by at least 10 points.
- Q8D = DELIVERY_BULLISH on a SELL action: I must name the specific intraday or session-level structural reason that justifies trading against the weekly delivery narrative — or I reduce confidence by at least 10 points.

If I cannot resolve a contradiction with a specific named reason, I output NO_TRADE.
If I can resolve it, I write the resolution in thesis_coherence_statement — not a generic acknowledgment, a specific named reason.

Return PURE JSON only — all required fields from the schema in my system prompt must be present.`;

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
          // CCIP-2026-0317A: Upgraded from gpt-4o-mini to gpt-4o.
          // GPT-4o provides the genuine reasoning depth required for professional-quality
          // trade decisions. gpt-4o-mini was filling the answer_sheet mechanically without
          // the judgment capacity to self-detect contradictions (e.g. buying PREMIUM zones,
          // selling into bullish EMA alignment). gpt-4o embodies the internalized professional
          // reasoning that Alpha's identity demands.
          //
          // COST AWARENESS (SSOT: llm-token-tracker.ts PRICING):
          // gpt-4o-mini: $0.15/1M input, $0.60/1M output → ~$0.0036/scan at 21k avg input tokens
          // gpt-4o:      $2.50/1M input, $10.00/1M output → ~$0.055/scan at 21k avg input tokens
          // Prompt compression target (CCIP-2026-0317A): reduce input to ~10k-12k tokens via
          // the professional reasoning contract rewrite, bringing effective cost to ~$0.03/scan.
          //
          // TOKEN BUDGET — CCIP-2026-0320:
          // ALL STYLES: 2000 tokens — SCALP was previously capped at 1400, which was
          //   insufficient for the full output schema (trader_statement 80+ words,
          //   reasoning 7-fields, answer_sheet 21-fields, thesis_coherence_statement).
          //   Conservative estimate for a complete BUY/SELL response is 1,000–1,600 tokens,
          //   putting the 1400 cap inside the failure zone. Unified at 2000 across all styles.
          // MICRO_INTRADAY / INTRADAY: unchanged at 2000 — trade_management + richer fields.
          //
          // INVARIANT: If finish_reason === 'length' fires, block_reason TOKEN_BUDGET_EXCEEDED
          //   surfaces in the trade log. Raise max_tokens if that fires repeatedly.
          model: 'gpt-4o',
          temperature: 0.3,
          max_tokens: 2000,
          requestType: 'alpha_coordination',
          endpoint: 'alpha-coordinator',
          symbol: marketContext.symbol
        }
      );

      // CCIP-TIMEOUT-FIX-2026-03-12: Token usage logging is audit-only — converted to
      // fire-and-forget. A slow Supabase INSERT here should never block trade decision
      // delivery. The OpenAI call already returned; any post-LLM latency is pure overhead.
      // CCIP-2026-0317A: model updated to gpt-4o — logging must match SSOT in llm-token-tracker.ts
      llmTokenTracker.logUsage({
        brainName: 'Alpha',
        model: 'gpt-4o',
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        contextType: 'alpha_coordination',
        userId: userId,
        sessionId: undefined
      }).catch(err => {
        console.warn('[Alpha Coordinator] Token usage logging failed (non-fatal):', err);
      });

      const content = response.choices[0]?.message?.content || '{}';

      // CCIP (2026-03-06): Detect response truncation — if finish_reason is 'length',
      // the LLM was cut off before completing its JSON. stopLoss and takeProfit appear
      // at the END of the response schema and are the first fields lost to truncation.
      // This is a prompt-compliance failure, not a market decision. Log it loudly and
      // abort rather than silently processing a structurally incomplete response.
      const finishReason = response.choices[0]?.finish_reason;
      if (finishReason === 'length') {
        console.error(`[Alpha Coordinator] TOKEN_BUDGET_EXCEEDED: Response truncated (finish_reason=length) for ${marketContext.symbol}/${styleName}. stopLoss/takeProfit are MISSING. Current max_tokens=2000 (gpt-4o, CCIP-2026-0320). Raise budget or shorten prompt.`);
        return {
          action: 'NO_TRADE',
          decision: 'NO_TRADE',
          block_reason: 'TOKEN_BUDGET_EXCEEDED',
          entry: marketContext.price,
          stopLoss: marketContext.price,
          takeProfit: marketContext.price,
          confidence: 0,
          reasoning: `NOT ENOUGH TOKENS — Alpha's response was cut off before the trade structure could be written. This is a system configuration issue, not a market decision. The token budget needs to be raised.`,
          omega_summary: '',
          risk_pct: 0
        };
      }

      // ═══════════════════════════════════════════════════════════════════
      // CCIP-REJECT-THESIS-2026-03-08: PRE-CHECK FOR PLAIN-TEXT REJECTION
      // ═══════════════════════════════════════════════════════════════════
      // GOVERNANCE: Alpha's prompt instructs it to ALWAYS return JSON.
      // However, as a defensive fallback we detect legacy plain-text
      // REJECT_THESIS responses BEFORE calling sanitizeAndParse.
      // When detected, the cached thesis is invalidated and the decision
      // is treated as a reasoned NO_TRADE (NOT an infrastructure error).
      // This prevents the governance infra error rate from spiking on
      // expected thesis invalidation behavior.
      const contentTrimmed = content.trim();
      const isPlainTextRejection = contentTrimmed.startsWith('REJECT_THESIS') ||
        contentTrimmed.startsWith('ACCEPTED_THESIS');

      if (isPlainTextRejection) {
        const isRejection = contentTrimmed.startsWith('REJECT_THESIS');
        const rejectionReason = isRejection
          ? contentTrimmed.replace(/^REJECT_THESIS[:\s]*/i, '').trim()
          : '';

        if (isRejection) {
          console.warn(`[Alpha Coordinator] CCIP-REJECT-THESIS: Alpha returned plain-text rejection (prompt compliance gap). Treating as reasoned NO_TRADE. Reason: ${rejectionReason.substring(0, 120)}`);
        } else {
          console.log('[Alpha Coordinator] CCIP-REJECT-THESIS: Alpha returned plain-text ACCEPTED_THESIS — rewriting to JSON NO_TRADE for consistency');
        }

        // Rewrite the plain-text response as a valid JSON NO_TRADE decision.
        // The thesis_status field carries the validation outcome.
        // Confidence >= 10 ensures this counts as a REASONED rejection,
        // not an infrastructure failure in the governance error rate.
        const rewrittenContent = JSON.stringify({
          action: 'NO_TRADE',
          thesis_status: isRejection ? 'REJECT_THESIS' : 'ACCEPTED_THESIS',
          thesis_rejection_reason: rejectionReason,
          reasoning: isRejection
            ? `REJECT_THESIS: ${rejectionReason}`
            : 'Cached thesis accepted — no new trade entry at this time',
          confidence: 15,
          trade_confidence: 15,
          stopLoss: 0,
          takeProfit: 0
        });

        return await this.parseDecision(
          rewrittenContent,
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
      }

      // ═══════════════════════════════════════════════════════════════════
      // EXTRACT AND CACHE MARKET THESIS
      // ═══════════════════════════════════════════════════════════════════
      let parsedJSON: any = {};
      try {
        // ✅ SSOT FIX: Use centralized sanitizer
        parsedJSON = sanitizeAndParse(content, 'alpha market thesis');

        // Extract market thesis status — new JSON field (primary) and legacy text search (fallback)
        const thesisStatus = parsedJSON.thesis_status || '';
        const rawThesisText = parsedJSON.marketThesis || parsedJSON.reasoning;
        const marketThesisText = typeof rawThesisText === 'string' ? rawThesisText : '';
        const thesisRejected = thesisStatus === 'REJECT_THESIS' || marketThesisText.includes('REJECT_THESIS');
        const thesisAccepted = thesisStatus === 'ACCEPTED_THESIS' || marketThesisText.includes('ACCEPTED_THESIS');

        if (cachedThesis && thesisRejected) {
          const rejectionReason = parsedJSON.thesis_rejection_reason || '';
          console.log(`[Alpha Coordinator] Cached thesis rejected${rejectionReason ? `: ${rejectionReason.substring(0, 80)}` : ''}`);
        } else if (cachedThesis && thesisAccepted) {
          console.log('[Alpha Coordinator] Cached thesis accepted — proceeding with current analysis');
        } else if (!cachedThesis && marketThesisText) {
          // Fresh thesis generation - cache it
          const directionBias = parsedJSON.action === 'BUY' ? 'BUY' :
                               parsedJSON.action === 'SELL' ? 'SELL' : 'NEUTRAL';

          // CCIP-CACHE-WRITE-FIX-2026-03-19:
          // Previously called getAlphaThesis() here (re-entrant), which hit the
          // warm in-memory local cache immediately and returned without executing the
          // DB write closure. Result: zero DB writes since GPT-4o upgrade (CCIP-2026-0317A).
          // Fix: call cacheThesis() directly — the dedicated write-only path that bypasses
          // the cache lookup and writes directly to alpha_market_thesis_cache.
          await sharedIntelligenceCoordinator.cacheThesis(
            marketContext.symbol,
            regimeSignature,
            {
              directionBias: directionBias as 'BUY' | 'SELL' | 'NEUTRAL',
              narrative: marketThesisText,
              regime: regimeSnapshot?.category || 'unknown',
              liquidityContext: parsedJSON.market_narrative || undefined,
              confidenceBand: parsedJSON.trade_confidence > 70 ? 'strong' as const :
                             parsedJSON.trade_confidence > 50 ? 'medium' as const : 'weak' as const,
              thesisSummary: marketThesisText.substring(0, 100)
            }
          ).catch(err => {
            logger.error('[Alpha Coordinator] cacheThesis write failed', { error: err });
          });

          console.log('[Alpha Coordinator] Caching fresh market thesis via cacheThesis()');
        }
      } catch (parseError) {
        logger.warn('[Alpha Coordinator] Failed to parse thesis from response', {
          error: parseError instanceof Error ? parseError.message : 'Unknown error'
        });
      }

      let decision = await this.parseDecision(
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
      // (e.g., 9.9999... < 10.0).
      //
      // CCIP (2026-03-06): Tolerance raised from 0.05 to 0.15 pips.
      // Wall bounds are computed via Math.round(price * slPercent / pipValue * 10) / 10,
      // which introduces up to 0.05 pip of rounding on the wall side. The pip distance
      // calculation on the proposal side also carries floating-point error. Combined, the
      // two-sided rounding error can reach 0.1 pips, causing valid trades at 10.3 pips to
      // be blocked by a wall min of 10.4 pips even though they are effectively the same
      // to 1 decimal place. A tolerance of 0.15 pips absorbs this combined rounding gap
      // without meaningfully relaxing the wall constraints for any asset class.
      // Applies to ALL styles (SCALP, MICRO_INTRADAY, INTRADAY, SWING).
      const WALL_COMPARISON_EPSILON = 0.15; // pips — absorbs two-sided floating-point rounding
      if (decision.action !== 'NO_TRADE' && dualArenaWalls) {
        decision.arena_chosen = decision.action === 'BUY' ? 'LONG' : 'SHORT';
        const arena = decision.action === 'BUY' ? dualArenaWalls.long : dualArenaWalls.short;
        const slPips = calculatePipDistance(marketContext.symbol, decision.entry, decision.stopLoss);
        const tpPips = calculatePipDistance(marketContext.symbol, decision.entry, decision.takeProfit);

        // CCIP-2026-03-18 ALPHA AUTHORITY: Wall checks are now DIAGNOSTIC ONLY.
        // Alpha's SL and TP values are NEVER modified after Alpha decides.
        // The coordinator's sole remaining veto power is Omega-9 (mathematical impossibility).
        //
        // Rationale: If the coordinator moves Alpha's SL or TP — even to a "better" value —
        // the post-trade accountability chain is broken. We cannot attribute a failed trade
        // to Alpha's decision if the coordinator silently corrected it. Alpha must own every
        // price level in the database, exactly as Alpha chose it.
        //
        // Wall diagnostics are logged and attached to the decision for governance analysis.
        // They DO NOT block, modify, or veto the trade.
        const wallAdvisories: string[] = [];

        if (slPips < arena.slPips.min - WALL_COMPARISON_EPSILON) {
          wallAdvisories.push(`[ADVISORY] SL ${slPips.toFixed(1)}p below wall min ${arena.slPips.min.toFixed(1)}p`);
        }
        if (slPips > arena.slPips.max + WALL_COMPARISON_EPSILON) {
          wallAdvisories.push(`[ADVISORY] SL ${slPips.toFixed(1)}p above wall max ${arena.slPips.max.toFixed(1)}p`);
        }
        if (tpPips < arena.tpPips.min - WALL_COMPARISON_EPSILON) {
          wallAdvisories.push(`[ADVISORY] TP ${tpPips.toFixed(1)}p below wall min ${arena.tpPips.min.toFixed(1)}p`);
        }
        if (tpPips > arena.tpPips.max + WALL_COMPARISON_EPSILON) {
          wallAdvisories.push(`[ADVISORY] TP ${tpPips.toFixed(1)}p above wall max ${arena.tpPips.max.toFixed(1)}p`);
        }

        // TP1 geometry: must be positive and must not exceed TP2.
        // These are physical impossibilities (not style preferences) — kept as hard checks.
        if (decision.tp1Price != null) {
          const tp1Pips = calculatePipDistance(marketContext.symbol, decision.entry, decision.tp1Price);
          if (tp1Pips <= 0) {
            wallAdvisories.push(`[ADVISORY] TP1 ${tp1Pips.toFixed(1)}p is non-positive`);
          }
          if (tp1Pips > tpPips) {
            wallAdvisories.push(`[ADVISORY] TP1 ${tp1Pips.toFixed(1)}p exceeds TP2 ${tpPips.toFixed(1)}p`);
          }
        }

        decision.wall_violations = wallAdvisories;

        if (wallAdvisories.length > 0) {
          console.log(`[Alpha Coordinator] [Wall Diagnostics] Alpha placed outside expected envelope (advisory — no veto): ${wallAdvisories.join('; ')}`);
          logViolation({
            violationType: 'ALPHA_WALL_ADVISORY',
            symbol: marketContext.symbol,
            attemptedOperation: 'wall_check',
            callLocation: 'coordinator-alpha.wall_check',
            blocked: false,
            errorDetails: {
              wallAdvisories,
              slPips,
              tpPips,
              epsilon_pips: WALL_COMPARISON_EPSILON,
              arenaMin: { sl: arena.slPips.min, tp: arena.tpPips.min },
              arenaMax: { sl: arena.slPips.max, tp: arena.tpPips.max },
              userId: userId || null,
              sessionId: goalContext?.sessionId || null,
            }
          }).catch(error => {
            console.error('[Alpha Coordinator] Failed to log wall advisory:', error);
          });
        } else {
          console.log(`[Alpha Coordinator] [Wall Diagnostics] Alpha decision within expected envelope`);
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
      if (sweepFacts && sweepFacts.sweep_detected) {
        decision.sweepFacts = sweepFacts;
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
        // Omega-8 raw pattern data attached for telemetry only - no confidence manipulation
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
            omega9_validation: validation
          };
        }

        console.log('[Alpha Coordinator] Omega-9 validation complete (catastrophic-only enforcement)');
      }

      // CCIP-2026-03-15: Alpha owns duration. No system calculation of fill time.
      // Alpha's estimated_duration_minutes output field is the sole source of truth.
      // Parse it from Alpha's JSON response and convert to hours for downstream consumers.
      if (decision.action !== 'NO_TRADE' && decision.estimated_duration_minutes) {
        const parsedDuration = parseAlphaDurationMinutes(decision.estimated_duration_minutes);
        if (parsedDuration > 0) {
          decision.expectedFillTimeHours = parsedDuration / 60;
        }
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
  private async parseDecision(
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
  ): Promise<AlphaDecision> {
    try {
      // CCIP-REJECT-THESIS-2026-03-08: Defensive pre-check for plain-text thesis responses.
      // The main coordinator flow rewrites these before calling parseDecision, but this
      // guard catches any edge cases where a plain-text response reaches this function directly.
      const responseTrimmed = response.trim();
      if (responseTrimmed.startsWith('REJECT_THESIS') || responseTrimmed.startsWith('ACCEPTED_THESIS')) {
        const isRejection = responseTrimmed.startsWith('REJECT_THESIS');
        const reason = isRejection ? responseTrimmed.replace(/^REJECT_THESIS[:\s]*/i, '').trim() : '';
        console.warn(`[Alpha Coordinator] parseDecision received plain-text thesis response — converting to NO_TRADE. type=${isRejection ? 'REJECT' : 'ACCEPT'}`);
        return {
          action: 'NO_TRADE',
          decision: 'NO_TRADE',
          entry: currentPrice,
          stopLoss: currentPrice,
          takeProfit: currentPrice,
          confidence: 15,
          reasoning: isRejection ? `REJECT_THESIS: ${reason}` : 'Cached thesis accepted — no new entry',
          omega_summary: '',
          risk_pct: 0
        };
      }

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
      // CCIP-2026-0319A (Fix 2): entry_mode is only valid for BUY/SELL decisions.
      // For NO_TRADE, the LLM should never emit entry_mode — but if it does (hallucination),
      // we strip it to undefined rather than defaulting to 'wait_pullback', which would
      // wrongly route a NO_TRADE decision into the entry monitor gate downstream.
      // For BUY/SELL: use 'execute_now' as the safe default (not 'wait_pullback') so that
      // a missing entry_mode from the LLM results in immediate execution, not a silent
      // monitored-wait that never resolves without a valid zone.
      // CCIP-2026-0323A: let (not const) — Q10 FORCED guard may correct execute_now → wait_pullback
      let entryMode = action === 'NO_TRADE'
        ? undefined
        : (parsed.entry_mode ?? 'execute_now');

      // Structural anchor validation — advisory only (no hard NO_TRADE override).
      // The prompt already instructs Alpha to output NO_TRADE itself if it cannot name an anchor.
      // When Alpha outputs BUY/SELL, it has structural conviction — the field may simply be omitted
      // due to model JSON field omission (known gpt-4o-mini behavior), not missing reasoning.
      // Fallback: synthesise the anchor from Q2_structure_level or sl_structural_reference when missing.
      const isAnchorVague = (s: string | null | undefined): boolean =>
        !s || s.trim().length < 10 ||
        ['null', 'n/a', 'required', 'none'].some(bad => s.trim().toLowerCase().includes(bad));

      const synthesiseFallbackAnchor = (label: string): string | null => {
        const q2 = typeof parsed.Q2_structure_level === 'string' ? parsed.Q2_structure_level.trim() : null;
        const slRef = typeof parsed.sl_structural_reference === 'string' ? parsed.sl_structural_reference.trim() : null;
        const candidate = q2 || slRef;
        if (candidate && candidate.length >= 10) {
          console.warn(`[Alpha Coordinator] ${label}: field missing — using fallback anchor from Q2/SL reference: "${candidate}"`);
          return candidate;
        }
        return null;
      };

      if (action !== 'NO_TRADE' && tradeStyle === 'SCALP') {
        const raw = typeof parsed.scalp_structural_confirmation === 'string'
          ? parsed.scalp_structural_confirmation.trim()
          : null;
        if (isAnchorVague(raw)) {
          const fallback = synthesiseFallbackAnchor('SCALP_NO_M5_ANCHOR');
          if (fallback) {
            parsed.scalp_structural_confirmation = fallback;
          } else {
            console.warn('[Alpha Coordinator] SCALP_NO_M5_ANCHOR: no anchor field and no fallback — trade proceeds on Alpha confidence');
          }
        } else {
          console.log(`[Alpha Coordinator] SCALP M5 anchor confirmed: "${raw}"`);
        }
      }

      if (action !== 'NO_TRADE' && tradeStyle === 'MICRO_INTRADAY') {
        const raw = typeof parsed.m15_structural_confirmation === 'string'
          ? parsed.m15_structural_confirmation.trim()
          : null;
        if (isAnchorVague(raw)) {
          const fallback = synthesiseFallbackAnchor('MICRO_INTRADAY_NO_M15_ANCHOR');
          if (fallback) {
            parsed.m15_structural_confirmation = fallback;
          } else {
            console.warn('[Alpha Coordinator] MICRO_INTRADAY_NO_M15_ANCHOR: no anchor field and no fallback — trade proceeds on Alpha confidence');
          }
        } else {
          console.log(`[Alpha Coordinator] MICRO_INTRADAY M15 anchor confirmed: "${raw}"`);
        }
      }

      if (action !== 'NO_TRADE' && tradeStyle === 'INTRADAY') {
        const raw = typeof parsed.h1_structural_confirmation === 'string'
          ? parsed.h1_structural_confirmation.trim()
          : null;
        if (isAnchorVague(raw)) {
          const fallback = synthesiseFallbackAnchor('INTRADAY_NO_H1_ANCHOR');
          if (fallback) {
            parsed.h1_structural_confirmation = fallback;
          } else {
            console.warn('[Alpha Coordinator] INTRADAY_NO_H1_ANCHOR: no anchor field and no fallback — trade proceeds on Alpha confidence');
          }
        } else {
          console.log(`[Alpha Coordinator] INTRADAY H1 anchor confirmed: "${raw}"`);
        }
      }

      // CCIP 2026-03-03 / 2026-03-16: INTRADAY and MICRO_INTRADAY require trade_management when
      // BUY/SELL is issued. Both styles use TP1 + TP2 structure — Alpha must state its management
      // plan. trade_management is an object with at least trail_method and tp1_close_percent.
      // A missing or degenerate plan is a governance failure, not a warning.
      const isMultiTpStyle = tradeStyle === 'INTRADAY' || tradeStyle === 'MICRO_INTRADAY';
      if (action !== 'NO_TRADE' && isMultiTpStyle) {
        const tm = parsed.trade_management;
        const managementIsVague = !tm ||
          typeof tm !== 'object' ||
          (tm.trail_method === undefined && tm.tp1_close_percent === undefined);

        if (managementIsVague) {
          console.warn(`[Alpha Coordinator] ${tradeStyle}_NO_TRADE_MANAGEMENT: Alpha did not provide trade_management plan. Trade proceeds on Alpha confidence — management plan advisory only.`);
        } else {
          console.log(`[Alpha Coordinator] ${tradeStyle} trade_management confirmed: tp1_close=${tm.tp1_close_percent}% trail=${tm.trail_method}`);
        }
      }

      // CCIP 2026-03-03: Validate move_stage keyword appears in reasoning for all trade decisions.
      // Alpha must explicitly diagnose the move stage (FRESH/DEVELOPING/EXHAUSTED) as part of
      // its reasoning. If it's missing, the position sizing and R:R decisions lack structural basis.
      // This is a WARNING check — does not block the trade but flags shallow reasoning.
      if (action !== 'NO_TRADE') {
        const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.toLowerCase() : '';
        const marketNarrative = typeof parsed.market_narrative === 'string' ? parsed.market_narrative.toLowerCase() : '';
        const combinedText = reasoning + ' ' + marketNarrative;
        const hasMoveStage = combinedText.includes('fresh') || combinedText.includes('developing') ||
          combinedText.includes('exhausted') || combinedText.includes('move stage') ||
          combinedText.includes('stage:') || combinedText.includes('starting');
        if (!hasMoveStage) {
          console.warn(`[Alpha Coordinator] MOVE_STAGE_ABSENT: Alpha issued ${action} without diagnosing move stage (FRESH/DEVELOPING/EXHAUSTED) in reasoning. This indicates shallow move analysis.`);
        }
      }

      // SSOT: User's chosen style is IMMUTABLE - LLM cannot override it
      // tradeStyle was already resolved from user's choice at function scope
      const resolvedStyle = tradeStyle;

      // Extract thesis-aware fields (Phase 2: Integration)
      const thesis = parsed.thesis || null;
      const styleIntent = parsed.style_intent || null;
      const executionPreference = parsed.execution_preference || null;
      const acceptableProfitRange = parsed.acceptable_profit_range || null;

      // CCIP-FIX: Extract Alpha's answer_sheet (full checklist Q1-Q9 + extended fields)
      // from LLM response. Previously only Q1-Q9 were extracted — the extended fields
      // (Q8C, Q8D, kill_zone, news_status, equal_highs_lows, trap_signature,
      // failed_auction, intermarket_correlation) were being silently discarded after
      // Alpha computed them. These fields carry Alpha's assessment of price location,
      // weekly narrative, intermarket correlation, trap signatures, and liquidity
      // context — critical inputs for the Mid-Trade Monitor and learning loops.
      // SSOT owner: coordinator-alpha (sole parse point for LLM response).
      const rawAnswerSheet = parsed.answer_sheet;
      const answerSheet: AlphaDecision['answer_sheet'] = (
        rawAnswerSheet &&
        typeof rawAnswerSheet === 'object' &&
        typeof rawAnswerSheet.Q1_trend_alignment === 'string' &&
        typeof rawAnswerSheet.Q6_entry_trigger === 'string'
      ) ? {
        Q1_trend_alignment: rawAnswerSheet.Q1_trend_alignment,
        Q2_structure_level: rawAnswerSheet.Q2_structure_level || '',
        Q3_prior_rejections: rawAnswerSheet.Q3_prior_rejections || '',
        Q4_momentum_stage: rawAnswerSheet.Q4_momentum_stage || '',
        Q5_failure_mode: rawAnswerSheet.Q5_failure_mode || '',
        Q5_failure_probability: typeof rawAnswerSheet.Q5_failure_probability === 'number' ? rawAnswerSheet.Q5_failure_probability : 0,
        Q5B_objective_alignment: rawAnswerSheet.Q5B_objective_alignment || '',
        Q6_entry_trigger: rawAnswerSheet.Q6_entry_trigger,
        Q7_confluence_count: typeof rawAnswerSheet.Q7_confluence_count === 'string' ? rawAnswerSheet.Q7_confluence_count : undefined,
        Q7_confluence_confirmed: typeof rawAnswerSheet.Q7_confluence_confirmed === 'string' ? rawAnswerSheet.Q7_confluence_confirmed : undefined,
        Q7_confluence_judgment: typeof rawAnswerSheet.Q7_confluence_judgment === 'string' ? rawAnswerSheet.Q7_confluence_judgment : undefined,
        Q8_move_position_pct: typeof rawAnswerSheet.Q8_move_position_pct === 'number' ? rawAnswerSheet.Q8_move_position_pct : 0,
        Q8B_session_range_pct: typeof rawAnswerSheet.Q8B_session_range_pct === 'number' ? rawAnswerSheet.Q8B_session_range_pct : 0,
        Q8C_price_location_zone: typeof rawAnswerSheet.Q8C_price_location_zone === 'string' ? rawAnswerSheet.Q8C_price_location_zone : undefined,
        Q8D_weekly_narrative: typeof rawAnswerSheet.Q8D_weekly_narrative === 'string' ? rawAnswerSheet.Q8D_weekly_narrative : undefined,
        kill_zone: typeof rawAnswerSheet.kill_zone === 'string' ? rawAnswerSheet.kill_zone : undefined,
        news_status: typeof rawAnswerSheet.news_status === 'string' ? rawAnswerSheet.news_status : undefined,
        equal_highs_lows: typeof rawAnswerSheet.equal_highs_lows === 'string' ? rawAnswerSheet.equal_highs_lows : undefined,
        trap_signature: typeof rawAnswerSheet.trap_signature === 'string' ? rawAnswerSheet.trap_signature : undefined,
        failed_auction: typeof rawAnswerSheet.failed_auction === 'string' ? rawAnswerSheet.failed_auction : undefined,
        intermarket_correlation: typeof rawAnswerSheet.intermarket_correlation === 'string' ? rawAnswerSheet.intermarket_correlation : undefined,
        Q9_sl_wick_proximity: typeof rawAnswerSheet.Q9_sl_wick_proximity === 'string' ? rawAnswerSheet.Q9_sl_wick_proximity : undefined,
        // CCIP-2026-0323A: Q10 entry conviction — SCALP ONLY. Parsed but never used as a hard block.
        // The prompt instructs Alpha to self-enforce: FORCED → cannot use execute_now.
        // We extract it here for audit/logging. Enforcement is prompt-level, not code-level.
        Q10_entry_conviction: (['SNIPER', 'ACCEPTABLE', 'FORCED'].includes(rawAnswerSheet.Q10_entry_conviction as string))
          ? (rawAnswerSheet.Q10_entry_conviction as 'SNIPER' | 'ACCEPTABLE' | 'FORCED')
          : undefined,
        // CCIP-2026-0323B: Q11 zone entry quality — MICRO_INTRADAY and INTRADAY ONLY.
        // Captures Alpha's zone-precision self-assessment: PRECISE (near edge), MID_ZONE,
        // or DEEP_ZONE (far edge, near invalidation). Parsed for audit/logging.
        // Code-layer backstop below corrects DEEP_ZONE + execute_now to wait_pullback.
        Q11_zone_entry_quality: (['PRECISE', 'MID_ZONE', 'DEEP_ZONE'].includes(rawAnswerSheet.Q11_zone_entry_quality as string))
          ? (rawAnswerSheet.Q11_zone_entry_quality as 'PRECISE' | 'MID_ZONE' | 'DEEP_ZONE')
          : undefined,
        // CCIP-2026-0324C: liquidity_sweep_read extraction.
        // MANDATORY when sweepFacts.sweep_detected was true. Validated below.
        liquidity_sweep_read: typeof rawAnswerSheet.liquidity_sweep_read === 'string'
          ? rawAnswerSheet.liquidity_sweep_read
          : undefined,
      } : undefined;

      // CCIP-2026-0323A: Q10 entry conviction enforcement — SCALP ONLY.
      // Alpha is instructed via the prompt to self-enforce: FORCED → no execute_now.
      // This guard is the code-layer backstop. If Alpha rated FORCED but still chose
      // execute_now (hallucination or prompt non-compliance), we correct the entry_mode
      // to wait_pullback and log a governance violation for observability.
      // SSOT: alpha-identity.ts defines the Q10 values. We never block the trade — only
      // redirect the entry mode to one that is compatible with a FORCED conviction.
      if (
        tradeStyle === 'SCALP' &&
        (action === 'BUY' || action === 'SELL') &&
        answerSheet?.Q10_entry_conviction === 'FORCED' &&
        entryMode === 'execute_now'
      ) {
        console.warn('[Alpha Coordinator] CCIP-2026-0323A: Q10=FORCED but entry_mode=execute_now — correcting to wait_pullback. Alpha must not force-enter immediately when conviction is FORCED.');
        logViolation({
          violationType: 'Q10_FORCED_EXECUTE_NOW',
          severity: 'medium',
          source: 'coordinator-alpha',
          description: `Q10_entry_conviction=FORCED but entry_mode=execute_now on SCALP. Corrected to wait_pullback.`,
          symbol: marketContext.symbol,
          userId: userId || 'unknown',
        }).catch(() => {});
        entryMode = 'wait_pullback';
      }

      // CCIP-2026-0323B: Q11 zone entry quality enforcement — MICRO_INTRADAY and INTRADAY ONLY.
      // Alpha is instructed via the prompt to self-enforce: DEEP_ZONE → no execute_now.
      // This guard is the code-layer backstop. If Alpha rated DEEP_ZONE but still chose
      // execute_now (hallucination or prompt non-compliance), we correct the entry_mode
      // to wait_pullback and log a governance violation for observability.
      // SSOT: alpha-identity.ts defines the Q11 values. We never block the trade — only
      // redirect the entry mode to one that is compatible with a DEEP_ZONE assessment.
      if (
        (tradeStyle === 'MICRO_INTRADAY' || tradeStyle === 'INTRADAY') &&
        (action === 'BUY' || action === 'SELL') &&
        answerSheet?.Q11_zone_entry_quality === 'DEEP_ZONE' &&
        entryMode === 'execute_now'
      ) {
        console.warn(`[Alpha Coordinator] CCIP-2026-0323B: Q11=DEEP_ZONE but entry_mode=execute_now on ${tradeStyle} — correcting to wait_pullback. Alpha must not force-enter at the far edge of a structural zone.`);
        logViolation({
          violationType: 'Q11_DEEP_ZONE_EXECUTE_NOW',
          severity: 'medium',
          source: 'coordinator-alpha',
          description: `Q11_zone_entry_quality=DEEP_ZONE but entry_mode=execute_now on ${tradeStyle}. Corrected to wait_pullback.`,
          symbol: marketContext.symbol,
          userId: userId || 'unknown',
        }).catch(() => {});
        entryMode = 'wait_pullback';
      }

      // CCIP-2026-0324D: Q8D weekly narrative vs action conflict advisory check.
      // alpha-identity.ts instructs Alpha to resolve DELIVERY_BEARISH+BUY and
      // DELIVERY_BULLISH+SELL in thesis_coherence_statement. This guard detects the
      // conflict post-LLM for governance observability. Action: advisory log only.
      // Trade is NOT blocked — Alpha has authority to trade against weekly narrative
      // with named structural justification. We surface the conflict for audit.
      // SSOT: This is the only place Q8D conflict logging occurs.
      if (action === 'BUY' || action === 'SELL') {
        const q8d = answerSheet?.Q8D_weekly_narrative?.toUpperCase();
        const q8dConflict =
          (action === 'BUY' && q8d === 'DELIVERY_BEARISH') ||
          (action === 'SELL' && q8d === 'DELIVERY_BULLISH');
        if (q8dConflict) {
          const hasCoherence = typeof parsed.thesis_coherence_statement === 'string' &&
            parsed.thesis_coherence_statement.length > 20;
          if (!hasCoherence) {
            logViolation({
              violationType: 'Q8D_WEEKLY_NARRATIVE_CONFLICT_UNRESOLVED',
              severity: 'medium',
              source: 'coordinator-alpha',
              description: `Q8D=${q8d} conflicts with action=${action} and thesis_coherence_statement is absent or too short. Alpha was required to name the override reason or reduce confidence.`,
              symbol: marketContext.symbol,
              userId: userId || 'unknown',
            }).catch(() => {});
            console.warn(
              `[Alpha Coordinator] CCIP-2026-0324D: Q8D=${q8d} conflicts with action=${action} but no coherence resolution found. ` +
              `Alpha should have named a session-level override or reduced confidence. Symbol=${symbol}.`
            );
          } else {
            console.log(
              `[Alpha Coordinator] CCIP-2026-0324D: Q8D=${q8d} vs action=${action} conflict — thesis_coherence_statement present, assuming override named. Symbol=${symbol}.`
            );
          }
        }
      }

      // CCIP-2026-0324C: liquidity_sweep_read omission detector.
      // alpha-identity.ts declares liquidity_sweep_read as MANDATORY whenever sweep sensor
      // data was injected into the prompt (sweepFacts.sweep_detected === true).
      // This guard detects silent omission — Alpha received sweep facts but produced no read.
      // Action: advisory violation only. Trade is NOT blocked. The omission is logged so it
      // can be tracked for prompt compliance over time.
      // SSOT: sweepFacts is the authoritative signal for whether sweep data was present.
      if (
        sweepFacts?.sweep_detected &&
        answerSheet &&
        (!answerSheet.liquidity_sweep_read || answerSheet.liquidity_sweep_read.trim() === '' || answerSheet.liquidity_sweep_read.toUpperCase() === 'NONE')
      ) {
        logViolation({
          violationType: 'LIQUIDITY_SWEEP_READ_OMITTED',
          severity: 'medium',
          source: 'coordinator-alpha',
          description: `Sweep sensor data was present (sweep_type=${sweepFacts.sweep_type}, BOS=${sweepFacts.has_bos}) but Alpha omitted liquidity_sweep_read from answer_sheet. This is a MANDATORY field when sweep data is injected.`,
          symbol: marketContext.symbol,
          userId: userId || 'unknown',
        }).catch(() => {});
        console.warn(
          `[Alpha Coordinator] CCIP-2026-0324C: LIQUIDITY_SWEEP_READ_OMITTED — sweep data was present ` +
          `(type=${sweepFacts.sweep_type}, BOS=${sweepFacts.has_bos}) but liquidity_sweep_read is absent. ` +
          `Symbol=${symbol}.`
        );
      }

      // CCIP-2026-0324E: Q5 failure_probability vs trade_confidence numeric consistency.
      // The coherence obligation (prompt-level) requires Alpha to name an edge preserver when
      // Q5_failure_probability is within 15 points of trade_confidence. However, the prompt
      // rule is self-enforced and cannot catch all hallucinations. This post-LLM check
      // verifies the numeric relationship directly and logs when the gap is dangerously narrow
      // (≤ 10 points) without a coherence statement — suggesting Alpha may have failed to
      // price the failure risk into its stated confidence.
      //
      // Action: advisory violation log only. Trade is NOT blocked or modified.
      // SSOT: alpha-identity.ts defines the 15-point rule. This guard enforces observability.
      if ((action === 'BUY' || action === 'SELL') && answerSheet) {
        const q5Prob = typeof answerSheet.Q5_failure_probability === 'number' ? answerSheet.Q5_failure_probability : null;
        const rawConf = parsed.trade_confidence ?? parsed.confidence;
        const confVal = typeof rawConf === 'number' ? rawConf : null;
        if (q5Prob !== null && confVal !== null) {
          const gap = confVal - q5Prob;
          if (gap <= 10 && gap >= -20) {
            const hasCoherence = typeof parsed.thesis_coherence_statement === 'string' &&
              parsed.thesis_coherence_statement.length > 20;
            if (!hasCoherence) {
              logViolation({
                violationType: 'Q5_CONFIDENCE_GAP_NARROW_NO_COHERENCE',
                severity: 'medium',
                source: 'coordinator-alpha',
                description: `Q5_failure_probability=${q5Prob} and trade_confidence=${confVal} — gap=${gap} points. Prompt requires named edge preserver when gap ≤ 15 points, but thesis_coherence_statement is absent or too short.`,
                symbol: marketContext.symbol,
                userId: userId || 'unknown',
              }).catch(() => {});
              console.warn(
                `[Alpha Coordinator] CCIP-2026-0324E: Q5 failure gap=${gap}pts (prob=${q5Prob}, conf=${confVal}) without coherence statement. ` +
                `Alpha may not have priced failure risk into confidence. Symbol=${symbol}.`
              );
            }
          }
        }
      }

      // CCIP-2026-03-16A: Q7 coherence check is advisory-only.
      // Alpha's final action field is authoritative. If Q7 judgment and action
      // appear to contradict, log it for observability but do NOT downgrade.
      if ((action === 'BUY' || action === 'SELL') && answerSheet?.Q7_confluence_judgment) {
        const q7judgment = answerSheet.Q7_confluence_judgment.toLowerCase();
        const q7DeclaresNoTrade = q7judgment.includes('does not meet') || q7judgment.includes('no_trade') || q7judgment.includes('decision: no_trade');
        if (q7DeclaresNoTrade) {
          console.warn(`[Alpha Coordinator] Q7 advisory note: action=${action} but Q7 judgment text contains no-trade language. Alpha's action field is authoritative — not downgrading. Q7: "${answerSheet.Q7_confluence_judgment}"`);
        }
      }

      // CCIP 2026-02-17: Extract Alpha's entry advisory (SSOT for Entry Monitor)
      const rawAdvisory = parsed.entry_advisory;
      const entryAdvisory = rawAdvisory && typeof rawAdvisory === 'object' ? {
        verdict: rawAdvisory.verdict === 'PULLBACK_EXPECTED' ? 'PULLBACK_EXPECTED' as const : 'GOOD_ENTRY' as const,
        pullback_zone_min: typeof rawAdvisory.pullback_zone_min === 'number' ? rawAdvisory.pullback_zone_min : null,
        pullback_zone_max: typeof rawAdvisory.pullback_zone_max === 'number' ? rawAdvisory.pullback_zone_max : null,
        reasoning: typeof rawAdvisory.reasoning === 'string' ? rawAdvisory.reasoning : ''
      } : null;

      // CCIP-2026-0318A: Extract Alpha's wait_condition block (SSOT: coordinator-alpha is sole parse point)
      // Alpha produces this block whenever entry_mode is wait_pullback or push_confirmation.
      // It carries the exact zone Alpha wants monitored, the invalidation price, Alpha's stated
      // reasoning for deferring, and an estimated wait time. All four fields are passed downstream
      // to AlphaTradeExecutor so they become the primary source for entry intent creation.
      // intent_mode is intentionally NOT extracted here — the executor derives it from entry_mode.
      const rawWaitCondition = parsed.wait_condition;
      const waitCondition: AlphaDecision['wait_condition'] =
        rawWaitCondition &&
        typeof rawWaitCondition === 'object' &&
        typeof rawWaitCondition.target_entry_zone_min === 'number' &&
        typeof rawWaitCondition.target_entry_zone_max === 'number' &&
        typeof rawWaitCondition.invalidation_price === 'number'
          ? {
              target_entry_zone_min: rawWaitCondition.target_entry_zone_min,
              target_entry_zone_max: rawWaitCondition.target_entry_zone_max,
              invalidation_price: rawWaitCondition.invalidation_price,
              wait_reasoning: typeof rawWaitCondition.wait_reasoning === 'string'
                ? rawWaitCondition.wait_reasoning
                : '',
              expected_wait_minutes: typeof rawWaitCondition.expected_wait_minutes === 'number'
                ? Math.min(Math.max(1, Math.round(rawWaitCondition.expected_wait_minutes)), 120)
                : undefined,
            }
          : undefined;

      // CCIP-2026-0319A (Fix 3): Enforce wait_condition presence when entry_mode requires it.
      // Previously this was a warning-only check. Now it takes corrective action:
      //   (a) If entry_advisory has a valid zone, synthesise a wait_condition from it so the
      //       entry intent creation path has a valid zone to work with.
      //   (b) If entry_advisory is also absent or invalid, downgrade entry_mode to 'execute_now'
      //       so the trade executes immediately rather than creating an intent with no zone.
      // The corrective action is logged to support governance auditing of LLM compliance.
      // SSOT: this is the sole place where wait_condition correction/synthesis happens.
      let resolvedEntryMode = entryMode;
      let resolvedWaitCondition = waitCondition;

      if ((resolvedEntryMode === 'wait_pullback' || resolvedEntryMode === 'push_confirmation') && !resolvedWaitCondition) {
        const advisoryHasZone =
          entryAdvisory &&
          typeof entryAdvisory.pullback_zone_min === 'number' &&
          typeof entryAdvisory.pullback_zone_max === 'number' &&
          entryAdvisory.pullback_zone_min > 0 &&
          entryAdvisory.pullback_zone_max > 0;

        if (advisoryHasZone) {
          resolvedWaitCondition = {
            target_entry_zone_min: entryAdvisory!.pullback_zone_min as number,
            target_entry_zone_max: entryAdvisory!.pullback_zone_max as number,
            invalidation_price: action === 'BUY'
              ? (entryAdvisory!.pullback_zone_min as number) * 0.9985
              : (entryAdvisory!.pullback_zone_max as number) * 1.0015,
            wait_reasoning: `Synthesised from entry_advisory zone (original wait_condition absent). Advisory: ${entryAdvisory!.reasoning || 'no detail'}`,
            expected_wait_minutes: undefined,
          };
          console.warn(
            `[Alpha Coordinator] WAIT_CONDITION_SYNTHESISED: entry_mode="${resolvedEntryMode}" — wait_condition absent but ` +
            `entry_advisory zone available. Synthesised zone=${resolvedWaitCondition.target_entry_zone_min}–${resolvedWaitCondition.target_entry_zone_max}. ` +
            `Symbol=${symbol}. CCIP-2026-0319A.`
          );
        } else {
          resolvedEntryMode = 'execute_now';
          console.warn(
            `[Alpha Coordinator] ENTRY_MODE_DOWNGRADED: entry_mode="${entryMode}"→"execute_now" — wait_condition absent and ` +
            `no advisory fallback zone available. Trade will execute immediately. Symbol=${symbol}. CCIP-2026-0319A.`
          );
        }
      } else if (resolvedWaitCondition) {
        console.log(
          `[Alpha Coordinator] wait_condition parsed: zone=${resolvedWaitCondition.target_entry_zone_min}–${resolvedWaitCondition.target_entry_zone_max} ` +
          `invalidation=${resolvedWaitCondition.invalidation_price} ` +
          `est_wait=${resolvedWaitCondition.expected_wait_minutes ?? 'unspecified'}min`
        );
      }

      // ═══════════════════════════════════════════════════════════════════
      // CCIP-2026-0324B: wait_pullback zone direction coherence backstop.
      // ═══════════════════════════════════════════════════════════════════
      //
      // INVARIANT: For a BUY with wait_pullback, price must come DOWN to the zone
      // (zone_max < current_price). For a SELL with wait_pullback, price must come
      // UP to the zone (zone_min > current_price). If Alpha sets a wait_pullback
      // zone on the wrong side of current price, the intent will never trigger —
      // a silent trade failure with no error surfaced to the user.
      //
      // This backstop detects the inversion and either:
      //   (a) Converts to execute_now if price is already inside the stated zone.
      //   (b) Logs a governance violation and downgrade to execute_now if the zone
      //       is entirely on the wrong side (Alpha specified a zone that price is
      //       moving away from, not toward).
      //
      // SSOT: coordinator-alpha.ts is the sole authority for wait_condition validation.
      // Alpha's SL and TP are never modified — only entry_mode and wait_condition.
      if (
        (resolvedEntryMode === 'wait_pullback') &&
        resolvedWaitCondition &&
        (action === 'BUY' || action === 'SELL')
      ) {
        const currentPx = marketContext.price;
        const zoneMin = resolvedWaitCondition.target_entry_zone_min;
        const zoneMax = resolvedWaitCondition.target_entry_zone_max;

        const priceAlreadyInZone =
          action === 'BUY'
            ? currentPx <= zoneMax && currentPx >= zoneMin
            : currentPx >= zoneMin && currentPx <= zoneMax;

        const zoneInWrongDirection =
          action === 'BUY'
            ? zoneMin > currentPx
            : zoneMax < currentPx;

        if (priceAlreadyInZone) {
          resolvedEntryMode = 'execute_now';
          resolvedWaitCondition = undefined;
          console.warn(
            `[Alpha Coordinator] CCIP-2026-0324B: wait_pullback zone contains current price — converting to execute_now. ` +
            `action=${action} currentPx=${currentPx} zone=${zoneMin}–${zoneMax}. Symbol=${symbol}.`
          );
        } else if (zoneInWrongDirection) {
          logViolation({
            violationType: 'WAIT_PULLBACK_ZONE_DIRECTION_INVERTED',
            severity: 'high',
            source: 'coordinator-alpha',
            description: `wait_pullback zone is on wrong side of current price for ${action}. currentPx=${currentPx} zone=${zoneMin}–${zoneMax}. Price is moving away from zone — silent intent failure prevented. Downgraded to execute_now.`,
            symbol: marketContext.symbol,
            userId: userId || 'unknown',
          }).catch(() => {});
          resolvedEntryMode = 'execute_now';
          resolvedWaitCondition = undefined;
          console.warn(
            `[Alpha Coordinator] CCIP-2026-0324B: WAIT_PULLBACK_ZONE_DIRECTION_INVERTED — zone is on wrong side of current price for ${action}. ` +
            `currentPx=${currentPx} zone=${zoneMin}–${zoneMax}. Downgraded to execute_now. Symbol=${symbol}.`
          );
        }
      }

      // CCIP-FIX (breakout contradiction guard):
      // Alpha's answer_sheet is an audit trail. Q6_entry_trigger and Q4_momentum_stage
      // carry Alpha's structural diagnosis — they must be coherent with entry_mode.
      //
      // INVARIANT: If Q6 names a breakout trigger (price has not yet traded through the
      // structural level) AND Q4 is DEVELOPING, the move has not confirmed. Executing at
      // current market price would mean entering BEFORE the breakout fires — the exact
      // failure pattern we are preventing.
      //
      // ACTION: Downgrade execute_now → push_confirmation and synthesise a wait_condition
      // zone centred on Alpha's planned entry price (tight band = ATR-approximate 0.1% width).
      // This keeps Alpha fully in authority — we correct the mode to match what Alpha already
      // told us in its answer_sheet. No trade parameters (SL, TP, lot size) are changed.
      //
      // GOVERNANCE: Logged as CCIP ENTRY_MODE_CONFLICT_CORRECTED for full audit trail.
      // SSOT: coordinator-alpha.ts is the sole parse and correction point for entry_mode.
      // This block runs BEFORE resolveExecutionMode() in goal-session-live-engine.ts so
      // the engine receives a consistent, already-validated decision object.
      if (
        action !== 'NO_TRADE' &&
        resolvedEntryMode === 'execute_now' &&
        answerSheet?.Q6_entry_trigger &&
        answerSheet?.Q4_momentum_stage
      ) {
        const q6Lower = answerSheet.Q6_entry_trigger.toLowerCase();
        const q4Lower = answerSheet.Q4_momentum_stage.toLowerCase();

        const isBreakoutTrigger =
          q6Lower.includes('breakout') ||
          q6Lower.includes('break above') ||
          q6Lower.includes('break below') ||
          q6Lower.includes('break of structure') ||
          q6Lower.includes('bos above') ||
          q6Lower.includes('bos below') ||
          q6Lower.includes('push through') ||
          q6Lower.includes('above resistance') ||
          q6Lower.includes('below support');

        const isDeveloping = q4Lower.includes('developing') || q4Lower.includes('dev');

        if (isBreakoutTrigger && isDeveloping) {
          const entryRef = typeof parsed.entry === 'number' && parsed.entry > 0 ? parsed.entry : 0;
          const zoneHalfWidth = entryRef > 0 ? entryRef * 0.001 : 0.001;

          const correctedZone = entryRef > 0
            ? {
                target_entry_zone_min: entryRef - zoneHalfWidth,
                target_entry_zone_max: entryRef + zoneHalfWidth,
                invalidation_price: action === 'BUY'
                  ? entryRef - zoneHalfWidth * 4
                  : entryRef + zoneHalfWidth * 4,
                wait_reasoning: `Breakout contradiction guard: Q6="${answerSheet.Q6_entry_trigger}" + Q4="${answerSheet.Q4_momentum_stage}" — breakout not yet confirmed. Waiting for M5 close inside zone before executing.`,
                expected_wait_minutes: 15,
              }
            : undefined;

          if (correctedZone) {
            resolvedEntryMode = 'push_confirmation';
            resolvedWaitCondition = correctedZone;
            console.warn(
              `[Alpha Coordinator] ENTRY_MODE_CONFLICT_CORRECTED: execute_now→push_confirmation ` +
              `— Q6="${answerSheet.Q6_entry_trigger}" (breakout) + Q4="${answerSheet.Q4_momentum_stage}" (developing) ` +
              `contradicts immediate execution. Synthesised wait zone: ${correctedZone.target_entry_zone_min.toFixed(5)}–${correctedZone.target_entry_zone_max.toFixed(5)}. ` +
              `Symbol=${symbol}. CCIP-FIX.`
            );
          } else {
            console.warn(
              `[Alpha Coordinator] ENTRY_MODE_CONFLICT_DETECTED: Q6="${answerSheet.Q6_entry_trigger}" + Q4="${answerSheet.Q4_momentum_stage}" ` +
              `contradicts execute_now but entry price unavailable to synthesise zone. Trade proceeds as execute_now. Symbol=${symbol}. CCIP-FIX.`
            );
          }
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // CCIP-2026-0319C: execute_now MUST NOT propagate wait_condition downstream.
      // ═══════════════════════════════════════════════════════════════════
      //
      // INVARIANT: wait_condition is advisory context for deferred entries only.
      // When entry_mode resolves to execute_now (immediate market order), any
      // wait_condition present in the LLM response is meaningless for routing and
      // MUST be stripped here at the SSOT boundary before the decision object
      // propagates to goal-session-live-engine.ts resolveExecutionMode().
      //
      // WHY: An execute_now decision that also carries a wait_condition was previously
      // misrouted to MONITORED mode by the secondary routing layer. The routing layer
      // saw wait_condition != null and treated it as a deferral signal, creating an
      // entry_intent that was never fulfilled — a silent trade failure.
      //
      // FIX: Coordinator is the SSOT authority. Strip wait_condition on execute_now
      // so no downstream consumer can be confused by its presence.
      if (resolvedEntryMode === 'execute_now' && resolvedWaitCondition != null) {
        console.warn(
          `[Alpha Coordinator] CCIP-2026-0319C: Stripping wait_condition from execute_now decision. ` +
          `entry_mode=execute_now is the SSOT routing authority; wait_condition is advisory context only. ` +
          `Downstream routing must not treat wait_condition as a deferral signal. Symbol=${symbol}.`
        );
        resolvedWaitCondition = undefined;
      }

      // ═══════════════════════════════════════════════════════════════════
      // ENTRY MONITOR GATE — SSOT GOVERNANCE ENFORCEMENT
      // CCIP-2026-0319B: Monitor-off intent blocking
      // ═══════════════════════════════════════════════════════════════════
      //
      // RULE: wait_pullback and push_confirmation require the entry monitor to be ACTIVE.
      // When the entry monitor is disabled, the system has no mechanism to watch price
      // and trigger execution at the target zone. Allowing a wait-intent through when
      // the monitor is off would create an entry_intent that is never fulfilled —
      // a silent NO_TRADE masquerading as a pending trade.
      //
      // ENFORCEMENT: If Alpha chose a wait mode AND the entry monitor is off, this gate
      // overrides the decision to NO_TRADE here, at the coordinator — the SSOT authority.
      // By the time the decision reaches AlphaTradeExecutor, it is already clean.
      //
      // GOVERNANCE: The override is logged to governance_change_log with change type
      // MONITOR_OFF_INTENT_BLOCKED so the audit trail records why the wait was suppressed.
      //
      // SSOT: coordinator-alpha.ts is the sole authority for entry_mode resolution.
      // goal-session-live-engine.ts resolveExecutionMode() is a secondary routing layer;
      // it must never receive a wait-mode decision when the monitor is off.
      const alphaWantsToWait =
        resolvedEntryMode === 'wait_pullback' || resolvedEntryMode === 'push_confirmation';

      if (action !== 'NO_TRADE' && alphaWantsToWait && userId) {
        // CCIP-2026-0322A: Reuse entryMonitorActive resolved at the top of coordinate()
        // in the parallel Promise.all fetch. No second DB round-trip needed.
        const monitorEnabled = entryMonitorActive;

        if (!monitorEnabled) {
          console.warn(
            `[Alpha Coordinator] MONITOR_OFF_INTENT_BLOCKED: Alpha chose entry_mode="${resolvedEntryMode}" ` +
            `but entry monitor is disabled for user ${userId}. ` +
            `Alpha cannot place deferred entries without an active monitor. ` +
            `Decision overridden to NO_TRADE. Symbol=${symbol}. CCIP-2026-0319B.`
          );
          return {
            action: 'NO_TRADE',
            decision: 'NO_TRADE',
            entry: currentPrice,
            stopLoss: currentPrice,
            takeProfit: currentPrice,
            confidence: Math.max(10, Math.min(100, tradeConfidence)),
            reasoning: `MONITOR_OFF_INTENT_BLOCKED: Alpha wanted ${resolvedEntryMode} but entry monitor is disabled. ` +
              `Enable the entry monitor to allow deferred entries, or Alpha will re-evaluate for an immediate execute_now opportunity.`,
            omega_summary: '',
            risk_pct: 0,
            narrativeValidation: narrativeValidation || undefined
          };
        }
      }

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
        // CCIP (2026-03-07): Reasoned NO_TRADE (LLM completed successfully) must carry confidence >= 10
        // so governance can distinguish it from a system-failure NO_TRADE (confidence === 0).
        // A system failure is: data missing, parse error, wall violation, hard block before LLM.
        // A reasoned rejection is: LLM evaluated the market and found no edge.
        // The governance alert fires on NO_TRADE && confidence === 0 — that must remain reserved
        // for genuine infrastructure failures only.
        const reasonedConfidence = Math.max(10, Math.min(100, tradeConfidence));
        // CCIP-2026-0319A (Fix 2): entry_mode is unconditionally undefined for NO_TRADE.
        // entryMode was already set to undefined above for NO_TRADE actions, but we log
        // here when the LLM hallucinated entry_mode on a NO_TRADE response so governance
        // can monitor LLM prompt compliance over time.
        if (parsed.entry_mode !== undefined && parsed.entry_mode !== null) {
          console.warn(
            `[Alpha Coordinator] NO_TRADE_ENTRY_STRIPPED: LLM returned entry_mode="${parsed.entry_mode}" and/or wait_condition on a NO_TRADE decision. ` +
            `Both fields stripped. Symbol=${symbol}. This indicates prompt non-compliance — review CCIP-2026-0319A.`
          );
        }
        return {
          action,
          decision: action,
          entry: currentPrice,
          stopLoss: currentPrice,
          takeProfit: currentPrice,
          confidence: reasonedConfidence,
          reasoning: parsed.reasoning || 'No reasoning provided',
          omega_summary: '',
          resolvedStyle,
          risk_pct: riskPct,
          thesis: thesis || undefined,
          style_intent: styleIntent || undefined,
          execution_preference: executionPreference || undefined,
          acceptable_profit_range: acceptableProfitRange || undefined,
          // entry_mode intentionally omitted — NO_TRADE decisions have no execution mode
          entry_spec: {
            entry_quality_score: entryQualityScore,
            entry_mode: undefined,
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

      // CCIP (2026-03-06): PROMPT COMPLIANCE ENFORCEMENT
      // stopLoss and takeProfit are NON-NEGOTIABLE for every BUY/SELL response.
      // If Alpha omits them, it is a prompt compliance failure — not a market condition.
      // Do NOT silently fall back. Log the violation loudly so it is visible in governance.
      if (typeof stopLoss !== 'number' || isNaN(stopLoss) || stopLoss <= 0) {
        console.error(`[Alpha Coordinator] CRITICAL PROMPT COMPLIANCE FAILURE: Alpha returned ${action} for ${symbol} WITHOUT a valid stopLoss. stopLoss=${stopLoss} (type: ${typeof stopLoss}). This violates the output contract. Trade BLOCKED.`);
        console.error(`[Alpha Coordinator] Parsed response fields: action=${parsed.action}, entry=${parsed.entry}, stopLoss=${parsed.stopLoss}, takeProfit=${parsed.takeProfit}`);
        return {
          action: 'NO_TRADE',
          decision: 'NO_TRADE',
          entry: currentPrice,
          stopLoss: currentPrice,
          takeProfit: currentPrice,
          confidence: 0,
          reasoning: `BLOCKED: Alpha returned ${action} without a valid stopLoss. Prompt compliance failure — Alpha must always provide stopLoss for BUY/SELL.`,
          omega_summary: '',
          risk_pct: 0
        };
      }
      if (typeof takeProfit !== 'number' || isNaN(takeProfit) || takeProfit <= 0) {
        console.error(`[Alpha Coordinator] CRITICAL PROMPT COMPLIANCE FAILURE: Alpha returned ${action} for ${symbol} WITHOUT a valid takeProfit. takeProfit=${takeProfit} (type: ${typeof takeProfit}). This violates the output contract. Trade BLOCKED.`);
        console.error(`[Alpha Coordinator] Parsed response fields: action=${parsed.action}, entry=${parsed.entry}, stopLoss=${parsed.stopLoss}, takeProfit=${parsed.takeProfit}, tp2=${parsed.tp2}`);
        return {
          action: 'NO_TRADE',
          decision: 'NO_TRADE',
          entry: currentPrice,
          stopLoss: currentPrice,
          takeProfit: currentPrice,
          confidence: 0,
          reasoning: `BLOCKED: Alpha returned ${action} without a valid takeProfit. Prompt compliance failure — Alpha must always provide takeProfit for BUY/SELL.`,
          omega_summary: '',
          risk_pct: 0
        };
      }

      // Additional safety check: ensure entry is a valid number
      if (typeof entry !== 'number' || isNaN(entry) || entry <= 0) {
        console.error(`[Alpha Coordinator] INVALID ENTRY PRICE: ${entry} (type: ${typeof entry})`);
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
          // CCIP-2026-0322A: Hard block — no TP1 for a dual-TP style is a malformed response.
          // The midpoint fallback was removed because it silently created TP1 = ~50% of TP2,
          // which could equal TP2 numerically after rounding and produced misleading audit data.
          // SSOT: coordinator-alpha.ts is the sole rejection authority for malformed Alpha responses.
          console.error(
            `[Alpha TP1 HARD BLOCK] ${tradeStyle} response missing mandatory "tp1" field. ` +
            `This is a malformed LLM response — TP1 is required for all dual-TP styles. ` +
            `Returning NO_TRADE to prevent a structurally incomplete trade execution. ` +
            `Symbol: ${symbol}. CCIP-2026-0322A.`
          );
          return {
            action: 'NO_TRADE',
            decision: 'NO_TRADE',
            entry: currentPrice,
            stopLoss: currentPrice,
            takeProfit: currentPrice,
            confidence: Math.max(10, Math.min(100, tradeConfidence)),
            reasoning: `TP1_MISSING_HARD_BLOCK: ${tradeStyle} response did not include a "tp1" field. ` +
              `A dual-TP trade cannot execute without both TP1 and TP2. Alpha will re-evaluate next scan.`,
            block_reason: 'TP1_MISSING',
            omega_summary: '',
            risk_pct: 0,
            narrativeValidation: narrativeValidation || undefined
          };
        }
        tp2Price = takeProfit;
        tp2Reasoning = `Alpha full target at ${tpPips.toFixed(1)} pips (${rr.toFixed(2)}:1 R:R)`;

        // CCIP-2026-0322A: Hard block — TP1 and TP2 must not be equal for dual-TP styles.
        // Equal targets indicate Alpha placed both at the same structural zone, which produces
        // a structurally meaningless partial-close and defeats the purpose of dual-TP geometry.
        // SSOT: coordinator-alpha.ts is the sole rejection authority.
        if (tp1Price != null && tp2Price != null && Math.abs(tp1Price - tp2Price) < 0.0001) {
          console.error(
            `[Alpha TP1=TP2 HARD BLOCK] ${tradeStyle} produced identical TP1 and TP2 values (${tp1Price}). ` +
            `Dual-TP geometry requires TP1 < TP2 (TP1 at M15 structure, TP2 at H1 structure). ` +
            `This is a malformed response. Returning NO_TRADE. Symbol: ${symbol}. CCIP-2026-0322A.`
          );
          return {
            action: 'NO_TRADE',
            decision: 'NO_TRADE',
            entry: currentPrice,
            stopLoss: currentPrice,
            takeProfit: currentPrice,
            confidence: Math.max(10, Math.min(100, tradeConfidence)),
            reasoning: `TP1_EQUALS_TP2_HARD_BLOCK: ${tradeStyle} produced TP1 = TP2 = ${tp1Price}. ` +
              `TP1 must be at the nearest M15 structural zone; TP2 at H1. They cannot be the same level. ` +
              `Alpha will re-evaluate next scan.`,
            block_reason: 'TP1_EQUALS_TP2',
            omega_summary: '',
            risk_pct: 0,
            narrativeValidation: narrativeValidation || undefined
          };
        }
      }

      // CCIP-2026-0324G: trader_statement extraction and word count enforcement.
      // The output schema requires 80+ words. This post-LLM check extracts the field,
      // logs a governance violation when it is absent or too short, and passes it downstream
      // for audit trail and UI display. Trade is NOT blocked — the statement is advisory
      // audit infrastructure. Under token pressure (long answer_sheet), the statement may
      // degrade silently; this guard makes the degradation observable.
      // SSOT: coordinator-alpha.ts is the sole extraction and enforcement point.
      const rawTraderStatement = typeof parsed.trader_statement === 'string' ? parsed.trader_statement : undefined;
      const traderStatementWordCount = rawTraderStatement
        ? rawTraderStatement.trim().split(/\s+/).filter(Boolean).length
        : 0;
      if (action === 'BUY' || action === 'SELL') {
        if (!rawTraderStatement || traderStatementWordCount < 30) {
          logViolation({
            violationType: 'TRADER_STATEMENT_ABSENT_OR_TOO_SHORT',
            severity: 'low',
            source: 'coordinator-alpha',
            description: `trader_statement ${rawTraderStatement ? `has only ${traderStatementWordCount} words` : 'is absent'}. Schema requires 80+ words. Token budget pressure likely.`,
            symbol: marketContext.symbol,
            userId: userId || 'unknown',
          }).catch(() => {});
          console.warn(
            `[Alpha Coordinator] CCIP-2026-0324G: trader_statement ${rawTraderStatement ? `too short (${traderStatementWordCount} words)` : 'absent'}. ` +
            `Schema requires 80+ words. Symbol=${symbol}.`
          );
        }
      }

      // CCIP-2026-0321A: Extract Alpha's per-trade deviation tolerance.
      // Alpha states max_entry_deviation_pips as an integer in the BUY/SELL output schema.
      // If missing or invalid, apply a per-asset-class fallback so execution never crashes.
      // Fallbacks (reasoning pips): forex=20, crypto=200, metals=80, indices=50.
      const rawDevPips = parsed.max_entry_deviation_pips;
      let alphaMaxDeviationPips: number | undefined;
      if (typeof rawDevPips === 'number' && Number.isFinite(rawDevPips) && rawDevPips > 0) {
        alphaMaxDeviationPips = Math.round(rawDevPips);
      } else {
        const sym = symbol.toUpperCase();
        if (['BTCUSD', 'ETHUSD', 'LTCUSD', 'XRPUSD', 'BCHUSD'].some(c => sym.includes(c.replace('USD', '')))) {
          alphaMaxDeviationPips = 200;
        } else if (['XAUUSD', 'XAGUSD', 'GOLD'].some(m => sym.includes(m.replace('USD', '')))) {
          alphaMaxDeviationPips = 80;
        } else if (['US30', 'NAS100', 'SPX500', 'UK100', 'DE30', 'JP225'].some(i => sym.includes(i))) {
          alphaMaxDeviationPips = 50;
        } else {
          alphaMaxDeviationPips = 20;
        }
        if (action !== 'NO_TRADE') {
          console.warn(`[Alpha Coordinator] max_entry_deviation_pips missing from Alpha response — applying ${alphaMaxDeviationPips} pip fallback for ${symbol}`);
        }
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
        // CCIP-2026-0319A (Fix 3): Use resolved values — may differ from raw LLM output
        // if wait_condition was synthesised from entry_advisory or entry_mode was downgraded.
        entry_mode: resolvedEntryMode as 'execute_now' | 'wait_pullback' | 'push_confirmation' | undefined,
        entry_spec: {
          entry_quality_score: entryQualityScore,
          entry_mode: resolvedEntryMode,
          style: resolvedStyle,
        },
        wait_condition: resolvedWaitCondition,
        narrativeValidation: narrativeValidation || undefined,
        entry_advisory: entryAdvisory || undefined,
        answer_sheet: answerSheet,
        // CCIP-2026-0321A: Alpha's stated tolerance — passed to executor for enforcement
        max_entry_deviation_pips: action !== 'NO_TRADE' ? alphaMaxDeviationPips : undefined,
        // CCIP-2026-0324G: Pass trader_statement through for audit trail and UI display
        trader_statement: rawTraderStatement
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

    const parts: string[] = ['\nSENSOR READINGS:'];

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

    const parts: string[] = ['\nALPHA INTELLIGENCE (raw historical data):'];

    if (symbol && intelligence.symbolIntelligence && intelligence.symbolIntelligence[symbol]) {
      const si = intelligence.symbolIntelligence[symbol];
      const siParts: string[] = [];
      if (si.recentWinRate > 0) siParts.push(`WR=${si.recentWinRate.toFixed(0)}%`);
      if (si.bestSessions?.length > 0) siParts.push(`best_sessions=${si.bestSessions.join('/')}`);
      if (si.avgSlippage > 0) siParts.push(`slippage=${si.avgSlippage.toFixed(1)}p`);
      siParts.push(`vol=${si.volatilityLevel}`);
      parts.push(`${symbol}: ${siParts.join(' | ')}`);
    }

    if (intelligence.platformPatterns.topPerformingPatterns.length > 0 || intelligence.platformPatterns.failingPatterns.length > 0) {
      const topPatterns = intelligence.platformPatterns.topPerformingPatterns.slice(0, 3);
      if (topPatterns.length > 0) {
        parts.push(`top_patterns: ${topPatterns.map(p => `${p.patternId}(w=${Math.round(p.winRate * p.sampleSize / 100)}/${p.sampleSize} R=${p.avgRMultiple.toFixed(1)})`).join(', ')}`);
      }
      const failingPatterns = intelligence.platformPatterns.failingPatterns.slice(0, 3);
      if (failingPatterns.length > 0) {
        parts.push(`weak_patterns: ${failingPatterns.map(p => `${p.patternId}(w=${Math.round(p.winRate * p.sampleSize / 100)}/${p.sampleSize})`).join(', ')}`);
      }
    }

    const calibrationKeys = Object.keys(intelligence.calibrationData);
    if (calibrationKeys.length > 0) {
      const calibLines: string[] = [];
      for (const [bucketStr, data] of Object.entries(intelligence.calibrationData)) {
        if (data.sampleSize >= 10) {
          calibLines.push(`${bucketStr}%pred=${data.actualWinRate.toFixed(0)}%actual(n=${data.sampleSize})`);
        }
      }
      if (calibLines.length > 0) parts.push(`confidence_cal: ${calibLines.join(', ')}`);
    }

    if (intelligence.metaInsights.length > 0) {
      const validated = intelligence.metaInsights.slice(0, 3).filter(i => i.validated);
      if (validated.length > 0) {
        parts.push('meta_insights:');
        validated.forEach(insight => parts.push(`  [${insight.confidence}%] ${insight.type}: ${insight.description}`));
      }
    }

    if (intelligence.executionQuality.avgSlippage > 0) {
      parts.push(`exec: slippage=${intelligence.executionQuality.avgSlippage.toFixed(1)}p sl_hunt=${intelligence.executionQuality.slHuntingSuspected} rejections=${intelligence.executionQuality.recentRejections}`);
    }

    if (intelligence.counterfactualInsights.sampleSize >= 5) {
      const cf = intelligence.counterfactualInsights;
      const cfParts: string[] = [];
      if (cf.bestSlMultiplier !== null) cfParts.push(`opt_SL=${cf.bestSlMultiplier.toFixed(2)}x`);
      if (cf.bestTpMultiplier !== null) cfParts.push(`opt_TP=${cf.bestTpMultiplier.toFixed(2)}x`);
      cfParts.push(`early_exit=${cf.earlyExitCount}/${cf.totalSampled} hold_longer=${cf.holdLongerCount}/${cf.totalSampled}`);
      parts.push(`counterfactual: ${cfParts.join(' ')}`);
    }

    const zml = intelligence.zoneMetaLearning;
    const hasZoneData = Object.keys(zml.zoneTypeSuccessRates).length > 0 || zml.reachabilityRate > 0;
    if (hasZoneData) {
      const zParts: string[] = [];
      Object.entries(zml.zoneTypeSuccessRates).forEach(([zoneType, rate]) => zParts.push(`${zoneType}=${(rate * 100).toFixed(0)}%`));
      if (zml.reachabilityRate > 0) zParts.push(`reach=${(zml.reachabilityRate * 100).toFixed(0)}%`);
      const unreachable = Object.entries(zml.unreachableByRegime).filter(([, rate]) => rate > 0.3);
      unreachable.forEach(([regime, rate]) => zParts.push(`${regime}_unreachable=${(rate * 100).toFixed(0)}%`));
      parts.push(`zones: ${zParts.join(' | ')}`);
    }

    if (intelligence.tpCalibration) {
      parts.push(intelligence.tpCalibration);
    }

    const dm = intelligence.decisionMetrics;
    if (dm.totalDecisions >= 5) {
      parts.push(`decisions: total=${dm.totalDecisions} W=${dm.totalWins} L=${dm.totalLosses} profitR=${dm.totalProfitR.toFixed(1)} lossR=${dm.totalLossR.toFixed(1)}`);
    }

    const tp1 = intelligence.tp1Learning;
    if (tp1.totalTP1Events >= 3) {
      parts.push(`tp1_data: events=${tp1.totalTP1Events} early(${tp1.closeEarlyWins}/${tp1.closeEarlyTotal} $${tp1.avgPnlCloseEarly.toFixed(0)}) hold(${tp1.holdToTP2Wins}/${tp1.holdToTP2Total} $${tp1.avgPnlHoldToTP2.toFixed(0)})`);
    }

    if (intelligence.validatedInsights.length > 0) {
      parts.push('validated_insights:');
      intelligence.validatedInsights.slice(0, 3).forEach(insight => {
        const winStr = insight.winRate > 0 && insight.sampleSize >= 5 ? ` w=${Math.round(insight.winRate * insight.sampleSize / 100)}/${insight.sampleSize}` : '';
        parts.push(`  [${insight.confidence.toFixed(0)}%,n=${insight.sampleSize}${winStr}] ${insight.title}: ${insight.description}`);
      });
    }

    if (intelligence.patternWeights && intelligence.patternWeights.length > 0) {
      const topPatterns = intelligence.patternWeights
        .filter(p => p.totalTrades >= 5)
        .sort((a, b) => b.advisoryWeight - a.advisoryWeight)
        .slice(0, 5);
      if (topPatterns.length > 0) {
        parts.push(`pattern_weights: ${topPatterns.map(p => `${p.patternId}(w=${p.advisoryWeight.toFixed(1)} WR=${(p.winRate * 100).toFixed(0)}%)`).join(' ')}`);
      }
    }

    if (intelligence.slHuntCorrections && symbol && intelligence.slHuntCorrections[symbol]) {
      const hunt = intelligence.slHuntCorrections[symbol];
      if (hunt.totalSlHits >= 3 && hunt.huntRate >= 0.3) {
        parts.push(`SL_HUNT (${symbol}): rate=${(hunt.huntRate * 100).toFixed(0)}% n=${hunt.totalSlHits}${hunt.recommendedWidenPct > 0 ? ` — widen SL ~${(hunt.recommendedWidenPct * 100).toFixed(0)}%` : ''}`);
      }
    }

    if (intelligence.sessionStreakState && intelligence.sessionStreakState.sessionTrades >= 2) {
      const streak = intelligence.sessionStreakState;
      const wr = streak.sessionTrades > 0 ? ((streak.sessionWins / streak.sessionTrades) * 100).toFixed(0) : '0';
      parts.push(`today: ${streak.sessionTrades}trades WR=${wr}% PnL=${streak.sessionPnlR >= 0 ? '+' : ''}${streak.sessionPnlR.toFixed(2)}R${streak.currentStreak >= 3 ? ` [${streak.streakType.toUpperCase()} STREAK x${streak.currentStreak}]` : ''}`);
    }

    if (intelligence.tpDistributionStats && symbol) {
      const symStats = intelligence.tpDistributionStats[symbol];
      if (symStats) {
        const styleKeys = Object.keys(symStats).filter(k => symStats[k].totalTrades >= 5);
        if (styleKeys.length > 0) {
          parts.push(`tp_dist(${symbol}): ${styleKeys.map(s => { const d = symStats[s]; return `${s}:full=${(d.tpFullRate * 100).toFixed(0)}% tp1=${(d.tp1OnlyRate * 100).toFixed(0)}% sl=${(d.slRate * 100).toFixed(0)}%(n=${d.totalTrades})`; }).join(' | ')}`);
        }
      }
    }

    if (intelligence.counterThesisAccuracy && symbol && intelligence.counterThesisAccuracy[symbol]) {
      const ct = intelligence.counterThesisAccuracy[symbol];
      if (ct.totalTrades >= 5) {
        const calibErr = (ct.calibrationError * 100).toFixed(0);
        const note = ct.calibrationError > 0.2 ? (ct.avgPredictedFailureRate > ct.actualFailureRate ? ' [over-cautious]' : ' [under-estimating risk]') : '';
        parts.push(`counter_thesis_cal(${symbol}): pred=${(ct.avgPredictedFailureRate * 100).toFixed(0)}% actual=${(ct.actualFailureRate * 100).toFixed(0)}% err=${calibErr}%(n=${ct.totalTrades})${note}`);
      }
    }

    return parts.join('\n');
  }

}

export const alphaCoordinator = new AlphaCoordinatorBrain();
