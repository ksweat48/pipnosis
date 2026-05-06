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
 * Session Example:
 * - EURUSD at 22:00 UTC (Asian session, low liquidity):
 *   - Regime Oracle: session=DEAD, volatility_score=30, structure=range
 *   - Alpha: Reads full raw data, evaluates sweep structure and clean air
 *   - Result: Alpha decides based on his edge — no code pre-scores the session
 *
 * - USDJPY at 23:00 UTC (Tokyo active):
 *   - Regime Oracle: session=ASIAN, Tokyo active, full liquidity
 *   - Alpha proceeds with full market picture
 *
 * CCIP-2026-0329A: All session weight multipliers, dead zone penalties,
 * and confidence deductions have been removed. Alpha receives raw regime
 * measurements and makes his own decision. No system pre-scores sessions.
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
import { VALID_CONFIDENCE_TIERS, tierToNumber, CONFIDENCE_TIER_TO_NUMBER } from '../config/confidence-tier';
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
import { getPairPersonalityContext } from '../config/pair-personalities';
import { microRegimeClassifier, type MicroRegimeResult, type MicroRegimeCandle } from '../services/micro-regime-classifier';
import { liquidityIntentAnalyzer, type LiquiditySweepFacts } from '../services/liquidity-intent-analyzer';
import { narrativeCoherenceValidator, type NarrativeValidation } from '../services/narrative-coherence-validator';
import { logViolation } from '../services/ssot-violation-logger';
import { sharedIntelligenceCoordinator } from '../services/shared-intelligence-coordinator';
import { extractRegimeSignature } from '../services/regime-signature-extractor';
import { parseStructuredAlphaResponse } from '../services/alpha-thesis-parser';
import type { AlphaMarketThesis, RegimeSignature } from '../types/alpha-thesis';
// CCIP-2026-0427E-STYLE-CONSOLIDATION: m5SwingAnalyzer no longer used (SCALP-only block removed).
import { MarketDataService } from '../services/market-data-service';
import { alphaGeometryValidator } from '../services/alpha-geometry-validator';
import { getExecutionEnvelope, getAssetClassEnvelopeBounds, validateTPSLAgainstEnvelope, type EnvelopeAssetClass } from '../config/style-execution-envelopes';
import { TRADING_CONSTANTS, getMinRRForStyle, getMinTP1RRForStyle, getEstimatedSpreadPips, getMinSlDistancePips } from '../config/trading-constants';
import { wallCalibrationEngine } from '../services/wall-calibration-engine';
import { resolveCanonicalStyle } from '../config/timeframe-hierarchy';
import { computeMomentumTrajectory, formatMomentumTrajectoryForPrompt } from '../services/momentum-trajectory-analyzer';

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
  style: 'MICRO_INTRADAY'; // CCIP-2026-0427E-STYLE-CONSOLIDATION
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
 * TRADE STYLE (single-style platform — CCIP-2026-0427E-STYLE-CONSOLIDATION):
 * - MICRO_INTRADAY: TP1 = scalp partial, TP2 = intraday target
 *
 * Philosophy:
 * - Risk defines position size and loss tolerance
 * - Style is fixed at MICRO_INTRADAY — TP1/TP2 cover the full intraday duration spectrum
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
  price: number;       // Last closed candle close — structural analysis reference
  livePrice?: number;  // Live market mid price at snapshot build time — Alpha uses for entry planning
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
  tradeStyle?: string; // CCIP-2026-0427E-STYLE-CONSOLIDATION: single-style platform; legacy values resolve to MICRO_INTRADAY
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
  // CCIP-2026-0413-CONFIDENCE-TEXT: Alpha's original text tier (e.g. "confident", "high").
  // The numeric `confidence` field is derived from this via CONFIDENCE_TIER_TO_NUMBER.
  // Alpha never sees numbers — this is what he actually said.
  confidence_tier?: string;
  reasoning: string;
  omega_summary: string;
  omega_votes?: OmegaCouncilVotes;
  omega8_liquidity_bias?: string;
  omega9_validation?: Omega9ValidationResult;
  omega10_applied?: boolean;
  symbol?: string;
  timestamp?: Date;
  risk_pct?: number;
  resolvedStyle?: 'MICRO_INTRADAY'; // CCIP-2026-0427E-STYLE-CONSOLIDATION
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
  style_intent?: string; // Style intent (MICRO_INTRADAY) — CCIP-2026-0427E-STYLE-CONSOLIDATION
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
  microRegime?: MicroRegimeResult;
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
  /**
   * CCIP-2026-0410A / CCIP-2026-0327C: NO_TRADE transparency fields.
   *
   * execution_status: What category of outcome this decision represents.
   *   EXECUTED — trade was taken (Alpha called BUY/SELL — no confidence gate exists)
   *   NO_TRADE_GENUINE — Alpha said NO_TRADE (genuinely found no profitable structural edge)
   *   NO_TRADE_LEAN — Alpha said NO_TRADE but had a directional lean
   *
   * BLOCKED_BY_FLOOR is permanently retired. Alpha's confidence never blocks execution.
   * Alpha executes any trade he calls. The only valid non-execution outcome is Alpha's own NO_TRADE.
   *
   * directional_lean: Alpha's directional opinion when no trade was taken.
   *   Only meaningful when action=NO_TRADE. Tells us if Alpha was leaning a direction.
   *
   * lean_confidence: How strong was the lean (0-100). 0 when NEUTRAL.
   */
  execution_status?: 'EXECUTED' | 'NO_TRADE_GENUINE' | 'NO_TRADE_LEAN';
  directional_lean?: 'BUY_LEAN' | 'SELL_LEAN' | 'NEUTRAL';
  lean_confidence?: number;
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
     * Q10: Entry conviction self-rating — MICRO_INTRADAY (CCIP-2026-0427E-STYLE-CONSOLIDATION).
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
     * Q11: Zone entry quality self-rating — MICRO_INTRADAY (CCIP-2026-0427E-STYLE-CONSOLIDATION).
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
    /**
     * Q12: Market phase classification on the control TF.
     * ACCUMULATION | EXPANSION | DISTRIBUTION | RETRACEMENT | REVERSAL
     * Named candle evidence FIRST, phase label as conclusion.
     * Must be consistent with Q4_momentum_stage — conflicts require thesis_coherence_statement resolution.
     *
     * CCIP-2026-0325A: Mandatory field. Missing or blank = governance violation.
     * SSOT: alpha-identity.ts defines the format. coordinator-alpha.ts extracts and audits.
     */
    Q12_market_phase?: string;
    /**
     * Session boundary prices — named prices Alpha is reasoning from.
     * CCIP-2026-0325A: Forces Alpha to surface the actual session levels, not reason from
     * implicit assumptions. UNKNOWN is acceptable when data is unavailable. Blank is a violation.
     */
    session_high?: number | null | string;
    session_low?: number | null | string;
    prior_session_high?: number | null | string;
    prior_session_low?: number | null | string;
    /**
     * session_sweep_status: Which session boundaries have been swept and which remain as draw.
     * MANDATORY for London and NY sessions on forex instruments.
     * Format: "ASIAN_LOW_SWEPT at [price] | ASIAN_HIGH_INTACT at [price]" etc.
     *
     * CCIP-2026-0325A: Mandatory field for London and NY sessions.
     * SSOT: alpha-identity.ts defines the format. coordinator-alpha.ts extracts for audit/learning.
     */
    session_sweep_status?: string;
    /**
     * Q_SWEEP_RECLAIM_STATUS: Sweep-reclaim lifecycle state.
     * Values: NO_SWEEP_PENDING | NO_RECLAIM_PENDING | RECLAIM_CONFIRMED | N/A
     *
     * CCIP-2026-0422B: Single-sided NO_SWEEP_PENDING or NO_RECLAIM_PENDING mandates
     * a directional wait_pullback output, not NO_TRADE. This field drives the
     * CCIP-0422B-GATE upgrade logic in the coordinator.
     */
    Q_SWEEP_RECLAIM_STATUS?: string;
    /**
     * Q_TRAPPED_FUEL: Assessment of trapped participant energy available to drive the move.
     * Present when Alpha identifies trapped longs/shorts that will amplify directional momentum.
     */
    Q_TRAPPED_FUEL?: string;
    /**
     * Q4B_realtime_participant_read: Live read of who is entering/exiting right now.
     * Distinguishes informed flow from retail noise at the current price level.
     */
    Q4B_realtime_participant_read?: string;
    /**
     * Q_PRICED_IN: Assessment of whether the structural setup has already been discovered
     * and partially exploited, reducing remaining edge.
     */
    Q_PRICED_IN?: string;
    /**
     * Q_LIQUIDITY_CASCADE: Directional cascade sequence when trapped participants are forced out.
     * Named direction and sequence of expected liquidation flow.
     * CCIP-2026-0422B: When present, the cascade direction overrides conflicting signals.
     */
    Q_LIQUIDITY_CASCADE?: string;
    /**
     * Q_WHO_IS_TRAPPED: Identity of the trapped participant group (retail longs, trapped shorts, etc.).
     * CCIP-2026-0422D: Mandatory when trap_likely pattern fires. Missing = incomplete reasoning.
     */
    Q_WHO_IS_TRAPPED?: string;
    /**
     * Q_WHAT_DIRECTION_WHEN_THEY_RUN: Named direction trapped participants will move when stopped out.
     * CCIP-2026-0422D: Mandatory when Q_WHO_IS_TRAPPED is populated.
     * "trap likely but no directional bias" is a self-contradiction when this field can be derived.
     */
    Q_WHAT_DIRECTION_WHEN_THEY_RUN?: string;
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
  /**
   * CCIP-2026-0420A: Alpha's structural justification for TP placement.
   * Extracted from the LLM response field of the same name.
   * Format: "TP at [price] — [named zone/level]. ~[X] pips. R:R [X]:1."
   * Mandatory on BUY/SELL responses per output schema. Persisted to alpha_decisions for audit.
   */
  tp_structural_reference?: string;
  /**
   * CCIP-2026-0420A: Alpha's structural justification for SL placement.
   * Extracted from the LLM response field of the same name.
   * Format: "[named level] — ~[X] pips from entry. Invalidation: [reasoning]."
   * Mandatory on BUY/SELL responses per output schema. Persisted to alpha_decisions for audit.
   */
  sl_structural_reference?: string;
  /**
   * CCIP-2026-0427-A: Wait-intent-available-but-suppressed-by-monitor-off subclass.
   * Set true when entryMonitorActive === false AND Alpha returned wait_pullback or
   * push_confirmation. The decision is downstream NO_TRADE (executor cannot deliver
   * deferred entries without the monitor) but is structurally a valid wait setup.
   * The dashboard uses this to quantify monitor-off impact on alpha_profitability_dashboard.
   */
  wait_intent_available_for_monitor_off?: boolean;
  /**
   * CCIP-2026-0427-A: Snapshot of the original wait intent that was suppressed.
   * Captures what Alpha would have entered into if the monitor were active.
   */
  wait_intent_metadata?: {
    original_entry_mode: 'wait_pullback' | 'push_confirmation';
    entry_zone_min?: number;
    entry_zone_max?: number;
    invalidation_price?: number;
    wait_reasoning?: string;
  };
  /**
   * tp_multiplier_override: Alpha's per-trade ATR TP multiplier.
   *
   * CCIP-ALPHA-GOV-001: When present, this value replaces the static 3.0x ATR base
   * in calculateDynamicMultipliers(). Alpha measures the structural distance to his
   * chosen TP level and expresses it as an ATR multiple — this is Alpha's structural
   * judgment, not a formula. Required on every BUY/SELL response.
   *
   * SSOT: AlphaOutputFormat.tp_multiplier_override in alpha-identity.ts.
   * This interface field mirrors it so the value survives the LLM parse boundary
   * and reaches calculateDynamicMultipliers() in alpha-omega-orchestrator.ts.
   *
   * FALLBACK: [CCIP-ALPHA-GOV-001] absent → static 3.0x ATR base (WARN logged).
   */
  tp_multiplier_override?: number;
  /**
   * rr_ceiling_override: Alpha's per-trade R:R ceiling.
   *
   * CCIP-ALPHA-GOV-001: When present, replaces getMaxRRForStyle() in omega9-constraint-provider.
   * Clamped by TRADING_CONSTANTS.RISK_REWARD_RATIOS.MAX_RR_RATIO (hard physics cap).
   * SSOT: AlphaOutputFormat.rr_ceiling_override in alpha-identity.ts.
   */
  rr_ceiling_override?: number;
  /**
   * spread_estimate_pips: Alpha's per-trade spread estimate for current pair and session.
   *
   * CCIP-ALPHA-GOV-001: When present, used wherever AVERAGE_SPREAD_PIPS static fallback
   * would be used. SSOT: AlphaOutputFormat.spread_estimate_pips in alpha-identity.ts.
   */
  spread_estimate_pips?: number;
  /**
   * CCIP-2026-0415: Decision Origin Classification System.
   *
   * Every NO_TRADE is self-documenting. This field records WHY the outcome is NO_TRADE —
   * distinguishing Alpha's genuine judgment from system failures, infrastructure errors,
   * data outages, and system blocks on Alpha's actual BUY/SELL intent.
   *
   * ALPHA_GENUINE          — Alpha searched, found no structural edge (real NO_TRADE)
   * ALPHA_BLOCKED_GEOMETRY — Alpha found a trade; geometry validation blocked it
   * ALPHA_BLOCKED_COMPLIANCE — Alpha found a trade; missing required field blocked it
   * ALPHA_BLOCKED_SURVIVAL — Alpha found a trade; Omega-9 survival gate blocked it
   * SYSTEM_DATA_MISSING    — Candle/structural data unavailable; Alpha could not reason
   * SYSTEM_PARSE_FAILURE   — LLM response could not be parsed
   * SYSTEM_DEGENERATE      — LLM returned abbreviated/empty output (both attempts)
   * SYSTEM_TRUNCATED       — LLM hit token budget and response was cut off
   * SYSTEM_NETWORK_FAILURE — Infrastructure/network error in coordinate()
   * SYSTEM_FRESHNESS_BLOCK — Price data was stale; freshness gate blocked execution
   * ENGINE_RISK_BLOCKED    — Risk manager blocked execution post-Alpha
   * ENGINE_FEASIBILITY_BLOCKED — Goal feasibility blocked execution
   * ENGINE_CAPACITY_BLOCKED — Concurrent trade limit reached
   */
  decision_origin?: 'ALPHA_GENUINE' | 'ALPHA_BLOCKED_GEOMETRY' | 'ALPHA_BLOCKED_COMPLIANCE' | 'ALPHA_BLOCKED_SURVIVAL' | 'SYSTEM_DATA_MISSING' | 'SYSTEM_PAIR_NOT_READY' | 'SYSTEM_PARSE_FAILURE' | 'SYSTEM_DEGENERATE' | 'SYSTEM_TRUNCATED' | 'SYSTEM_NETWORK_FAILURE' | 'SYSTEM_FRESHNESS_BLOCK' | 'ENGINE_RISK_BLOCKED' | 'ENGINE_FEASIBILITY_BLOCKED' | 'ENGINE_CAPACITY_BLOCKED';
  /**
   * CCIP-2026-0415: Preserved original Alpha decision when system blocked it.
   * Only set when decision_origin starts with ALPHA_BLOCKED_* or ENGINE_*.
   * Tells us what Alpha actually said before the system intervened.
   */
  alpha_original_decision?: {
    action: 'BUY' | 'SELL';
    entry: number;
    stopLoss: number;
    takeProfit: number;
    confidence: number;
    entry_mode?: string;
    reasoning?: string;
  };
  /**
   * CCIP-2026-0415: djb2 hash of (first 120 chars + last 80 chars + completion_tokens).
   * Used to detect GPT-4o KV-prefix cache contamination across symbols in the same batch.
   * Identical fingerprints across different symbols = cache hit, not independent analysis.
   */
  response_fingerprint?: string;
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

    // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform. resolveCanonicalStyle always returns MICRO_INTRADAY.
    const tradeStyle = resolveCanonicalStyle(goalContext?.tradeStyle, 'MICRO_INTRADAY');

    console.log(`[Alpha Coordinator] Dual-Arena mode [Style: ${tradeStyle}] - Alpha chooses direction`);

    // Fire-and-forget thought stream emissions
    if (sessionId && userId) {
      alphaThoughtStream.emitAlphaPlatformIntel(sessionId, userId, marketContext.symbol).catch(() => {});
      alphaThoughtStream.emitAlphaNarrative(sessionId, userId, marketContext.symbol).catch(() => {});
      if (goalContext) {
        alphaThoughtStream.emitAlphaRiskCheck(sessionId, userId, marketContext.symbol).catch(() => {});
      }
    // Load platform streak context (non-blocking, observation only — CCIP-2026-0329A)
    let streakContextLine = 'Platform streak context: no significant streak — platform is in a neutral execution phase.';
    try {
      const platformScore = await rewardEngine.loadPlatformScore();
      streakContextLine = buildStreakContext(platformScore);
    } catch { /* Non-blocking — streak context is advisory only */ }

    }

    // Load platform streak context (observation only, non-blocking — CCIP-2026-0329A)
    let streakContextLine = 'Platform streak context: no significant streak — platform is in a neutral execution phase.';
    try {
      const platformScore = await rewardEngine.loadPlatformScore();
      streakContextLine = buildStreakContext(platformScore);
    } catch {
      // Non-blocking — default to neutral observation
    }

    // Parallelize all independent data fetches (bidirectional for dual-arena)
    // CCIP-2026-0506E FRESH-SCAN ISOLATION: The ai_trade_analysis historical query was
    // removed from this pipeline. Prior trade outcomes must NEVER flow into Alpha's prompt —
    // each scan must reason from live market data alone. Contamination from historical
    // win/loss records was producing pattern-matched SELL bias (see CCIP-2026-0506E).
    const [, dailyNarrative, riskResultLong, riskResultShort, rrResult, monitorPrefRaw] = await Promise.all([
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
        .from('user_monitor_preferences')
        .select('entry_price_monitor_enabled')
        .eq('user_id', userId)
        .maybeSingle()
        .then(({ data }) => data)
        .catch(() => null) : Promise.resolve(null)
    ]);

    // CCIP-2026-0322A: Resolve monitor status from parallel fetch.
    // CCIP-2026-0429A: Default to FALSE — Alpha's prompt must match what the downstream
    // executor can deliver. Monitor-OFF users get execute_now only; the new
    // ALPHA_WANTS_WAIT_MONITOR_REQUIRED state surfaces deferred setups with an upgrade prompt.
    const entryMonitorActive = monitorPrefRaw?.entry_price_monitor_enabled === true;

    const entryModePromptSection = entryMonitorActive
      ? `ENTRY MODE — TRIGGER-CLOSED-FIRST DECISION PROCESS (CCIP-2026-0505D ENTRY TIMING DISCIPLINE):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GOVERNANCE RULE (CCIP-2026-0333): Every BUY or SELL response MUST include "entry_mode" as a TOP-LEVEL field
in the JSON. Omitting entry_mode will BLOCK the trade — it is not optional, not nested, not skippable.
Place it at the root of the JSON object, not inside entry_spec or any other sub-object.

ENTRY TIMING PHILOSOPHY (CCIP-2026-0505D):
execute_now is NOT the default. execute_now is reserved for setups where the confirming candle has
ALREADY CLOSED on the control timeframe AND price is still inside the actionable zone. A correct
read with an early entry is still a losing trade. When in doubt, wait_pullback is the professional
choice — the system will execute the moment price reaches your named zone. You are NOT losing
opportunity by waiting; you are gaining better fills and surviving noise.

MANDATORY DECISION SEQUENCE — evaluate in this exact order for every pair:

STEP 1 — HAS THE CONFIRMING CANDLE ALREADY CLOSED on the control timeframe?
The "confirming candle" is the already-closed candle that proves your trigger fired:
  - SELL: closed bearish rejection / closed reclaim / closed BOS candle
  - BUY:  closed bullish rejection / closed reclaim / closed BOS candle
  - Sweep-reclaim: closed candle that took liquidity AND closed back inside the range
  - Break-of-structure: closed candle that broke and held the prior structural level
Ask: Can I point to a SPECIFIC already-closed candle on the control TF that proves the trigger fired?
  AND is price still within my actionable entry zone (not already extended >0.5×ATR past the trigger)?
If BOTH YES → "entry_mode": "execute_now". Cite the closed candle in q_micro_context or q_trigger_state. DONE.
If the confirming candle is still FORMING / NOT YET CLOSED → you do NOT have execute_now. Go to STEP 2.
If the candle closed but price has already extended past the optimal zone → go to STEP 2 (pullback).

STEP 2 — CAN I NAME THE ZONE WHERE THE TRIGGER WILL FIRE OR RETRACE TO?
Use when: trigger is forming but not closed; price extended past optimal entry; pending sweep;
pending BOS retest; anticipating reversal without a closed reversal candle yet.
Required: a named structural level (wick high/low, prior PDH/PDL, FVG edge, VWAP, session high/low,
equal highs/lows cluster) — NOT a round number guess.
→ "entry_mode": "wait_pullback" — zone is defined, system will execute on zone hit.
→ "entry_mode": "push_confirmation" — you need a CANDLE CLOSE inside a specific 1–3 pip zone.
The system will execute the moment price enters your zone (and for push_confirmation, closes inside).
This is NOT a weaker decision. For counter-momentum / reversal setups this is the CORRECT decision.

STEP 3 — NO_TRADE (only if BOTH Step 1 and Step 2 fail)
Only valid when you cannot find a direction AND cannot name a trigger zone.
If you have directional conviction and can name a level → STEP 2, not NO_TRADE.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ENTRY MODE OPTIONS:

  "entry_mode": "execute_now"
    → The confirming candle has ALREADY CLOSED on the control TF AND price is still inside the zone.
    → You must be able to cite the closed trigger candle in your reasoning.
    → No wait_condition block required.

  "entry_mode": "wait_pullback"
    → Price extended, trigger forming, pending sweep, pending reclaim, anticipating reversal without
      a closed reversal candle yet, or any counter-momentum setup where the latest control-TF candle
      still prints in the opposing direction.
    → Include a wait_condition block with the named structural zone.

  "entry_mode": "push_confirmation"
    → You require a candle CLOSE inside a specific zone before entry is confirmed.
    → Zone should be tight (1-3 pip width for FX, proportional for indices/crypto).
    → Include a wait_condition block.

For wait_pullback or push_confirmation, include:
{
  "wait_condition": {
    "target_entry_zone_min": <lower bound of the trigger zone>,
    "target_entry_zone_max": <upper bound of the trigger zone>,
    "invalidation_price": <price that invalidates the thesis entirely>,
    "wait_reasoning": "Name the structural level and state exactly why you are waiting",
    "expected_wait_minutes": <your estimate of how long until trigger fires>
  }
}

COUNTER-MOMENTUM FADE CHECK (CCIP-2026-0505D — HARD RULE):
If your action FADES the most recent closed control-TF candle (SELL into a bullish close,
BUY into a bearish close) — this is a counter-momentum setup. execute_now is ONLY permitted if
you can cite a named already-closed reversal candle (rejection wick / reclaim / BOS against the
prior momentum). If no closed reversal candle exists yet, you MUST output wait_pullback with the
reversal zone named. "Anticipating a reversal" is never sufficient for execute_now.

REMINDER: "entry_mode" must be a top-level key in your JSON response. Example:
{ "action": "SELL", "entry_mode": "wait_pullback", "wait_condition": { ... }, ... }
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      : `ENTRY MODE — MONITOR OFF, TRIGGER-CLOSED-FIRST DISCIPLINE (CCIP-2026-0505D):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GOVERNANCE RULE (CCIP-2026-0333): Every BUY or SELL response MUST include "entry_mode" as a TOP-LEVEL field
in the JSON. Omitting entry_mode will BLOCK the trade — it is not optional, not nested, not skippable.

This user does not have the Entry Monitor active. Your primary job is to find the best execute_now
trade — but execute_now still requires an ALREADY-CLOSED confirming candle. Do NOT force execute_now
on a setup that has not yet confirmed; output wait_pullback instead and the system will surface it as
a monitor-upgrade opportunity to the user.

MANDATORY DECISION SEQUENCE:

STEP 1 — HAS THE CONFIRMING CANDLE ALREADY CLOSED on the control timeframe,
         AND is price still inside the actionable zone?
If YES → "entry_mode": "execute_now". Cite the closed trigger candle. DONE.

STEP 2 — TRIGGER NOT YET CLOSED, OR PRICE EXTENDED: can I name the zone where it WILL fire / retrace to?
If YES → "entry_mode": "wait_pullback" with wait_condition. The system captures this as a
monitor-required opportunity and surfaces it to the user with the option to activate the Entry Monitor.
Do NOT force execute_now just because the monitor is off — a correct read entered early still loses.

STEP 3 — No direction and no nameable zone → NO_TRADE.

COUNTER-MOMENTUM FADE CHECK (CCIP-2026-0505D — HARD RULE):
If your action FADES the most recent closed control-TF candle, execute_now requires a NAMED
already-closed reversal candle. Otherwise you MUST output wait_pullback.

REMINDER: "entry_mode" must be a top-level key in your JSON response.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

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
      const currentPx = marketContext.livePrice ?? marketContext.price;
      const swingHigh = briefing?.intelligence?.swingHigh;
      const swingLow = briefing?.intelligence?.swingLow;
      if (swingHigh && swingLow && swingHigh > swingLow) {
        const rangeSize = swingHigh - swingLow;
        const positionInRange = (currentPx - swingLow) / rangeSize;
        const locationZone = positionInRange > 0.62 ? 'PREMIUM' : positionInRange < 0.38 ? 'DISCOUNT' : 'EQUILIBRIUM';
        const positionPct = Math.round(positionInRange * 100);
        const conflictAdvisories: string[] = [];
        if (locationZone === 'PREMIUM') {
          conflictAdvisories.push(`LOCATION CONTEXT: Price is at ${positionPct}% of the swing range (swing H: ${swingHigh}, swing L: ${swingLow}) — PREMIUM zone. Record in Q8C. Factor into your conviction.`);
        } else if (locationZone === 'DISCOUNT') {
          conflictAdvisories.push(`LOCATION CONTEXT: Price is at ${positionPct}% of the swing range (swing H: ${swingHigh}, swing L: ${swingLow}) — DISCOUNT zone. Record in Q8C. Factor into your conviction.`);
        }
        if (regimeCategory && (regimeCategory.toLowerCase().includes('range') || regimeCategory.toLowerCase().includes('chop') || regimeCategory.toLowerCase().includes('side'))) {
          conflictAdvisories.push(`REGIME CONTEXT: Market regime is ${regimeCategory.toUpperCase()}. Record this in your analysis. Factor into your conviction.`);
        }
        if (conflictAdvisories.length > 0) {
          regimeLocationConflictAdvisory = `\nMARKET CONTEXT:\n${conflictAdvisories.join('\n')}\n`;
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

      // CCIP-ALPHA-HUNTER-LAW: Alpha ALWAYS hunts with HIGH/AGGRESSIVE profile.
      // The user's riskMode (derived from dollar risk) controls position sizing ONLY.
      // Alpha's entry urgency, timeframe preference, and entry type weights are permanently
      // set to HIGH — immediate entry urgency, M5/M15 timeframes, breakout/momentum at 0.9.
      // Passing the user's riskMode here was architecturally fatal: it made Alpha conservative
      // on sessions where users risked low dollar amounts. Alpha is a hunter always.
      riskProfileText = formatRiskProfileForLLM('high');

      const styleDirective = goalContext.tradeStyle
        ? `\nTRADE STYLE: ${goalContext.tradeStyle.toUpperCase()} (full style identity and duration constraints provided below)\n`
        : '';
      goalContextText = `\nGOAL: $${goalContext.currentBalance.toFixed(0)} -> +$${goalContext.targetGoal.toFixed(0)} (${goalContext.goalPercentage.toFixed(3)}% gain) | Progress: $${goalContext.currentProgress.toFixed(0)}/${goalContext.targetGoal.toFixed(0)} | Remaining: $${goalContext.remainingGoal.toFixed(0)}\n${riskProfileText}${styleDirective}\n`;
    }

    // Build intelligence context
    let intelligenceContext = this.buildIntelligenceContext(intelligenceSnapshot, marketContext.symbol);

    // CCIP-2026-0506E FRESH-SCAN ISOLATION:
    // hunterLearningContextText and recentTradesContext were removed. They injected
    // prior trade outcomes (wins/losses, exit reasons, mistakes_identified, what_worked)
    // directly into Alpha's prompt, producing pattern-matched directional bias across
    // consecutive scans. Alpha must reason from live market structure alone.

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
    //
    // CCIP-2026-0401-REGIME-SSOT:
    // The classifier returns one of two result types:
    //   'classified'  — dynamic Supabase baseline >=20 samples; full regime
    //                   label + direction is injected into the Alpha prompt.
    //   'live_only'   — no baseline yet; raw computed indicators only.
    //                   No regime label, no direction verdict is injected.
    //                   Alpha reads the live numbers directly.
    //
    // ELIMINATION OF FALLBACK: static_fallback thresholds are gone. No
    // neutral_ranging label will ever be synthetically injected into a prompt.
    // ═══════════════════════════════════════════════════════════════════
    let microRegimeContext = '';
    let regimeResult: MicroRegimeResult | null = null;

    if (fullCandles && fullCandles.length >= 50) {
      if (sessionId && userId) {
        alphaThoughtStream.emitAlphaMicroRegime(sessionId, userId, marketContext.symbol).catch(err => {
          console.warn('[Alpha Coordinator] Failed to emit micro-regime thought:', err);
        });
      }
      try {
        const regimeCandles: MicroRegimeCandle[] = fullCandles.map(c => ({
          time: new Date(c.open_time).getTime(),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume || 0
        }));

        // CCIP-2026-0331C: Map sydney/closed -> 'dead' so baselines accumulate
        // for those sessions rather than being discarded as undefined.
        const regimeSessionCtx = calculateSessionContext();
        const rawSession = regimeSessionCtx.currentSession;
        const regimeSession: import('../services/micro-regime-classifier').RegimeSession =
          rawSession === 'sydney' || rawSession === 'closed'
            ? 'dead'
            : (['asian', 'london', 'ny', 'overlap', 'dead'] as const).includes(rawSession as any)
              ? (rawSession as import('../services/micro-regime-classifier').RegimeSession)
              : 'dead';

        regimeResult = await microRegimeClassifier.classify(
          regimeCandles,
          marketContext.symbol,
          regimeSession
        );

        if (regimeResult) {
          if (regimeResult.type === 'classified') {
            // Dynamic baseline confirmed — full regime classification is reliable.
            console.log(`[Alpha Coordinator] Micro-Regime: ${regimeResult.regime} | Direction: ${regimeResult.direction} | Confidence: ${regimeResult.confidence}% | Samples: ${regimeResult.thresholds.sampleCount}`);

            microRegimeContext = `\nMICRO-REGIME CLASSIFICATION (dynamic baseline — ${regimeResult.thresholds.sampleCount} real ${marketContext.symbol} ${regimeSessionCtx.sessionName ?? ''} readings):\n`;
            microRegimeContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            microRegimeContext += `Regime: ${regimeResult.regime.toUpperCase().replace(/_/g, ' ')} (${regimeResult.confidence}% classification confidence)\n`;
            microRegimeContext += `Direction: ${regimeResult.direction.toUpperCase()}\n\n`;
            microRegimeContext += `Raw Sensor Readings vs this symbol+session baseline:\n`;
            microRegimeContext += `  ATR Expansion: ${regimeResult.indicators.atrExpansion.toFixed(2)}x (top-30%>${regimeResult.thresholds.atrExpansionP70.toFixed(2)}, top-15%>${regimeResult.thresholds.atrExpansionP85.toFixed(2)}, bottom-30%<${regimeResult.thresholds.atrExpansionP30.toFixed(2)})\n`;
            microRegimeContext += `  EMA50 Displacement: ${regimeResult.indicators.emaDisplacement.toFixed(2)}% (p80=${regimeResult.thresholds.emaDisplacementP80.toFixed(2)}, p90=${regimeResult.thresholds.emaDisplacementP90.toFixed(2)}, p95=${regimeResult.thresholds.emaDisplacementP95.toFixed(2)})\n`;
            microRegimeContext += `  RSI: ${regimeResult.indicators.rsi.toFixed(0)}\n`;
            microRegimeContext += `  Volume Profile: ${regimeResult.indicators.volumeProfile}\n`;
            microRegimeContext += `  Range Compression: ${regimeResult.indicators.rangeCompression.toFixed(2)}x (bottom-20%<${regimeResult.thresholds.rangeCompressionP20.toFixed(2)}, bottom-35%<${regimeResult.thresholds.rangeCompressionP35.toFixed(2)})\n`;
            microRegimeContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          } else {
            // live_only — no dynamic baseline. Inject raw computed indicator
            // values from live candles. No regime label. No direction verdict.
            console.log(`[Alpha Coordinator] Micro-Regime: live_only (no baseline yet — ${regimeResult.sampleCount} samples) | ATR:${regimeResult.indicators.atrExpansion.toFixed(2)}x EMA:${regimeResult.indicators.emaDisplacement.toFixed(2)}% RSI:${regimeResult.indicators.rsi.toFixed(0)}`);

            microRegimeContext = `\nLIVE MARKET INDICATORS (computed from current candle data — no prior baseline for this symbol+session yet):\n`;
            microRegimeContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            microRegimeContext += `  ATR Expansion ratio (current ATR vs 20-period average): ${regimeResult.indicators.atrExpansion.toFixed(2)}x\n`;
            microRegimeContext += `  EMA50 Displacement (price distance from EMA50 as % of EMA): ${regimeResult.indicators.emaDisplacement.toFixed(2)}%\n`;
            microRegimeContext += `  RSI(14): ${regimeResult.indicators.rsi.toFixed(0)}\n`;
            microRegimeContext += `  Volume Profile (recent 5 vs prior 5 candles): ${regimeResult.indicators.volumeProfile}\n`;
            microRegimeContext += `  Range Compression (recent 5-candle avg range vs prior 15): ${regimeResult.indicators.rangeCompression.toFixed(2)}x\n`;
            microRegimeContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          }
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
    // PHASE 2B: MOMENTUM TRAJECTORY ANALYSIS (CCIP-2026-0421-MTL)
    //
    // Pure computation — no LLM calls, no external requests.
    // Runs over raw candles already in memory. Advisory-only context
    // for Alpha — does NOT gate, score, or restrict any trade decision.
    //
    // Every phase contains a hunt. This tells Alpha WHAT KIND of hunt
    // is available, not whether to hunt.
    //
    // Supports: SCALP, MICRO_INTRADAY, INTRADAY
    // Sessions: Asian, London, NY, Overlap, Dead — all supported
    // ═══════════════════════════════════════════════════════════════════
    let momentumTrajectoryContext = '';

    if (fullCandles && fullCandles.length >= 10) {
      try {
        const trajectoryCandles = fullCandles.map((c: any) => ({
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
          volume: c.volume ? Number(c.volume) : undefined,
        }));

        const sessionCtx = calculateSessionContext();
        const sessionName = sessionCtx.currentSession ?? 'unknown';

        const trajectory = computeMomentumTrajectory(
          trajectoryCandles,
          sweepFacts,
          regimeResult,
          tradeStyle,
          sessionName
        );

        momentumTrajectoryContext = formatMomentumTrajectoryForPrompt(trajectory);

        console.log(`[Alpha Coordinator] Momentum Trajectory: phase=${trajectory.phase} | velocity=${trajectory.velocityState} | atr=${trajectory.atrExpansionState} | sweep=${trajectory.sweepFollowThrough} | style=${tradeStyle} | session=${sessionName}`);
      } catch (error) {
        console.warn('[Alpha Coordinator] Momentum trajectory computation failed (non-blocking):', error);
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
          utcHour: new Date().getUTCHours(),
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
        decision_origin: 'SYSTEM_DATA_MISSING' as const,
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
          decision_origin: 'SYSTEM_DATA_MISSING' as const,
        };
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // HUNT READINESS PRE-SCAN GATE
    // CCIP-2026-04-21: Query alpha_hunt_readiness before assembling the full
    // Alpha prompt. If hunt_state === 'not_ready' (PC1 phase unreadable AND
    // PC2 no structural material), skip the full LLM scan — the structural
    // raw material for a trade does not exist.
    //
    // Gate fires ONLY on 'not_ready'. 'ready', 'live', or missing/expired
    // records all proceed to the full scan — no data = no gate.
    //
    // This preserves Alpha's full decision authority when material exists.
    // It only prevents scans where the pre-computed structural assessment
    // has already determined there is no phase, no setup, and no structural room.
    // ═══════════════════════════════════════════════════════════════════
    // CCIP-2026-0424B: Capture preconditions from 'ready' state to inject into Alpha's
    // prompt as a readiness signal. This tells Alpha which structural preconditions the
    // readiness scanner already qualified — closing the gap where Alpha would output
    // NO_TRADE despite naming a trigger zone.
    let huntContextForPrompt: {
      preconditionsMet: string[];
      phase: string | null;
      recentDrift?: {
        symbol: string;
        style: string;
        sampleSize: number;
        avgDriftPips: number;
        maxDriftPips: number;
        medianDriftPips: number;
        tierACount: number;
        tierBCount: number;
        tierCCount: number;
        blockedCount: number;
      } | null;
      recentPerformance?: {
        symbol: string;
        style: string;
        sampleSize: number;
        wins: number;
        losses: number;
        breakEvens: number;
        winRate: number;
        avgPnlPct: number;
        lastOutcome: string | null;
        lastOutcomeAt: string | null;
      } | null;
      reasoningHealth?: Array<{
        observationType: string;
        ccipTag: string;
        severity: string;
        summary: string;
        sampleSize: number;
      }> | null;
      recentPostmortems?: Array<{
        confidenceTier: string | null;
        action: string;
        entryMode: string | null;
        namedEvidenceCount: number;
        topCitations: string[];
        outcome: string;
        pnlPct: number | null;
        summary: string;
        createdAt: string;
      }> | null;
    } | undefined;
    try {
      const { data: huntReadiness } = await supabase
        .from('alpha_hunt_readiness')
        .select('hunt_state, preconditions_met, hunt_summary, phase_detected, expires_at')
        .eq('symbol', marketContext.symbol)
        .eq('style', tradeStyle)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (huntReadiness && huntReadiness.hunt_state === 'not_ready') {
        const preconditionsMet = Array.isArray(huntReadiness.preconditions_met)
          ? (huntReadiness.preconditions_met as string[]).join(', ') || 'none'
          : 'unknown';
        console.log(`[Alpha Coordinator] HUNT_READINESS_GATE: ${marketContext.symbol} (${tradeStyle}) skipped — not_ready. Phase: ${huntReadiness.phase_detected}. Preconditions: ${preconditionsMet}`);
        return {
          action: 'NO_TRADE',
          decision: 'NO_TRADE',
          entry: marketContext.price,
          stopLoss: marketContext.price,
          takeProfit: marketContext.price,
          confidence: 0,
          reasoning: `HUNT_READINESS_NOT_MET: Pre-scan assessment found no readable phase and no structural setup material for ${tradeStyle} on ${marketContext.symbol}. Phase: ${huntReadiness.phase_detected ?? 'UNCLEAR'}. ${huntReadiness.hunt_summary ?? ''}`,
          decision_origin: 'SYSTEM_PAIR_NOT_READY' as const,
        };
      }

      if (huntReadiness && Array.isArray(huntReadiness.preconditions_met) && huntReadiness.preconditions_met.length > 0) {
        huntContextForPrompt = {
          preconditionsMet: huntReadiness.preconditions_met as string[],
          phase: huntReadiness.phase_detected ?? null,
        };
      }
    } catch {
      // Hunt readiness unavailable — proceed with full scan (non-blocking)
      console.warn(`[Alpha Coordinator] Hunt readiness gate unavailable for ${marketContext.symbol} — proceeding with full scan`);
    }

    // CCIP-2026-0424C: Fetch Alpha's own recent execution drift for this symbol/style
    // and inject into the prompt so Alpha self-calibrates stop sizing against observed
    // fill behavior. Pure reasoning feedback — not a gate.
    try {
      const { data: driftStats } = await supabase.rpc('get_recent_drift_stats', {
        p_symbol: marketContext.symbol,
        p_style: tradeStyle,
        p_lookback: 10,
      });
      const row = Array.isArray(driftStats) ? driftStats[0] : driftStats;
      if (row && typeof row.sample_size === 'number' && row.sample_size > 0) {
        const existing = huntContextForPrompt ?? { preconditionsMet: [], phase: null };
        huntContextForPrompt = {
          ...existing,
          recentDrift: {
            symbol: marketContext.symbol,
            style: tradeStyle,
            sampleSize: Number(row.sample_size) || 0,
            avgDriftPips: Number(row.avg_drift_pips) || 0,
            maxDriftPips: Number(row.max_drift_pips) || 0,
            medianDriftPips: Number(row.median_drift_pips) || 0,
            tierACount: Number(row.tier_a_count) || 0,
            tierBCount: Number(row.tier_b_count) || 0,
            tierCCount: Number(row.tier_c_count) || 0,
            blockedCount: Number(row.blocked_count) || 0,
          },
        };
      }
    } catch {
      // Drift history unavailable — proceed without it (non-blocking, pure feedback)
    }

    // CCIP-2026-0429F Stage 4 — Session-State Self-Awareness
    // Fetch Alpha's own recent realized outcomes on this symbol/style and inject them
    // into the prompt so Alpha self-calibrates confidence against observed performance.
    // Pure reasoning feedback — not a gate.
    try {
      const { data: perfStats } = await supabase.rpc('get_recent_alpha_performance', {
        p_symbol: marketContext.symbol,
        p_style: tradeStyle,
        p_lookback: 10,
      });
      const perfRow = Array.isArray(perfStats) ? perfStats[0] : perfStats;
      if (perfRow && typeof perfRow.sample_size === 'number' && perfRow.sample_size > 0) {
        const existing = huntContextForPrompt ?? { preconditionsMet: [], phase: null };
        huntContextForPrompt = {
          ...existing,
          recentPerformance: {
            symbol: marketContext.symbol,
            style: tradeStyle,
            sampleSize: Number(perfRow.sample_size) || 0,
            wins: Number(perfRow.wins) || 0,
            losses: Number(perfRow.losses) || 0,
            breakEvens: Number(perfRow.break_evens) || 0,
            winRate: Number(perfRow.win_rate) || 0,
            avgPnlPct: Number(perfRow.avg_pnl_pct) || 0,
            lastOutcome: perfRow.last_outcome ?? null,
            lastOutcomeAt: perfRow.last_outcome_at ?? null,
          },
        };
      }
    } catch {
      // Recent performance unavailable — proceed without it (non-blocking, pure feedback)
    }

    // CCIP-2026-0430A Stage 6A — Reasoning Health Feedback
    // Pull currently-firing drift-watcher observations (global-scope, active only).
    // Block is injected only when watchers have fired — empty = clean = no tokens spent.
    try {
      const { data: healthRows } = await supabase.rpc('get_active_reasoning_health', {
        p_symbol: marketContext.symbol,
        p_style: tradeStyle,
      });
      if (Array.isArray(healthRows) && healthRows.length > 0) {
        const existing = huntContextForPrompt ?? { preconditionsMet: [], phase: null };
        huntContextForPrompt = {
          ...existing,
          reasoningHealth: healthRows.map((r: {
            observation_type?: string;
            ccip_tag?: string;
            severity?: string;
            summary?: string;
            sample_size?: number;
            fire_count?: number;
            escalation_level?: string;
            scope?: string;
            symbol?: string;
            style?: string;
          }) => ({
            observationType: r.observation_type ?? '',
            ccipTag: r.ccip_tag ?? '',
            severity: r.severity ?? 'advisory',
            summary: r.summary ?? '',
            sampleSize: Number(r.sample_size) || 0,
            fireCount: Number(r.fire_count) || 1,
            escalationLevel: r.escalation_level ?? 'advisory',
            scope: r.scope ?? 'global',
            symbol: r.symbol ?? null,
            style: r.style ?? null,
          })),
        };
      }
    } catch {
      // Reasoning health unavailable — proceed (non-blocking, pure feedback)
    }

    // CCIP-2026-0501D Stage 12 — Dynamic tier-target mirror (advisory only).
    // Alpha reads the shrinkage-adjusted tier targets per (symbol, style) so its
    // self-accountability labels reflect realized calibration. NEVER drives
    // lot size — the user's riskMode/riskPercent remains sole sizing authority.
    try {
      const { data: tierTargetRows } = await supabase.rpc('get_current_tier_targets', {
        p_symbol: marketContext.symbol,
        p_style: tradeStyle,
      });
      if (Array.isArray(tierTargetRows) && tierTargetRows.length > 0) {
        const existing = huntContextForPrompt ?? { preconditionsMet: [], phase: null };
        huntContextForPrompt = {
          ...existing,
          tierTargets: tierTargetRows.map((r: {
            tier?: string;
            static_anchor_pct?: number;
            trailing_realized_pct?: number | null;
            sample_size?: number;
            current_target_pct?: number;
          }) => ({
            tier: r.tier ?? '',
            staticAnchorPct: Number(r.static_anchor_pct) || 0,
            trailingRealizedPct: r.trailing_realized_pct != null ? Number(r.trailing_realized_pct) : null,
            sampleSize: Number(r.sample_size) || 0,
            currentTargetPct: Number(r.current_target_pct) || 0,
          })),
        };
      }
    } catch {
      // Tier targets unavailable — proceed (non-blocking, pure feedback)
    }

    // CCIP-2026-0501E Stage 13 — Winning-pattern reinforcement signals.
    // Top 3 citation clusters by realized win rate for this symbol x style
    // (min sample 10, min 55% realized). Alpha sees what has worked — but is
    // warned against hot-hand bias. Pure feedback — not a selection gate.
    try {
      const { data: winningRows } = await supabase.rpc('get_winning_patterns', {
        p_symbol: marketContext.symbol,
        p_style: tradeStyle,
      });
      if (Array.isArray(winningRows) && winningRows.length > 0) {
        const existing = huntContextForPrompt ?? { preconditionsMet: [], phase: null };
        huntContextForPrompt = {
          ...existing,
          winningPatterns: winningRows.map((r: {
            citation_cluster?: unknown;
            sample_size?: number;
            realized_win_rate_pct?: number;
            avg_pnl_pct?: number | null;
          }) => ({
            citationCluster: Array.isArray(r.citation_cluster)
              ? (r.citation_cluster as unknown[]).filter((c): c is string => typeof c === 'string')
              : [],
            sampleSize: Number(r.sample_size) || 0,
            realizedWinRatePct: Number(r.realized_win_rate_pct) || 0,
            avgPnlPct: r.avg_pnl_pct != null ? Number(r.avg_pnl_pct) : null,
          })),
        };
      }
    } catch {
      // Winning patterns unavailable — proceed (non-blocking, pure feedback)
    }

    // CCIP-2026-0501C Stage 10 — Per-trade reasoning post-mortems
    // Pull the last 3 post-mortems for this symbol x style. Alpha sees its own
    // recent per-pair outcomes tied to the reasoning artifacts (tier, evidence,
    // citations). Pure feedback — not a gate.
    try {
      const { data: postmortemRows } = await supabase.rpc('get_recent_reasoning_postmortems', {
        p_symbol: marketContext.symbol,
        p_style: tradeStyle,
        p_limit: 3,
      });
      if (Array.isArray(postmortemRows) && postmortemRows.length > 0) {
        const existing = huntContextForPrompt ?? { preconditionsMet: [], phase: null };
        huntContextForPrompt = {
          ...existing,
          recentPostmortems: postmortemRows.map((r: {
            confidence_tier?: string | null;
            action?: string;
            entry_mode?: string | null;
            named_evidence_count?: number;
            top_citations?: unknown;
            outcome?: string;
            pnl_pct?: number | null;
            summary?: string;
            created_at?: string;
          }) => ({
            confidenceTier: r.confidence_tier ?? null,
            action: r.action ?? '',
            entryMode: r.entry_mode ?? null,
            namedEvidenceCount: Number(r.named_evidence_count) || 0,
            topCitations: Array.isArray(r.top_citations)
              ? (r.top_citations as unknown[]).filter((c): c is string => typeof c === 'string')
              : [],
            outcome: r.outcome ?? 'UNKNOWN',
            pnlPct: r.pnl_pct != null ? Number(r.pnl_pct) : null,
            summary: r.summary ?? '',
            createdAt: r.created_at ?? '',
          })),
        };
      }
    } catch {
      // Post-mortems unavailable — proceed (non-blocking, pure feedback)
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

    // CCIP-2026-04-07: marketVolatilityLevel block removed.
    // The stop calculator now defaults to 'normal' (no ATR adjustment).
    // Alpha receives raw atrPercent and decides volatility interpretation itself.

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
      // CCIP-2026-0421-LIVE-PRICE: Use live price for stop calculation context so
      // ATR-derived anchor prices reflect where the market actually is.
      const entryPrice = marketContext.livePrice ?? marketContext.price;

      // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform.
      // MICRO_INTRADAY → M5 ATR (atr). Entry is M5, ATR matches entry timeframe.
      preferredAtrField = 'atr';
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
      logATRUsage('Stop-Loss calculation', preferredAtrRaw ?? marketContext.atr);

      // Build sweep context from Omega-8 for sweep-aware stop placement (SSOT)
      // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform — applies to MICRO_INTRADAY.
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

      // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform.
      const stopCalcStyle: 'MICRO_INTRADAY' = 'MICRO_INTRADAY';

      buyStopAnchor = riskAwareStopCalculator.calculateStopLoss({
        symbol: marketContext.symbol, entryPrice, direction: 'buy',
        riskMode, atr: atrForStopLoss,
        sweepContext: sweepContextForStop,
        tradeStyle: stopCalcStyle
      });
      sellStopAnchor = riskAwareStopCalculator.calculateStopLoss({
        symbol: marketContext.symbol, entryPrice, direction: 'sell',
        riskMode, atr: atrForStopLoss,
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

      // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform.
      const requestedStyle: 'MICRO_INTRADAY' = 'MICRO_INTRADAY';

      const atrValue = extractATRValue(marketContext.atr);
      const atrPercent = (atrValue / (marketContext.livePrice ?? marketContext.price)) * 100;
      computedAtrPercent = atrPercent;
      logATRUsage('Feasibility check', marketContext.atr20 ?? marketContext.atr);

      if (sessionId && userId) {
        alphaThoughtStream.emitAlphaFeasibility(sessionId, userId, marketContext.symbol).catch(err => {
          console.warn('[Alpha Coordinator] Failed to emit feasibility thought:', err);
        });
      }

      console.log(`[Alpha Coordinator] 🔍 Feasibility Check: ${requestedStyle} style with ${riskMode.toUpperCase()} risk on ${assetClass}`);
      console.log(`[Alpha Coordinator] 📊 Market ATR: ${atrValue.toFixed(5)} (${atrPercent.toFixed(3)}%)`);

      // Derive envelope-based TP ceiling for the feasibility RR check.
      // ATR-multiple TP ceiling (ATR% × 12) produces a falsely low ceiling during low-vol
      // sessions (e.g. Asian crypto: BTC M5 ATR = 0.02% → TP ceiling = 0.28%, far below
      // the 0.50% SL floor → false RR_BELOW_TARGET advisory every scan).
      // The execution envelope already encodes the correct TP max per asset class per style.
      // Using it directly eliminates the ATR-compression artifact while preserving all other
      // feasibility checks unchanged.
      const feasibilityEnvelope = getExecutionEnvelope(requestedStyle);
      const feasibilityEnvelopeAssetClass = assetClass as EnvelopeAssetClass;
      const envelopeAssetBounds = feasibilityEnvelope.assetClassPercentBounds[feasibilityEnvelopeAssetClass];
      const envelopeTpCeilingPercent = envelopeAssetBounds?.tpPercent?.max;

      feasibilityResult = tradeFeasibilityResolver.resolve({
        symbol: marketContext.symbol,
        assetClass,
        requestedStyle,
        requestedRiskMode: riskMode.toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH',
        price: marketContext.livePrice ?? marketContext.price,
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
          tpCeilingPercent: envelopeTpCeilingPercent,
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

      // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform — internal DB key is 'micro'.
      // CCIP (2026-02-18): Dynamic Wall Calibration
      // Run BEFORE generateDualArenaWalls to adapt the ATR multiplier and TP floor
      // to live market conditions. Walls breathe with the market instead of blocking
      // Alpha when volatility compresses or session time shortens.
      // SSOT: wallCalibrationEngine is the single authority for corridor adaptation.
      const canonicalTradeStyle: 'micro' = 'micro';
      const wallCalibration = wallCalibrationEngine.calibrate({
        symbol: marketContext.symbol,
        entry: marketContext.price,
        atr: extractATRValue(marketContext.atr),
        tradeStyle: canonicalTradeStyle,
        riskMode,
        currentSession: sessionContext.currentSession,
        sessionTimeRemainingMinutes: sessionContext.sessionTimeRemainingMinutes,
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
        atr: extractATRValue(marketContext[preferredAtrField as keyof typeof marketContext] as number | import('../types/atr').ATRValue | undefined) || extractATRValue(marketContext.atr),
        tradeStyle: canonicalTradeStyle,
        riskMode,
        currentSession: sessionContext.currentSession,
        sessionTimeRemainingMinutes: sessionContext.sessionTimeRemainingMinutes,
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
        atr: extractATRValue(marketContext[preferredAtrField as keyof typeof marketContext] as number | import('../types/atr').ATRValue | undefined) || extractATRValue(marketContext.atr),
        riskMode,
        tradeStyle,
        currentSession: sessionContext.currentSession,
        sessionTimeRemainingMinutes: sessionContext.sessionTimeRemainingMinutes,
        proposedStopLoss: buyStopAnchor?.stopLossPrice,
        resolvedPlan: calibratedResolvedPlan,
      });
    }

    const styleEnvelope = getExecutionEnvelope(tradeStyle);
    const promptAssetClass = getAssetClass(marketContext.symbol) as EnvelopeAssetClass;

    // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform — only MICRO_INTRADAY.
    const styleIdentityPrompt = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STYLE IDENTITY: MICRO_INTRADAY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are operating as a M5 MICRO_INTRADAY trader.
Timeframe stack: M5 (entry lens — my primary signal) | M15 (trend validation and direction confirmation) | H1 (macro bias only) | D1 (macro orientation).
I read M5 candles as my primary entry signal. M15 confirms the trend direction — it tells me which way the structural energy is aligned. H1 orients the macro bias. Neither M15 nor H1 defines my TP destination — they define the directional context I am trading within.
TP is where the M5 leg exhausts. I am trading a M5 momentum move. My exit is where the M5 candle sequence visibly runs out of energy — a prior M5 swing already printed in the direction of travel, equal highs/lows already established on M5, pace fading on the M5 candle bodies, a M5 FVG already filled. That is my TP zone — exhaustion of the M5 leg, not a named M15 structural destination.

HUNTER'S TP CONTRACT (MICRO_INTRADAY):
I am a hunter. My first question is: where does this M5 leg run out of energy? I look for: a prior M5 swing high/low already printed in the direction of travel, M5 equal highs/lows clustering that signal absorption, M5 candle bodies compressing and wicks extending (pace fading), M5 momentum visibly stalling. That is my TP1 zone (the fast partial — the scalp slice). If a clear second zone of M5 exhaustion exists further along — a second prior swing, a second cluster of equal highs/lows — I place TP2 there (the full intraday target).
M15 tells me the direction is valid. H1 tells me the macro story. Neither tells me where to exit. The exit is the M5 leg's natural endpoint.
I name the specific M5 exhaustion signal I am targeting for each TP AND state how many pips from entry it sits AND why the M5 momentum is most likely to die at that exact location. No fixed buffers. No formulas. I read the M5 tape and commit.
Name the specific M5 structural level you are entering from in m5_structural_confirmation.
Format: "[structure type] at [exact price] — [what confirms it]". Example: "M5 BOS at 1.08230 confirmed long bias on M15 trend".
Valid M5 anchors: named M5 S/R levels, M5 range boundaries, session highs/lows, equal highs/lows, VWAP, EMA rejections, prior M5 swing points.
Record m5_structural_confirmation, m5_move_phase, and m5_atr_traveled in the JSON response — these are audit fields that document my structural read for governance review regardless of action.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

    if (buyStopAnchor && sellStopAnchor) {
      const pipInfo = getCurrencyPipInfo(marketContext.symbol);
      const atrPips = (extractATRValue(marketContext.atr) / pipInfo.pipValue).toFixed(1);
      // CCIP-2026-04-21 (LIVE-ATR SOVEREIGNTY): wallSl/wallTp pip range variables removed.
      // Alpha receives live ATR anchors only. No static pip envelope is shown to Alpha.

      // CCIP-2026-03-18 ALPHA AUTHORITY: SL anchors are presented to Alpha as-is from the
      // stop calculator. The coordinator MUST NOT pre-modify anchor values to comply with
      // wall minimums. If the ATR-derived anchor is below the wall minimum that is
      // information Alpha can see and act on — not a pre-decision correction.
      // Accountability requires Alpha's SL to be exactly what Alpha chose,
      // not what the coordinator silently lifted it to before Alpha saw the data.

      // CCIP-2026-0421 (ALPHA SL SOVEREIGNTY):
      // sweepZoneDirective removed in full. It referenced the pre-computed SL anchor
      // ("The SL anchor above was computed to clear the swept zone...") and recommended
      // specific clearance prices for LONG/SHORT SL placement. Alpha reads the raw
      // Omega-8 sweep data directly and decides his own SL placement from structure.
      //
      // buyAnchorPips/buyAnchorPrice/sellAnchorPips/sellAnchorPrice extraction also
      // removed — those values are not injected into the prompt anywhere.
      //
      // CCIP-2026-0421 (ALPHA SL SOVEREIGNTY) continued:
      // Pre-computed SL anchor prices removed from the prompt entirely.
      //
      // REMOVED:
      //   IF LONG SL Anchor: [price] (Xp, X.XXx ATR)
      //   IF SHORT SL Anchor: [price] (Xp, X.XXx ATR)
      //   sweepZoneDirective — "The SL anchor above was computed to clear the swept zone..."
      //
      // ROOT CAUSE: Showing Alpha a pre-computed SL anchor price is equivalent to telling
      // him where to place the stop. He anchors to it — and when the structural level he
      // identifies happens to sit closer than the anchor, he either follows the anchor (wrong)
      // or produces a tighter SL that gets blocked (the Gold scalp failure).
      //
      // Alpha's job is to read the candle structure, identify the structural invalidation
      // point for this specific setup, and place the SL there. He receives ATR as a raw
      // noise-floor reference. He receives Omega-8 sweep extremes as structural facts.
      // He does not receive a pre-computed price to anchor to.
      //
      // The calculator still runs (required for omega9ConstraintProvider TP range calc and
      // lot sizing). Its output is NOT shown to Alpha.
      stopLossDirective = `
ATR: ${extractATRValue(marketContext.atr).toFixed(5)} (${atrPips} pips) | Risk: ${riskMode.toUpperCase()}
SL/TP AUTHORITY: You have FULL authority to place SL and TP where structure justifies it. Read the candle sequence, identify the structural invalidation point for this setup, and commit. Only Omega-9 (mathematical impossibility — geometry, spread floor) can veto.
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

If the structure has materially changed — direction broken, key level invalidated, or momentum reversed — reject and analyze fresh. If structure is intact and the thesis direction remains supported by current candle evidence, proceed with your own judgment on the current opportunity. The decision is yours.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        console.log(`[Alpha Coordinator] Cached thesis available (${ageMinutes}min old), raw briefing attached for validation`);
      }
    } catch (error) {
      // Cache miss or error - will generate fresh
      console.log('[Alpha Coordinator] 💭 No cached thesis - will generate fresh');
      cachedThesis = null;
    }

    // CCIP-2026-0427E-STYLE-CONSOLIDATION: M5 SCALP-only validation block removed —
    // single-style platform, M5 is the primary entry lens (not a validation layer).
    const m5ContextPrompt = '';

    // ═══════════════════════════════════════════════════════════════════
    // PRIMARY TIMEFRAME CANDLE CONTEXT — CCIP-2026-0427E-STYLE-CONSOLIDATION
    // SSOT: MarketDataService is the single authority for candle data
    // Single-style platform: MICRO_INTRADAY entry=M5 (30 candles), direction=M15, context=H1.
    // ═══════════════════════════════════════════════════════════════════
    const styleName = getDisplayNameFromStyle(tradeStyle);
    const primaryTfConfig = { timeframe: 'M5', label: 'M5', candleCount: 30 } as const;

    let primaryTfCandlePrompt = '';
    let microIntradayMovePhaseContext = '';
    // M15 direction data for MICRO_INTRADAY — hoisted so the move phase block
    // (inside the primary candle try block) can reference these values.
    let m15DirectionPromptMicro = '';
    let m15SwingHighMicro = 0;
    let m15SwingLowMicro = 0;
    // CCIP-2026-0421 (ALPHA SL SOVEREIGNTY): slStructuralDistanceNote removed.
    // It injected the pre-computed SL anchor price back into the prompt twice
    // (IF LONG SL / IF SHORT SL) along with "INSIDE/BELOW the wick range" framing.
    // Alpha reads the primary-TF candles directly and assesses wick proximity himself.
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

        // CCIP-2026-0421 (ALPHA SL SOVEREIGNTY): SL structural distance block removed.
        // Alpha reads recentPrimary candles directly and identifies his own structural
        // invalidation point without being shown pre-computed SL anchor prices or
        // "INSIDE/BELOW the wick range" framing.

        // ═══════════════════════════════════════════════════════════════════
        // MICRO_INTRADAY M5 MOVE PHASE & FAKEOUT ADVISORY
        // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform.
        // recentPrimary contains M5 candles. ATR reference is atrForStopLoss (marketContext.atr).
        // Advisory only — Alpha retains full decision authority.
        // ═══════════════════════════════════════════════════════════════════
        if (atrForStopLoss > 0) {
          const m5AtrPips = (atrForStopLoss / pipInfo.pipValue);
          const freshCeilingM5 = (atrForStopLoss * 0.75 / pipInfo.pipValue).toFixed(1);
          const developingCeilingM5 = (atrForStopLoss * 1.5 / pipInfo.pipValue).toFixed(1);

          // Find M5 swing origin within the 30-candle primary window
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
          const atrTraveledM5window = m5AtrPips > 0 ? distFromSwingPipsM5 / m5AtrPips : 0;

          // Anchor ATR-traveled to M15 swing origin when available.
          // m15SwingHighMicro / m15SwingLowMicro are populated by the M15 direction
          // fetch block below. If M15 gives a LARGER travel distance (more conservative),
          // use that as the primary move phase input.
          const hasMicroM15Anchor = m15SwingHighMicro > 0 && m15SwingLowMicro > 0;
          const m15AnchorOrigin = hasMicroM15Anchor
            ? (currentDirM5 === 'DN' ? m15SwingHighMicro : m15SwingLowMicro)
            : 0;
          const m15AnchorDistPips = hasMicroM15Anchor
            ? Math.abs(marketContext.price - m15AnchorOrigin) / pipInfo.pipValue
            : 0;
          const m15AnchorATRMultiple = hasMicroM15Anchor && m5AtrPips > 0
            ? m15AnchorDistPips / m5AtrPips
            : 0;
          const atrTraveledFinal = hasMicroM15Anchor && m15AnchorATRMultiple > atrTraveledM5window
            ? m15AnchorATRMultiple
            : atrTraveledM5window;

          const m5MovePhase = atrTraveledFinal < 0.75 ? 'FRESH' : atrTraveledFinal < 1.5 ? 'DEVELOPING' : 'EXHAUSTED';

          let fakeoutTypeM5micro: string | null = null;
          let fakeoutCandlesAgoM5micro = 0;
          let fakeoutReversalConfirmedM5micro = false;
          if (recentPrimary.length >= 4) {
            const lookbackM5micro = recentPrimary.slice(0, -1);
            const windowHighM5micro = Math.max(...lookbackM5micro.slice(0, -1).map(c => c.high));
            const windowLowM5micro = Math.min(...lookbackM5micro.slice(0, -1).map(c => c.low));
            const recentFewM5micro = lookbackM5micro.slice(-3);
            for (let i = recentFewM5micro.length - 1; i >= 0; i--) {
              const c = recentFewM5micro[i];
              const bodyTop = Math.max(c.open, c.close);
              const bodyBot = Math.min(c.open, c.close);
              const sweptHighM5micro = c.high > windowHighM5micro && bodyTop < windowHighM5micro;
              const sweptLowM5micro = c.low < windowLowM5micro && bodyBot > windowLowM5micro;
              if (sweptHighM5micro) {
                fakeoutTypeM5micro = 'BEARISH_FAKEOUT';
                fakeoutCandlesAgoM5micro = recentFewM5micro.length - i;
                const nextCandles = recentPrimary.slice(recentPrimary.indexOf(c) + 1);
                fakeoutReversalConfirmedM5micro = nextCandles.some(nc => nc.close < nc.open);
                break;
              } else if (sweptLowM5micro) {
                fakeoutTypeM5micro = 'BULLISH_FAKEOUT';
                fakeoutCandlesAgoM5micro = recentFewM5micro.length - i;
                const nextCandles = recentPrimary.slice(recentPrimary.indexOf(c) + 1);
                fakeoutReversalConfirmedM5micro = nextCandles.some(nc => nc.close > nc.open);
                break;
              }
            }
          }

          const phaseLabelM5micro = m5MovePhase === 'FRESH'
            ? `FRESH — < 0.75x M5 ATR traveled (< ${freshCeilingM5} pips from swing origin). Full structural space available.`
            : m5MovePhase === 'DEVELOPING'
              ? `DEVELOPING — 0.75–1.5x M5 ATR traveled (${freshCeilingM5}–${developingCeilingM5} pips from swing origin). Structural space to TP1 may be narrowing — the remaining runway to the named TP levels is the key measurement.`
              : `EXHAUSTED — > 1.5x M5 ATR traveled (> ${developingCeilingM5} pips from swing origin). The move is extended. Document the structural picture honestly and reflect it in the conviction score.`;

          const fakeoutBlockM5micro = fakeoutTypeM5micro
            ? `
M5 FAKEOUT DETECTION:
A ${fakeoutTypeM5micro} was detected ${fakeoutCandlesAgoM5micro} M5 candle(s) ago. A candle swept a recent M5 extreme but closed back inside the prior range. Reversal confirmed: ${fakeoutReversalConfirmedM5micro ? 'YES — subsequent M5 candles have printed in the reversal direction' : 'NOT YET — subsequent M5 candles have not yet confirmed direction'}.
${fakeoutTypeM5micro === 'BEARISH_FAKEOUT'
  ? 'BEARISH FAKEOUT: Price swept above a prior M5 high and rejected, closing back inside the prior range. This is raw structural data — a sweep of the high, a rejection, and a body close inside. What that means for the current thesis is my read.'
  : 'BULLISH FAKEOUT: Price swept below a prior M5 low and rejected, closing back inside the prior range. This is raw structural data — a sweep of the low, a rejection, and a body close inside. What that means for the current thesis is my read.'}
`
            : '';

          const m15AnchorBlock = hasMicroM15Anchor
            ? `M15 SWING ORIGIN ANCHOR: M15 High=${m15SwingHighMicro.toFixed(pipInfo.decimalPlaces)} | M15 Low=${m15SwingLowMicro.toFixed(pipInfo.decimalPlaces)} | Current direction: ${currentDirM5} — origin is M15 ${currentDirM5 === 'DN' ? 'High' : 'Low'} at ${m15AnchorOrigin.toFixed(pipInfo.decimalPlaces)} | Distance: ${m15AnchorDistPips.toFixed(1)} pips (~${m15AnchorATRMultiple.toFixed(2)}x M5 ATR) | ${m15AnchorATRMultiple > atrTraveledM5window ? 'M15 anchor used (larger than M5 window)' : 'M5 window used (larger than M15 anchor)'}`
            : `M15 SWING ORIGIN ANCHOR: Not yet available — M15 direction fetch runs after this block. ATR-traveled uses M5 window measurement only.`;

          microIntradayMovePhaseContext = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MICRO_INTRADAY MOVE STAGE ADVISORY (${marketContext.symbol})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pre-computed from M5 entry candles (30-candle window) + M15 direction anchor. Advisory — my analysis takes precedence.
ACTIVE M5 ATR: ${m5AtrPips.toFixed(1)} pips | Phase thresholds: Fresh < ${freshCeilingM5}p | Developing ${freshCeilingM5}–${developingCeilingM5}p | Exhausted > ${developingCeilingM5}p

${m15AnchorBlock}

ATR Traveled (primary): ~${(atrTraveledFinal * m5AtrPips).toFixed(1)} pips from origin (~${atrTraveledFinal.toFixed(2)}x M5 ATR)
Move Phase: ${m5MovePhase}
Assessment: ${phaseLabelM5micro}

${m5MovePhase === 'DEVELOPING'
  ? `DEVELOPING STAGE — RUNWAY AUDIT: Record the remaining structural space from current price to the named TP1 (M15 structural level) and TP2 (H1 structural level). "Remaining runway to TP1: ~X pips. Remaining runway to TP2: ~X pips. R:R from current price: TP1=X:1, TP2=X:1." The R:R assessment belongs in the conviction score.`
  : m5MovePhase === 'EXHAUSTED'
    ? `EXHAUSTED STAGE — The move has traveled > 1.5x ATR from its structural origin. Document the nearest structural levels from current price, the R:R those levels produce, and what the market is showing. The conviction score reflects the honest read.`
    : `FRESH STAGE — Full structural space to TP1 and TP2 is available.`
}
${fakeoutBlockM5micro}MANDATORY JSON FIELD — Include in your response regardless of action:
  "m5_move_phase": "fresh|developing|exhausted"
  "m5_atr_traveled": ${atrTraveledFinal.toFixed(2)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.log(`[Alpha Coordinator] MICRO_INTRADAY Move Phase: ${m5MovePhase} (~${atrTraveledFinal.toFixed(2)}x ATR, M15anchor=${hasMicroM15Anchor ? m15AnchorDistPips.toFixed(1)+'p/'+m15AnchorATRMultiple.toFixed(2)+'x' : 'N/A'}, M5window=${distFromSwingPipsM5.toFixed(1)}p/${atrTraveledM5window.toFixed(2)}x)${fakeoutTypeM5micro ? ` | Fakeout: ${fakeoutTypeM5micro}` : ''}`);
        }

        const emaContextBlock = (ema20Val > 0 || ema50Val > 0) ? `
${primaryTfConfig.label} EMA CONTEXT (computed from candle closes):
- EMA20: ${ema20Val > 0 ? ema20Val.toFixed(pipInfo.decimalPlaces) : 'N/A'} | Price is ${ema20Val > 0 ? (priceAboveEma20 ? 'ABOVE' : 'BELOW') : '?'} EMA20${ema20Pips !== null ? ` by ${ema20Pips.toFixed(1)} pips` : ''}
- EMA50: ${ema50Val > 0 ? ema50Val.toFixed(pipInfo.decimalPlaces) : 'N/A'} | Price is ${ema50Val > 0 ? (priceAboveEma50 ? 'ABOVE' : 'BELOW') : '?'} EMA50${ema50Pips !== null ? ` by ${ema50Pips.toFixed(1)} pips` : ''}${ema200Val > 0 ? `
- EMA200: ${ema200Val.toFixed(pipInfo.decimalPlaces)} | Price is ${priceAboveEma200 ? 'ABOVE' : 'BELOW'} EMA200${ema200Pips !== null ? ` by ${ema200Pips.toFixed(1)} pips` : ''}` : ''}
- EMA Stack: ${emaStack}${ema20Val > 0 ? ` | EMA20 is ${ema20AboveEma50 ? 'ABOVE' : 'BELOW'} EMA50` : ''} | EMA20 Slope: ${ema20SlopeDir} (${ema20Slope.toFixed(2)} pips/candle)
EMA INTERPRETATION: body ratio >60% = directional conviction candle | small body relative to range = indecision (inside bar / doji). Use EMA20 as the closest dynamic support/resistance. If price is within 3 pips of EMA20, this is an EMA rejection zone.` : '';

        primaryTfCandlePrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${primaryTfConfig.label} PRIMARY TIMEFRAME CANDLES (${marketContext.symbol}) — ENTRY ADVISORY PRIMARY SIGNAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THIS IS YOUR PRIMARY DATA for the entry_advisory verdict. Your trade lives on the ${primaryTfConfig.label} timeframe.
Analyze these ${primaryTfConfig.label} candles FIRST before considering M1 micro-data.
CANDLE FORMAT: direction | OHLC | body pips | upper/lower wick pips | body% of range | wick_bias
body ratio >60% = conviction candle | small body relative to range = indecision | wick_bias = which side dominates (institutional rejection signal)

${primaryLines.join('\n')}

${primaryTfConfig.label} STRUCTURE SUMMARY:
- ${primaryTfConfig.label} Range: ${tfRangePips.toFixed(1)} pips (High: ${tfHigh.toFixed(pipInfo.decimalPlaces)}, Low: ${tfLow.toFixed(pipInfo.decimalPlaces)})
- Consecutive same-direction ${primaryTfConfig.label} candles: ${consecutiveSameDir}
- Last ${primaryTfConfig.label} candle: ${hasRejectionWick ? 'REJECTION WICK detected' : 'Normal candle'} (body: ${lastBody.toFixed(1)}p, upper wick: ${lastUpperWick.toFixed(1)}p, lower wick: ${lastLowerWick.toFixed(1)}p)
- ${primaryTfConfig.label} Momentum: ${consecutiveSameDir >= 3 ? 'IMPULSIVE MOVE — ' + consecutiveSameDir + ' consecutive same-direction ' + primaryTfConfig.label + ' candles. Pullback is highly probable before continuation.' : consecutiveSameDir >= 2 ? 'Developing trend — 2 consecutive ' + primaryTfConfig.label + ' candles, monitor for continuation or pullback' : 'Mixed/consolidating — no impulsive leg detected on ' + primaryTfConfig.label}
${emaContextBlock}
PULLBACK ASSESSMENT RULE (${primaryTfConfig.label} TIMEFRAME):
${consecutiveSameDir >= 3
  ? `IMPULSIVE LEG OBSERVATION: ${consecutiveSameDir} consecutive same-direction ${primaryTfConfig.label} candles detected. This is an extended ${primaryTfConfig.label} move without a structural pullback. Document your entry_advisory verdict and the structural reasoning behind it — whether continuation, pullback probability, or other. State your assessment of what the consecutive candle count means for this specific setup and let your conviction score reflect it.`
  : `No impulsive ${primaryTfConfig.label} leg detected. Assess structural levels, EMA proximity, and wick bias to determine entry quality.`}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        console.log(`[Alpha Coordinator] ${primaryTfConfig.label} Primary TF: ${recentPrimary.length} candles, ${consecutiveSameDir} consecutive same-dir, range ${tfRangePips.toFixed(1)} pips`);
      }
    } catch (error) {
      console.warn(`[Alpha Coordinator] ${primaryTfConfig.label} primary TF candles unavailable (non-blocking):`, error instanceof Error ? error.message : 'Unknown');
    }

    // ═══════════════════════════════════════════════════════════════════
    // HTF DIRECTION TIMEFRAME CANDLES — CCIP-2026-0427E-STYLE-CONSOLIDATION
    // Single-style platform: MICRO_INTRADAY uses H1 as direction TF (validates M5 entry direction).
    // GOVERNANCE: Missing direction TF data = hard NO_TRADE (MTF_DATA_MISSING)
    // Alpha cannot reason about direction without direction TF data.
    // ═══════════════════════════════════════════════════════════════════
    const htfConfig = { timeframe: 'H1', label: 'H1', candleCount: 10 } as const;

    let htfCandlePrompt = '';

    {
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
            decision_origin: 'SYSTEM_DATA_MISSING' as const,
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

COUNTER-TREND ENTRY AUDIT: If your intended direction opposes the ${htfConfig.label} structural bias above,
document in your reasoning what counter-trend structural evidence you observed (BOS, sweep wick, or other).
If no counter-trend structural evidence exists in the pre-computed signals above, state that clearly and reflect it in your conviction score.
Alpha decides the action — the audit trail records the evidence.`;

        console.log(`[Alpha Coordinator] ${htfConfig.label} structural evidence: BOS_BULL=${htfBOSBull} BOS_BEAR=${htfBOSBear} WICK_BULL=${htfSweepWickBull} WICK_BEAR=${htfSweepWickBear}`);

        htfCandlePrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${htfConfig.label} DIRECTION TIMEFRAME CANDLES (${marketContext.symbol}) — DIRECTIONAL AUTHORITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THIS IS YOUR DIRECTION CONTEXT for ${styleName} trades. The ${htfConfig.label} sets the directional bias.
MICRO_INTRADAY: H1 is the direction TF. My entry lens is M5. My TP is M5 leg exhaustion. H1 tells me which direction to hunt — not where to exit.
MANDATORY: Reference this ${htfConfig.label} data in your QUESTION 1 TREND ALIGNMENT answer.

${htfLines.join('\n')}

${htfConfig.label} DIRECTION SUMMARY:
- ${htfConfig.label} Range (last ${htfConfig.candleCount} candles): ${htfRangePips.toFixed(1)} pips (High: ${htfHigh.toFixed(pipInfo.decimalPlaces)}, Low: ${htfLow.toFixed(pipInfo.decimalPlaces)})
- ${htfConfig.label} Directional bias: ${htfTrendDir}
- Consecutive same-direction ${htfConfig.label} candles: ${htfConsecutive}
- ${htfConfig.label} Key resistance: ${htfHigh.toFixed(pipInfo.decimalPlaces)} | Key support: ${htfLow.toFixed(pipInfo.decimalPlaces)}

${htfConfig.label} DIRECTION RULE:
${htfTrendDir === 'BULLISH' ? `${htfConfig.label} trend is BULLISH. ${primaryTfConfig.label} BUY entries have directional tailwind. ${primaryTfConfig.label} SELL entries are counter-trend — require explicit ${htfConfig.label}-level reversal evidence.` : htfTrendDir === 'BEARISH' ? `${htfConfig.label} trend is BEARISH. ${primaryTfConfig.label} SELL entries have directional tailwind. ${primaryTfConfig.label} BUY entries are counter-trend — require explicit ${htfConfig.label}-level reversal evidence.` : `${htfConfig.label} is NEUTRAL/RANGING. Both directions require structural confirmation at the range boundaries.`}

${htfStructuralEvidenceBlock}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        console.log(`[Alpha Coordinator] ${htfConfig.label} Direction TF: ${recentHtf.length} candles, bias ${htfTrendDir}, range ${htfRangePips.toFixed(1)} pips`);
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
          decision_origin: 'SYSTEM_DATA_MISSING' as const,
        };
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // CCIP-2026-0427E-STYLE-CONSOLIDATION: H4 background block (INTRADAY-only) removed.
    const h4BackgroundPrompt = '';

    // ═══════════════════════════════════════════════════════════════════
    // M5 SUB-CONFIRMATION CANDLES — CCIP-2026-0427E-STYLE-CONSOLIDATION
    // Single-style platform: MICRO_INTRADAY = M5 (primary entry) + M15 (trend validation) + H1 (controlling).
    // Advisory, non-blocking.
    // ═══════════════════════════════════════════════════════════════════
    let m5SubConfirmationPrompt = '';
    {
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

These are raw M5 measurements from the current scan window — pre-computed structural signals for Alpha to read and evaluate.`;

          m5SubConfirmationPrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M5 CANDLE CONTEXT (${marketContext.symbol}) — MICRO_INTRADAY TIMING LAYER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M5 data below is raw structural measurement from the current scan window. M15 defines the setup. M5 reveals the current micro-structure within that setup.
Record entry_mode and the structural reasoning behind it in the JSON response — this is an audit field.

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
DATA GAP: Without M5 confirmation data, the sub-confirmation trigger state is unknown.
Document your entry_mode choice and reasoning given this data gap. State what trigger you are waiting for or why current structural context is sufficient. Your conviction score should reflect this uncertainty.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.warn(`[Alpha Coordinator] M5 sub-confirmation data insufficient for MICRO_INTRADAY (${m5SubCandles?.length ?? 0} candles)`);
        }
      } catch (error) {
        m5SubConfirmationPrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M5 SUB-CONFIRMATION (${marketContext.symbol}) — FETCH ERROR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WARNING: M5 candle fetch failed. The sub-confirmation trigger state is unknown due to a data fetch error.
Document your entry_mode choice and reasoning given this data gap. Your conviction score should reflect the absence of sub-confirmation data.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        console.warn('[Alpha Coordinator] M5 sub-confirmation fetch failed (non-blocking):', error instanceof Error ? error.message : 'Unknown');
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // M15 DIRECTION CANDLES — CCIP-2026-0427E-STYLE-CONSOLIDATION
    // Single-style platform: MICRO_INTRADAY = M5 (entry) + M15 (direction) + H1 (control).
    // Non-blocking advisory.
    // ═══════════════════════════════════════════════════════════════════
    {
      try {
        const mds = MarketDataService.getInstance();
        const m15DirCandles = await mds.getCandles(marketContext.symbol, 'M15', 10);

        if (m15DirCandles && m15DirCandles.length >= 5) {
          const recentM15Dir = m15DirCandles.slice(0, 10).reverse();
          const pipInfo = getCurrencyPipInfo(marketContext.symbol);

          const m15DirLines: string[] = recentM15Dir.map((c, i) => {
            const dir = c.close > c.open ? 'UP' : c.close < c.open ? 'DN' : 'FLAT';
            const bodyPips = Math.abs(c.close - c.open) / pipInfo.pipValue;
            const upperWick = (c.high - Math.max(c.open, c.close)) / pipInfo.pipValue;
            const lowerWick = (Math.min(c.open, c.close) - c.low) / pipInfo.pipValue;
            const totalRange = (c.high - c.low) / pipInfo.pipValue;
            const bodyRatio = totalRange > 0 ? Math.round((bodyPips / totalRange) * 100) : 0;
            const wickBias = upperWick > lowerWick * 1.5 ? 'upper' : lowerWick > upperWick * 1.5 ? 'lower' : 'balanced';
            return `  ${i + 1}. ${dir} O:${c.open.toFixed(pipInfo.decimalPlaces)} H:${c.high.toFixed(pipInfo.decimalPlaces)} L:${c.low.toFixed(pipInfo.decimalPlaces)} C:${c.close.toFixed(pipInfo.decimalPlaces)} body:${bodyPips.toFixed(1)}p wicks:${upperWick.toFixed(1)}/${lowerWick.toFixed(1)}p ratio:${bodyRatio}% wick_bias:${wickBias}`;
          });

          const lastM15Dir = recentM15Dir[recentM15Dir.length - 1];
          const prevM15Dir = recentM15Dir.length >= 2 ? recentM15Dir[recentM15Dir.length - 2] : lastM15Dir;
          const m15DirTrend = lastM15Dir.close > prevM15Dir.close ? 'BULLISH' : lastM15Dir.close < prevM15Dir.close ? 'BEARISH' : 'NEUTRAL';
          const lastM15DirBody = Math.abs(lastM15Dir.close - lastM15Dir.open) / pipInfo.pipValue;
          const lastM15DirUpperWick = (lastM15Dir.high - Math.max(lastM15Dir.open, lastM15Dir.close)) / pipInfo.pipValue;
          const lastM15DirLowerWick = (Math.min(lastM15Dir.open, lastM15Dir.close) - lastM15Dir.low) / pipInfo.pipValue;
          const m15DirRejectionWick = lastM15DirUpperWick > lastM15DirBody * 1.5 || lastM15DirLowerWick > lastM15DirBody * 1.5;

          m15SwingHighMicro = Math.max(...recentM15Dir.map(c => c.high));
          m15SwingLowMicro = Math.min(...recentM15Dir.map(c => c.low));
          const m15DirRangePips = (m15SwingHighMicro - m15SwingLowMicro) / pipInfo.pipValue;

          let m15DirConsecutive = 1;
          for (let i = recentM15Dir.length - 2; i >= 0; i--) {
            const prevDir = recentM15Dir[i].close > recentM15Dir[i].open ? 'UP' : 'DN';
            const lastDir = lastM15Dir.close > lastM15Dir.open ? 'UP' : 'DN';
            if (prevDir === lastDir) m15DirConsecutive++;
            else break;
          }

          const m15DirBOSBull = recentM15Dir.length >= 2 && lastM15Dir.close > recentM15Dir[recentM15Dir.length - 2].high;
          const m15DirBOSBear = recentM15Dir.length >= 2 && lastM15Dir.close < recentM15Dir[recentM15Dir.length - 2].low;
          const m15DirSweepWickBull = recentM15Dir.slice(-2).some(c => {
            const body = Math.abs(c.close - c.open);
            const wick = Math.min(c.open, c.close) - c.low;
            return body > 0 && wick / body >= 1.5;
          });
          const m15DirSweepWickBear = recentM15Dir.slice(-2).some(c => {
            const body = Math.abs(c.close - c.open);
            const wick = c.high - Math.max(c.open, c.close);
            return body > 0 && wick / body >= 1.5;
          });

          m15DirectionPromptMicro = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M15 DIRECTION CONTEXT — MICRO_INTRADAY (${marketContext.symbol})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M15 is the direction timeframe for MICRO_INTRADAY. The M15 candle sequence shows where the trend stands at the 15-minute level. The M15 High/Low are the structural boundaries the M5 entry must align with.

${m15DirLines.join('\n')}

M15 DIRECTION SUMMARY:
- M15 Structural Range (last ${recentM15Dir.length} candles): ${m15DirRangePips.toFixed(1)} pips | High: ${m15SwingHighMicro.toFixed(pipInfo.decimalPlaces)} | Low: ${m15SwingLowMicro.toFixed(pipInfo.decimalPlaces)}
- M15 Current trend direction: ${m15DirTrend}
- Consecutive same-direction M15 candles: ${m15DirConsecutive}
- Last M15 candle: ${m15DirRejectionWick ? 'REJECTION WICK detected — possible exhaustion or reversal at M15 level' : 'Normal candle — no strong wick signal'}
- M15 BOS BULL (last M15 close > prior M15 high): ${m15DirBOSBull ? 'YES — bullish M15 break of structure confirmed' : 'NO'}
- M15 BOS BEAR (last M15 close < prior M15 low): ${m15DirBOSBear ? 'YES — bearish M15 break of structure confirmed' : 'NO'}
- M15 SWEEP WICK BULL (lower wick ≥1.5x body, last 2 candles): ${m15DirSweepWickBull ? 'YES — bullish absorption on M15' : 'NO'}
- M15 SWEEP WICK BEAR (upper wick ≥1.5x body, last 2 candles): ${m15DirSweepWickBear ? 'YES — bearish absorption on M15' : 'NO'}

The M15 structural high and low above are the reference points for the move stage advisory. I read the M15 candle sequence directly to assess whether the M5 entry direction is aligned with the M15 trend.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.log(`[Alpha Coordinator] M15 Direction (MICRO_INTRADAY): ${recentM15Dir.length} candles, trend=${m15DirTrend}, BOS_BULL=${m15DirBOSBull} BOS_BEAR=${m15DirBOSBear}, High=${m15SwingHighMicro.toFixed(pipInfo.decimalPlaces)} Low=${m15SwingLowMicro.toFixed(pipInfo.decimalPlaces)}`);
        } else {
          m15DirectionPromptMicro = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M15 DIRECTION (${marketContext.symbol}) — DATA UNAVAILABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WARNING: M15 direction candles unavailable (${m15DirCandles?.length ?? 0} found, need ≥5). M15 structural high/low cannot be computed. ATR-traveled in the move stage advisory is measured from M5 window only — treat conservatively.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.warn(`[Alpha Coordinator] M15 direction data insufficient for MICRO_INTRADAY (${m15DirCandles?.length ?? 0} candles)`);
        }
      } catch (error) {
        m15DirectionPromptMicro = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M15 DIRECTION (${marketContext.symbol}) — FETCH ERROR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WARNING: M15 direction fetch failed. M15 structural high/low unavailable. ATR-traveled is from M5 window only.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        console.warn('[Alpha Coordinator] M15 direction fetch failed for MICRO_INTRADAY (non-blocking):', error instanceof Error ? error.message : 'Unknown');
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
    // CCIP-2026-0427E-STYLE-CONSOLIDATION: INTRADAY M15 sub-confirmation block removed —
    // single-style platform (MICRO_INTRADAY) does not run an INTRADAY branch.

    // ═══════════════════════════════════════════════════════════════════
    // M15 STRUCTURAL REFERENCE (SCALP ONLY — advisory, non-blocking)
    // CCIP-2026-02-19: SCALP trades play out over 15-60 minutes — the M15
    // timeframe governs where price stalls or reverses within that window.
    // Alpha must know M15 trend and nearest S/R to place scalp TPs correctly.
    // This is NOT a controlling TF gate (no MTF_DATA_MISSING block).
    // Missing M15 data is non-blocking. Present data is advisory context.
    // SSOT: MarketDataService is the single authority for candle data
    // ═══════════════════════════════════════════════════════════════════
    // CCIP-2026-0427E-STYLE-CONSOLIDATION: SCALP M15 structural reference removed —
    // single-style platform (MICRO_INTRADAY) does not run a SCALP branch.
    const m15ReferencePrompt = '';

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
    // CCIP-2026-0427E-STYLE-CONSOLIDATION: SCALP H1 campaign context removed —
    // single-style platform (MICRO_INTRADAY) does not run a SCALP branch.
    const h1CampaignPrompt = '';

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
      // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform — MICRO_INTRADAY only needs PDH/PDL reference (3 candles sufficient).
      const d1FetchCount = 3;
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

        const currentPrice = marketContext.livePrice ?? marketContext.price;
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
        const isIndexOrMetal = ['US30', 'NAS100', 'SP500', 'SPX500', 'XAUUSD', 'XAGUSD'].includes(marketContext.symbol);
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

        // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform — INTRADAY D1 structural
        // campaign block and SCALP advisory branch removed. MICRO_INTRADAY uses PDH/PDL as
        // institutional reference levels.
        d1ContextPrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSTITUTIONAL REFERENCE LEVELS (${marketContext.symbol})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Previous Day Date: ${prevDayDate}
Previous Day High (PDH): ${prevDayHigh.toFixed(pipInfo.decimalPlaces)} — ${distToPDH.toFixed(1)} pips away
Previous Day Low (PDL): ${prevDayLow.toFixed(pipInfo.decimalPlaces)} — ${distToPDL.toFixed(1)} pips away
Previous Day Close: ${prevDayClose.toFixed(pipInfo.decimalPlaces)} (${prevDayDir} day, range: ${prevDayRange.toFixed(1)} pips)
${weeklyRefBlock ? weeklyRefBlock + '\n' : ''}${roundNumbersBlock}
Current Position: ${positionContext}
Price vs PD Range: ${pricePositionInPDRange}% from PDL (0%=at PDL, 100%=at PDH)${pwhValue !== null && pwlValue !== null ? `
WEEKLY LEVELS RULE: PWH and PWL are the MOST SIGNIFICANT weekly liquidity reference levels. Market makers run stops above PWH and below PWL. When price is within 10 pips of PWH or PWL, include these in your TP path audit as named obstacles or potential targets. A break above PWH or below PWL with a strong body close signals institutional commitment to the weekly direction.` : ''}

INSTITUTIONAL LEVEL RULES:
- PDH and PDL are MAJOR institutional reference levels. Market makers target these for liquidity sweeps.
- A TP placed at or beyond PDH/PDL without accounting for its magnetic pull is structurally weak.
- If your TP target is BEYOND PDH (for BUY) or below PDL (for SELL), acknowledge this in your reasoning.
- If your entry is NEAR PDH/PDL (within 5% of range), explain whether this is a breakout or rejection setup.
- PDH/PDL are NOT hard TP targets. They are context layers — use them to calibrate where liquidity pools.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        console.log(`[Alpha Coordinator] D1 Previous Day (${styleName ?? tradeStyle}): H=${prevDayHigh.toFixed(pipInfo.decimalPlaces)} L=${prevDayLow.toFixed(pipInfo.decimalPlaces)} range=${prevDayRange.toFixed(1)}p, price at ${pricePositionInPDRange}% of PD range`);
      }
    } catch (error) {
      console.warn('[Alpha Coordinator] D1 context unavailable (non-blocking):', error instanceof Error ? error.message : 'Unknown');
    }

    // ═══════════════════════════════════════════════════════════════════
    // M1 PRICE ACTION CONTEXT (MICRO_INTRADAY + INTRADAY ONLY)
    // M1 TIMING DATA — ALL STYLES (non-blocking)
    // SCALP:          M1 is the precision entry timing layer. M5 is primary (structure + TP).
    //                 M1 shows Alpha exactly WHERE on the M5 leg to pull the trigger.
    //                 20 M1 candles = 20 minutes of sub-M5 price action.
    // MICRO_INTRADAY: M1 is timing refinement. M5 is primary.
    // INTRADAY:       M1 is timing refinement. M15 is primary.
    // SSOT: MarketDataService is the single authority for candle data.
    // ═══════════════════════════════════════════════════════════════════
    let m1MicroContextPrompt = '';
    try {
      const mds = MarketDataService.getInstance();
      // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform — MICRO_INTRADAY uses 12 M1 candles for timing refinement.
      const m1CandleCount = 12;
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

        const lastCandleM1 = recentM1[recentM1.length - 1];
        const lastBodyM1 = Math.abs(lastCandleM1.close - lastCandleM1.open) / pipInfo.pipValue;
        const lastUpperWickM1 = (lastCandleM1.high - Math.max(lastCandleM1.open, lastCandleM1.close)) / pipInfo.pipValue;
        const lastLowerWickM1 = (Math.min(lastCandleM1.open, lastCandleM1.close) - lastCandleM1.low) / pipInfo.pipValue;
        const hasRejectionWickM1 = lastUpperWickM1 > lastBodyM1 * 1.5 || lastLowerWickM1 > lastBodyM1 * 1.5;

        const m1High = Math.max(...recentM1.map(c => c.high));
        const m1Low = Math.min(...recentM1.map(c => c.low));
        const m1RangePips = (m1High - m1Low) / pipInfo.pipValue;

        // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform — MICRO_INTRADAY uses M1 as timing refinement only.
        const m1Header = `Use M1 data to REFINE entry timing AFTER you have assessed the ${primaryTfConfig.label} structure above. M1 signals alone do NOT determine your entry_advisory verdict. The ${primaryTfConfig.label} timeframe is primary.`;

        m1MicroContextPrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M1 PRECISION TIMING (${marketContext.symbol}) — TIMING REFINEMENT (SECONDARY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${m1Header}

${m1Lines.join('\n')}

M1 SUMMARY:
- M1 Range: ${m1RangePips.toFixed(1)} pips (High: ${m1High.toFixed(pipInfo.decimalPlaces)}, Low: ${m1Low.toFixed(pipInfo.decimalPlaces)})
- Consecutive same-direction M1 candles: ${consecutiveSameDir}
- Last M1 candle: ${hasRejectionWickM1 ? 'REJECTION WICK detected (possible reversal/exhaustion at M1 level)' : 'Normal candle — no strong wick signal'}
- M1 momentum: ${consecutiveSameDir >= 4 ? 'STRONG one-way — retrace/pause likely imminent' : consecutiveSameDir >= 3 ? 'Building — watch for M1 exhaustion' : 'Mixed/choppy — normal price action'}

HIERARCHY REMINDER: A single M1 rejection wick does NOT override an impulsive ${primaryTfConfig.label} leg.
If the ${primaryTfConfig.label} shows 3+ consecutive same-direction candles, the entry_advisory should be PULLBACK_EXPECTED
regardless of what M1 shows — unless there is exceptional breakaway evidence.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        console.log(`[Alpha Coordinator] M1 Timing (${styleName}): ${recentM1.length} candles, ${consecutiveSameDir} consecutive same-dir, range ${m1RangePips.toFixed(1)} pips`);
      }
    } catch (error) {
      console.warn('[Alpha Coordinator] M1 timing data unavailable (non-blocking):', error instanceof Error ? error.message : 'Unknown');
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
Pre-computed signal from the server-side intelligence monitor. This is advisory context — your analysis takes precedence. Document any contradictions between this signal and your own reading in your reasoning.
${direction ? `Directional Bias: ${direction.toUpperCase()}` : ''}${imConfidence !== undefined ? ` | Signal Confidence: ${(imConfidence * 100).toFixed(0)}%` : ''}${imScore !== undefined ? ` | Pair Score: ${imScore.toFixed(1)}` : ''}
${alignment ? `Alignment: ${alignment}` : ''}
${momentumPhase ? `Momentum Phase: ${momentumPhase.toUpperCase()}` : ''}${subMode ? ` | Sub-Mode: ${subMode}` : ''}
${pattern ? `Detected Pattern: ${pattern}` : ''}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
      }
    }

    // CCIP-2026-0427E-STYLE-CONSOLIDATION: SCALP intelligence prompt removed —
    // single-style platform (MICRO_INTRADAY) does not run a SCALP branch.
    const scalpIntelligencePrompt = '';

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

    // CCIP-2026-0427E-STYLE-CONSOLIDATION: ATR legend simplified — single-style platform (MICRO_INTRADAY).
    void atr20Pips;
    void atr100Pips;
    const atrLegendPrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MARKET DATA LEGEND — ATR FIELD REFERENCE (${marketContext.symbol})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
When you reference "ATR" in move stage diagnosis, structural space requirements, and SL sizing, you are referring to the ACTIVE ATR (M5-based, 14-period).

  marketContext.atr = MICRO_INTRADAY ATR (14-period, M5-based) — current: ${atrPips} pips

ACTIVE ATR for this session (MICRO_INTRADAY): ${activeAtrPips} pips — this is your baseline ATR (using ${preferredAtrField} field)

Use the ACTIVE ATR value above for all move stage calculations in this scan cycle:
  - FRESH / STARTING:  price has traveled < 0.75 × ${activeAtrPips} pips = < ${atrForStopLoss > 0 ? ((atrForStopLoss * 0.75) / pipInfoForLegend.pipValue).toFixed(1) : 'N/A'} pips from swing origin
  - DEVELOPING:        0.75–1.5 × ${activeAtrPips} pips = ${atrForStopLoss > 0 ? ((atrForStopLoss * 0.75) / pipInfoForLegend.pipValue).toFixed(1) : 'N/A'}–${atrForStopLoss > 0 ? ((atrForStopLoss * 1.5) / pipInfoForLegend.pipValue).toFixed(1) : 'N/A'} pips from swing origin
  - EXHAUSTED:         > 1.5 × ${activeAtrPips} pips = > ${atrForStopLoss > 0 ? ((atrForStopLoss * 1.5) / pipInfoForLegend.pipValue).toFixed(1) : 'N/A'} pips from swing origin → ADVISORY: Move is extended. Name whether a structural reversal, retest, or sweep setup exists. Exhausted moves can produce strong reversals — reason honestly about the structural case. Your confidence reflects your actual conviction.
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
    // opportunity every scan cycle. An ACCEPTABLE setup with structural basis and correct RR
    // is a valid trade. NOT executing on a valid setup is a scan failure.
    // SSOT: System prompt (alpha-identity.ts) carries Alpha's identity and reasoning framework.
    // This section provides per-scan context: streak, advisory designations, hard block list,
    // confidence bands, and the active-scan mandate.

    // CCIP-2026-0330-PAIR-PERSONALITY: Instrument awareness injection (LAYER 1).
    // Placed before macro intelligence so Alpha reads the pair's behavioral character
    // before interpreting any candle data. This is not a rule or gate — it is the
    // professional trader's internalized knowledge of the instrument they are analyzing.
    // SSOT: src/config/pair-personalities.ts
    const pairPersonalityContext = getPairPersonalityContext(marketContext.symbol, tradeStyle);

    const prompt = `${styleIdentityPrompt}
${pairPersonalityContext}
${cachedThesisPrompt}
${atrLegendPrompt}
SCAN CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${streakContextLine}

SCAN MANDATE (CCIP-2026-0330A): My first question every scan: what is this market doing right now, and is there a profitable direction? I read structure, phase, momentum, and range. I ask: can price move enough in one direction to produce a valid R:R trade with a structurally anchored stop? If yes — I execute with honest confidence. I do not require a textbook trigger before acting. A fired trigger raises confidence and favors execute_now. Its absence favors wait_pullback or push_confirmation. Neither absence produces NO_TRADE on its own.

NO_TRADE means the answer sheet is genuinely blank — not absence of a perfect setup.

CONVICTION STANDARD — TIER-TO-ACTION MAP (CCIP-2026-0425B):
My confidence_tier determines which actions are available to me. There are exactly four tiers.

  no_read              → NO_TRADE only.
                         My answer sheet is genuinely blank. ALL of the following must be true:
                         - htf_pattern, mtf_pattern, ltf_pattern = null or "none"
                         - No named price level anywhere in my reasoning
                         - No directional lean (lean_confidence = 0)
                         - No sweep, no BOS, no equal highs/lows, no FVG identified
                         - No kill zone, no range boundary, no session boundary worth monitoring
                         If even ONE of these conditions is not met, no_read is FORBIDDEN.
                         I must reassess to at minimum "confident" and output BUY or SELL.

  confident            → Execute Now or Wait Intent (NO_TRADE is NOT available).
                         Solid structure. Direction is named. Stop can be anchored. Path is credible.
                         Some unknowns remain but the structural case is clear.
                         If trigger has fired or price is at the structural level: execute_now.
                         If trigger is pending or geometry requires a better zone: wait_pullback or push_confirmation.
                         If geometry is impossible at current price but valid at a named zone: ALWAYS wait intent,
                         never NO_TRADE.

  very_confident       → Execute Now or Wait Intent (NO_TRADE is NOT available).
                         Strong named structure. Clear directional evidence stack. Named liquidity fuel.
                         Clean path to target. High-quality setup — I trade this at current price or at the zone.
                         If trigger fired: execute_now.
                         If trigger is pending: wait_pullback or push_confirmation.

  extremely_confident  → Execute Now only (wait and NO_TRADE are NOT available).
                         Near-perfect alignment across all dimensions. Structure, momentum, session, and
                         liquidity all converge on the same conclusion. The edge is live. Waiting surrenders it.
                         execute_now is the only valid response.

My confidence_tier is my honest read of what the structural evidence shows. My action and entry_mode must be consistent with the permitted set for that tier. A response that selects an action outside the permitted set for the stated tier is a governance violation — the system will correct it.

LEGACY TIERS — SCHEMA VIOLATIONS: low, cautious, moderate, high, very_high, extreme are no longer valid output tiers. Any response containing these tiers will be treated as a schema violation and corrected by the coordinator.

I read macro intelligence first, then interpret candle evidence through that lens. My system prompt defines how I think. What follows is the market data for this scan.

ADVISORY SOURCES (context inputs — not decision gates):
- Regime Oracle: session and volatility regime context
- Adversarial Detector: manipulation and trap pattern warnings
- Session Constraints: time-based liquidity context
- Advisory signals inform my reasoning. They are context — I read them and reason about what they mean for this specific setup. They do not produce arithmetic deductions from my confidence. My confidence is my honest conviction that this trade wins.
- Omega Sensors (Omega-8 through Omega-10): pure price-structure sensor readings — liquidity sweeps, FVGs, orderflow patterns, volume anomalies. These are raw structural observations about what the market has done. They carry no directional vote and no abstention. There is no "Omega disagreement" — there are only structural facts I interpret. I read them as evidence and build my judgment from that evidence.

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

OPPORTUNITY ASSESSMENT (CCIP-2026-0330A — answer before directional analysis):
Q_DIR: Which direction does momentum and structure favour right now — BUY, SELL, or NEITHER? State the evidence in one sentence.
Q_RANGE: How many pips can price realistically travel in that direction before hitting a structural wall? Name the wall.
Q_EDGE: Does the structural distance to my named target (TP pips) equal or exceed the structural distance to my invalidation level (SL pips)? YES or NO. This is the 1:1 floor — TP pips must be >= SL pips or this is a direction, not a trade.
If Q_EDGE = YES → proceed to full analysis and execute with honest confidence.
If Q_EDGE = NO → I have found a direction but not a trade. I do not proceed to full analysis. I immediately search for a valid geometry: a tighter SL anchored closer to structure, a further TP at the next structural level beyond the first wall, a different entry point that reduces SL distance, or the opposite direction. I resolve Q_EDGE to YES before proceeding — it is a prerequisite for full analysis, not a final check. If after a genuine structural search across all options no valid geometry exists, state the specific structural reason in thesis_coherence_statement and output NO_TRADE.
These three questions replace the need for a "perfect setup". Structure + range + R:R = edge. If the edge exists, I trade it.

Risk Mode: ${riskMode.toUpperCase()}

${conflictContext}${regimeLocationConflictAdvisory}${advisoryContext}${riskContext}${rrPerformanceContext}${dailyNarrativeContext}${microRegimeContext}${liquidityIntentContext}${momentumTrajectoryContext}${patternContext}${intelligenceContext}${imSignalContext}${goalContextText}${liquidityContext}${constraintsText}

MARKET CONDITIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Current Market Price (${marketContext.symbol}): ${(marketContext.livePrice ?? marketContext.price).toFixed(pipInfoForLegend.decimalPlaces)} ← USE THIS as your entry/SL/TP anchor
  Volatility: ${volatilityRegime.regime.toUpperCase()} ${volatilityRegime.ratio !== 1.0 ? `(${volatilityRegime.ratio.toFixed(2)}x)` : ''} | ${volatilityRegime.recommendation}
  Spread (${marketContext.symbol}): ~${getEstimatedSpreadPips(marketContext.symbol).toFixed(1)} pips | Minimum viable SL: ${getMinSlDistancePips(marketContext.symbol).toFixed(1)} pips (1.5x spread — SL below this will be hard-blocked)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LAYER 4 — RAW CANDLE EVIDENCE (Interpret through macro lens above)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${m5ContextPrompt}
${primaryTfCandlePrompt}
${htfCandlePrompt}
${h4BackgroundPrompt}
${m5SubConfirmationPrompt}
${m15DirectionPromptMicro}
${m15ReferencePrompt}
${h1CampaignPrompt}
${d1ContextPrompt}
${m1MicroContextPrompt}
${scalpIntelligencePrompt}
${microIntradayMovePhaseContext}
${stopLossDirective}

Actions: BUY (bullish edge), SELL (bearish edge), NO_TRADE (no structural edge or hard block condition met).
When analyzing multiple pairs, execute the best opportunity. Scanner re-evaluates every cycle.
BUY: SL < Entry < TP | SELL: TP < Entry < SL

TAKE-PROFIT RULES (ALPHA SOLE AUTHORITY) — MICRO_INTRADAY:
You choose ALL profit targets. No pre-computed ceiling exists. TP placement is driven entirely by market structure.
Process: (1) Find the directional edge. (2) Name the structural target. (3) Place TP there. (4) Calculate the R:R that results.

MICRO_INTRADAY uses TWO take-profits. TP1 captures a fast partial — the scalp slice. TP2 captures the full intraday target.
Minimum R:R 1.0:1 net of spread applies to TP2.

MANDATORY PRE-SUBMISSION GEOMETRY VERIFICATION (execute this as the final step before outputting JSON):
  Step A: Calculate my SL distance in pips — abs(entry - stopLoss).
  Step B: Verify SL distance >= minimum viable SL shown above (${getMinSlDistancePips(marketContext.symbol).toFixed(1)} pips for ${marketContext.symbol}). If my SL distance is below this floor, the position cannot survive the spread — widen the SL to the next structural level that clears this floor. If no structural anchor exists at or beyond the floor, I output NO_TRADE.
  Step C: Calculate my TP2 distance in pips — abs(tp2 - entry).
  Step D: Verify TP2 distance >= SL distance. If TP2 distance < SL distance, I have constructed a direction, not a trade. I select the next structural level further from entry that satisfies TP2 >= SL distance. If no such level exists after a genuine structural search, I output NO_TRADE with the specific structural reason.
  ETHUSD example (Step B): Minimum SL = 7.5 pips. If my structural SL is at 7.1 pips, I widen to the next structural extreme that is >= 7.5 pips. I do NOT submit a 7.1 pip SL — it will be hard-blocked before execution.
  Geometry example (Step D): SL is 57 pips. My TP2 must be >= 57 pips. A TP2 of 50 pips with a 57-pip SL = 0.88:1 = not a trade.

- MICRO_INTRADAY: TWO take-profits. Minimum R:R 1.0:1 on TP2. REASONING ORDER IS FIXED — find TP2 first, then find TP1 inside.
  "tp2" (FIND FIRST) = The full intraday target — the M5 structural destination (M5 swing extreme, equal highs/lows cluster, or M5 FVG fill zone) that defines why this move exists. MANDATORY. Do NOT fabricate TP2 by pointing at an M15 structural wall — name the M5 exhaustion point that defines the leg.
  "tp1" (FIND SECOND, INSIDE TP2) = The fast partial — the scalp slice. The highest-probability first fill point between entry and TP2. Scan M5 for: a prior M5 swing already printed between entry and TP2, M5 equal highs/lows clustering on the path, or an M5 FVG fill zone between entry and TP2. MANDATORY. Must be closer to entry than TP2.
  M15 tells you the direction. It does not set the destination. The destination is M5 exhaustion.
  tp1 must be closer to entry than tp2. TP2 R:R must be >= TP1 R:R.
  Document the M5 exhaustion signal for each level and the R:R achievable from it.

${entryModePromptSection}

My answer_sheet is an audit trail. I fill every field honestly — what I see informs my confidence. My action and trade_confidence are always my own judgment.

Return PURE JSON only — all required fields from the schema in my system prompt must be present.`;

    // Emit final progress thought before LLM call (this is the 6.3s phase)
    if (sessionId && userId) {
      alphaThoughtStream.emitAlphaFinalDecision(sessionId, userId, marketContext.symbol).catch(err => {
        console.warn('[Alpha Coordinator] Failed to emit final decision thought:', err);
      });
    }

    // CCIP-CACHE-BUST-2026-04-15: Root cause fix for OpenAI prompt cache degenerate scans.
    //
    // ROOT CAUSE (CORRECTED UNDERSTANDING):
    // OpenAI caches the entire messages array as a concatenated prefix, starting from
    // the SYSTEM message. The system prompt is thousands of tokens of static text identical
    // across all 7 symbols in a scan cycle — this is precisely what was being cached at
    // 49-55%. The prior fix (fingerprint in user message) was architecturally wrong:
    // the user message appears AFTER the system message in the concatenated prompt, well
    // beyond the cached prefix boundary. OpenAI had already matched the cache key on the
    // system prompt before reaching the user message fingerprint — so the fingerprint had
    // no effect on the cache hit rate.
    //
    // FIX: Inject the fingerprint as the FIRST line of the SYSTEM message. OpenAI's cache
    // key is computed from the first ~1024 tokens of the concatenated messages array,
    // beginning with the system message. Prepending a unique fingerprint to the system
    // message guarantees a cache miss on every single scan because the cache key changes
    // with every request. This is the only position in the message array that defeats the
    // automatic prefix-caching mechanism at its root.
    //
    // COST: ~10 tokens per scan — negligible.
    // EXPECTED OUTCOME: Cache hit rate drops from 49-55% to 0-5%.
    //                   Completion tokens return to 600-1500 genuine analysis range.
    const scanNonce = Math.random().toString(36).slice(2, 8).toUpperCase();
    const scanTs = Date.now();
    const scanFingerprint = `[SCAN:${marketContext.symbol}|${scanTs}|${scanNonce}]`;

    const buildAlphaMessages = (retryLabel?: string) => {
      const systemFingerprint = retryLabel
        ? `${scanFingerprint}|${retryLabel}`
        : scanFingerprint;
      return [
        {
          role: 'system' as const,
          content: `${systemFingerprint}\n\n${getAlphaSystemPromptForStyle(styleName, huntContextForPrompt)}`
        },
        {
          role: 'user' as const,
          content: prompt
        }
      ];
    };

    const alphaCallOptions = {
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
      // TOKEN BUDGET — CCIP-2026-0502A (replaces CCIP-2026-0406B):
      // CCIP-2026-0406B set max_tokens=2000 after raising from 1500 to accommodate
      // post-upgrade reasoning depth. Stages 11-16 (CCIP-2026-0501D/E/F) injected new
      // prompt blocks (Dynamic Tier Targets, Winning-Pattern Signals, Repeated-Drift
      // Escalation, Auto-Tuned Watchers, Pair-Personality Drift) that expanded both the
      // prompt surface and Alpha's required reasoning output. Production evidence
      // (2026-05-02): XAUUSD/MICRO_INTRADAY hit finish_reason=length at 2000, truncating
      // stopLoss/takeProfit (last fields in JSON schema). Raise max_tokens 2000 → 3000.
      //
      // INVARIANT: If finish_reason === 'length' fires, TOKEN_BUDGET_EXCEEDED surfaces.
      //   Raise max_tokens if that fires — production data justifies current ceiling.
      model: 'gpt-4o',
      temperature: 0.3,
      max_completion_tokens: 3000,
      requestType: 'alpha_coordination',
      endpoint: 'alpha-coordinator',
      symbol: marketContext.symbol
    };

    try {
      let response = await openAIClient.chat(buildAlphaMessages(), alphaCallOptions);

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

      // CCIP-2026-0413-CONFIDENCE-TEXT: Raw response instrumentation.
      // Alpha now outputs confidence_tier (text) not trade_confidence (integer).
      // Detect: (1) Alpha reverting to a numeric confidence field (schema violation),
      //         (2) Alpha outputting an unrecognized tier string,
      //         (3) short token counts indicating degenerate anchoring behavior.
      try {
        const rawTierMatch = content.match(/"confidence_tier"\s*:\s*"([^"]+)"/);
        const rawNumericConfidenceMatch = content.match(/"trade_confidence"\s*:\s*(\d+)/);
        const rawActionMatch = content.match(/"action"\s*:\s*"([^"]+)"/);
        const cachedTokens = (response.usage as any)?.prompt_tokens_details?.cached_tokens ?? 'unknown';
        const totalPromptTokens = response.usage?.prompt_tokens ?? 'unknown';
        const cacheHitPct = typeof cachedTokens === 'number' && typeof totalPromptTokens === 'number' && totalPromptTokens > 0
          ? Math.round((cachedTokens / totalPromptTokens) * 100)
          : 'unknown';
        const completionTokens = response.usage?.completion_tokens ?? 'unknown';
        const rawTier = rawTierMatch?.[1];
        const rawAction = rawActionMatch?.[1];
        const initialFinishReason = response.choices[0]?.finish_reason ?? 'unknown';
        console.log(
          `[Alpha Raw Response] symbol=${marketContext.symbol} action=${rawAction ?? 'MISSING'} ` +
          `confidence_tier=${rawTier ?? 'MISSING'} finish_reason=${initialFinishReason} ` +
          `cache=${cacheHitPct}% (${cachedTokens}/${totalPromptTokens} tokens cached) ` +
          `completion_tokens=${completionTokens}`
        );
        // CCIP-CACHE-BUST-ALARM-2026-04-15: If cache hit > 5% on an alpha_coordination call,
        // the transport-layer fingerprint is not working. This is the leading indicator of
        // degenerate abbreviated completions. Fire a high-severity alarm immediately so it
        // is impossible to miss in logs. The fingerprint is injected in openai-client.ts
        // injectCacheBustFingerprint() — investigate there if this alarm fires.
        if (typeof cacheHitPct === 'number' && cacheHitPct > 5) {
          console.error(
            `[Alpha CACHE ALARM] DEGENERATE SCAN RISK: symbol=${marketContext.symbol} ` +
            `cache_hit=${cacheHitPct}% (${cachedTokens}/${totalPromptTokens} tokens). ` +
            `The transport-layer cache-bust fingerprint (openai-client.ts injectCacheBustFingerprint) ` +
            `is not defeating OpenAI's KV-prefix cache. Completion tokens=${completionTokens}. ` +
            `Abbreviated degenerate outputs are likely. Investigate immediately.`
          );
        }
        if (rawNumericConfidenceMatch && !rawTierMatch) {
          console.warn(
            `[Alpha Raw Response] CCIP-2026-0413 SCHEMA_VIOLATION: Alpha output a numeric trade_confidence=${rawNumericConfidenceMatch[1]} ` +
            `instead of confidence_tier text for ${marketContext.symbol}. ` +
            `This means the model is ignoring the prompt schema update. ` +
            `Cache hit=${cacheHitPct}%. completion_tokens=${completionTokens}. ` +
            `Check prompt cache staleness — prompt may need a cache-busting change.`
          );
        }
        if (rawTier && !VALID_CONFIDENCE_TIERS.has(rawTier)) {
          console.warn(
            `[Alpha Raw Response] CCIP-2026-0413 UNRECOGNIZED_TIER: Alpha output confidence_tier="${rawTier}" ` +
            `for ${marketContext.symbol} — not a valid tier. Valid: ${[...VALID_CONFIDENCE_TIERS].join(', ')}. ` +
            `Will resolve to confidence=0 (system failure bucket). completion_tokens=${completionTokens}.`
          );
        }

        // CCIP-DEGENERATE-FIX-2026-04-14 v2: Expanded degenerate gate.
        //
        // ORIGINAL GATE: fired only when completion_tokens < 600 AND action === NO_TRADE.
        // PROBLEM: the gate was also triggering on genuine short NO_TRADE responses and
        // missing truncations on BUY/SELL responses where finish_reason=length cut the JSON.
        //
        // NEW GATE (two independent triggers):
        //   1. Token floor: completion_tokens < 600 AND action === NO_TRADE
        //      (same as before — abbreviated NO_TRADE is always degenerate)
        //   2. Incomplete finish: finish_reason !== 'stop' AND finish_reason !== 'length'
        //      (finish_reason=null or unknown means the response was aborted mid-stream)
        //      Note: finish_reason='length' is handled separately by the TOKEN_BUDGET_EXCEEDED gate below.
        //
        // ROOT CAUSE OF PERSISTENT FAILURE (2026-04-14):
        //   The `max_tokens` parameter is deprecated for gpt-4o. OpenAI now requires
        //   `max_completion_tokens`. Sending only `max_tokens` causes gpt-4o to default
        //   to a much lower internal ceiling (~256 tokens), which is why ALL symbols
        //   return ~225-247 tokens regardless of the requested 2000-token budget.
        //   FIX: The Netlify function now sends BOTH max_completion_tokens AND max_tokens.
        //   This gate remains as a safety net to catch any future infrastructure failures.
        // CCIP-DEGENERATE-FIX-2026-04-15 v3: Content-based degenerate detection for NO_TRADE.
        //
        // PROBLEM WITH v2: The 600-token floor for NO_TRADE was triggering on genuine Alpha NO_TRADE
        // responses (200-350 tokens is normal for a well-reasoned "no setup today"). Every real
        // NO_TRADE was being retried unnecessarily, causing GPT-4o rate limit pressure and
        // misclassifying good Alpha judgment as infrastructure failure.
        //
        // NEW APPROACH: For NO_TRADE, validate by content (does it have substance?).
        //   - Genuine NO_TRADE: has no_trade_statement ≥50 chars OR reasoning ≥60 chars OR directional_lean present
        //   - Degenerate NO_TRADE: < 200 tokens AND fails all content checks (empty stub)
        // For BUY/SELL: keep 600-token floor (abbreviated BUY/SELL is still always degenerate)
        let isShortNoTrade = false;
        const isNoTradeResponse = rawAction === 'NO_TRADE';
        if (isNoTradeResponse && typeof completionTokens === 'number') {
          let rawParsed: any = null;
          try { rawParsed = JSON.parse(content.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')); } catch { /* ok */ }
          const noTradeStatement: string = rawParsed?.no_trade_statement ?? '';
          const reasoningText: string = rawParsed?.reasoning ?? rawParsed?.no_trade_reasoning ?? '';
          const hasLean = rawParsed?.directional_lean && rawParsed.directional_lean !== 'NEUTRAL';
          const hasSubstantiveStatement = noTradeStatement.trim().length >= 50;
          const hasSubstantiveReasoning = reasoningText.trim().length >= 60;
          const looksGenuine = hasSubstantiveStatement || hasSubstantiveReasoning || hasLean;
          isShortNoTrade = completionTokens < 200 && !looksGenuine;
          if (!isShortNoTrade && completionTokens < 600) {
            console.log(`[Alpha Raw Response] CCIP-DEGENERATE v3: NO_TRADE for ${marketContext.symbol} has ${completionTokens} tokens — content-based validation PASSED (genuine). Skipping retry.`);
          }
        } else if (!isNoTradeResponse && typeof completionTokens === 'number') {
          isShortNoTrade = completionTokens < 600;
        }
        const isIncompleteFinish = initialFinishReason !== 'stop' && initialFinishReason !== 'length' && initialFinishReason !== 'unknown';

        if (isShortNoTrade || isIncompleteFinish) {
          const degenerateReason = isShortNoTrade
            ? (isNoTradeResponse
                ? `completion_tokens=${completionTokens} below 200-token floor AND content is stub (NO_TRADE)`
                : `completion_tokens=${completionTokens} below 600-token genuine-scan floor (BUY/SELL)`)
            : `finish_reason=${initialFinishReason} indicates aborted/incomplete response`;
          console.warn(
            `[Alpha Raw Response] CCIP-DEGENERATE DETECTED: ${degenerateReason} ` +
            `for ${marketContext.symbol}. Auto-retrying with escalated fingerprint.`
          );

          const retryLabel = `RETRY:1|NONCE:${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
          try {
            const retryResponse = await openAIClient.chat(buildAlphaMessages(retryLabel), alphaCallOptions);
            const retryCompletionTokens = retryResponse.usage?.completion_tokens ?? 0;
            const retryFinishReason = retryResponse.choices[0]?.finish_reason ?? 'unknown';
            const retryContent = retryResponse.choices[0]?.message?.content || '{}';
            const retryAction = retryContent.match(/"action"\s*:\s*"([^"]+)"/)?.[1];

            console.log(
              `[Alpha Raw Response] CCIP-DEGENERATE RETRY_RESULT: symbol=${marketContext.symbol} ` +
              `completion_tokens=${retryCompletionTokens} finish_reason=${retryFinishReason} action=${retryAction ?? 'MISSING'}`
            );

            let retryIsGenuine = retryFinishReason === 'stop';
            if (retryIsGenuine && retryAction === 'NO_TRADE') {
              let retryParsed: any = null;
              try { retryParsed = JSON.parse(retryContent.replace(/\/\/[^\n]*/g, '')); } catch { /* ok */ }
              const retryStatement: string = retryParsed?.no_trade_statement ?? '';
              const retryReasoning: string = retryParsed?.reasoning ?? retryParsed?.no_trade_reasoning ?? '';
              const retryLooksGenuine = retryStatement.trim().length >= 50 || retryReasoning.trim().length >= 60 || retryParsed?.directional_lean;
              retryIsGenuine = retryCompletionTokens >= 200 || retryLooksGenuine;
            } else if (retryIsGenuine && retryAction !== 'NO_TRADE') {
              retryIsGenuine = retryCompletionTokens >= 600;
            }
            if (retryIsGenuine) {
              console.log(`[Alpha Raw Response] CCIP-DEGENERATE RETRY_SUCCESS: Genuine scan recovered for ${marketContext.symbol} (${retryCompletionTokens} tokens, finish_reason=stop)`);
              response = retryResponse;
            } else {
              console.error(
                `[Alpha Raw Response] CCIP-DEGENERATE SCAN_FAILURE: Retry also produced degenerate output ` +
                `(${retryCompletionTokens} tokens, finish_reason=${retryFinishReason}) for ${marketContext.symbol}. ` +
                `Returning SCAN_FAILURE to prevent false NO_TRADE from suppressing live opportunities.`
              );
              return {
                action: 'NO_TRADE',
                decision: 'NO_TRADE',
                block_reason: 'SCAN_FAILURE_DEGENERATE_COMPLETION',
                entry: marketContext.price,
                stopLoss: marketContext.price,
                takeProfit: marketContext.price,
                confidence: 0,
                reasoning: `SCAN_FAILURE: Alpha returned abbreviated reasoning on both the initial scan and the retry for ${marketContext.symbol}. ` +
                  `Initial: ${completionTokens} tokens, finish_reason=${initialFinishReason}. ` +
                  `Retry: ${retryCompletionTokens} tokens, finish_reason=${retryFinishReason}. ` +
                  `This is an infrastructure failure — the LLM is not performing genuine analysis. ` +
                  `This is NOT a market decision. The scan should be retried on the next cycle.`,
                omega_summary: '',
                risk_pct: 0,
                decision_origin: 'SYSTEM_DEGENERATE' as const,
              };
            }
          } catch (retryErr) {
            console.error(`[Alpha Raw Response] CCIP-DEGENERATE RETRY_ERROR: Retry call failed for ${marketContext.symbol}:`, retryErr);
          }
        }
      } catch {
        // Non-fatal — raw log instrumentation must never block decision flow
      }

      // CCIP (2026-03-06): Detect response truncation — if finish_reason is 'length',
      // the LLM was cut off before completing its JSON. stopLoss and takeProfit appear
      // at the END of the response schema and are the first fields lost to truncation.
      // This is a prompt-compliance failure, not a market decision. Log it loudly and
      // abort rather than silently processing a structurally incomplete response.
      const finishReason = response.choices[0]?.finish_reason;
      if (finishReason === 'length') {
        console.error(`[Alpha Coordinator] TOKEN_BUDGET_EXCEEDED: Response truncated (finish_reason=length) for ${marketContext.symbol}/${styleName}. stopLoss/takeProfit are MISSING. Current max_tokens=3000 (gpt-4o, CCIP-2026-0502A). Raise budget if this fires repeatedly.`);
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
          risk_pct: 0,
          decision_origin: 'SYSTEM_TRUNCATED' as const,
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
          dualArenaWalls,
          entryMonitorActive
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
        } else if (!cachedThesis && marketThesisText && (parsedJSON.action === 'BUY' || parsedJSON.action === 'SELL')) {
          // CCIP-2026-0330-CACHE-SOVEREIGNTY: Only cache directional theses.
          // NO_TRADE decisions (action = 'NO_TRADE' or NEUTRAL directionBias) must NOT be cached.
          // A cached NEUTRAL thesis creates a self-reinforcing NO_TRADE cycle: on the next scan
          // Alpha sees the cached NEUTRAL thesis, validates against it, outputs NO_TRADE again.
          // Only BUY and SELL decisions carry a directional thesis worth caching for regime continuity.
          const directionBias = parsedJSON.action === 'BUY' ? 'BUY' : 'SELL';

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
              confidenceBand: (() => {
                const tierNum = parsedJSON.confidence_tier
                  ? (CONFIDENCE_TIER_TO_NUMBER[parsedJSON.confidence_tier as keyof typeof CONFIDENCE_TIER_TO_NUMBER] ?? 0)
                  : (parsedJSON.trade_confidence ?? 0);
                return tierNum > 70 ? 'strong' as const : tierNum > 50 ? 'medium' as const : 'weak' as const;
              })(),
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

      // CCIP-2026-0415: Response fingerprinting for GPT-4o KV-prefix cache contamination detection.
      // djb2 hash of (first 120 chars + last 80 chars + completion_tokens).
      // Identical fingerprints across different symbols in the same batch = cache hit, not independent analysis.
      let responseFingerprint: string | undefined;
      try {
        const rawContent = response.choices[0]?.message?.content || '';
        const tokens = response.usage?.completion_tokens ?? 0;
        const head = rawContent.substring(0, 120).replace(/\s+/g, ' ').trim();
        const tail = rawContent.substring(Math.max(0, rawContent.length - 80)).replace(/\s+/g, ' ').trim();
        const fingerprintSource = `${tokens}|${head}|${tail}`;
        let hash = 5381;
        for (let i = 0; i < fingerprintSource.length; i++) {
          hash = ((hash << 5) + hash) ^ fingerprintSource.charCodeAt(i);
          hash = hash >>> 0;
        }
        responseFingerprint = hash.toString(16).padStart(8, '0');
      } catch { /* Non-fatal */ }

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
        dualArenaWalls,
        entryMonitorActive
      );

      if (responseFingerprint) {
        decision.response_fingerprint = responseFingerprint;
      }

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
      if (regimeResult) {
        decision.microRegime = regimeResult;
      }
      if (sweepFacts && sweepFacts.sweep_detected) {
        decision.sweepFacts = sweepFacts;
      }

      // CCIP-2026-0324C: liquidity_sweep_read omission detector.
      // Placed here (in coordinate) because sweepFacts is only in scope in this method.
      // parseDecision() previously referenced sweepFacts as an undefined variable, causing
      // a ReferenceError caught by its outer try/catch and surfaced as a misleading
      // "Parse error: sweepFacts is not defined" console error on every scan.
      // Action: advisory violation only. Trade is NOT blocked.
      if (
        sweepFacts != null &&
        sweepFacts.sweep_detected &&
        decision.answer_sheet &&
        (!decision.answer_sheet.liquidity_sweep_read ||
          decision.answer_sheet.liquidity_sweep_read.trim() === '' ||
          decision.answer_sheet.liquidity_sweep_read.toUpperCase() === 'NONE')
      ) {
        logViolation({
          violationType: 'LIQUIDITY_SWEEP_READ_OMITTED',
          symbol: marketContext.symbol,
          attemptedOperation: 'answer_sheet_validation',
          callLocation: 'coordinator-alpha/coordinate',
          blocked: false,
          errorDetails: {
            sweep_type: sweepFacts.sweep_type,
            has_bos: sweepFacts.has_bos,
            userId: userId || 'unknown',
          },
        }).catch(() => {});
        console.warn(
          `[Alpha Coordinator] CCIP-2026-0324C: LIQUIDITY_SWEEP_READ_OMITTED — sweep data was present ` +
          `(type=${sweepFacts.sweep_type}, BOS=${sweepFacts.has_bos}) but liquidity_sweep_read is absent. ` +
          `Symbol=${marketContext.symbol}.`
        );
      }

      // Note: narrativeValidation is already set by parseDecision()

      // CCIP-2026-0325A: Q12 market phase omission audit.
      // Advisory violation only — trade is NOT blocked. Logged for governance audit trail.
      if (
        decision.answer_sheet &&
        (!decision.answer_sheet.Q12_market_phase ||
          decision.answer_sheet.Q12_market_phase.trim() === '')
      ) {
        logViolation({
          violationType: 'Q12_MARKET_PHASE_OMITTED',
          symbol: marketContext.symbol,
          attemptedOperation: 'answer_sheet_validation',
          callLocation: 'coordinator-alpha/coordinate',
          blocked: false,
          errorDetails: { userId: userId || 'unknown' },
        }).catch(() => {});
        console.warn(
          `[Alpha Coordinator] CCIP-2026-0325A: Q12_MARKET_PHASE_OMITTED — ` +
          `Symbol=${marketContext.symbol}, Action=${decision.action}.`
        );
      }

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
            omega9_validation: validation,
            decision_origin: 'ALPHA_BLOCKED_SURVIVAL' as const,
            alpha_original_decision: decision.action !== 'NO_TRADE' ? {
              action: decision.action as 'BUY' | 'SELL',
              entry: decision.entry ?? marketContext.price,
              stopLoss: decision.stopLoss ?? marketContext.price,
              takeProfit: decision.takeProfit ?? marketContext.price,
              confidence: decision.confidence,
              entry_mode: decision.entry_mode,
              reasoning: decision.reasoning,
            } : undefined,
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

      // ─── NO_TRADE AUDIT LOG (CCIP-2026-0422B) ───────────────────────────────
      // Surfaces Alpha's full structured reasoning for every NO_TRADE so it can
      // be audited in the console without querying the database. This is the
      // single most important diagnostic log — it reveals WHY Alpha passed.
      if (decision.action === 'NO_TRADE') {
        const auditNoTradeStatement: string = (decision as any).no_trade_statement || '';
        const auditConfidenceTier: string = (decision as any).confidence_tier || 'unknown';
        const auditDirectionalLean: string = (decision as any).directional_lean || 'NEUTRAL';
        const auditLeanConfidence: number = (decision as any).lean_confidence || 0;
        const auditBlockReason: string = (decision as any).block_reason || 'none';

        // Parse answer_sheet fields from the raw parsed response for audit visibility
        let auditSweepReclaimStatus = 'NOT_IN_RESPONSE';
        let auditQTrappedFuel = 'NOT_IN_RESPONSE';
        let auditQ12Phase = 'NOT_IN_RESPONSE';
        let auditQPricedIn = 'NOT_IN_RESPONSE';
        let auditQ4B = 'NOT_IN_RESPONSE';
        let auditSessionSweepStatus = 'NOT_IN_RESPONSE';
        try {
          const rawParsed = (decision as any)._rawParsed;
          if (rawParsed) {
            // NO_TRADE JSON is flat — answer_sheet only exists in BUY/SELL responses.
            // Read top-level first (NO_TRADE path), fall back to answer_sheet (BUY/SELL path).
            const src = rawParsed.answer_sheet ?? rawParsed;
            auditSweepReclaimStatus = src.Q_SWEEP_RECLAIM_STATUS || 'NOT_PRESENT';
            auditQTrappedFuel = src.Q_TRAPPED_FUEL || 'NOT_PRESENT';
            auditQ12Phase = src.Q12 || 'NOT_PRESENT';
            auditQPricedIn = src.Q_PRICED_IN || 'NOT_PRESENT';
            auditQ4B = src.Q4B_realtime_participant_read || 'NOT_PRESENT';
            auditSessionSweepStatus = src.session_sweep_status || 'NOT_PRESENT';
          }
        } catch { /* rawParsed unavailable */ }

        console.log(
          `[Alpha NO_TRADE AUDIT] ════════════════════════════════════════\n` +
          `  Symbol:              ${marketContext.symbol}\n` +
          `  Confidence Tier:     ${auditConfidenceTier}\n` +
          `  Directional Lean:    ${auditDirectionalLean} (lean_confidence: ${auditLeanConfidence})\n` +
          `  Block Reason:        ${auditBlockReason}\n` +
          `  Q12 Phase:           ${auditQ12Phase}\n` +
          `  Session Sweep:       ${auditSessionSweepStatus}\n` +
          `  Q_SWEEP_RECLAIM:     ${auditSweepReclaimStatus}\n` +
          `  Q_TRAPPED_FUEL:      ${auditQTrappedFuel}\n` +
          `  Q_PRICED_IN:         ${auditQPricedIn}\n` +
          `  Q4B Participant:     ${auditQ4B}\n` +
          `  No-Trade Statement:\n    ${(auditNoTradeStatement || '(MISSING — governance violation)').replace(/\n/g, '\n    ')}\n` +
          `════════════════════════════════════════════════════════════════`
        );
      }
      // ─────────────────────────────────────────────────────────────────────────

      // CCIP-2026-0333: Fail-loud governance for missing/generic no_trade_statement.
      // Alpha's output is the sole authority. If Alpha did not produce a substantive
      // no_trade_statement, the audit trail persists NULL — the system never invents text.
      if (decision.action === 'NO_TRADE') {
        const noTradeStatement: string = (decision as any).no_trade_statement || '';
        const wordCount = noTradeStatement.trim().split(/\s+/).filter(Boolean).length;
        const isGenericPhrase = !noTradeStatement ||
          wordCount < 60 ||
          /^(ranging|no clear|low volatility|uncertain|choppy|unclear|sideways|no edge|insufficient)/i.test(noTradeStatement.trim());

        // CCIP-2026-0422C: When Alpha has a directional lean, vague deferrals are governance violations.
        const directionalLean = (decision as any).directional_lean;
        const leanConfidence = (decision as any).lean_confidence || 0;
        const hasLean = (directionalLean === 'BUY_LEAN' || directionalLean === 'SELL_LEAN') && leanConfidence > 0;
        const hasVagueDeferral = hasLean && noTradeStatement &&
          /wait.{0,20}(till|until|for).{0,20}(next|another).{0,20}(cycle|scan)|check back later/i.test(noTradeStatement);
        if (hasVagueDeferral) {
          console.warn(
            `[CCIP-2026-0422C] DIRECTIONAL_LEAN_WITHOUT_PRICE_ZONE — ` +
            `Alpha has ${directionalLean} (lean_confidence: ${leanConfidence}) but used a vague deferral phrase. ` +
            `no_trade_statement must name a specific price level and trigger event. ` +
            `Symbol=${marketContext.symbol}. Governance violation logged.`
          );
          logViolation({
            violationType: 'DIRECTIONAL_LEAN_WITHOUT_PRICE_ZONE',
            symbol: marketContext.symbol,
            attemptedOperation: 'no_trade_governance_check',
            callLocation: 'coordinator-alpha.no_trade_governance',
            blocked: false,
            errorDetails: {
              directional_lean: directionalLean,
              lean_confidence: leanConfidence,
              no_trade_statement_snippet: noTradeStatement?.slice(0, 200) || null,
              sessionId: goalContext?.sessionId || null,
            }
          }).catch(() => {});
        }

        if (isGenericPhrase) {
          // CCIP-2026-0333: Do NOT synthesise a fallback. Persist NULL and log the violation.
          // The audit trail must reflect Alpha's actual failure, not a system-invented substitute.
          (decision as any).no_trade_statement = null;

          logViolation({
            violationType: 'NO_TRADE_STATEMENT_MISSING_OR_GENERIC',
            symbol: marketContext.symbol,
            attemptedOperation: 'no_trade_governance_check',
            callLocation: 'coordinator-alpha.no_trade_governance',
            blocked: false,
            errorDetails: {
              no_trade_statement_original: noTradeStatement || null,
              confidence: decision.confidence,
              block_reason: (decision as any).block_reason || null,
              sessionId: goalContext?.sessionId || null,
              userId: userId || null,
            }
          }).catch(() => {});
          console.warn(
            `[CCIP-2026-0333] NO_TRADE_STATEMENT_MISSING_OR_GENERIC — ` +
            `Alpha produced NO_TRADE without a substantive structural explanation. ` +
            `Symbol=${marketContext.symbol}, confidence=${decision.confidence}. ` +
            `Persisting NULL. Governance violation logged.`
          );
        }
      }

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
            regimeResult?.type === 'classified' ? regimeResult.regime : undefined
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
        omega_summary: 'Error in coordination',
        decision_origin: 'SYSTEM_NETWORK_FAILURE' as const,
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
    tradeStyle: 'MICRO_INTRADAY' = 'MICRO_INTRADAY', // CCIP-2026-0427E-STYLE-CONSOLIDATION
    dualArenaWalls?: DualArenaWalls | null,
    entryMonitorActive: boolean = true
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

      // CCIP-2026-0333: action is NON-NEGOTIABLE. Alpha must always return BUY, SELL, or NO_TRADE.
      // A missing action is a prompt compliance failure — fail loudly.
      if (!parsed.action) {
        console.error(`[CCIP-2026-0333] MISSING_ACTION — Alpha returned a valid JSON response for ${marketContext?.symbol} but omitted the action field entirely. Prompt compliance failure.`);
        throw new Error(`[CCIP-2026-0333] Alpha response missing required 'action' field. Prompt compliance failure.`);
      }
      let action = parsed.action;
      if (!['BUY', 'SELL', 'NO_TRADE'].includes(action)) {
        console.error(`[CCIP-2026-0333] INVALID_ACTION "${action}" — Alpha returned an unrecognised action for ${marketContext?.symbol}. Expected BUY | SELL | NO_TRADE. Prompt compliance failure.`);
        throw new Error(`[CCIP-2026-0333] Alpha returned invalid action "${action}". Expected BUY | SELL | NO_TRADE.`);
      }

      // CCIP-2026-0413-CONFIDENCE-TEXT: Confidence conversion boundary.
      // Alpha outputs confidence_tier (text). Convert to numeric for all downstream consumers.
      // Alpha never sees numbers — the tier-to-number mapping is internal only.
      const rawTier = parsed.confidence_tier as string | undefined;
      const confidenceTier = rawTier && VALID_CONFIDENCE_TIERS.has(rawTier) ? rawTier : null;
      const tradeConfidence = confidenceTier
        ? tierToNumber(confidenceTier)
        : (parsed.trade_confidence ?? parsed.confidence ?? 0);

      // CCIP-2026-0413: Post-parse confidence log.
      console.log(
        `[Alpha Parse] symbol=${symbol} action=${parsed.action} ` +
        `confidence_tier=${rawTier ?? 'MISSING'} ` +
        `resolved_numeric=${tradeConfidence}` +
        (confidenceTier ? '' : ` (LEGACY_FALLBACK: raw.trade_confidence=${parsed.trade_confidence ?? 'MISSING'})`)
      );

      // CCIP-2026-0413: Detect schema violation — Alpha output a number instead of a tier.
      if (!rawTier && (parsed.trade_confidence != null || parsed.confidence != null)) {
        console.warn(
          `[Alpha Parse] CCIP-2026-0413 SCHEMA_VIOLATION for ${symbol}: ` +
          `Alpha omitted confidence_tier and fell back to numeric confidence=${parsed.trade_confidence ?? parsed.confidence}. ` +
          `The prompt schema requires confidence_tier text. ` +
          `This may indicate the model is using a stale cached prompt. Check completion_tokens in [Alpha Raw Response] log.`
        );
      }

      // CCIP-2026-0413: Detect unrecognized tier string — Alpha invented a word.
      if (rawTier && !VALID_CONFIDENCE_TIERS.has(rawTier)) {
        console.warn(
          `[Alpha Parse] CCIP-2026-0413 UNRECOGNIZED_TIER for ${symbol}: ` +
          `Alpha returned confidence_tier="${rawTier}" which is not in the valid tier set. ` +
          `Resolving to confidence=0 (system failure bucket). ` +
          `Valid tiers: ${[...VALID_CONFIDENCE_TIERS].join(', ')}.`
        );
      }

      // CCIP-2026-0422H: Alpha sovereignty — no rescue, no conversion, no sentinel injection.
      //
      // Alpha follows a sequential decision process:
      //   1. Can I execute NOW?       → BUY/SELL + execute_now
      //   2. Can I set a wait intent? → BUY/SELL + wait_pullback/push_confirmation
      //   3. Only if BOTH fail        → NO_TRADE
      //
      // Alpha's decision stands unmodified. NO_TRADE stays NO_TRADE.
      // BUY/SELL passes through with Alpha's own entry/stopLoss/takeProfit.
      // Omega-9 is the only authority that may block a trade, and only when the
      // geometry Alpha supplied is mathematically impossible.
      //
      // If Alpha repeatedly returns NO_TRADE when a deferred setup is obvious, the fix
      // is in alpha-identity.ts (improve reasoning), not here (fabricate a trade).

      const entryQualityScore = parsed.entry_quality_score ?? 0;
      // CCIP-2026-0319A (Fix 2): entry_mode is only valid for BUY/SELL decisions.
      // CCIP-2026-0333: entry_mode is a routing decision (immediate vs. monitored).
      // Alpha must explicitly declare execution intent for BUY/SELL.
      // If Alpha omits entry_mode, this is a prompt compliance failure — block the trade.
      // For NO_TRADE, strip any hallucinated entry_mode to undefined.
      // CCIP-2026-0323A: let (not const) — Q10 FORCED guard may correct execute_now → wait_pullback
      let entryMode: string | undefined;
      // Re-read action after CCIP-2026-0415A corrections above
      const correctedAction = (parsed.action as string | undefined) ?? action;
      if (correctedAction !== action) {
        // 0415A changed the action — update the local binding so all downstream
        // code (entry_mode parse, NO_TRADE early-return, trade object assembly) sees the correction.
        (parsed as Record<string, unknown>).action = correctedAction;
      }
      if (correctedAction === 'NO_TRADE') {
        entryMode = undefined;
      } else if (!parsed.entry_mode && !parsed.entry_spec?.entry_mode) {
        // CCIP-2026-0428A: Alpha omitted entry_mode — was previously a hard block (ALPHA_BLOCKED_COMPLIANCE).
        // Changed to advisory + default to execute_now. The intent is clear from action=BUY/SELL;
        // blocking the trade silently discards a valid Alpha decision.
        logViolation({
          violationType: 'MISSING_ENTRY_MODE',
          symbol: marketContext.symbol,
          attemptedOperation: 'entry_mode_governance_check',
          callLocation: 'coordinator-alpha.entry_mode_governance',
          blocked: false,
          errorDetails: {
            action,
            tradeStyle,
            confidence: tradeConfidence,
            sessionId: goalContext?.sessionId ?? null,
            userId: userId ?? null,
          }
        }).catch(() => {});
        console.warn(
          `[CCIP-2026-0428A] MISSING_ENTRY_MODE — Alpha returned ${correctedAction} for ${marketContext.symbol} without entry_mode. ` +
          `Defaulting to execute_now (was: hard block). Violation logged.`
        );
        entryMode = 'execute_now';
      } else {
        entryMode = parsed.entry_mode ?? parsed.entry_spec?.entry_mode;
      }

      // CCIP-2026-0505G: Answer Sheet Is The Source Of Truth.
      // Alpha's structured entry_mode field and his prose answer-sheet fields are
      // authored by the same LLM in one pass and occasionally drift. When the prose
      // says "wait" but the structured field says "execute_now", execution previously
      // ignored the prose. This reconciliation reads Alpha's own stated intent from
      // the prose and downgrades execute_now to match it. This is not a constraint
      // on Alpha — it is obedience to what Alpha already wrote.
      if (correctedAction !== 'NO_TRADE' && entryMode === 'execute_now') {
        const answerSheet = parsed.answer_sheet ?? {};
        const proseFields = [
          answerSheet.Q_SWEEP_RECLAIM_STATUS,
          answerSheet.Q6_entry_trigger,
          answerSheet.Q_WHAT_DIRECTION_WHEN_THEY_RUN,
          (parsed as Record<string, unknown>).Q_SWEEP_RECLAIM_STATUS,
          (parsed as Record<string, unknown>).Q6_entry_trigger,
        ]
          .filter((v): v is string => typeof v === 'string' && v.length > 0)
          .map(s => s.toLowerCase());

        const proseBlob = proseFields.join(' | ');
        let reconciledTo: 'wait_pullback' | 'push_confirmation' | null = null;
        let trigger: string | null = null;

        if (proseBlob.includes('push_confirmation') || proseBlob.includes('push confirmation')) {
          reconciledTo = 'push_confirmation';
          trigger = 'push_confirmation token in prose';
        } else if (
          proseBlob.includes('wait_pullback') ||
          proseBlob.includes('wait pullback') ||
          proseBlob.includes('watching for reclaim') ||
          proseBlob.includes('no reclaim') ||
          proseBlob.includes('none_yet') ||
          proseBlob.includes('pending')
        ) {
          reconciledTo = 'wait_pullback';
          trigger = 'wait/pending/NONE_YET token in prose';
        }

        if (reconciledTo) {
          logViolation({
            violationType: 'ANSWER_SHEET_RECONCILIATION',
            symbol: marketContext.symbol,
            attemptedOperation: 'ccip_2026_0505g_entry_mode_reconciliation',
            callLocation: 'coordinator-alpha.answer_sheet_reconciliation',
            blocked: false,
            errorDetails: {
              ccip: 'CCIP-2026-0505G',
              original_entry_mode: 'execute_now',
              reconciled_to: reconciledTo,
              trigger,
              prose_sample: proseBlob.slice(0, 500),
              action: correctedAction,
              sessionId: goalContext?.sessionId ?? null,
              userId: userId ?? null,
            }
          }).catch(() => {});
          console.warn(
            `[CCIP-2026-0505G] ANSWER_SHEET_RECONCILIATION — ${marketContext.symbol} ${correctedAction}: ` +
            `Alpha emitted entry_mode=execute_now but prose said "${trigger}". ` +
            `Downgrading execute_now → ${reconciledTo}. Obeying Alpha's stated intent.`
          );
          entryMode = reconciledTo;
        }
      }

      // CCIP-2026-0333: Structural anchor validation — fail-loud, no synthesis.
      // If Alpha omits the anchor field, log a governance violation and preserve Alpha's
      // output as-is. The system must never substitute a field Alpha did not provide.
      const isAnchorVague = (s: string | null | undefined): boolean =>
        !s || s.trim().length < 10 ||
        ['null', 'n/a', 'required', 'none'].some(bad => s.trim().toLowerCase().includes(bad));

      // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform — only MICRO_INTRADAY anchor check applies.
      if (action !== 'NO_TRADE') {
        const raw = typeof parsed.m5_structural_confirmation === 'string'
          ? parsed.m5_structural_confirmation.trim()
          : null;
        if (isAnchorVague(raw)) {
          logViolation({
            violationType: 'MISSING_STRUCTURAL_ANCHOR',
            symbol: marketContext.symbol,
            attemptedOperation: 'micro_intraday_anchor_check',
            callLocation: 'coordinator-alpha.micro_intraday_anchor_governance',
            blocked: false,
            errorDetails: { style: 'MICRO_INTRADAY', field: 'm5_structural_confirmation', value: raw ?? null, sessionId: goalContext?.sessionId ?? null }
          }).catch(() => {});
          console.warn(`[CCIP-2026-0333] MICRO_INTRADAY_NO_M5_ANCHOR: Alpha omitted m5_structural_confirmation for ${marketContext.symbol}. Proceeding on Alpha confidence — violation logged.`);
        }
      }

      // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform — MICRO_INTRADAY uses TP1 + TP2 (multi-TP).
      const isMultiTpStyle = true;
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
        // CCIP-2026-0325A: Q12 market phase — mandatory field. Extracted for audit and learning.
        // Missing = governance violation (logged below, not a trade block).
        Q12_market_phase: typeof rawAnswerSheet.Q12_market_phase === 'string'
          ? rawAnswerSheet.Q12_market_phase
          : undefined,
        // CCIP-2026-0325A: Session boundary prices — named prices Alpha reasoned from.
        // Accept number, null, or string "UNKNOWN". Silently drop if not present.
        session_high: (rawAnswerSheet.session_high !== undefined && rawAnswerSheet.session_high !== '')
          ? rawAnswerSheet.session_high
          : undefined,
        session_low: (rawAnswerSheet.session_low !== undefined && rawAnswerSheet.session_low !== '')
          ? rawAnswerSheet.session_low
          : undefined,
        prior_session_high: (rawAnswerSheet.prior_session_high !== undefined && rawAnswerSheet.prior_session_high !== '')
          ? rawAnswerSheet.prior_session_high
          : undefined,
        prior_session_low: (rawAnswerSheet.prior_session_low !== undefined && rawAnswerSheet.prior_session_low !== '')
          ? rawAnswerSheet.prior_session_low
          : undefined,
        // CCIP-2026-0325A: session_sweep_status — mandatory for London/NY forex sessions.
        // Extracted for audit trail. No code-layer hard gate — prompt-level enforcement.
        session_sweep_status: typeof rawAnswerSheet.session_sweep_status === 'string'
          ? rawAnswerSheet.session_sweep_status
          : undefined,
        // CCIP-2026-0422B: Sweep-reclaim lifecycle fields — previously extracted for audit logging
        // only (discarded after the console.log block). Now preserved in the structured object so
        // the CCIP-0422B-GATE upgrade logic and downstream consumers can use them.
        Q_SWEEP_RECLAIM_STATUS: typeof rawAnswerSheet.Q_SWEEP_RECLAIM_STATUS === 'string'
          ? rawAnswerSheet.Q_SWEEP_RECLAIM_STATUS
          : undefined,
        Q_TRAPPED_FUEL: typeof rawAnswerSheet.Q_TRAPPED_FUEL === 'string'
          ? rawAnswerSheet.Q_TRAPPED_FUEL
          : undefined,
        Q4B_realtime_participant_read: typeof rawAnswerSheet.Q4B_realtime_participant_read === 'string'
          ? rawAnswerSheet.Q4B_realtime_participant_read
          : undefined,
        Q_PRICED_IN: typeof rawAnswerSheet.Q_PRICED_IN === 'string'
          ? rawAnswerSheet.Q_PRICED_IN
          : undefined,
        Q_LIQUIDITY_CASCADE: typeof rawAnswerSheet.Q_LIQUIDITY_CASCADE === 'string'
          ? rawAnswerSheet.Q_LIQUIDITY_CASCADE
          : undefined,
        Q_WHO_IS_TRAPPED: typeof rawAnswerSheet.Q_WHO_IS_TRAPPED === 'string'
          ? rawAnswerSheet.Q_WHO_IS_TRAPPED
          : undefined,
        Q_WHAT_DIRECTION_WHEN_THEY_RUN: typeof rawAnswerSheet.Q_WHAT_DIRECTION_WHEN_THEY_RUN === 'string'
          ? rawAnswerSheet.Q_WHAT_DIRECTION_WHEN_THEY_RUN
          : undefined,
      } : undefined;

      // CCIP-2026-0404A: Enum fallback logging for answer_sheet fields.
      // When Alpha returns a value that doesn't match the expected enum, the field silently
      // becomes undefined. This logs governance violations so we can detect prompt drift.
      if (rawAnswerSheet && typeof rawAnswerSheet === 'object') {
        const Q1_VALID = ['ALIGNED', 'CONFLICT', 'COUNTER_TREND'];
        if (rawAnswerSheet.Q1_trend_alignment && !Q1_VALID.includes(rawAnswerSheet.Q1_trend_alignment)) {
          console.warn(`[Alpha Coordinator] CCIP-2026-0404A: Q1_trend_alignment "${rawAnswerSheet.Q1_trend_alignment}" is not a valid enum value — answer_sheet field stored as-is.`);
        }
        const Q8C_VALID = ['DISCOUNT', 'EQUILIBRIUM', 'PREMIUM'];
        if (rawAnswerSheet.Q8C_price_location_zone && !Q8C_VALID.includes(rawAnswerSheet.Q8C_price_location_zone)) {
          console.warn(`[Alpha Coordinator] CCIP-2026-0404A: Q8C_price_location_zone "${rawAnswerSheet.Q8C_price_location_zone}" is not a valid enum value.`);
        }
        const Q8D_VALID = ['DELIVERY_BULLISH', 'DELIVERY_BEARISH', 'REBALANCING', 'UNCERTAIN'];
        if (rawAnswerSheet.Q8D_weekly_narrative && !Q8D_VALID.includes(rawAnswerSheet.Q8D_weekly_narrative)) {
          console.warn(`[Alpha Coordinator] CCIP-2026-0404A: Q8D_weekly_narrative "${rawAnswerSheet.Q8D_weekly_narrative}" is not a valid enum value.`);
        }
        const KILL_ZONE_VALID = ['LONDON_OPEN', 'NY_OPEN', 'NY_PM', 'PRE_KILL_ZONE', 'OUTSIDE_KILL_ZONE'];
        if (rawAnswerSheet.kill_zone && !KILL_ZONE_VALID.includes(rawAnswerSheet.kill_zone)) {
          console.warn(`[Alpha Coordinator] CCIP-2026-0404A: kill_zone "${rawAnswerSheet.kill_zone}" is not a valid enum value.`);
        }
        const NEWS_STATUS_VALID = ['HARD_BLACKOUT', 'POST_NEWS_VOLATILITY', 'TIER2_PROXIMITY', 'CLEAR', 'UNKNOWN'];
        if (rawAnswerSheet.news_status && !NEWS_STATUS_VALID.includes(rawAnswerSheet.news_status)) {
          console.warn(`[Alpha Coordinator] CCIP-2026-0404A: news_status "${rawAnswerSheet.news_status}" is not a valid enum value.`);
        }
        const IM_CORR_VALID = ['CONFLUENT', 'DIVERGENT', 'UNKNOWN'];
        if (rawAnswerSheet.intermarket_correlation && !IM_CORR_VALID.includes(rawAnswerSheet.intermarket_correlation)) {
          console.warn(`[Alpha Coordinator] CCIP-2026-0404A: intermarket_correlation "${rawAnswerSheet.intermarket_correlation}" is not a valid enum value.`);
        }
        const Q5B_VALID = ['SERVES', 'MARGINAL', 'DOES_NOT_SERVE'];
        if (rawAnswerSheet.Q5B_objective_alignment && !Q5B_VALID.includes(rawAnswerSheet.Q5B_objective_alignment)) {
          console.warn(`[Alpha Coordinator] CCIP-2026-0404A: Q5B_objective_alignment "${rawAnswerSheet.Q5B_objective_alignment}" is not a valid enum value.`);
        }
      }

      // CCIP-2026-0328B: Q10 and Q11 entry mode corrections REMOVED.
      // Alpha has full authority over entry_mode. Q10_entry_conviction=FORCED and
      // Q11_zone_entry_quality=DEEP_ZONE are audit observations that Alpha already
      // prices into his reasoning — code must not override his output.
      // If Alpha self-assessed FORCED or DEEP_ZONE and still chose execute_now,
      // that is his professional judgment and must stand as issued.
      // LEGITIMATE_BLOCK_CONDITIONS in alpha-identity.ts governs all hard stops.
      if ((action === 'BUY' || action === 'SELL') && answerSheet?.Q10_entry_conviction === 'FORCED' && entryMode === 'execute_now') {
        console.log(`[Alpha Coordinator] CCIP-2026-0328B: Q10=FORCED + execute_now — advisory observation logged. Alpha's entry_mode stands as issued. Symbol=${symbol}.`);
      }
      if ((action === 'BUY' || action === 'SELL') && answerSheet?.Q11_zone_entry_quality === 'DEEP_ZONE' && entryMode === 'execute_now') {
        console.log(`[Alpha Coordinator] CCIP-2026-0328B: Q11=DEEP_ZONE + execute_now — advisory observation logged. Alpha's entry_mode stands as issued. Symbol=${symbol}.`);
      }

      // CCIP-2026-0406A: resolvedEntryMode declared here (before CCIP-0402A block that references it).
      // Original declaration was at the wait_condition parse boundary (line ~4890), causing a
      // TDZ crash for any BUY/SELL decision: "Cannot access 'resolvedEntryMode' before initialization".
      // This killed the GBPUSD SELL at confidence=65 (confirmed by [Alpha Raw Response] diagnostics,
      // 2026-04-05 session). resolvedWaitCondition is kept at its original site because waitCondition
      // is not parsed until after the answer_sheet advisory blocks below.
      // SSOT: coordinator-alpha.ts is the sole parse boundary for entry_mode.
      let resolvedEntryMode = entryMode;

      // CCIP-2026-0402A: Q6=NONE_YET + execute_now consistency enforcement.
      //
      // Alpha's own prompt defines the rule:
      //   "The absence of a fired trigger supports wait_pullback or push_confirmation
      //    — it does not produce NO_TRADE."
      // The inverse is equally true: execute_now requires a fired trigger (Q6 named event).
      // If Alpha answers Q6=NONE_YET but sets entry_mode=execute_now, those two outputs
      // are internally contradictory. Alpha acknowledged no event has fired, yet routed
      // the trade as an immediate market order — exactly what happened on the USDJPY loss
      // (2026-04-02, trade 685d0c91) where price ran 25 pips against entry from tick 1.
      //
      // This is NOT an override of Alpha's trading judgment. Alpha self-documented the
      // absence of a trigger. We are enforcing his own stated rule, not ours.
      // The entry_mode is downgraded to wait_pullback. The thesis, direction, levels,
      // and confidence are left entirely intact. Alpha's trade will execute when the
      // entry monitor detects the trigger condition he implicitly needed.
      //
      // SSOT: coordinator-alpha.ts is the sole parse boundary for LLM output.
      // This correction must live here — not in the executor or live engine.
      if (
        (action === 'BUY' || action === 'SELL') &&
        answerSheet?.Q6_entry_trigger?.toUpperCase() === 'NONE_YET' &&
        resolvedEntryMode === 'execute_now'
      ) {
        console.warn(
          `[Alpha Coordinator] CCIP-2026-0402A: Q6=NONE_YET + execute_now CONFLICT detected. ` +
          `Alpha acknowledged no trigger has fired but selected immediate execution. ` +
          `Downgrading entry_mode from execute_now → wait_pullback per Alpha's own rule. ` +
          `Thesis/direction/levels/confidence unchanged. Symbol=${symbol}.`
        );
        resolvedEntryMode = 'wait_pullback';
        logViolation({
          violationType: 'Q6_NONE_YET_EXECUTE_NOW_CONFLICT',
          symbol: marketContext.symbol,
          attemptedOperation: 'execute_now_with_no_trigger',
          callLocation: 'coordinator-alpha',
          blocked: false,
          errorDetails: {
            q6_value: answerSheet?.Q6_entry_trigger,
            entry_mode_before: 'execute_now',
            entry_mode_after: 'wait_pullback',
            action,
            userId: userId || 'unknown',
            description: 'Alpha answered Q6=NONE_YET but set entry_mode=execute_now. Per Alpha\'s own rule, no trigger means deferred entry. entry_mode corrected to wait_pullback. Trade thesis and levels unchanged.',
            timestamp: new Date().toISOString(),
          },
        }).catch(() => {});
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
              symbol: marketContext.symbol,
              attemptedOperation: 'answer_sheet_validation',
              callLocation: 'coordinator-alpha/parseDecision',
              blocked: false,
              errorDetails: { q8d, action, userId: userId || 'unknown' },
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

      // CCIP-2026-0324C: Moved to coordinate() after parseDecision() returns,
      // where sweepFacts is in scope. See the check immediately after the
      // parseDecision() call in coordinate().

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
                symbol: marketContext.symbol,
                attemptedOperation: 'answer_sheet_validation',
                callLocation: 'coordinator-alpha/parseDecision',
                blocked: false,
                errorDetails: { q5Prob, confVal, gap, userId: userId || 'unknown' },
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

      // CCIP-2026-0328B: Wait condition synthesis and entry mode downgrade REMOVED.
      // Alpha has full authority over entry_mode and wait_condition. If Alpha chose
      // wait_pullback or push_confirmation without supplying a wait_condition zone,
      // that is his decision — he may have intend a market-order at the zone level
      // using his structural reference. Code must not synthesise zones or downgrade
      // his mode. The executor will handle a missing wait_condition gracefully.
      // SSOT: coordinator-alpha.ts passes Alpha's output as-is. No synthesis.
      let resolvedWaitCondition = waitCondition;

      if (resolvedWaitCondition) {
        console.log(
          `[Alpha Coordinator] wait_condition parsed: zone=${resolvedWaitCondition.target_entry_zone_min}–${resolvedWaitCondition.target_entry_zone_max} ` +
          `invalidation=${resolvedWaitCondition.invalidation_price} ` +
          `est_wait=${resolvedWaitCondition.expected_wait_minutes ?? 'unspecified'}min`
        );
      } else if (resolvedEntryMode === 'wait_pullback' || resolvedEntryMode === 'push_confirmation') {
        console.warn(
          `[Alpha Coordinator] CCIP-2026-0404A: entry_mode="${resolvedEntryMode}" without wait_condition — deferred entry has no monitoring zone. Executor will attempt zone inference from SL/TP geometry. Symbol=${symbol}.`
        );
        logViolation({
          violationType: 'WAIT_CONDITION_MISSING_ON_DEFERRED_ENTRY',
          symbol: symbol,
          attemptedOperation: 'deferred_entry_zone_validation',
          callLocation: 'coordinator-alpha.wait_condition_check',
          blocked: false,
          errorDetails: {
            entry_mode: resolvedEntryMode,
            sessionId: goalContext?.sessionId || null,
            userId: userId || null,
          }
        }).catch(() => {});
      }

      // CCIP-2026-0328A-SOVEREIGNTY: wait_pullback zone direction backstop REMOVED.
      //
      // The prior backstop (CCIP-2026-0324B) converted wait_pullback to execute_now
      // when the zone appeared to be on the "wrong side" of current price. This was
      // a trading judgment override — Alpha may have a valid reason to set a zone
      // above current price for a BUY (e.g. breakout confirmation, push confirmation).
      // Code must not infer "wrong side" from geometric position alone.
      //
      // If Alpha's zone is genuinely unreachable, the entry monitor will log it as
      // expired without triggering. That is the correct silent failure mode — not
      // a code-level override that silently changes his entry_mode.
      //
      // SSOT: Alpha's entry_mode and wait_condition are passed downstream unchanged.
      // alpha-identity.ts LEGITIMATE_BLOCK_CONDITIONS is the exhaustive gate registry.

      // ═══════════════════════════════════════════════════════════════════
      // CCIP-2026-0427H-IN-ZONE-COLLAPSE: SSOT geometric consistency rule.
      // ═══════════════════════════════════════════════════════════════════
      //
      // INVARIANT: A wait whose target zone is already satisfied by current price
      // is geometrically not a wait — it is an immediate execution.
      //
      // This is NOT a trading-judgment override of Alpha's entry_mode. It is
      // enforcement of internal SSOT consistency between two fields Alpha
      // produced together: entry_mode=wait_pullback and a wait_condition zone
      // that current price already sits inside. Those two facts contradict
      // each other. The fix is to honour the geometry (price IS in the zone)
      // and convert to execute_now. The wait_condition is then meaningless
      // and stripped, matching CCIP-2026-0319C semantics for execute_now.
      //
      // WHY: Without this, Alpha-emitted wait_pullback decisions whose zone
      // is already satisfied get routed to MONITORED mode, where the entry
      // monitor sees price in zone and either fires anyway (creating racey
      // double-paths) or expires the intent silently. Either is a defect.
      if (
        (resolvedEntryMode === 'wait_pullback' || resolvedEntryMode === 'push_confirmation') &&
        resolvedWaitCondition != null
      ) {
        const livePrice = marketContext?.livePrice ?? marketContext?.price;
        const zoneMin = Math.min(
          resolvedWaitCondition.target_entry_zone_min,
          resolvedWaitCondition.target_entry_zone_max
        );
        const zoneMax = Math.max(
          resolvedWaitCondition.target_entry_zone_min,
          resolvedWaitCondition.target_entry_zone_max
        );
        if (typeof livePrice === 'number' && livePrice >= zoneMin && livePrice <= zoneMax) {
          console.warn(
            `[Alpha Coordinator] CCIP-2026-0427H-IN-ZONE-COLLAPSE: wait zone already satisfied. ` +
            `currentPrice=${livePrice} inside zone ${zoneMin}-${zoneMax}. ` +
            `Converting entry_mode=${resolvedEntryMode} → execute_now and stripping wait_condition. Symbol=${symbol}.`
          );
          logViolation({
            violationType: 'IN_ZONE_WAIT_PULLBACK_COLLAPSE',
            symbol,
            attemptedOperation: 'in_zone_collapse',
            callLocation: 'coordinator-alpha.in_zone_collapse',
            blocked: false,
            errorDetails: {
              original_entry_mode: resolvedEntryMode,
              corrected_entry_mode: 'execute_now',
              current_price: livePrice,
              zone_min: zoneMin,
              zone_max: zoneMax,
              sessionId: goalContext?.sessionId || null,
              userId: userId || null,
            }
          }).catch(() => {});
          resolvedEntryMode = 'execute_now';
          resolvedWaitCondition = undefined;
        }
      }

      // CCIP-2026-0328B: Breakout contradiction guard REMOVED.
      // Alpha has full authority over entry_mode. Q6 and Q4 are answer_sheet audit
      // fields that Alpha already accounts for in his reasoning. Code must not
      // second-guess Alpha's entry_mode by inferring a contradiction from two text
      // fields. If Alpha says execute_now on a breakout setup, that is his judgment.
      // Advisory observation only — no modification to entry_mode or wait_condition.

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

      // CCIP-2026-0328A-SOVEREIGNTY: Monitor-off NO_TRADE override REMOVED.
      //
      // The prior gate (CCIP-2026-0319B) converted wait_pullback/push_confirmation
      // to NO_TRADE when the entry monitor was disabled. This was a trading judgment
      // override — Alpha chose to wait at a specific zone. That is his decision.
      //
      // Alpha is already informed of the monitor status via entryMonitorStatusLine
      // injected into his briefing. If the monitor is offline, Alpha reads that
      // context and chooses accordingly. Code must not second-guess him.
      //
      // If the monitor is off and a wait_condition is created, the executor or live
      // engine handles the routing gracefully. An unmonitored intent is preferable
      // to silently overriding Alpha's entry decision.
      //
      // SSOT: entryMonitorStatusLine (injected into prompt) is the only monitor-status
      // signal Alpha needs. The override gate is not on LEGITIMATE_BLOCK_CONDITIONS.

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
      // CCIP-2026-0415A: Use correctedAction here — 0415A may have upgraded action from NO_TRADE → BUY/SELL.
      if (correctedAction === 'NO_TRADE') {
        // CCIP (2026-03-07): Reasoned NO_TRADE (LLM completed successfully) must carry confidence >= 10
        // so governance can distinguish it from a system-failure NO_TRADE (confidence === 0).
        // A system failure is: data missing, parse error, wall violation, hard block before LLM.
        // A reasoned rejection is: LLM evaluated the market and found no edge.
        // The governance alert fires on NO_TRADE && confidence === 0 — that must remain reserved
        // for genuine infrastructure failures only.
        const reasonedConfidence = Math.max(10, Math.min(100, tradeConfidence));
        // CCIP-2026-0319A (Fix 2): entry_mode is unconditionally undefined for NO_TRADE.
        if (parsed.entry_mode !== undefined && parsed.entry_mode !== null) {
          console.warn(
            `[Alpha Coordinator] NO_TRADE_ENTRY_STRIPPED: LLM returned entry_mode="${parsed.entry_mode}" and/or wait_condition on a NO_TRADE decision. ` +
            `Both fields stripped. Symbol=${symbol}. This indicates prompt non-compliance — review CCIP-2026-0319A.`
          );
        }
        // CCIP-2026-0327C: Extract directional lean fields from Alpha's NO_TRADE response.
        // These are purely diagnostic — never used for execution routing.
        const rawLean = parsed.directional_lean as string | undefined;
        const directionalLean: 'BUY_LEAN' | 'SELL_LEAN' | 'NEUTRAL' =
          rawLean === 'BUY_LEAN' || rawLean === 'SELL_LEAN' ? rawLean : 'NEUTRAL';
        const leanConfidence: number = directionalLean !== 'NEUTRAL'
          ? Math.min(100, Math.max(0, Number(parsed.lean_confidence) || 0))
          : 0;
        // execution_status: patience conviction >= 50 = Alpha clearly saw no edge (GENUINE)
        //                   patience conviction < 50 = Alpha was somewhat uncertain (LEAN)
        const executionStatus: 'NO_TRADE_GENUINE' | 'NO_TRADE_LEAN' =
          reasonedConfidence >= 50 ? 'NO_TRADE_GENUINE' : 'NO_TRADE_LEAN';

        // CCIP-2026-0332A: Include no_trade_statement in the returned decision object so
        // downstream consumers (alpha-learning-tracker.ts logDecision) can persist it to
        // alpha_decisions. Previously this was parsed but discarded — NULL was propagating
        // to the database, a governance violation. The governance check below enforces non-null.
        const noTradeStatementRaw: string = parsed.no_trade_statement || '';

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
          narrativeValidation: narrativeValidation || undefined,
          execution_status: executionStatus,
          directional_lean: directionalLean,
          lean_confidence: leanConfidence,
          // CCIP-2026-0413-CONFIDENCE-TEXT: Pass the original text tier through so the database
          // and UI can display what Alpha actually said (not just the derived number).
          confidence_tier: confidenceTier || undefined,
          // CCIP-2026-0332A: Audit fields — governance check below enforces non-null
          no_trade_statement: noTradeStatementRaw || undefined,
          // CCIP-2026-0404A: Validate block_reason against LEGITIMATE_BLOCK_CONDITIONS + NO_EDGE.
          // An unrecognised block_reason indicates Alpha invented a reason not in the approved list.
          // Advisory only — the NO_TRADE decision stands, but the violation is logged.
          block_reason: (() => {
            const rawBlockReason = parsed.block_reason;
            if (!rawBlockReason) return undefined;
            const validReasons = [...ALPHA_IDENTITY.LEGITIMATE_BLOCK_CONDITIONS, 'NO_EDGE'];
            if (!validReasons.includes(rawBlockReason)) {
              console.warn(`[Alpha Coordinator] CCIP-2026-0404A: block_reason "${rawBlockReason}" is not in LEGITIMATE_BLOCK_CONDITIONS. Using as-is but logging advisory violation. Symbol=${symbol}.`);
              logViolation({
                violationType: 'INVALID_BLOCK_REASON',
                symbol: symbol,
                attemptedOperation: 'no_trade_block_reason_validation',
                callLocation: 'coordinator-alpha.block_reason_validation',
                blocked: false,
                errorDetails: { block_reason: rawBlockReason, sessionId: goalContext?.sessionId || null }
              }).catch(() => {});
            }
            return rawBlockReason;
          })(),
          // CCIP-2026-0415: This is Alpha's genuine judgment — he searched and found no edge.
          decision_origin: 'ALPHA_GENUINE' as const,
          // CCIP-2026-0422B: Raw parsed response attached for audit log upstream to read
          // answer_sheet fields (Q_SWEEP_RECLAIM_STATUS, Q_TRAPPED_FUEL, Q12) without
          // querying the database. Stripped before any persistence layer sees it.
          _rawParsed: parsed,
        };
      }

      // REMOVED: WAIT action handling
      // Alpha now only returns BUY, SELL, or NO_TRADE
      // If setup not ready, return NO_TRADE and scanner will re-evaluate

      // CCIP GOVERNANCE (2026-02-16): Alpha is SOLE AUTHORITY for all trade parameters
      // Alpha chooses entry, SL, and ALL take-profit levels. System never computes TP.
      // SCALP: Alpha returns "takeProfit" (single TP target)
      // MICRO_INTRADAY/INTRADAY: Alpha returns "tp1" (conservative) and "tp2" (full target)
      // CCIP-2026-0333: entry is NON-NEGOTIABLE for BUY/SELL. If Alpha omits it, block the trade.
      // Alpha must always provide an explicit entry price — never substitute with currentPrice.
      let entry: number;
      if (parsed.entry === null || parsed.entry === undefined || typeof parsed.entry !== 'number' || isNaN(parsed.entry) || parsed.entry <= 0) {
        logViolation({
          violationType: 'MISSING_ENTRY_PRICE',
          symbol,
          attemptedOperation: 'trade_execution',
          callLocation: 'coordinator-alpha/parseDecision',
          blocked: true,
          errorDetails: {
            action,
            tradeStyle,
            parsedEntry: parsed.entry,
            entryType: typeof parsed.entry,
          },
        }).catch(() => {});
        console.error(`[CCIP-2026-0333] MISSING_ENTRY_PRICE — Alpha returned ${correctedAction} for ${symbol} without a valid entry. entry=${parsed.entry}. Trade BLOCKED.`);
        return {
          action: 'NO_TRADE',
          decision: 'NO_TRADE',
          entry: currentPrice,
          stopLoss: currentPrice,
          takeProfit: currentPrice,
          confidence: 0,
          reasoning: `GOVERNANCE_BLOCK: Alpha returned ${correctedAction} without a valid entry price. Prompt compliance failure — Alpha must always provide entry for BUY/SELL.`,
          omega_summary: '',
          risk_pct: 0,
          decision_origin: 'ALPHA_BLOCKED_COMPLIANCE' as const,
          alpha_original_decision: {
            action: action as 'BUY' | 'SELL',
            entry: currentPrice,
            stopLoss: parsed.stopLoss ?? currentPrice,
            takeProfit: parsed.takeProfit ?? currentPrice,
            confidence: tradeConfidence,
            reasoning: parsed.reasoning,
          },
        };
      } else {
        entry = parsed.entry;
      }
      let stopLoss = parsed.stopLoss;
      let takeProfit: number;
      // CCIP-2026-0415A: Use correctedAction — 0415A may have upgraded NO_TRADE → BUY/SELL.
      const isBuy = correctedAction === 'BUY';

      // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform — MICRO_INTRADAY uses tp1 + tp2.
      // Backward compat: if Alpha returns old format with takeProfit, use it as tp2.
      takeProfit = parsed.tp2 || parsed.takeProfit;

      // CCIP (2026-03-06): PROMPT COMPLIANCE ENFORCEMENT
      // stopLoss and takeProfit are NON-NEGOTIABLE for every BUY/SELL response.
      // If Alpha omits them, it is a prompt compliance failure — not a market condition.
      // Do NOT silently fall back. Log the violation loudly so it is visible in governance.
      if (typeof stopLoss !== 'number' || isNaN(stopLoss) || stopLoss <= 0) {
        console.error(`[Alpha Coordinator] CRITICAL PROMPT COMPLIANCE FAILURE: Alpha returned ${correctedAction} for ${symbol} WITHOUT a valid stopLoss. stopLoss=${stopLoss} (type: ${typeof stopLoss}). This violates the output contract. Trade BLOCKED.`);
        console.error(`[Alpha Coordinator] Parsed response fields: action=${parsed.action}, entry=${parsed.entry}, stopLoss=${parsed.stopLoss}, takeProfit=${parsed.takeProfit}`);
        return {
          action: 'NO_TRADE',
          decision: 'NO_TRADE',
          entry: currentPrice,
          stopLoss: currentPrice,
          takeProfit: currentPrice,
          confidence: 0,
          reasoning: `BLOCKED: Alpha returned ${correctedAction} without a valid stopLoss. Prompt compliance failure — Alpha must always provide stopLoss for BUY/SELL.`,
          omega_summary: '',
          risk_pct: 0,
          decision_origin: 'ALPHA_BLOCKED_COMPLIANCE' as const,
          alpha_original_decision: {
            action: correctedAction as 'BUY' | 'SELL',
            entry: entry ?? currentPrice,
            stopLoss: currentPrice,
            takeProfit: takeProfit ?? currentPrice,
            confidence: tradeConfidence,
            reasoning: parsed.reasoning,
          },
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
          risk_pct: 0,
          decision_origin: 'ALPHA_BLOCKED_COMPLIANCE' as const,
          alpha_original_decision: {
            action: action as 'BUY' | 'SELL',
            entry: entry ?? currentPrice,
            stopLoss: stopLoss ?? currentPrice,
            takeProfit: currentPrice,
            confidence: tradeConfidence,
            reasoning: parsed.reasoning,
          },
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
          narrativeValidation: narrativeValidation || undefined,
          decision_origin: 'ALPHA_BLOCKED_GEOMETRY' as const,
          alpha_original_decision: {
            action: action as 'BUY' | 'SELL',
            entry,
            stopLoss,
            takeProfit,
            confidence: tradeConfidence,
            entry_mode: entryMode,
            reasoning: parsed.reasoning,
          },
        };
      }

      console.log(`[Alpha Coordinator] Geometry validation passed`);

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

      // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform — MICRO_INTRADAY uses TP1 + TP2.
      {
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
            narrativeValidation: narrativeValidation || undefined,
            decision_origin: 'ALPHA_BLOCKED_COMPLIANCE' as const,
            alpha_original_decision: {
              action: action as 'BUY' | 'SELL',
              entry: entry ?? currentPrice,
              stopLoss: stopLoss ?? currentPrice,
              takeProfit: takeProfit ?? currentPrice,
              confidence: tradeConfidence,
              entry_mode: entryMode,
              reasoning: parsed.reasoning,
            },
          };
        }
        tp2Price = takeProfit;
        tp2Reasoning = `Alpha full target at ${tpPips.toFixed(1)} pips (${rr.toFixed(2)}:1 R:R)`;

        // CCIP-2026-0418A: When TP1 and TP2 are identical, the market only offered one
        // structural level — collapse to single-TP rather than blocking.
        // Rule: if market can only give TP1, TP2 is not required.
        //       if market gives TP2, TP1 is mandatory (and must differ from TP2).
        // Collapsing to single-TP allows the trade to execute on the one level Alpha found.
        if (tp1Price != null && tp2Price != null && Math.abs(tp1Price - tp2Price) < 0.0001) {
          console.warn(
            `[Alpha TP1=TP2 COLLAPSE] ${tradeStyle} produced identical TP1 and TP2 values (${tp1Price}). ` +
            `Market only offered one structural level — collapsing to single-TP. TP2 dropped. Symbol: ${symbol}.`
          );
          tp2Price = null;
          tp2Reasoning = null;
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
      // CCIP-2026-0415A: Use correctedAction — 0415A may have upgraded NO_TRADE → BUY/SELL.
      if (correctedAction === 'BUY' || correctedAction === 'SELL') {
        if (!rawTraderStatement || traderStatementWordCount < 30) {
          logViolation({
            violationType: 'TRADER_STATEMENT_ABSENT_OR_TOO_SHORT',
            symbol: marketContext.symbol,
            attemptedOperation: 'answer_sheet_validation',
            callLocation: 'coordinator-alpha/parseDecision',
            blocked: false,
            errorDetails: { wordCount: traderStatementWordCount, userId: userId || 'unknown' },
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
        if (correctedAction !== 'NO_TRADE') {
          console.warn(`[Alpha Coordinator] max_entry_deviation_pips missing from Alpha response — applying ${alphaMaxDeviationPips} pip fallback for ${symbol}`);
        }
      }

      return {
        // CCIP-2026-0415A: Use correctedAction — may differ from original action const after tier correction.
        action: correctedAction as 'BUY' | 'SELL' | 'NO_TRADE',
        decision: correctedAction,
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
        max_entry_deviation_pips: correctedAction !== 'NO_TRADE' ? alphaMaxDeviationPips : undefined,
        // CCIP-2026-0324G: Pass trader_statement through for audit trail and UI display
        trader_statement: rawTraderStatement,
        // CCIP-2026-0413-CONFIDENCE-TEXT: Alpha's original text tier — passed through for DB and UI
        confidence_tier: confidenceTier || undefined,
        // CCIP-2026-0420A: Structural references for TP and SL — persisted to alpha_decisions.
        // These were defined in the output schema and produced by Alpha but never extracted
        // from the parsed response. Both fields are now passed through for DB audit.
        tp_structural_reference: typeof parsed.tp_structural_reference === 'string' ? parsed.tp_structural_reference : undefined,
        sl_structural_reference: typeof parsed.sl_structural_reference === 'string' ? parsed.sl_structural_reference : undefined,
        // CCIP-2026-0427-A: WAIT_INTENT_AVAILABLE_MONITOR_OFF subclass.
        // When the user has the Entry Monitor disabled, the executor cannot deliver
        // wait_pullback or push_confirmation entries. Alpha's prompt branch already
        // routes these users to execute_now only, but if a wait intent slips through,
        // we tag the row so the dashboard can quantify suppressed-but-valid setups.
        wait_intent_available_for_monitor_off:
          !entryMonitorActive &&
          (correctedAction === 'BUY' || correctedAction === 'SELL') &&
          (resolvedEntryMode === 'wait_pullback' || resolvedEntryMode === 'push_confirmation'),
        wait_intent_metadata:
          !entryMonitorActive &&
          (correctedAction === 'BUY' || correctedAction === 'SELL') &&
          (resolvedEntryMode === 'wait_pullback' || resolvedEntryMode === 'push_confirmation')
            ? {
                original_entry_mode: resolvedEntryMode as 'wait_pullback' | 'push_confirmation',
                entry_zone_min: resolvedWaitCondition?.target_entry_zone_min,
                entry_zone_max: resolvedWaitCondition?.target_entry_zone_max,
                invalidation_price: resolvedWaitCondition?.invalidation_price,
                wait_reasoning: resolvedWaitCondition?.wait_reasoning,
              }
            : undefined,
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
        risk_pct: 1.0,
        narrativeValidation: undefined,
        decision_origin: 'SYSTEM_PARSE_FAILURE' as const,
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
    // CCIP-2026-0421 (SESSION NEUTRALITY — REGIME ORACLE REMOVAL):
    // The Regime Oracle block has been removed from Alpha's prompt.
    //
    // Root cause: The Regime Oracle output pre-scores market conditions with labels like
    // "Volatility Score: 15/100", "ATR State: compressed", "Session: asian" — these are
    // pre-synthesized assessments that condition Alpha to conclude "conditions are poor"
    // before reading a single candle. Combined with session-biased pair personality text,
    // these labels were the primary driver of universal NO_TRADE during Asian sessions.
    //
    // Alpha already receives the raw structural inputs the Regime Oracle consumed:
    // - Live ATR values (atrLegendPrompt) for stop sizing
    // - Adversarial Detector readings (below) for manipulation detection
    // - Micro-regime classifier output (microRegimeContext) for structure/momentum
    // - Daily narrative (dailyNarrativeContext) for range and displacement
    // - Candle data for all timeframes
    //
    // Alpha reads this raw evidence and forms his own assessment of conditions.
    // He does not need a pre-scored "Volatility Score: 15/100" to tell him the market
    // is quiet — he can see that from the ATR values and candle ranges directly.
    // The Regime Oracle's job is done by the data Alpha already receives.
    //
    // The adversarial detector remains — it provides structural manipulation-detection
    // readings (stop runs, whipsaw counts, BOS) that Alpha cannot derive from candles alone.
    if (!adversarial) {
      return '';
    }

    // Unused param kept in signature for backward compatibility with call sites.
    void regime;

    const parts: string[] = ['\nSENSOR READINGS:'];

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

      // CCIP-2026-0422A: When a stop run is active and BOS has NOT fired, inject an explicit
      // structural timing note. This is a sensor reading — Alpha interprets it and decides.
      // The note surfaces the information Alpha needs for sweep-reclaim reasoning without
      // pre-scoring the decision or blocking any entry_mode.
      if (!adversarial.stop_run_classification.has_bos) {
        parts.push(`  [STRUCTURAL NOTE — CCIP-2026-0422A]: Stop run detected, Break of Structure NOT YET confirmed. The sweep has fired but price has not yet reclaimed the swept level with a ${adversarial.stop_run_classification.type === 'active_stop_run' ? 'fresh directional close' : 'structural close above/below the sweep extreme'}. Sweep-reclaim protocol (4B) applies to any reversal thesis at this level. Alpha reads this and determines entry timing.`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Build intelligence context from platform-wide learning
   *
   * CCIP-2026-0506E FRESH-SCAN ISOLATION:
   * This method is permanently retired. It previously injected calibration buckets,
   * counter-thesis accuracy, session-phase historical edge, pattern weights, SL_HUNT
   * severity, today's streak, tp_dist, decisions totals, validated_insights,
   * meta_insights, and tp1_data into Alpha's prompt on every scan.
   *
   * That historical payload was the root cause of cross-scan bias contamination:
   * Alpha pattern-matched winning templates from prior sessions and reproduced the
   * same directional reasoning on unrelated market conditions.
   *
   * Alpha must reason from live market structure only. Historical data stays in the
   * database for analytics; it does NOT enter the decision prompt.
   */
  private buildIntelligenceContext(_intelligence?: AlphaIntelligenceSnapshot | null, _symbol?: string): string {
    void _intelligence;
    void _symbol;
    return '';
  }

}

export const alphaCoordinator = new AlphaCoordinatorBrain();
