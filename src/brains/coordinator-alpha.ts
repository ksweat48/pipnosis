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
import { m5SwingAnalyzer, type M5SwingContext } from '../services/m5-swing-analyzer';
import { MarketDataService } from '../services/market-data-service';
import { alphaGeometryValidator } from '../services/alpha-geometry-validator';
import { getExecutionEnvelope, getAssetClassEnvelopeBounds, validateTPSLAgainstEnvelope, type EnvelopeAssetClass } from '../config/style-execution-envelopes';
import { TRADING_CONSTANTS, getMinRRForStyle, getMinTP1RRForStyle, getEstimatedSpreadPips, getMinSlDistancePips } from '../config/trading-constants';
import { wallCalibrationEngine } from '../services/wall-calibration-engine';
import { resolveCanonicalStyle } from '../config/timeframe-hierarchy';
import { alphaHunterLearningContext } from '../services/alpha-hunter-learning-context';
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
        .gte('entry_time', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
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

    const entryModePromptSection = entryMonitorActive
      ? `ENTRY MODE — SMART WAITING SYSTEM:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GOVERNANCE RULE (CCIP-2026-0333): Every BUY or SELL response MUST include "entry_mode" as a TOP-LEVEL field
in the JSON. Omitting entry_mode will BLOCK the trade — it is not optional, not nested, not skippable.
Place it at the root of the JSON object, not inside entry_spec or any other sub-object.

  "entry_mode": "execute_now"       → Structure and momentum support an immediate entry at current price.

  "entry_mode": "wait_pullback"     → Thesis is valid but price is extended. You want a better entry at a structural level.
                                      The system places a limit-style entry that triggers on first touch — no candle close needed.
                                      Include a wait_condition block with the zone, invalidation price, and reasoning.

  "entry_mode": "push_confirmation" → You want a candle close inside a specific zone before entering.
                                      Use for breakout entries or when you need confirmed commitment before executing.
                                      Include a wait_condition block. Zone should be tight (1-3 pip width).

For wait_pullback or push_confirmation, include:
{
  "wait_condition": {
    "target_entry_zone_min": <lower bound>,
    "target_entry_zone_max": <upper bound>,
    "invalidation_price": <price that invalidates the thesis>,
    "wait_reasoning": "Named structural level and why you are waiting",
    "expected_wait_minutes": <your estimate>
  }
}

REMINDER: "entry_mode" must be a top-level key in your JSON response. Example:
{ "action": "BUY", "entry_mode": "execute_now", ... }
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      : `ENTRY MODE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GOVERNANCE RULE (CCIP-2026-0333): Every BUY or SELL response MUST include "entry_mode" as a TOP-LEVEL field
in the JSON. Omitting entry_mode will BLOCK the trade.

The entry monitor is OFFLINE. Only one entry_mode is available for BUY/SELL:

  "entry_mode": "execute_now" → Structure and momentum support an immediate entry at current price.

"wait_pullback" and "push_confirmation" require the entry monitor to be active and are NOT available.
Set entry_mode to "execute_now" for all BUY/SELL decisions when the monitor is offline, or output NO_TRADE.

REMINDER: "entry_mode" must be a top-level key in your JSON response. Example:
{ "action": "BUY", "entry_mode": "execute_now", ... }
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

    // Build hunter learning context — sharpens Alpha's entry intelligence (advisory only, no gates)
    let hunterLearningContextText = '';
    if (userId) {
      try {
        const hunterCtx = await alphaHunterLearningContext.buildContext(
          userId,
          marketContext.symbol,
          goalContext?.tradeStyle
        );
        hunterLearningContextText = alphaHunterLearningContext.formatForPrompt(hunterCtx);
      } catch (error) {
        console.warn('[Alpha Coordinator] Hunter learning context failed (non-blocking):', error);
      }
    }

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
          const recentLosses = losses.slice(0, 3);
          const recentWins = wins.slice(0, 3);

          recentTradesContext = `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          recentTradesContext += `RECENT TRADE CALIBRATION ON ${symbol} (last 14 days, ${tradeCount} trades)\n`;
          recentTradesContext += `Record: ${wins.length} wins / ${losses.length} losses (win rate: ${Math.round((wins.length / tradeCount) * 100)}%)\n`;
          recentTradesContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          recentTradesContext += `This is calibration data only. Each session starts fresh. Prior losses do not reduce my conviction on a current structural setup.\n`;

          if (recentLosses.length > 0) {
            recentTradesContext += `\nRecent losses on ${symbol}:\n`;
            recentLosses.forEach((trade, idx) => {
              recentTradesContext += `${idx + 1}. ${trade.direction?.toUpperCase() || '?'} → LOSS ($${Number(trade.pnl || 0).toFixed(2)}) | Exit: ${trade.exit_reason || 'unknown'}\n`;
              if (Array.isArray(trade.mistakes_identified) && trade.mistakes_identified.length > 0) {
                recentTradesContext += `   Note: ${trade.mistakes_identified.slice(0, 1).join(', ')}\n`;
              }
            });
          }

          if (recentWins.length > 0) {
            recentTradesContext += `\nRecent wins on ${symbol}:\n`;
            recentWins.forEach((trade, idx) => {
              recentTradesContext += `${idx + 1}. ${trade.direction?.toUpperCase() || '?'} → WIN ($${Number(trade.pnl || 0).toFixed(2)}) | Exit: ${trade.exit_reason || 'unknown'}\n`;
              if (trade.what_worked) {
                recentTradesContext += `   What worked: ${trade.what_worked}\n`;
              }
            });
          }

          recentTradesContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        } else if (tradeCount > 0) {
          recentTradesContext = `\nRecent trades on ${symbol} (${tradeCount} trades, last 14 days — calibration only):\n`;
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
    } catch {
      // Hunt readiness unavailable — proceed with full scan (non-blocking)
      console.warn(`[Alpha Coordinator] Hunt readiness gate unavailable for ${marketContext.symbol} — proceeding with full scan`);
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

      // CCIP 2026-04-08: Style-differentiated ATR timeframe for SL width (cascade shift).
      // SCALP → M5 ATR (atr20). Entry is now M1 but ATR stays M5 (M1 ATR too noisy for stops).
      //   atr20 is populated from a separate M5 snapshot in alpha-omega-orchestrator.ts.
      // MICRO_INTRADAY → M5 ATR (atr). Entry is M5, ATR matches entry timeframe.
      // INTRADAY → M15 ATR (atr). Entry is M15, ATR matches entry timeframe.
      // Note: atr100 (long-period H4-based) is not populated in marketContext and is therefore
      // not usable for stop sizing.
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
      logATRUsage('Stop-Loss calculation', preferredAtrRaw ?? marketContext.atr);

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

    const styleIdentityPrompt = tradeStyle === 'SCALP'
      ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STYLE IDENTITY: SCALP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are operating as a M5 SCALP trader.
Timeframe stack: M5 (entry lens — my primary signal) | M15 (trend validation and direction confirmation) | H1 (context and session bias).
I read M5 candles as my primary entry signal. M15 confirms the trend direction — it tells me which way structural energy is aligned. H1 gives session bias. M15 and H1 structure do NOT define my exit destination — they define my directional context.
TP is where the M5 leg exhausts. I am trading a M5 momentum move. My exit is where the M5 candle sequence visibly runs out of energy — a prior M5 swing already printed in the direction of travel, equal highs/lows already established on M5, pace fading on the M5 candle bodies. I do not target a M15 structural level as a destination. I exit where this M5 leg dies.
M1 is timing refinement only. If M5 structure is clearly present and M1 is choppy or indecisive, I still execute — I use a M1 candle close as my timing entry signal, not as a confirmation gate. M1 choppiness does NOT block a clean M5 setup.

HUNTER'S TP CONTRACT (SCALP):
I am a hunter. My first question is: where does this M5 leg run out of energy? I look for: a prior M5 swing high/low already printed in the direction of travel, M5 equal highs/lows clustering that signal absorption, M5 candle bodies compressing and wicks extending (pace fading), a M5 FVG already filled. That is my TP zone — the point of M5 momentum exhaustion, not the structural destination.
M15 tells me the direction is valid. H1 tells me the macro story. Neither tells me where to exit. The exit is the M5 leg's natural endpoint.
I decide the TP. I name the specific M5 exhaustion signal I am targeting AND state how many pips from entry it sits AND why the M5 momentum is most likely to die at that exact location. No fixed buffers. No formulas. I read the M5 tape and commit.
Name the specific M5 structural level you are entering from in m1_structural_confirmation.
Format: "[structure type] at [exact price] — [what M15 context confirms it]". Example: "M5 BOS at 1.08230 confirmed by M15 bullish trend bias".
Valid M5 anchors: named M5 swing high/low, M5 FVG, M5 BOS, M5 EMA rejection, M5 equal highs/lows, M5 range boundary, session open level, M5 sweep reclaim.
Record m1_structural_confirmation, scalp_momentum_phase, and scalp_atr_traveled in the JSON response — these are audit fields required regardless of action.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`
      : tradeStyle === 'MICRO_INTRADAY'
      ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STYLE IDENTITY: MICRO_INTRADAY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are operating as a M5 MICRO_INTRADAY trader.
Timeframe stack: M5 (entry lens — my primary signal) | M15 (trend validation and direction confirmation) | H1 (macro bias only) | D1 (macro orientation).
I read M5 candles as my primary entry signal. M15 confirms the trend direction — it tells me which way the structural energy is aligned. H1 orients the macro bias. Neither M15 nor H1 defines my TP destination — they define the directional context I am trading within.
TP is where the M5 leg exhausts. I am trading a M5 momentum move. My exit is where the M5 candle sequence visibly runs out of energy — a prior M5 swing already printed in the direction of travel, equal highs/lows already established on M5, pace fading on the M5 candle bodies, a M5 FVG already filled. That is my TP zone — exhaustion of the M5 leg, not a named M15 structural destination.

HUNTER'S TP CONTRACT (MICRO_INTRADAY):
I am a hunter. My first question is: where does this M5 leg run out of energy? I look for: a prior M5 swing high/low already printed in the direction of travel, M5 equal highs/lows clustering that signal absorption, M5 candle bodies compressing and wicks extending (pace fading), M5 momentum visibly stalling. That is my TP1 zone. If a clear second zone of M5 exhaustion exists further along — a second prior swing, a second cluster of equal highs/lows — I place TP2 there.
M15 tells me the direction is valid. H1 tells me the macro story. Neither tells me where to exit. The exit is the M5 leg's natural endpoint.
I name the specific M5 exhaustion signal I am targeting for each TP AND state how many pips from entry it sits AND why the M5 momentum is most likely to die at that exact location. No fixed buffers. No formulas. I read the M5 tape and commit.
Name the specific M5 structural level you are entering from in m5_structural_confirmation.
Format: "[structure type] at [exact price] — [what confirms it]". Example: "M5 BOS at 1.08230 confirmed long bias on M15 trend".
Valid M5 anchors: named M5 S/R levels, M5 range boundaries, session highs/lows, equal highs/lows, VWAP, EMA rejections, prior M5 swing points.
Record m5_structural_confirmation, m5_move_phase, and m5_atr_traveled in the JSON response — these are audit fields that document my structural read for governance review regardless of action.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`
      : tradeStyle === 'INTRADAY'
      ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STYLE IDENTITY: INTRADAY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are operating as a M15 INTRADAY trader.
Timeframe stack: M15 (entry lens — my primary signal) | H1 (trend validation and direction confirmation only) | H4 (macro bias only) | D1 (daily delivery narrative).
I read M15 candles as my primary entry signal. H1 confirms the trend direction — it tells me which way the structural energy is aligned. H4 orients the macro bias. H1 is NOT a TP destination. H4 is NOT a TP destination. Higher timeframes define the directional context I am trading within — they do not define where my trade ends.
TP is where the M15 leg exhausts. I am trading a M15 momentum move. My exit is where the M15 candle sequence visibly runs out of energy — a prior M15 swing already printed in the direction of travel, equal highs/lows already established on M15, pace fading on the M15 candle bodies, M15 momentum visibly stalling. That is my TP zone — exhaustion of the M15 leg, not a named H1 or H4 structural destination.

HUNTER'S TP CONTRACT (INTRADAY):
I am a hunter. My first question is: where does this M15 leg run out of energy? I look for: a prior M15 swing high/low already printed in the direction of travel, M15 equal highs/lows clustering that signal absorption, M15 candle bodies compressing and wicks extending (pace fading), M15 momentum visibly stalling. That is my TP1 zone. If a clear second point of M15 exhaustion exists further along — a second prior swing, a second cluster of equal highs/lows, a clear M15 FVG already filled — I place TP2 there.
H1 confirms my directional bias is real. H4 tells me the macro story. Neither H1 nor H4 sets my exit price. The exit is the M15 leg's natural endpoint.
I name the specific M15 exhaustion signal I am targeting for each TP AND state how many pips from entry it sits AND why the M15 momentum is most likely to die at that exact location. No fixed buffers. No formulas. I read the M15 tape and commit.
Name the specific M15 structural level you are entering from in m15_structural_confirmation.
Format: "[structure type] at [exact price] — [what confirms it]". Example: "M15 BOS at 1.08230 confirmed long bias on H1 trend".
Valid M15 anchors: named M15 S/R levels, M15 range boundaries, session highs/lows, equal highs/lows, VWAP, EMA rejections, prior M15 swing points.
Record m15_structural_confirmation, m15_move_phase, and m15_atr_traveled in the JSON response — these are audit fields that document my structural read for governance review regardless of action.
The trade_management object in my response documents my campaign plan for this trade — TP1 percentage, post-TP1 SL action, and trailing method. This is part of my honest account of the campaign, not a compliance requirement.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`
      : '';

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

    // ═══════════════════════════════════════════════════════════════════
    // M5 STRUCTURAL VALIDATION CONTEXT (SCALP ONLY)
    // CCIP-2026-04-11: Repositioned from "M5 entry lens reference" to
    // "M5 structural validation layer". SCALP enters on M1 candles;
    // M5 provides the trend direction and TP structural target sizing.
    // M5 swing data is the correct reference for TP sizing — M1 swings
    // are too small to use as TP targets for meaningful scalp profit.
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
M5 STRUCTURAL VALIDATION (${marketContext.symbol}) — TREND AUTHORITY & TP SIZING REFERENCE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M5 is my validation layer. I enter on M1 structure; M5 validates trend direction and names the structural level I am targeting for TP.
My M1 entry must be in the direction of M5 trend bias. My TP is a named M5 structural level — one clean M1 leg into a named M5 target.

M5 Statistics (TP Sizing Reference):
• Avg M5 Swing: ${m5Context.avgSwingPips} pips
• Recent M5 Swings: ${m5Context.recentSwings.join(', ')} pips
• Current M5 Swing Progress: ${(m5Context.currentSwingProgress * 100).toFixed(0)}% through typical M5 swing
• M5 ATR: ${m5Context.m5ATR} pips (stop sizing authority)

Session Context:
• Session: ${m5Context.session}
• Typical ${m5Context.session} M5 Range: ${m5Context.sessionTypicalRange}

TP Sizing Reference (GUIDANCE — I have full authority over TP placement):
• Typical M5 TP Range: ${m5Context.suggestedTPRange[0]}-${m5Context.suggestedTPRange[1]} pips
• Typical M5 SL Range: ${m5Context.suggestedSLRange[0]}-${m5Context.suggestedSLRange[1]} pips

VALIDATION REMINDERS:
- I enter on M1 price action; my TP must land on a named M5 structural level
- TP sizing is anchored to M5 swing behavior — M1 swings are too small for scalp TP targets
- I have FULL AUTHORITY over TP/SL placement when I name the structural justification
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        console.log(`[Alpha Coordinator] M5 Validation Context: ${m5Context.avgSwingPips} pip avg, ${m5Context.session} session`);
      } catch (error) {
        console.warn('[Alpha Coordinator] Failed to fetch M5 validation context (non-blocking):', error);
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // PRIMARY TIMEFRAME CANDLE CONTEXT (STYLE-AWARE - for entry advisory)
    // SSOT: MarketDataService is the single authority for candle data
    // CCIP-2026-04-21: SCALP primary lens REVERTED from M1 back to M5.
    // Reason: M1 primary caused Alpha to require M1 structural confirmation
    // (M1 BOS, M1 EMA rejection) that never fires during clean M5 setups in
    // low-volatility sessions. Alpha missed multiple valid setups correctly
    // identified by the hunt readiness scanner (which operates on M5).
    // Fix: M5 is the SCALP entry lens. M1 is timing refinement only —
    // M5 setup present + M1 choppy = still execute, use M1 close as timing.
    // Stop-out risk addressed through TP at M5 leg exhaustion, not TF demotion.
    // SCALP:          entry=M5 (20 candles), trend/TP-ref=M15, context=H1
    // MICRO_INTRADAY: entry=M5 (30 candles), direction=M15 (10 candles), context=H1
    // INTRADAY:       entry=M15 (20 candles), trend=H1, context=H4
    // ATR NOTE: SCALP stop sizing uses M5 ATR (atr20).
    // PRIMARY_TF_MAP fetches the entry timeframe candles — the primary signal lens.
    // ═══════════════════════════════════════════════════════════════════
    const PRIMARY_TF_MAP: Record<string, { timeframe: string; label: string; candleCount: number }> = {
      'SCALP': { timeframe: 'M5', label: 'M5', candleCount: 20 },
      'MICRO_INTRADAY': { timeframe: 'M5', label: 'M5', candleCount: 30 },
      'INTRADAY': { timeframe: 'M15', label: 'M15', candleCount: 20 },
    };
    const styleName = getDisplayNameFromStyle(tradeStyle);
    const primaryTfConfig = PRIMARY_TF_MAP[styleName] || PRIMARY_TF_MAP['SCALP'];

    let primaryTfCandlePrompt = '';
    let intradayMovePhaseContext = '';
    let microIntradayMovePhaseContext = '';
    let scalpMovePhaseContext = '';
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
        // INTRADAY M15 MOVE PHASE & FAKEOUT ADVISORY
        // CCIP-2026-04-08 cascade shift: INTRADAY entry TF is M15 (SSOT).
        // recentPrimary now contains M15 candles (PRIMARY_TF_MAP corrected).
        // ATR reference is atrForStopLoss (marketContext.atr, M15 ATR per code comment line 1338).
        // Advisory only — Alpha retains full decision authority.
        // ═══════════════════════════════════════════════════════════════════
        if (styleName === 'INTRADAY' && atrForStopLoss > 0) {
          const m15AtrPipsIntraday = (atrForStopLoss / pipInfo.pipValue);
          const freshCeiling = (atrForStopLoss * 0.75 / pipInfo.pipValue).toFixed(1);
          const developingCeiling = (atrForStopLoss * 1.5 / pipInfo.pipValue).toFixed(1);

          // Estimate ATR traveled from M15 swing origin:
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
          const atrTraveled = m15AtrPipsIntraday > 0 ? distFromSwingPips / m15AtrPipsIntraday : 0;

          const m15MovePhaseIntraday = atrTraveled < 0.75 ? 'FRESH' : atrTraveled < 1.5 ? 'DEVELOPING' : 'EXHAUSTED';

          // M15 fakeout detection: look for a candle that swept a recent extreme
          // then closed back inside the prior range (fakeout candle)
          let fakeoutType: string | null = null;
          let fakeoutCandlesAgo = 0;
          let fakeoutReversalConfirmed = false;
          if (recentPrimary.length >= 4) {
            const lookback = recentPrimary.slice(0, -1);
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

          const phaseLabel = m15MovePhaseIntraday === 'FRESH'
            ? `FRESH — < 0.75x M15 ATR traveled (< ${freshCeiling} pips from swing origin). Full structural space available.`
            : m15MovePhaseIntraday === 'DEVELOPING'
              ? `DEVELOPING — 0.75–1.5x M15 ATR traveled (${freshCeiling}–${developingCeiling} pips from swing origin). Structural space to TP1 may be narrowing — the remaining runway to the named TP levels is the key measurement.`
              : `EXHAUSTED — > 1.5x M15 ATR traveled (> ${developingCeiling} pips from swing origin). The M15 leg is extended. Document the structural picture honestly and reflect it in the conviction score.`;

          const fakeoutBlock = fakeoutType
            ? `
M15 FAKEOUT DETECTION:
A ${fakeoutType} was detected ${fakeoutCandlesAgo} M15 candle(s) ago. A candle swept a recent M15 extreme but closed back inside the prior range. Reversal confirmed: ${fakeoutReversalConfirmed ? 'YES — subsequent M15 candles have printed in the reversal direction' : 'NOT YET — subsequent M15 candles have not yet confirmed direction'}.
${fakeoutType === 'BEARISH_FAKEOUT'
  ? 'BEARISH FAKEOUT: Price swept above a prior M15 high and rejected, closing back inside the prior range. This is raw structural data — a sweep of the high, a rejection, and a body close inside. What that means for the current thesis is my read.'
  : 'BULLISH FAKEOUT: Price swept below a prior M15 low and rejected, closing back inside the prior range. This is raw structural data — a sweep of the low, a rejection, and a body close inside. What that means for the current thesis is my read.'}
`
            : '';

          intradayMovePhaseContext = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INTRADAY M15 MOVE STAGE ADVISORY (${marketContext.symbol})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pre-computed from M15 candle data (entry timeframe). Advisory context — your analysis takes precedence.
ACTIVE M15 ATR: ${m15AtrPipsIntraday.toFixed(1)} pips | Phase thresholds: Fresh < ${freshCeiling}p | Developing ${freshCeiling}–${developingCeiling}p | Exhausted > ${developingCeiling}p

Estimated ATR Traveled: ~${distFromSwingPips.toFixed(1)} pips from M15 swing origin (~${atrTraveled.toFixed(2)}x M15 ATR)
M15 Move Phase: ${m15MovePhaseIntraday}
Assessment: ${phaseLabel}

${m15MovePhaseIntraday === 'DEVELOPING'
  ? `DEVELOPING STAGE — RUNWAY AUDIT: Record the remaining structural space from current price to the named TP1 (H1 structural level) and TP2 (H4 structural level). "Remaining runway to TP1: ~X pips. Remaining runway to TP2: ~X pips. R:R from current price: TP1=X:1, TP2=X:1." The R:R assessment belongs in the conviction score.`
  : m15MovePhaseIntraday === 'EXHAUSTED'
    ? `EXHAUSTED STAGE — The M15 leg has traveled > 1.5x ATR. The structural picture at this extension is what it is — document the nearest structural levels from current price, the R:R those levels produce, and what the market is showing. The conviction score reflects the honest read.`
    : `FRESH STAGE — Full structural space to TP1 and TP2 is available.`
}
${fakeoutBlock}MANDATORY JSON FIELD — Include in your response regardless of action:
  "m15_move_phase": "fresh|developing|exhausted"
  "m15_atr_traveled": ${atrTraveled.toFixed(2)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.log(`[Alpha Coordinator] INTRADAY M15 Move Phase: ${m15MovePhaseIntraday} (~${atrTraveled.toFixed(2)}x ATR, ${distFromSwingPips.toFixed(1)} pips)${fakeoutType ? ` | Fakeout: ${fakeoutType}` : ''}`);
        }

        // ═══════════════════════════════════════════════════════════════════
        // MICRO_INTRADAY M5 MOVE PHASE & FAKEOUT ADVISORY
        // CCIP-2026-04-08 cascade shift: MICRO_INTRADAY entry TF is M5 (SSOT).
        // recentPrimary now contains M5 candles (PRIMARY_TF_MAP corrected).
        // ATR reference is the standard atrForStopLoss (marketContext.atr).
        // Advisory only — Alpha retains full decision authority.
        // ═══════════════════════════════════════════════════════════════════
        if (styleName === 'MICRO_INTRADAY' && atrForStopLoss > 0) {
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

        // ═══════════════════════════════════════════════════════════════════
        // SCALP M1 MOVE PHASE ADVISORY
        // CCIP-2026-04-11: SCALP primary lens migrated from M5 to M1.
        // Entry analysis now runs on M1 candles (recentPrimary = M1).
        // ATR reference remains M5 (atrForStopLoss = M5 ATR via atr20) —
        // M1 ATR is too noisy for stop sizing. Phase thresholds expressed in
        // M5 ATR units so stop sizing is structurally grounded while the entry
        // swing origin is derived from M1 price action.
        // Advisory only — Alpha retains full decision authority.
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
              ? `DEVELOPING — 0.75–1.5x M5 ATR traveled (${freshCeilingM5}–${developingCeilingM5} pips from M5 swing origin). ATR travel data provided. Alpha assesses remaining structural space and R:R independently.`
              : `EXTENDED — > 1.5x M5 ATR traveled (> ${developingCeilingM5} pips from M5 swing origin). ATR travel data provided. Alpha assesses structure and thesis direction independently.`;

          const fakeoutBlockM5 = fakeoutTypeM5
            ? `
M1 FAKEOUT DETECTION:
A ${fakeoutTypeM5} was detected ${fakeoutCandlesAgoM5} M1 candle(s) ago. A candle swept a recent M1 extreme but closed back inside the prior range. Reversal confirmed: ${fakeoutReversalConfirmedM5 ? 'YES — subsequent M1 candles have printed in the reversal direction' : 'NOT YET — watch for reversal confirmation before entering in the faked direction'}.
${fakeoutTypeM5 === 'BEARISH_FAKEOUT'
  ? 'BEARISH FAKEOUT: Price swept above a prior M1 high and rejected. This is a classic M1 bull trap. Entering LONG at current price carries fakeout-reversal risk — explicit M1 structural justification required.'
  : 'BULLISH FAKEOUT: Price swept below a prior M1 low and rejected. This is a classic M1 bear trap. Entering SHORT at current price carries fakeout-reversal risk — explicit M1 structural justification required.'}
`
            : '';

          scalpMovePhaseContext = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCALP M1 MOVE STAGE ADVISORY (${marketContext.symbol})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pre-computed from M1 candle data (entry lens). ATR reference is M5 (stop sizing authority — M1 ATR is too noisy).
ACTIVE M5 ATR: ${m5AtrPips.toFixed(1)} pips | Phase thresholds vs M5 ATR: Fresh < ${freshCeilingM5}p | Developing ${freshCeilingM5}–${developingCeilingM5}p | Exhausted > ${developingCeilingM5}p

Estimated ATR Traveled: ~${distFromSwingPipsM5.toFixed(1)} pips from M1 swing origin (~${atrTraveledM5.toFixed(2)}x M5 ATR)
M1 Move Phase: ${m5MovePhase}
Assessment: ${phaseLabelM5}

${m5MovePhase === 'DEVELOPING'
  ? `DEVELOPING STAGE — ATR travel is within 0.75–1.5x M5 ATR. Identify the nearest structural target and assess achievable R:R from current price. Document the structural level you name and reflect that assessment in your conviction score. Alpha decides the action.`
  : m5MovePhase === 'EXHAUSTED'
    ? `EXTENDED STAGE — ATR travel exceeds 1.5x M5 ATR. Identify the strongest structural thesis available — continuation, reversal, or retest — from the current price action. Document the structural basis and reflect your honest assessment in your conviction score. Alpha decides the action.`
    : `FRESH STAGE — Full confidence window. Structural space to your SCALP TP is available. Both continuation and pullback M1 entries are valid.`
}
${fakeoutBlockM5}MANDATORY JSON FIELDS — Include in your response regardless of action:
  "scalp_momentum_phase": "${m5MovePhase.toLowerCase()}"
  "scalp_atr_traveled": ${atrTraveledM5.toFixed(2)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.log(`[Alpha Coordinator] SCALP M5 Move Phase: ${m5MovePhase} (~${atrTraveledM5.toFixed(2)}x M5 ATR, ${distFromSwingPipsM5.toFixed(1)} pips from M5 swing)${fakeoutTypeM5 ? ` | Fakeout: ${fakeoutTypeM5}` : ''}`);
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
    // HTF DIRECTION TIMEFRAME CANDLES (MICRO_INTRADAY + INTRADAY ONLY)
    // CCIP-2026-04-21: Direction TF demoted from "controlling gate" to
    // "direction authority" — provides bias, not a hard block.
    // MICRO_INTRADAY: H1 is the direction TF (validates M5 entry direction)
    // INTRADAY: H1 is the direction TF (validates M15 entry direction)
    // Both styles use H1. H4 is background context only for INTRADAY (no gate).
    // GOVERNANCE: Missing direction TF data = hard NO_TRADE (MTF_DATA_MISSING)
    // Alpha cannot reason about direction without direction TF data.
    // ═══════════════════════════════════════════════════════════════════
    const HTF_VALIDATION_MAP: Record<string, { timeframe: string; label: string; candleCount: number } | null> = {
      'SCALP': null,
      'MICRO_INTRADAY': { timeframe: 'H1', label: 'H1', candleCount: 10 },
      'INTRADAY': { timeframe: 'H1', label: 'H1', candleCount: 10 },
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
${styleName === 'INTRADAY' ? 'INTRADAY: H1 is the direction TF. My entry lens is M15. My TP is M15 leg exhaustion. H1 tells me which direction to hunt — not where to exit.' : 'MICRO_INTRADAY: H1 is the direction TF. My entry lens is M5. My TP is M5 leg exhaustion. H1 tells me which direction to hunt — not where to exit.'}
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
    // H4 BACKGROUND CONTEXT (INTRADAY ONLY — pure context, no gate)
    // CCIP-2026-04-21: 4 H4 candles give Alpha awareness of whether the H1
    // move it is entering has H4 structural tailwind or is counter-trend.
    // A counter-H4 INTRADAY trade carries materially different risk than a
    // H4-aligned one — Alpha should see this even though H4 never controls
    // entry, never sets TP, and never gates execution.
    // Non-blocking: if H4 data is unavailable, prompt block is omitted silently.
    // ═══════════════════════════════════════════════════════════════════
    let h4BackgroundPrompt = '';
    if (tradeStyle === 'INTRADAY') {
      try {
        const mds = MarketDataService.getInstance();
        const h4Candles = await mds.getCandles(marketContext.symbol, 'H4', 4);

        if (h4Candles && h4Candles.length >= 2) {
          const recentH4 = h4Candles.slice(0, 4).reverse();
          const pipInfo = getCurrencyPipInfo(marketContext.symbol);

          const h4Lines: string[] = recentH4.map((c, i) => {
            const dir = c.close > c.open ? 'UP' : c.close < c.open ? 'DN' : 'FLAT';
            const bodyPips = Math.abs(c.close - c.open) / pipInfo.pipValue;
            const upperWick = (c.high - Math.max(c.open, c.close)) / pipInfo.pipValue;
            const lowerWick = (Math.min(c.open, c.close) - c.low) / pipInfo.pipValue;
            return `  ${i + 1}. ${dir} O:${c.open.toFixed(pipInfo.decimalPlaces)} H:${c.high.toFixed(pipInfo.decimalPlaces)} L:${c.low.toFixed(pipInfo.decimalPlaces)} C:${c.close.toFixed(pipInfo.decimalPlaces)} body:${bodyPips.toFixed(1)}p wicks:${upperWick.toFixed(1)}/${lowerWick.toFixed(1)}p`;
          });

          const h4High = Math.max(...recentH4.map(c => c.high));
          const h4Low = Math.min(...recentH4.map(c => c.low));
          const h4Mid = (h4High + h4Low) / 2;
          const currentPrice = marketContext.livePrice ?? marketContext.price;
          const priceVsMid = currentPrice > h4Mid ? 'ABOVE H4 midpoint — upper half of 4-candle H4 range' : 'BELOW H4 midpoint — lower half of 4-candle H4 range';

          const upCandles = recentH4.filter(c => c.close > c.open).length;
          const downCandles = recentH4.filter(c => c.close < c.open).length;
          const h4Bias = upCandles > downCandles ? 'BULLISH' : downCandles > upCandles ? 'BEARISH' : 'NEUTRAL';
          const h4RangePips = (h4High - h4Low) / pipInfo.pipValue;

          h4BackgroundPrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
H4 BACKGROUND CONTEXT (${marketContext.symbol}) — DIRECTION AWARENESS ONLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
H4 data is background awareness only. It does not gate my entry. It does not set my TP.
It tells me whether my H1 directional read has H4 structural tailwind or is counter-trend at the H4 level.
My exits are M15 exhaustion points regardless of what H4 shows. Alpha decides what the H4 alignment means for conviction.

${h4Lines.join('\n')}

H4 BACKGROUND SUMMARY:
- H4 Range (last ${recentH4.length} candles): ${h4RangePips.toFixed(1)} pips (High: ${h4High.toFixed(pipInfo.decimalPlaces)}, Low: ${h4Low.toFixed(pipInfo.decimalPlaces)})
- H4 Structural bias: ${h4Bias} (${upCandles} bull candles, ${downCandles} bear candles of ${recentH4.length})
- Current price: ${priceVsMid}
- H4 Key resistance: ${h4High.toFixed(pipInfo.decimalPlaces)} | H4 Key support: ${h4Low.toFixed(pipInfo.decimalPlaces)}

H4 ALIGNMENT READ:
${h4Bias === 'BULLISH' ? 'H4 structure is BULLISH. A BUY entry on H1 has H4 tailwind — structurally aligned. A SELL entry is counter-H4 and requires explicit H1-level reversal evidence in my reasoning.' : h4Bias === 'BEARISH' ? 'H4 structure is BEARISH. A SELL entry on H1 has H4 tailwind — structurally aligned. A BUY entry is counter-H4 and requires explicit H1-level reversal evidence in my reasoning.' : 'H4 structure is NEUTRAL/RANGING. Both directions are equally viable — structural edge is determined by H1 and M15 setup quality alone.'}
I note the H4 alignment in my trader_statement when it is relevant to my conviction assessment. H4 does not change my entry or exit — it informs my honest read of the structural context.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.log(`[Alpha Coordinator] H4 Background (INTRADAY): ${recentH4.length} candles, bias ${h4Bias}, range ${h4RangePips.toFixed(1)} pips, price ${priceVsMid.split(' ')[0].toLowerCase()} midpoint`);
        }
      } catch (error) {
        // Non-blocking — H4 context is advisory only, scan continues without it
        console.warn(`[Alpha Coordinator] H4 background context unavailable for ${marketContext.symbol} (non-blocking):`, error instanceof Error ? error.message : 'Unknown');
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
    // THREE-TIER ARCHITECTURE (post CCIP-2026-04-08 + CCIP-2026-04-21):
    //   SCALP:          M5 (primary entry) + M1 (timing refinement only) + M15/H1 (advisory)
    //   MICRO_INTRADAY: M5 (primary entry) + M15 (trend validation) + H1 (controlling)
    //   INTRADAY:       M15 (primary entry) + H1 (trend validation) + H4 (context only)
    // NOTE: Sub-confirmation blocks below fetch additional same-TF candles as advisory
    // supplementary data. All sub-confirmation is NON-BLOCKING — Alpha retains full authority.
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
    // M15 DIRECTION CANDLES (MICRO_INTRADAY ONLY — direction TF, non-blocking)
    //
    // ARCHITECTURE: MICRO_INTRADAY = M5 (entry) + M15 (direction) + H1 (control)
    // M15 is the direction TF. It validates M5 trend direction and provides the
    // M15 swing high/low that anchors the ATR-traveled calculation above.
    // Variables m15SwingHighMicro / m15SwingLowMicro are read in the move phase
    // block (inside primary candle try block) which runs before this fetch.
    // NOTE: Because this block runs AFTER the move phase block, the M15 anchor
    // in the move phase prompt text is set but the JSON field "m5_atr_traveled"
    // will reflect the M5-window measurement on the first scan. The M15 direction
    // prompt below gives Alpha the full M15 picture directly to read.
    // SSOT: MarketDataService is the single authority for candle data.
    // ═══════════════════════════════════════════════════════════════════
    if (styleName === 'MICRO_INTRADAY') {
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
M15 CANDLE CONTEXT — PRE-COMPUTED MEASUREMENTS:
- M15 BOS BULL (last M15 close > prior M15 high): ${m15IBOSBull ? 'YES — bullish M15 break of structure confirmed' : 'NO'}
- M15 BOS BEAR (last M15 close < prior M15 low): ${m15IBOSBear ? 'YES — bearish M15 break of structure confirmed' : 'NO'}
- M15 SWEEP WICK BULL (lower wick ≥1.5x body in last 2 M15 candles): ${m15ISweepWickBull ? 'YES — bullish absorption signal on M15' : 'NO'}
- M15 SWEEP WICK BEAR (upper wick ≥1.5x body in last 2 M15 candles): ${m15ISweepWickBear ? 'YES — bearish absorption signal on M15' : 'NO'}

This is raw market measurement. I read what the M15 is showing and reach my own conclusions on timing, trigger state, and entry_mode.`;

          m5SubConfirmationPrompt += `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M15 CANDLE CONTEXT — INTRADAY TIMING LAYER (${marketContext.symbol})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
H1 defines the campaign structure. M15 provides timing precision within the H1 structural picture. The measurements below are pre-computed — I read them and decide.

${m15IntradayLines.join('\n')}

M15 CONTEXT SUMMARY:
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
DATA GAP: Without M15 precision entry data, the sub-confirmation trigger state is unknown.
Document your entry_mode choice and reasoning given this data gap. State what trigger you are waiting for or why current H1 structural context is sufficient. Your conviction score should reflect this uncertainty.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.warn(`[Alpha Coordinator] M15 precision entry data insufficient for INTRADAY (${m15IntradayCandles?.length ?? 0} candles)`);
        }
      } catch (error) {
        m5SubConfirmationPrompt += `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M15 PRECISION ENTRY (${marketContext.symbol}) — FETCH ERROR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WARNING: M15 precision entry fetch failed. The sub-confirmation trigger state is unknown due to a data fetch error.
Document your entry_mode choice and reasoning given this data gap. Your conviction score should reflect the absence of M15 confirmation data.
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

M15 COUNTER-TREND SCALP AUDIT: If your M5 entry direction opposes the M15 bias above,
document in your reasoning what counter-trend structural evidence you observed (M15 BOS, sweep wick, or other).
If no counter-trend structural evidence exists in the pre-computed signals above, state that clearly and reflect it in your conviction score.
Alpha decides the action — the audit trail records the evidence.`;

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

INTRADAY D1 STRUCTURAL CONTEXT:
- The D1 structural bias is the macro campaign frame for INTRADAY trades. Document how it aligns with or challenges your intended direction.
- The D1 swing high and low define the CAMPAIGN BOUNDARIES for INTRADAY. Document whether your TP target is inside or outside those boundaries and what that means for your conviction.
- If D1 bias is BULLISH, document how that affects your assessment of BUY vs SELL setups.
- If D1 bias is BEARISH, document how that affects your assessment of SELL vs BUY setups.
- If D1 bias is NEUTRAL, both directions are available — document which H4 structural evidence drives your direction choice.
- State how the D1 structural bias supports or challenges your intended direction in your reasoning.`;
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
      const m1CandleCount = styleName === 'SCALP' ? 20 : styleName === 'MICRO_INTRADAY' ? 12 : 8;
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

        const scalpM1Header = styleName === 'SCALP'
          ? `SCALP PRECISION ENTRY TIMING — M5 is my primary lens (structure + TP target). M1 tells me WHERE on the M5 leg to pull the trigger. I read M1 to find: a M1 pullback completing inside a M5 bullish/bearish leg (entry into the retrace), M1 momentum reversing toward my M5 direction, M1 equal-highs/lows being swept just before the continuation impulse. I DO NOT change my TP based on M1 — TP is the M5 exhaustion point. M1 is the timing layer only.`
          : `Use M1 data to REFINE entry timing AFTER you have assessed the ${primaryTfConfig.label} structure above. M1 signals alone do NOT determine your entry_advisory verdict. The ${primaryTfConfig.label} timeframe is primary.`;

        m1MicroContextPrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M1 PRECISION TIMING (${marketContext.symbol}) — ${styleName === 'SCALP' ? 'ENTRY TIMING LAYER' : 'TIMING REFINEMENT (SECONDARY)'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${scalpM1Header}

${m1Lines.join('\n')}

M1 SUMMARY:
- M1 Range: ${m1RangePips.toFixed(1)} pips (High: ${m1High.toFixed(pipInfo.decimalPlaces)}, Low: ${m1Low.toFixed(pipInfo.decimalPlaces)})
- Consecutive same-direction M1 candles: ${consecutiveSameDir}
- Last M1 candle: ${hasRejectionWickM1 ? 'REJECTION WICK detected (possible reversal/exhaustion at M1 level)' : 'Normal candle — no strong wick signal'}
- M1 momentum: ${consecutiveSameDir >= 4 ? 'STRONG one-way — retrace/pause likely imminent' : consecutiveSameDir >= 3 ? 'Building — watch for M1 exhaustion' : 'Mixed/choppy — normal price action'}
${styleName === 'SCALP' ? `
SCALP ENTRY TIMING SIGNALS:
- M1 BOS BULL (last M1 close > prior M1 high): ${recentM1.length >= 2 && lastCandleM1.close > recentM1[recentM1.length - 2].high ? 'YES — bullish M1 break of structure' : 'NO'}
- M1 BOS BEAR (last M1 close < prior M1 low): ${recentM1.length >= 2 && lastCandleM1.close < recentM1[recentM1.length - 2].low ? 'YES — bearish M1 break of structure' : 'NO'}
- M1 absorption wick (lower wick ≥1.5x body, last 2 candles): ${recentM1.slice(-2).some(c => { const b = Math.abs(c.close - c.open); const w = Math.min(c.open, c.close) - c.low; return b > 0 && w / b >= 1.5; }) ? 'YES — bullish absorption on M1' : 'NO'}
- M1 rejection wick (upper wick ≥1.5x body, last 2 candles): ${recentM1.slice(-2).some(c => { const b = Math.abs(c.close - c.open); const w = c.high - Math.max(c.open, c.close); return b > 0 && w / b >= 1.5; }) ? 'YES — bearish rejection on M1' : 'NO'}
I use this M1 picture to pick the exact moment the M5 leg restarts after a pullback. My TP target is unchanged — it is set by M5 exhaustion, not by anything I see here.` : `
HIERARCHY REMINDER: A single M1 rejection wick does NOT override an impulsive ${primaryTfConfig.label} leg.
If the ${primaryTfConfig.label} shows 3+ consecutive same-direction candles, the entry_advisory should be PULLBACK_EXPECTED
regardless of what M1 shows — unless there is exceptional breakaway evidence.`}
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
   - EXHAUSTED / EXTENDED (> 1.5x ATR): Move is extended. Document what you observe: available reversal setups, retest opportunities, sweep structures, or the absence of a clear directional case. State your exhaustion assessment explicitly and let your conviction score reflect it.

2. SUB-MODE: Identify which of these applies to the current M5 structure:
   - MOMENTUM_CONTINUATION: Fresh directional move, enter now or on first micro-pullback
   - PULLBACK_ENTRY: Impulse already moved, price retracing — wait for pullback completion
   - CONSOLIDATION_BREAKOUT: Tight compression range — wait for body close outside range

3. STRUCTURE: Identify which of the 8 named scalp structures is present (or closest match):
   momentum_breakout | bos_retest | ema_rejection | double_bottom | double_top |
   range_breakout | liquidity_sweep | engulfing_at_structure | trend_pullback_ema

   Identify which named structure best matches what you observe, or describe the structure in plain terms if none of the 8 names apply. Valid scalps include range boundaries (range top/bottom fades), session highs/lows, and any named price structure — textbook pattern names are not required. Document the structural basis you identified or the absence of one, and let your conviction score reflect that assessment.

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
            exhausted: 'EXHAUSTED / EXTENDED (> 1.5x ATR traveled — move is extended. Document what you observe: reversal setups, retests, sweep structures, or the absence of a directional case. State your exhaustion assessment explicitly and let your conviction score reflect it.)',
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
  ? `EXHAUSTED MOMENTUM: ATR traveled > 1.5x — this move is extended. Document what you observe: reversal setups, retests, sweep structures, or the absence of a directional case. Name any available structural signals (BOS, sweep extreme, EMA rejection, level reaction) and state your honest conviction about whether a directional case exists.`
  : scalpSignal.momentumPhase === 'developing'
    ? `DEVELOPING MOMENTUM: ~${scalpSignal.atrTraveled?.toFixed(2) ?? '?'}x ATR consumed. Range is partially used. Document remaining runway: state "Remaining runway: ~X pips to nearest structure. TP placed at [level] — the [near/far] edge of that zone." Document your entry_mode choice and the structural basis for it. Your conviction score reflects your honest assessment of whether runway is sufficient.`
    : `FRESH MOMENTUM: < 0.75x ATR consumed. Full confidence is available if structure supports it.`
}

${scalpSignal.scalpSubMode === 'pullback_entry'
  ? `PULLBACK ENTRY CONTEXT: The intelligence monitor identified a pullback phase. The sub-mode tool wait_condition block is available to define a limit entry zone. Document the current state of the retrace, your entry_mode choice, and the structural zone you are targeting or why current price is already at a valid entry.`
  : scalpSignal.scalpSubMode === 'consolidation_breakout'
    ? `CONSOLIDATION BREAKOUT CONTEXT: The intelligence monitor identified a compression range. A candle BODY close outside the range is the standard breakout trigger. Document whether the body close has or has not occurred, which entry_mode you selected, and your structural reasoning for that choice.`
    : `MOMENTUM CONTINUATION: Fresh directional move. Enter on the breakout or within the first 1-2 candle pullback.`
}


${scalpSignal.scalpPattern === 'none' || !scalpSignal.scalpPattern
  ? `NO NAMED STRUCTURE PRE-DETECTED: The intelligence monitor found no textbook match. Identify which of the 8 named structures best fits what you observe in the M5 data, or describe the structure you see in plain terms. Valid scalps include range boundary fades, session high/low reactions, and any named price structure — textbook pattern names are not required. Document the structural basis you identified or the absence of one. Set "scalp_pattern" to the closest match or your own description.`
  : `PATTERN DETECTED: ${patternLabels[scalpSignal.scalpPattern]} was pre-computed. Confirm this matches what you see or correct it in your reasoning. Include "scalp_pattern": "${scalpSignal.scalpPattern}" in your JSON output (or correct to a valid structure name).`
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

  marketContext.atr20  = SCALP primary ATR (20-period, M5-based)         — SCALP stop sizing reference (entry=M1, ATR stays M5) | Current: ${atr20Pips} pips
  marketContext.atr    = MICRO/INTRADAY ATR (14-period, M5/M15-based)     — MICRO_INTRADAY (M5) & INTRADAY (M15) stop reference  | Current: ${atrPips} pips
  (atr100 is a long-period H4 regime reference field — NOT populated, NOT used for stop sizing in any style)

ACTIVE ATR for this session (${tradeStyle}): ${activeAtrPips} pips — this is your baseline ATR (using ${preferredAtrField} field)
For INTRADAY: move stage thresholds below are computed from the same baseline. The H1 MOVE STAGE ADVISORY block (if present above) uses H1 candle-derived ATR for finer phase accuracy.

Use the ACTIVE ATR value above for all move stage calculations in this scan cycle:
  - FRESH / STARTING:  price has traveled < 0.75 × ${activeAtrPips} pips = < ${atrForStopLoss > 0 ? ((atrForStopLoss * 0.75) / pipInfoForLegend.pipValue).toFixed(1) : 'N/A'} pips from swing origin
  - DEVELOPING:        0.75–1.5 × ${activeAtrPips} pips = ${atrForStopLoss > 0 ? ((atrForStopLoss * 0.75) / pipInfoForLegend.pipValue).toFixed(1) : 'N/A'}–${atrForStopLoss > 0 ? ((atrForStopLoss * 1.5) / pipInfoForLegend.pipValue).toFixed(1) : 'N/A'} pips from swing origin
  - EXHAUSTED:         > 1.5 × ${activeAtrPips} pips = > ${atrForStopLoss > 0 ? ((atrForStopLoss * 1.5) / pipInfoForLegend.pipValue).toFixed(1) : 'N/A'} pips from swing origin${tradeStyle === 'SCALP' ? ' → ADVISORY: Move is extended. Name whether this is a reversal, retest, or sweep setup. Exhausted moves can produce strong reversals — reason honestly about whether a genuine directional case exists. Your confidence reflects your actual conviction.' : tradeStyle === 'INTRADAY' ? ' → ADVISORY: Move is extended. Reason about reversal, retest, or sweep opportunity. Recalculate R:R from current price. Name what structural case exists or why it does not. Your confidence reflects your actual conviction.' : tradeStyle === 'MICRO_INTRADAY' ? ' → ADVISORY: Move is extended. Name whether a structural reversal, retest, or sweep setup exists on M15. Exhausted M15 moves can produce strong reversals — reason honestly about the structural case. Your confidence reflects your actual conviction.' : ' → ADVISORY: Move is extended. Reason explicitly about continuation justification and current R:R from price.'}
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

NO_TRADE means genuine absence of directional edge — not absence of a perfect setup.

CONVICTION STANDARD — TIER-TO-ACTION MAP (CCIP-2026-0415A):
My confidence_tier determines which actions are available to me. This is not a formula — it is the honest relationship between structural clarity and execution readiness.

  no_read    → NO_TRADE only.
               Nothing credible visible. There is no direction to wait for. A wait on a no_read is waiting for nothing.

  low        → NO_TRADE or Wait Intent (execute_now is NOT available).
               A signal is present but structural basis is too thin to execute. I may see a directional lean,
               but valid stop placement cannot be confirmed or R:R is mathematically impossible at this level.
               If I have a directional lean and a zone to monitor: wait_pullback or push_confirmation.
               If even a lean cannot be structured: NO_TRADE.

  cautious   → NO_TRADE, Wait Intent, or Execute Now.
               Signal visible but significant structural gaps. If a lean can be structured with a named level
               and valid stop geometry: wait_pullback, push_confirmation, or execute_now.
               If the structural gaps are too severe to anchor a stop or identify a credible path: NO_TRADE.

  moderate   → NO_TRADE, Wait Intent, or Execute Now.
               Partial-to-solid structure. Direction is readable. I have identified a named level and a credible
               path. The only question is whether entry conditions are met now or require zone confirmation.
               If trigger has fired or price is at the structural level: execute_now.
               If price is extended and I want a better entry: wait_pullback or push_confirmation.
               If the structure I identified lacks the minimum geometry for a valid stop and 1:1 R:R: NO_TRADE.

  confident  → Wait Intent or Execute Now (NO_TRADE is NOT available at this tier).
  high       → Wait Intent or Execute Now (NO_TRADE is NOT available at this tier).
               Strong named structure, clean path, stop anchored. I trade this.
               If I want to wait for a zone pullback: wait_pullback or push_confirmation.
               If price is already at the level: execute_now.

  very_high  → Execute Now only (wait and NO_TRADE are NOT available at this tier).
  extreme    → Execute Now only (wait and NO_TRADE are NOT available at this tier).
               Exceptional or near-perfect structural clarity. The edge is live. Waiting surrenders it.
               execute_now is the only valid response.

My confidence_tier is my honest read of what the structural evidence shows. My action and entry_mode must be consistent with the permitted set for that tier. A response that selects an action outside the permitted set for the stated tier is a governance violation — the system will correct it.

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

${conflictContext}${regimeLocationConflictAdvisory}${advisoryContext}${riskContext}${rrPerformanceContext}${recentTradesContext}${dailyNarrativeContext}${microRegimeContext}${liquidityIntentContext}${momentumTrajectoryContext}${patternContext}${intelligenceContext}${hunterLearningContextText}${imSignalContext}${goalContextText}${liquidityContext}${constraintsText}

MARKET CONDITIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Current Market Price (${marketContext.symbol}): ${(marketContext.livePrice ?? marketContext.price).toFixed(pipInfoForLegend.decimalPlaces)} ← USE THIS as your entry/SL/TP anchor
  Volatility: ${volatilityRegime.regime.toUpperCase()} ${volatilityRegime.ratio !== 1.0 ? `(${volatilityRegime.ratio.toFixed(2)}x)` : ''} | ${volatilityRegime.recommendation}
  Spread (${marketContext.symbol}): ~${getEstimatedSpreadPips(marketContext.symbol).toFixed(1)} pips | Minimum viable SL: ${(getEstimatedSpreadPips(marketContext.symbol) * 1.5).toFixed(1)} pips (1.5x spread — SL below this will be hard-blocked)
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
${intradayMovePhaseContext}
${microIntradayMovePhaseContext}
${scalpMovePhaseContext}
${stopLossDirective}

Actions: BUY (bullish edge), SELL (bearish edge), NO_TRADE (no structural edge or hard block condition met).
When analyzing multiple pairs, execute the best opportunity. Scanner re-evaluates every cycle.
BUY: SL < Entry < TP | SELL: TP < Entry < SL

TAKE-PROFIT RULES (ALPHA SOLE AUTHORITY):
You choose ALL profit targets. No pre-computed ceiling exists. TP placement is driven entirely by market structure. The style envelope shown above is a structural reference — not a formula, not a constraint.
Process: (1) Find the directional edge. (2) Name the structural target. (3) Place TP there. (4) Calculate the R:R that results. If R:R ≥ 1:1 and the edge is real, execute. The minimum is 1.0:1 net of spread. Above that, TP goes where structure offers the most probable exit.

MANDATORY PRE-SUBMISSION R:R VERIFICATION (execute this as the final step before outputting JSON):
  Step A: Calculate my SL distance in pips — abs(entry - stopLoss).
  Step B: Calculate my TP distance in pips — abs(takeProfit - entry).
  Step C: Verify TP distance >= SL distance. If TP distance < SL distance, I have constructed a direction, not a trade. This geometry does not qualify as a trade candidate.
  Step D: If Step C fails — I do not submit. I select the next structural level further from entry that satisfies TP >= SL distance. If no such level exists after a genuine structural search, I output NO_TRADE with the specific structural reason.
  Example: SL is 57 pips from entry. My TP must be at least 57 pips from entry on the other side. A TP of 50 pips with a 57-pip SL = 0.88:1 = not a trade. I find the next structural level that puts TP at 57+ pips, or I output NO_TRADE.

- SCALP: ONE take-profit ("takeProfit"). Minimum R:R 1.0:1 net of spread — account for spread cost explicitly.
  Place TP where the M5 leg exhausts. The exit is not a structural destination — it is the point where M5 momentum dies. Look for: prior M5 swing already printed in the direction of travel, M5 equal highs/lows clustering (absorption), M5 candle bodies compressing as wicks extend (pace fading). Place TP at that M5 exhaustion point — not at a structural wall, not at an M15 level.
  M1 timing data (when present) refines the exact entry moment within the M5 structure — it does not change the TP target. The TP is always the nearest M5 exhaustion point. Name the M5 exhaustion signal in tp_structural_reference.
- MICRO_INTRADAY: Up to TWO take-profits. Minimum R:R 1.0:1.
  "tp1" = Where the M5 leg first exhausts. Look for: the nearest prior M5 swing already printed in the direction of travel, M5 equal highs/lows clustering (absorption), M5 candle pace visibly fading. That is TP1 — not a named M15 structural zone.
  "tp2" = Where the M5 leg exhausts a second time if one exists — a second prior M5 swing, a second cluster of equal highs/lows, a M5 FVG fill zone. TP2 R:R must be >= TP1 R:R. tp1 must be closer to entry than tp2.
  M15 tells you the direction. It does not set the destination. The destination is M5 exhaustion.
  TP2 RULE: If a distinct second M5 exhaustion point exists further from entry than TP1, include "tp2". If no clear second exhaustion point exists — omit "tp2" entirely (set to null or leave absent). Do NOT fabricate a TP2 by pointing at a M15 structural wall.
  TP1 RULE: If you include "tp2", then "tp1" is MANDATORY and must differ from "tp2". If only one M5 exhaustion point exists, output only "tp1".
  If the market only offers one reachable exhaustion point, output only "tp1" at that level. This is valid and will execute as a single-target trade.
  Document the M5 exhaustion signal identified for each TP and the R:R achievable from it.
- INTRADAY: Up to TWO take-profits. Minimum R:R 1.0:1.
  "tp1" = Where the M15 leg first exhausts. Look for: the nearest prior M15 swing already printed in the direction of travel, M15 equal highs/lows clustering (absorption), M15 candle bodies compressing as wicks extend (pace fading). That is TP1 — not a named H1 structural zone.
  "tp2" = Where the M15 leg exhausts a second time if one exists — a second prior M15 swing, a second cluster of equal highs/lows, a M15 FVG fill zone. TP2 R:R must be >= TP1 R:R. tp1 must be closer to entry than tp2.
  H1 confirms the directional bias. H1 does not set the exit price — M15 exhaustion does. H4 is background macro only — it has no role in TP placement.
  TP2 RULE: If a distinct second M15 exhaustion point exists further from entry than TP1, include "tp2". If no clear second exhaustion point exists — omit "tp2" entirely (set to null or leave absent). Do NOT fabricate a TP2 by pointing at an H1 or H4 structural wall.
  TP1 RULE: If you include "tp2", then "tp1" is MANDATORY and must differ from "tp2". If only one M15 exhaustion point exists, output only "tp1".
  If the market only offers one reachable exhaustion point, output only "tp1" at that level. This is valid and will execute as a single-target trade.
  Document the M15 exhaustion signal identified for each TP and the R:R achievable from it.

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
          content: `${systemFingerprint}\n\n${getAlphaSystemPromptForStyle(styleName)}`
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
      // TOKEN BUDGET — CCIP-2026-0406B (replaces CCIP-2026-0329A):
      // CCIP-2026-0329A set max_tokens=1500 based on 7-day p99=1,249 with 163-token margin.
      // Production evidence (2026-04-05 session): SPX500 hit finish_reason=length at 1500,
      // losing a confirmed SELL at trade_confidence=60 (visible in [Alpha Raw Response] diag).
      // Per the INVARIANT below, max_tokens is raised from 1500 → 2000.
      // stopLoss/takeProfit are the last fields in the JSON schema and first to be truncated.
      //
      // INVARIANT: If finish_reason === 'length' fires, TOKEN_BUDGET_EXCEEDED surfaces.
      //   Raise max_tokens if that fires — production data justifies current ceiling.
      model: 'gpt-4o',
      temperature: 0.3,
      max_completion_tokens: 2000,
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
        console.error(`[Alpha Coordinator] TOKEN_BUDGET_EXCEEDED: Response truncated (finish_reason=length) for ${marketContext.symbol}/${styleName}. stopLoss/takeProfit are MISSING. Current max_tokens=2000 (gpt-4o, CCIP-2026-0406B). Raise budget if this fires repeatedly.`);
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
        dualArenaWalls
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
          severity: 'medium',
          source: 'coordinator-alpha',
          description: `Sweep sensor data was present (sweep_type=${sweepFacts.sweep_type}, BOS=${sweepFacts.has_bos}) but Alpha omitted liquidity_sweep_read from answer_sheet. This is a MANDATORY field when sweep data is injected.`,
          symbol: marketContext.symbol,
          userId: userId || 'unknown',
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
          severity: 'low',
          source: 'coordinator-alpha',
          description: `Alpha omitted Q12_market_phase from answer_sheet. This is a mandatory field per CCIP-2026-0325A. Phase classification on the control TF is required for session-phase audit trail.`,
          symbol: marketContext.symbol,
          userId: userId || 'unknown',
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

      // CCIP-2026-0415A: Tier-to-action governance enforcement.
      // Updated: NO_TRADE now permitted at cautious and moderate (CCIP-2026-0422A).
      //
      // The tier-to-action map defines which outputs are permitted per confidence tier:
      //   no_read               → NO_TRADE only
      //   low                   → NO_TRADE or Wait Intent (execute_now forbidden)
      //   cautious, moderate    → NO_TRADE, Wait Intent, or Execute Now
      //   confident, high       → Wait Intent or Execute Now (NO_TRADE forbidden)
      //   very_high, extreme    → Execute Now only (wait and NO_TRADE forbidden)
      //
      // Violations are corrected here — the goal is to honour Alpha's intent while
      // enforcing the structural logic of the tier system.
      // Corrections applied:
      //   - NO_TRADE at confident/high → downgraded to wait_pullback BUY/SELL
      //     (Alpha has named structural clarity at these tiers — surfaced as a wait intent)
      //   - NO_TRADE at very_high/extreme → overridden to execute_now with the stated direction
      //     (exceptional clarity must result in execution)
      //   - execute_now at low → corrected to wait_pullback
      //     (low confidence cannot support an immediate market order)
      //   - wait_pullback/push_confirmation at very_high/extreme → corrected to execute_now
      //     (edge is live and sharp — waiting surrenders it)
      //   - NO_TRADE at no_read → passes through unchanged (valid)
      //   - NO_TRADE at low → passes through unchanged (valid when no lean can be structured)
      {
        const tier = confidenceTier as string | null;
        const NO_TRADE_FORBIDDEN_TIERS = new Set(['confident', 'high', 'very_high', 'extreme']);
        const EXECUTE_NOW_ONLY_TIERS = new Set(['very_high', 'extreme']);
        const WAIT_ONLY_TIERS = new Set(['low']);

        if (action === 'NO_TRADE' && tier && NO_TRADE_FORBIDDEN_TIERS.has(tier)) {
          // Alpha has structural clarity at this tier — NO_TRADE is not permitted.
          // We must surface his directional lean as a wait intent or execution.
          // Use directional_lean to determine the action, defaulting to BUY_LEAN path.
          const lean = (parsed.directional_lean as string | undefined) ?? 'NEUTRAL';
          const correctedAction = (lean === 'SELL_LEAN') ? 'SELL' : 'BUY';
          const correctedEntryMode = EXECUTE_NOW_ONLY_TIERS.has(tier) ? 'execute_now' : 'wait_pullback';
          console.warn(
            `[Alpha Coordinator] CCIP-2026-0415A: NO_TRADE_TIER_VIOLATION — ` +
            `Alpha returned NO_TRADE at confidence_tier="${tier}" where NO_TRADE is forbidden. ` +
            `Directional lean: ${lean}. ` +
            `Correcting to action=${correctedAction} entry_mode=${correctedEntryMode}. ` +
            `Symbol=${symbol}. All thesis fields preserved.`
          );
          // Mutate action and entry_mode on parsed object so downstream parse picks them up.
          // The thesis, levels, and all structural fields are preserved.
          (parsed as Record<string, unknown>).action = correctedAction;
          (parsed as Record<string, unknown>).entry_mode = correctedEntryMode;
          // If no wait_condition present, build a minimal one from SL geometry so the
          // entry monitor has a zone to work with. The executor will refine at execution.
          if (correctedEntryMode !== 'execute_now' && !parsed.wait_condition) {
            (parsed as Record<string, unknown>).wait_condition = {
              target_entry_zone_min: parsed.entry ?? currentPrice,
              target_entry_zone_max: parsed.entry ?? currentPrice,
              invalidation_price: parsed.stopLoss ?? parsed.stop_loss ?? currentPrice,
              wait_reasoning: `CCIP-2026-0415A: Auto-generated wait zone. Alpha chose NO_TRADE at tier=${tier} but this tier requires execution or wait. Zone inferred from entry geometry.`,
              expected_wait_minutes: 30,
            };
          }
          logViolation({
            violationType: 'NO_TRADE_TIER_VIOLATION',
            symbol: marketContext.symbol,
            attemptedOperation: 'no_trade_at_forbidden_tier',
            callLocation: 'coordinator-alpha.tier_action_governance',
            blocked: false,
            errorDetails: {
              tier,
              original_action: 'NO_TRADE',
              corrected_action: correctedAction,
              corrected_entry_mode: correctedEntryMode,
              directional_lean: lean,
              description: `NO_TRADE forbidden at tier=${tier}. Corrected to ${correctedAction}/${correctedEntryMode}.`,
            },
          }).catch(() => {});
        } else if (action === 'BUY' || action === 'SELL') {
          const rawEntryMode = (parsed.entry_mode as string | undefined) ?? (parsed.entry_spec?.entry_mode as string | undefined);
          if (tier && WAIT_ONLY_TIERS.has(tier) && rawEntryMode === 'execute_now') {
            // execute_now at low confidence — correct to wait_pullback
            console.warn(
              `[Alpha Coordinator] CCIP-2026-0415A: EXECUTE_NOW_AT_LOW_TIER — ` +
              `Alpha returned execute_now at confidence_tier="${tier}" where execute_now is forbidden. ` +
              `Correcting entry_mode: execute_now → wait_pullback. Symbol=${symbol}.`
            );
            (parsed as Record<string, unknown>).entry_mode = 'wait_pullback';
            logViolation({
              violationType: 'EXECUTE_NOW_AT_LOW_TIER',
              symbol: marketContext.symbol,
              attemptedOperation: 'execute_now_at_low_confidence',
              callLocation: 'coordinator-alpha.tier_action_governance',
              blocked: false,
              errorDetails: { tier, entry_mode_before: 'execute_now', entry_mode_after: 'wait_pullback' },
            }).catch(() => {});
          } else if (tier && EXECUTE_NOW_ONLY_TIERS.has(tier) && rawEntryMode && rawEntryMode !== 'execute_now') {
            // wait at very_high/extreme — edge is live, correct to execute_now
            console.warn(
              `[Alpha Coordinator] CCIP-2026-0415A: WAIT_AT_VERY_HIGH_TIER — ` +
              `Alpha returned entry_mode="${rawEntryMode}" at confidence_tier="${tier}" where only execute_now is permitted. ` +
              `Correcting entry_mode → execute_now. Symbol=${symbol}.`
            );
            (parsed as Record<string, unknown>).entry_mode = 'execute_now';
            logViolation({
              violationType: 'WAIT_AT_VERY_HIGH_TIER',
              symbol: marketContext.symbol,
              attemptedOperation: 'wait_at_very_high_confidence',
              callLocation: 'coordinator-alpha.tier_action_governance',
              blocked: false,
              errorDetails: { tier, entry_mode_before: rawEntryMode, entry_mode_after: 'execute_now' },
            }).catch(() => {});
          }
        }
      }

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
        logViolation({
          violationType: 'MISSING_ENTRY_MODE',
          symbol: marketContext.symbol,
          attemptedOperation: 'entry_mode_governance_check',
          callLocation: 'coordinator-alpha.entry_mode_governance',
          blocked: true,
          errorDetails: {
            action,
            tradeStyle,
            confidence: tradeConfidence,
            sessionId: goalContext?.sessionId ?? null,
            userId: userId ?? null,
          }
        }).catch(() => {});
        console.error(
          `[CCIP-2026-0333] MISSING_ENTRY_MODE — Alpha returned ${correctedAction} for ${marketContext.symbol} without entry_mode. ` +
          `Trade BLOCKED. Alpha must explicitly declare execution intent.`
        );
        return {
          action: 'NO_TRADE',
          decision: 'NO_TRADE',
          entry: currentPrice,
          stopLoss: currentPrice,
          takeProfit: currentPrice,
          confidence: tradeConfidence,
          reasoning: 'GOVERNANCE_BLOCK: Alpha omitted entry_mode — prompt compliance failure. Trade blocked.',
          omega_summary: '',
          risk_pct: 0,
          symbol: marketContext.symbol,
          decision_origin: 'ALPHA_BLOCKED_COMPLIANCE' as const,
          alpha_original_decision: {
            action: correctedAction as 'BUY' | 'SELL',
            entry: parsed.entry ?? currentPrice,
            stopLoss: parsed.stopLoss ?? currentPrice,
            takeProfit: parsed.takeProfit ?? currentPrice,
            confidence: tradeConfidence,
            reasoning: parsed.reasoning,
          },
        };
      } else {
        entryMode = parsed.entry_mode ?? parsed.entry_spec?.entry_mode;
      }

      // CCIP-2026-0333: Structural anchor validation — fail-loud, no synthesis.
      // If Alpha omits the anchor field, log a governance violation and preserve Alpha's
      // output as-is. The system must never substitute a field Alpha did not provide.
      const isAnchorVague = (s: string | null | undefined): boolean =>
        !s || s.trim().length < 10 ||
        ['null', 'n/a', 'required', 'none'].some(bad => s.trim().toLowerCase().includes(bad));

      if (action !== 'NO_TRADE' && tradeStyle === 'SCALP') {
        const raw = typeof parsed.scalp_structural_confirmation === 'string'
          ? parsed.scalp_structural_confirmation.trim()
          : null;
        if (isAnchorVague(raw)) {
          logViolation({
            violationType: 'MISSING_STRUCTURAL_ANCHOR',
            symbol: marketContext.symbol,
            attemptedOperation: 'scalp_anchor_check',
            callLocation: 'coordinator-alpha.scalp_anchor_governance',
            blocked: false,
            errorDetails: { style: 'SCALP', field: 'scalp_structural_confirmation', value: raw ?? null, sessionId: goalContext?.sessionId ?? null }
          }).catch(() => {});
          console.warn(`[CCIP-2026-0333] SCALP_NO_M5_ANCHOR: Alpha omitted scalp_structural_confirmation for ${marketContext.symbol}. Proceeding on Alpha confidence — violation logged.`);
        }
      }

      if (action !== 'NO_TRADE' && tradeStyle === 'MICRO_INTRADAY') {
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

      if (action !== 'NO_TRADE' && tradeStyle === 'INTRADAY') {
        const raw = typeof parsed.m15_structural_confirmation === 'string'
          ? parsed.m15_structural_confirmation.trim()
          : null;
        if (isAnchorVague(raw)) {
          logViolation({
            violationType: 'MISSING_STRUCTURAL_ANCHOR',
            symbol: marketContext.symbol,
            attemptedOperation: 'intraday_anchor_check',
            callLocation: 'coordinator-alpha.intraday_anchor_governance',
            blocked: false,
            errorDetails: { style: 'INTRADAY', field: 'm15_structural_confirmation', value: raw ?? null, sessionId: goalContext?.sessionId ?? null }
          }).catch(() => {});
          console.warn(`[CCIP-2026-0333] INTRADAY_NO_M15_ANCHOR: Alpha omitted m15_structural_confirmation for ${marketContext.symbol}. Proceeding on Alpha confidence — violation logged.`);
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
          tradeStyle,
          details: `Alpha returned ${action} for ${symbol} without a valid entry price. entry=${parsed.entry} (type: ${typeof parsed.entry}). This violates the output contract.`,
          severity: 'HIGH',
          blocked: true,
        }).catch(() => {});
        console.error(`[CCIP-2026-0333] MISSING_ENTRY_PRICE — Alpha returned ${action} for ${symbol} without a valid entry. entry=${parsed.entry}. Trade BLOCKED.`);
        return {
          action: 'NO_TRADE',
          decision: 'NO_TRADE',
          entry: currentPrice,
          stopLoss: currentPrice,
          takeProfit: currentPrice,
          confidence: 0,
          reasoning: `GOVERNANCE_BLOCK: Alpha returned ${action} without a valid entry price. Prompt compliance failure — Alpha must always provide entry for BUY/SELL.`,
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
          risk_pct: 0,
          decision_origin: 'ALPHA_BLOCKED_COMPLIANCE' as const,
          alpha_original_decision: {
            action: action as 'BUY' | 'SELL',
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
      const bucketEntries = Object.entries(intelligence.calibrationData)
        .filter(([, data]) => data.sampleSize >= 10)
        .sort(([a], [b]) => Number(a) - Number(b));
      const totalBuckets = bucketEntries.length;
      for (let i = 0; i < totalBuckets; i++) {
        const [, data] = bucketEntries[i];
        const tier = i < Math.floor(totalBuckets / 3)
          ? 'LOW_CONVICTION'
          : i < Math.floor(totalBuckets * 2 / 3)
            ? 'MID_CONVICTION'
            : 'HIGH_CONVICTION';
        const edge = data.actualWinRate >= 60 ? 'profitable edge' : data.actualWinRate >= 50 ? 'slight advantage' : data.actualWinRate >= 40 ? 'marginal performance' : 'underperforming';
        calibLines.push(`${tier}: ${edge} (n=${data.sampleSize})`);
      }
      if (calibLines.length > 0) parts.push(`conviction_performance: ${calibLines.join(', ')}`);
    }

    if (intelligence.metaInsights.length > 0) {
      const validated = intelligence.metaInsights.slice(0, 3).filter(i => i.validated);
      if (validated.length > 0) {
        parts.push('meta_insights:');
        validated.forEach(insight => parts.push(`  [validated] ${insight.type}: ${insight.description}`));
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
      Object.entries(zml.zoneTypeSuccessRates).forEach(([zoneType, rate]) => {
        const label = rate >= 0.60 ? 'high success' : rate >= 0.45 ? 'moderate success' : 'low success';
        zParts.push(`${zoneType}=${label}`);
      });
      if (zml.reachabilityRate > 0) {
        const reachLabel = zml.reachabilityRate >= 0.60 ? 'good reachability' : zml.reachabilityRate >= 0.40 ? 'moderate reachability' : 'poor reachability';
        zParts.push(`reach=${reachLabel}`);
      }
      const unreachable = Object.entries(zml.unreachableByRegime).filter(([, rate]) => rate > 0.3);
      unreachable.forEach(([regime]) => zParts.push(`${regime}_unreachable=often`));
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
        parts.push(`  [n=${insight.sampleSize}${winStr}] ${insight.title}: ${insight.description}`);
      });
    }

    if (intelligence.patternWeights && intelligence.patternWeights.length > 0) {
      const topPatterns = intelligence.patternWeights
        .filter(p => p.totalTrades >= 5)
        .sort((a, b) => b.advisoryWeight - a.advisoryWeight)
        .slice(0, 5);
      if (topPatterns.length > 0) {
        parts.push(`pattern_weights: ${topPatterns.map(p => {
          const edge = p.winRate >= 0.60 ? 'strong-edge' : p.winRate >= 0.50 ? 'positive-edge' : p.winRate >= 0.40 ? 'neutral' : 'weak-edge';
          return `${p.patternId}(w=${p.advisoryWeight.toFixed(1)} edge=${edge})`;
        }).join(' ')}`);
      }
    }

    if (intelligence.slHuntCorrections && symbol && intelligence.slHuntCorrections[symbol]) {
      const hunt = intelligence.slHuntCorrections[symbol];
      if (hunt.totalSlHits >= 3 && hunt.huntRate >= 0.3) {
        const huntSeverity = hunt.huntRate >= 0.6 ? 'frequent' : hunt.huntRate >= 0.4 ? 'moderate' : 'occasional';
        parts.push(`SL_HUNT (${symbol}): severity=${huntSeverity} n=${hunt.totalSlHits}${hunt.recommendedWidenPct > 0 ? ` — widen SL recommended` : ''}`);
      }
    }

    if (intelligence.sessionStreakState && intelligence.sessionStreakState.sessionTrades >= 2) {
      const streak = intelligence.sessionStreakState;
      const rawWr = streak.sessionTrades > 0 ? streak.sessionWins / streak.sessionTrades : 0;
      const wrLabel = rawWr >= 0.60 ? 'winning' : rawWr >= 0.50 ? 'breakeven' : 'losing';
      parts.push(`today: ${streak.sessionTrades}trades form=${wrLabel} PnL=${streak.sessionPnlR >= 0 ? '+' : ''}${streak.sessionPnlR.toFixed(2)}R${streak.currentStreak >= 3 ? ` [${streak.streakType.toUpperCase()} STREAK x${streak.currentStreak}]` : ''}`);
    }

    if (intelligence.tpDistributionStats && symbol) {
      const symStats = intelligence.tpDistributionStats[symbol];
      if (symStats) {
        const styleKeys = Object.keys(symStats).filter(k => symStats[k].totalTrades >= 5);
        if (styleKeys.length > 0) {
          parts.push(`tp_dist(${symbol}): ${styleKeys.map(s => {
            const d = symStats[s];
            const fullLabel = d.tpFullRate >= 0.50 ? 'frequent' : d.tpFullRate >= 0.30 ? 'occasional' : 'rare';
            const slLabel = d.slRate >= 0.50 ? 'high' : d.slRate >= 0.30 ? 'moderate' : 'low';
            return `${s}:full_tp=${fullLabel} sl_hit=${slLabel}(n=${d.totalTrades})`;
          }).join(' | ')}`);
        }
      }
    }

    if (intelligence.counterThesisAccuracy && symbol && intelligence.counterThesisAccuracy[symbol]) {
      const ct = intelligence.counterThesisAccuracy[symbol];
      if (ct.totalTrades >= 5) {
        const note = ct.calibrationError > 0.2 ? (ct.avgPredictedFailureRate > ct.actualFailureRate ? ' [over-cautious]' : ' [under-estimating risk]') : '';
        parts.push(`counter_thesis_cal(${symbol}): calibration=${ct.calibrationError <= 0.1 ? 'well-calibrated' : ct.calibrationError <= 0.2 ? 'slightly-off' : 'poorly-calibrated'}(n=${ct.totalTrades})${note}`);
      }
    }

    // CCIP-2026-0325B: Session-phase-style performance mirror
    // CCIP-2026-0407C: Numeric win-rate percentages removed — qualitative edge labels only.
    // Prevents GPT-4o from anchoring trade_confidence to historical win-rate numbers.
    if (intelligence.sessionPhasePerformance && intelligence.sessionPhasePerformance.length > 0) {
      parts.push('\nSESSION-PHASE-STYLE HISTORICAL EDGE (your empirical context profile):');
      parts.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      parts.push('Format: session|phase|style → edge profile | avg_pnl');

      const rows = intelligence.sessionPhasePerformance
        .slice(0, 20)
        .map(r => {
          const edgeLabel = r.win_rate >= 0.65 ? 'strong historical edge'
            : r.win_rate >= 0.55 ? 'positive historical edge'
            : r.win_rate >= 0.45 ? 'neutral historical edge'
            : r.win_rate >= 0.35 ? 'historically weak context'
            : 'historically poor context';
          const tradeCount = `(${r.wins}W/${r.losses}L)`;
          return `  ${r.session_name}|${r.market_phase}|${r.trade_style} → ${edgeLabel} ${tradeCount} $${Number(r.avg_pnl).toFixed(2)}/trade`;
        });

      parts.push(...rows);
      parts.push('INSTRUCTION: When my active session + current Q12 phase + active style matches a row above,');
      parts.push('I reference the edge profile as contextual information only. Edge labels describe historical');
      parts.push('context — they do not determine my trade_confidence. My confidence comes from the structural');
      parts.push('evidence I observe right now: structure quality, path cleanliness, trigger clarity.');
      parts.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }

    if (intelligence.setupTypeContextPerformance && intelligence.setupTypeContextPerformance.length > 0) {
      const setupRows = intelligence.setupTypeContextPerformance.slice(0, 15);
      parts.push('\nSETUP-TYPE HISTORICAL EDGE BY CONTEXT (empirical):');
      setupRows.forEach(r => {
        const edgeLabel = r.win_rate >= 0.60 ? 'strong edge'
          : r.win_rate >= 0.50 ? 'positive edge'
          : r.win_rate >= 0.40 ? 'neutral edge'
          : 'historically weak';
        const tradeCount = `(${r.wins}W/${r.losses}L)`;
        parts.push(`  ${r.session_name}|${r.market_phase}|${r.setup_type} → ${edgeLabel} ${tradeCount} $${Number(r.avg_pnl).toFixed(2)}/trade`);
      });
    }

    if (intelligence.phaseConfluenceCalibration && intelligence.phaseConfluenceCalibration.length > 0) {
      parts.push('\nCCIP-2026-0401A: PHASE-RELATIVE CONFLUENCE REQUIREMENTS (load-bearing signals only):');
      parts.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      parts.push('Format: phase|style → min/7 | load-bearing signals | edge status');
      intelligence.phaseConfluenceCalibration.forEach(row => {
        const edgeStatus = row.historical_win_rate !== null && row.sample_size >= 5
          ? (row.historical_win_rate >= 60 ? `calibrated edge (n=${row.sample_size})`
            : row.historical_win_rate >= 50 ? `positive tendency (n=${row.sample_size})`
            : `building data (n=${row.sample_size})`)
          : 'no data yet';
        const lb = row.load_bearing_dimensions.join('+');
        const edgeFlag = row.historical_win_rate !== null && row.historical_win_rate >= 60 ? ' [CALIBRATED EDGE]' : '';
        parts.push(`  ${row.market_phase}|${row.trade_style} → ${row.min_signals_required}/7 | ${lb} | ${edgeStatus}${edgeFlag}`);
      });
      parts.push('INSTRUCTION: When Q12 phase matches a row above, apply that row\'s min_signals to my Q7 evaluation.');
      parts.push('A setup meeting min_signals with ALL load-bearing dimensions firing = TRADEABLE regardless of universal count.');
      parts.push('My trade_confidence is my honest conviction derived from the structural evidence I observe — not a band, not a formula, not a range midpoint.');
      parts.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    }

    return parts.join('\n');
  }

}

export const alphaCoordinator = new AlphaCoordinatorBrain();
