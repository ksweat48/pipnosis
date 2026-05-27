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
// CCIP-2026-0512A RAW-DATA DOCTRINE: rrSuccessTracker import removed.
// The service remains available for dashboards but is forbidden from the
// coordinator prompt pipeline.
import { VALID_CONFIDENCE_TIERS, tierToNumber, CONFIDENCE_TIER_TO_NUMBER, deriveContinuousConfidence } from '../config/confidence-tier';
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
import { isIndex, isXAUUSD } from '../utils/currencyHelpers';
import type { ConflictInfo } from '../types/alpha-thesis';
import { calculateSessionContext } from '../utils/marketHours';
import type { EntrySpec, AlphaOutputFormat, StyleDisplayName } from '../types/entry';
import {
  ALPHA_IDENTITY,
  getAlphaSystemPromptForStyle
} from '../config/alpha-identity';
import {
  ALPHA_RESPONSE_FORMAT,
  MANDATORY_AUDIT_KEYS,
  detectMissingAuditKeys
} from '../config/alpha-output-schema';
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
  _h1_excluded_stale?: boolean;
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
  // CCIP-2026-0510C: Continuous confidence (0-100) inside the tier's band.
  // Blends (100 - Q5_failure_probability) and (100 - counter_thesis_probability)
  // so two "confident" reads no longer collapse to the same 65.
  confidence_continuous?: number;
  reasoning: string;
  omega_summary: string;
  omega_votes?: OmegaCouncilVotes;
  omega8_liquidity_bias?: string;
  omega9_validation?: Omega9ValidationResult;
  omega10_applied?: boolean;
  // CCIP-2026-0511H: Dual-advocate architecture collapsed to single-pass arbiter.
  // Alpha now reasons both BUY and SELL internally (see alpha-identity.ts + alpha-output-schema.ts
  // buy_case_reasoning / sell_case_reasoning / case_comparison / winning_direction fields).
  // The advocate_briefs persistence slot is preserved on the interface for historical records.
  advocate_briefs?: {
    buy: unknown;
    sell: unknown;
    generated_at: string;
  };
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
    // CCIP-2026-0518A: Devil's advocate architecture
    // Trade geometry (single directional plan)
    trade_geometry?: { direction: string; thesis: string; entry: number; sl: number; tp: number; probability: number; reward_pips: number; risk_pips: number };
    // Devil's advocate stress-test
    contradicting_evidence?: string[];
    thesis_survival_argument?: string;
    conviction_after_challenge?: boolean;
    // Sweep / reconciliation
    sweep_map_direction?: string;
    contradictions_fired?: string[];
    contradictions_scanned_count?: number;
    contradictions_unresolved_count?: number;
    reconciliation_ledger_complete?: boolean;
    // Free-form reasoning
    market_analysis?: string;
    direction_thesis?: string;
    invalidation_thesis?: string;
    reward_thesis?: string;
    risk_assessment?: string;
    session_context?: string | null;
    mtf_conflict_stance?: string | null;
    failure_scenario?: string;
    failure_probability?: number;
    // Sweep / liquidity
    sweep_reclaim_status?: string;
    trapped_fuel?: string;
    liquidity_sweep_read?: string;
    // Trap-aware geometry
    trap_map_invalidation_side?: string | null;
    trap_map_reward_side?: string | null;
    sl_sweep_risk_acknowledged?: string | null;
    entry_sweep_alignment?: string | null;
    tp_sweep_alignment?: string | null;
    trap_reconciliation_complete?: boolean | null;
    // RR profitability
    rr_planned_ratio?: number | null;
    breakeven_win_rate_implied?: number | null;
    rr_profitability_check?: string | null;
    rr_profitability_resolution?: string | null;
    // Entry sharpness
    m5_expected_mae_pips?: number | null;
    m5_mae_vs_risk_ratio?: number | null;
    entry_sharpness_check?: string | null;
    // SL reconciliation
    sl_distance_pips?: number | null;
    sl_distance_vs_m5_atr_ratio?: number | null;
    sl_distance_vs_mae_forecast_ratio?: number | null;
    sl_pool_clearance_pips?: number | null;
    sl_placement_verdict?: string | null;
    // TP geometry
    tp1_omitted?: boolean | null;
    tp1_omission_reason?: string | null;
    tp1_partial_value_pips?: number | null;
    tp1_partial_value_ratio?: number | null;
    tp2_omitted?: boolean | null;
    tp2_omission_reason?: string | null;
    // M5 hierarchy
    m5_micro_leg_state?: string | null;
    // Legacy fields (backward compat with stored records — never required in new schema)
    Q1_trend_alignment?: string;
    Q2_structure_level?: string;
    Q3_prior_rejections?: string;
    Q4_momentum_stage?: string;
    Q5_failure_mode?: string;
    Q5_failure_probability?: number;
    Q5B_objective_alignment?: string;
    Q6_entry_trigger?: string;
    Q7_confluence_count?: string;
    Q7_confluence_confirmed?: string;
    Q7_confluence_judgment?: string;
    Q8_move_position_pct?: number;
    Q8B_session_range_pct?: number;
    Q8C_price_location_zone?: string;
    kill_zone?: string;
    news_status?: string;
    equal_highs_lows?: string;
    trap_signature?: string;
    failed_auction?: string;
    intermarket_correlation?: string;
    Q9_sl_wick_proximity?: string;
    Q10_entry_conviction?: 'SNIPER' | 'ACCEPTABLE' | 'FORCED';
    Q11_zone_entry_quality?: 'PRECISE' | 'MID_ZONE' | 'DEEP_ZONE';
    Q12_market_phase?: string;
    session_high?: number | null | string;
    session_low?: number | null | string;
    prior_session_high?: number | null | string;
    prior_session_low?: number | null | string;
    session_sweep_status?: string;
    Q_SWEEP_RECLAIM_STATUS?: string;
    Q_SWEEP_MAP_DIRECTION?: string;
    Q_TRAPPED_FUEL?: string;
    Q4B_realtime_participant_read?: string;
    Q_PRICED_IN?: string;
    Q_LIQUIDITY_CASCADE?: string;
    Q_WHO_IS_TRAPPED?: string;
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
   * CCIP-2026-0511B: M5 TP CONTRACT proof fields — mandatory evidence that TP
   * placement was anchored to M5 leg reality rather than H1/M15 structure or
   * round numbers. Extracted directly from Alpha's answer_sheet + top-level
   * response. The coordinator rejects output whose proof fields are missing or
   * reference H1/M15/round-number anchors.
   */
  tp_structural_justification?: string;
  tp_m5_leg_length_pips?: number;
  tp_m5_consecutive_same_color_candles?: number;
  tp_m5_nearest_exhaustion_price?: number;
  tp_m5_nearest_exhaustion_reference?: string;
  tp1_m5_anchor_price?: number;
  tp1_m5_anchor_reference?: string;
  tp1_placement_vs_anchor?: 'before_anchor' | 'at_anchor' | 'beyond_pocket';
  tp2_m5_anchor_price?: number;
  tp2_m5_anchor_reference?: string;
  tp2_sequential_leg_justification?: string;
  tp_is_scalp_only?: boolean;
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
    // each scan must reason from live market data alone.
    // CCIP-2026-0512A RAW-DATA DOCTRINE: The rrSuccessTracker.getRecentPerformanceSummary()
    // call was excised here. That feed was surfacing win/loss aggregates, R:R success rates,
    // best/worst performing setups, and SL stop-out warnings into every scan — a direct
    // violation of the raw-data-only mandate. Alpha receives live market data only; trade
    // history is invisible to the live decision prompt. The service itself remains available
    // for dashboards/analytics but MUST NOT be called from the coordinator.
    const [, dailyNarrative, riskResultLong, riskResultShort, monitorPrefRaw] = await Promise.all([
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
    → Zone should be tight (1-3 pip width for FX, proportional for indices).
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

REMINDER: "entry_mode" must be a top-level key in your JSON response.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      : `ENTRY MODE — MONITOR OFF (CCIP-2026-0513M):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GOVERNANCE RULE (CCIP-2026-0333): Every BUY or SELL response MUST include "entry_mode" as a TOP-LEVEL field in the JSON.

monitor_active=false for this scan. wait_pullback / push_confirmation outputs are recorded as
monitor-required opportunities and surfaced to the user. The schema set is identical to monitor-on.

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

    // CCIP-2026-0512A RAW-DATA DOCTRINE: narrative conflictDescription and authority
    // sentence removed. Raw conflict flags only — Alpha interprets.
    let conflictContext = '';
    if (conflictInfo && conflictInfo.hasConflict) {
      conflictContext = `\nOMEGA CONFLICT FLAGS: type=${conflictInfo.conflictType} severity=${conflictInfo.severity}\n`;
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
      // CCIP-2026-0513M-SEALED-COORDINATOR: raw numerics only. No PREMIUM/DISCOUNT/EQUILIBRIUM
      // English. No regime English with .toUpperCase(). No "Derive Q8C" procedural teaching.
      // Alpha receives swing extremes and a position percentage; he reasons over the numbers.
      void regimeCategory;
      if (swingHigh && swingLow && swingHigh > swingLow) {
        const rangeSize = swingHigh - swingLow;
        const positionInRange = (currentPx - swingLow) / rangeSize;
        const positionPct = Math.round(positionInRange * 100);
        regimeLocationConflictAdvisory = `\nSWING_RANGE_RAW: swing_high=${swingHigh} swing_low=${swingLow} position_pct=${positionPct}\n`;
      }
    }

    // Build advisory context (Adversarial Detector + Regime Oracle)
    let advisoryContext = this.buildAdvisoryContext(adversarialSignal, regimeSnapshot);

    // CCIP-2026-0512A RAW-DATA DOCTRINE: rrPerformanceContext was deleted here.
    // Alpha must not see any historical performance aggregates, R:R success rates,
    // SL stop-out warnings, or best/worst performing tallies. Only live raw sensor
    // data is permitted in the prompt.

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

      goalContextText = `\nGOAL: $${goalContext.currentBalance.toFixed(0)} -> +$${goalContext.targetGoal.toFixed(0)} (${goalContext.goalPercentage.toFixed(3)}% gain) | Progress: $${goalContext.currentProgress.toFixed(0)}/${goalContext.targetGoal.toFixed(0)} | Remaining: $${goalContext.remainingGoal.toFixed(0)}\n${riskProfileText}\n`;
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
      // CCIP-2026-0512A RAW-DATA DOCTRINE: structureQuality label and "Observation:" lines
      // removed. Sweep facts surface as boolean flags with no narrative framing.
      dailyNarrativeContext += `Total daily displacement: ${dailyNarrative.dailyDisplacement.toFixed(1)} pips\n`;
      dailyNarrativeContext += `Current session: ${dailyNarrative.currentSession}\n`;
      if (dailyNarrative.asianRange) {
        dailyNarrativeContext += `Asian session range: high=${dailyNarrative.asianRange.high} low=${dailyNarrative.asianRange.low}\n`;
      }
      dailyNarrativeContext += `asian_low_swept=${dailyNarrative.liquiditySweeps.asianLowSwept} asian_high_swept=${dailyNarrative.liquiditySweeps.asianHighSwept} daily_high_tested=${dailyNarrative.liquiditySweeps.dailyHighTested} daily_low_tested=${dailyNarrative.liquiditySweeps.dailyLowTested}\n`;
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

            // CCIP-2026-0512A RAW-DATA DOCTRINE: Regime label, direction verdict, and
            // classification confidence removed. Alpha receives the raw indicator readings
            // and the baseline percentile thresholds and interprets them himself.
            microRegimeContext = `\nLIVE MARKET INDICATORS (vs ${regimeResult.thresholds.sampleCount}-sample ${marketContext.symbol} ${regimeSessionCtx.sessionName ?? ''} baseline):\n`;
            microRegimeContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            microRegimeContext += `Raw sensor readings and baseline percentile thresholds:\n`;
            microRegimeContext += `  ATR Expansion: ${regimeResult.indicators.atrExpansion.toFixed(2)}x (top-30%>${regimeResult.thresholds.atrExpansionP70.toFixed(2)}, top-15%>${regimeResult.thresholds.atrExpansionP85.toFixed(2)}, bottom-30%<${regimeResult.thresholds.atrExpansionP30.toFixed(2)})\n`;
            microRegimeContext += `  EMA50 Displacement: ${regimeResult.indicators.emaDisplacement.toFixed(2)}% (p80=${regimeResult.thresholds.emaDisplacementP80.toFixed(2)}, p90=${regimeResult.thresholds.emaDisplacementP90.toFixed(2)}, p95=${regimeResult.thresholds.emaDisplacementP95.toFixed(2)})\n`;
            microRegimeContext += `  RSI: ${regimeResult.indicators.rsi.toFixed(0)}\n`;
            microRegimeContext += `  Volume Ratio (recent5 / prior5): ${regimeResult.indicators.volumeRatio.toFixed(2)}x\n`;
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
            microRegimeContext += `  Volume Ratio (recent5 / prior5): ${regimeResult.indicators.volumeRatio.toFixed(2)}x\n`;
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
          // CCIP-2026-0513M-SEALED-COORDINATOR: symmetric sweep_type code in prompt.
          // sweep_type_code: +1=high-side sweep, -1=low-side sweep, 0=none.
          const sweepTypeCode = sweepFacts.sweep_type === 'high' ? 1 : sweepFacts.sweep_type === 'low' ? -1 : 0;
          console.log(`[Alpha Coordinator] Sweep facts extracted: sweep_type_code=${sweepTypeCode} | extreme @ ${sweepFacts.sweep_extreme_price.toFixed(priceDecimals)} | BOS:${sweepFacts.has_bos} | ${sweepFacts.candles_since_sweep} candles ago | wick:body ${sweepFacts.wick_to_body_ratio.toFixed(2)} | vol ratio ${sweepFacts.volume_ratio.toFixed(2)}x`);

          liquidityIntentContext = `\nLIQUIDITY SWEEP SENSOR DATA (Omega-8 observation — raw measurements only):\n`;
          liquidityIntentContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
          liquidityIntentContext += `sweep_type_code: ${sweepTypeCode}\n`;
          liquidityIntentContext += `Candles since sweep: ${sweepFacts.candles_since_sweep}\n`;
          liquidityIntentContext += `Sweep wick extreme: ${sweepFacts.sweep_extreme_price.toFixed(priceDecimals)}\n`;
          if (sweepFacts.nearest_cluster_price) {
            liquidityIntentContext += `nearest_cluster_price: ${sweepFacts.nearest_cluster_price.toFixed(priceDecimals)}\n`;
          }
          liquidityIntentContext += `bos_confirmed_post_sweep: ${sweepFacts.has_bos ? 1 : 0}\n`;
          liquidityIntentContext += `wick_to_body_ratio: ${sweepFacts.wick_to_body_ratio.toFixed(2)}\n`;
          liquidityIntentContext += `volume_ratio_vs_avg: ${sweepFacts.volume_ratio > 0 ? sweepFacts.volume_ratio.toFixed(2) : -1}\n`;
          liquidityIntentContext += `equal_highs_count: ${sweepFacts.equal_highs_count}\n`;
          liquidityIntentContext += `equal_lows_count: ${sweepFacts.equal_lows_count}\n`;
          liquidityIntentContext += `fvg_in_sweep_direction: ${sweepFacts.fvg_present_in_sweep_direction ? 1 : 0}\n`;
          liquidityIntentContext += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
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
        // CCIP-2026-0513J SEALED-PROMPT DOCTRINE: pattern analysis is direction-agnostic.
        // tradeDirection is a cache-key/audit-only sentinel — formatForAlphaPrompt emits
        // pure raw geometry (pattern types + price levels) and does not consume the
        // direction-conditional supports/opposes flags. This keeps the prompt symmetric
        // for buy/sell hypotheses; the prior hardcoded 'long' was a directional injection.
        const tradeDirection = 'long' as const;

        console.log('[Alpha Coordinator] Analyzing multi-timeframe patterns (structural, direction-agnostic)...');

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
    // CCIP-2026-0510J — HUNT_READINESS_GATE REMOVED
    // The readiness monitor is now a PARALLEL ADVISORY channel (armed/not_ready).
    // Alpha's pre-filter is never gated by it. Alpha always scans — finding
    // missed opportunities and golden nuggets remains Alpha's sovereign job.
    // The readiness advisory exists only to tell the user when to manually scan.
    // ═══════════════════════════════════════════════════════════════════

    // CCIP-2026-0424C: Fetch Alpha's own recent execution drift for this symbol/style
    // and inject into the prompt so Alpha self-calibrates stop sizing against observed
    // fill behavior. Pure reasoning feedback — not a gate.
    let huntContextForPrompt: {
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
    } | undefined;
    try {
      const { data: driftStats } = await supabase.rpc('get_recent_drift_stats', {
        p_symbol: marketContext.symbol,
        p_style: tradeStyle,
        p_lookback: 10,
      });
      const row = Array.isArray(driftStats) ? driftStats[0] : driftStats;
      if (row && typeof row.sample_size === 'number' && row.sample_size > 0) {
        huntContextForPrompt = {
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

    // CCIP-2026-0510B — Past-outcome feedback injections removed.
    // Alpha is a live in-the-moment reasoner. Past-trade outcomes (recent performance,
    // reasoning health watchers, dynamic tier targets, winning patterns, postmortems)
    // caused Alpha to anchor on stale situations rather than improve live decisions.
    // Audit trails remain for admin forensics but are no longer injected into the prompt.

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
        // CCIP-2026-0512A RAW-DATA DOCTRINE: directional labels "Long targets"/"Short targets"
        // removed. Zones are reported by raw geometric position (above/below current price).
        liquidityContext = `\nLIQUIDITY ZONES (raw geometric levels):\n`;
        liquidityContext += `ABOVE current price:\n`;
        longLiquidityZones.slice(0, 3).forEach((zone, idx) => {
          liquidityContext += `  ${idx + 1}. ${zone.type} @ ${zone.price.toFixed(5)} (${zone.distance_pips.toFixed(1)} pips, strength=${zone.strength})\n`;
        });
        liquidityContext += `BELOW current price:\n`;
        shortLiquidityZones.slice(0, 3).forEach((zone, idx) => {
          liquidityContext += `  ${idx + 1}. ${zone.type} @ ${zone.price.toFixed(5)} (${zone.distance_pips.toFixed(1)} pips, strength=${zone.strength})\n`;
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
      // The execution envelope encodes the correct TP max per asset class per style.
      // Using it directly eliminates ATR-compression artifacts while preserving all other
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
    // CCIP-2026-0521C: CONTEXTUAL AUTHORITY — no timeframe hierarchy imposed.
    // Alpha synthesizes all timeframes freely. SL/TP placed at M5 precision.
    const styleIdentityPrompt = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STYLE: MICRO_INTRADAY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SL/TP precision: M5. Directional decision: synthesize ALL timeframes (M5, M15, H1, D1).
Record m5_move_phase, m5_atr_traveled, m5_micro_leg_state in the JSON response — these are audit fields.
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
      // CCIP-2026-0512A RAW-DATA DOCTRINE: SL/TP AUTHORITY teaching sentence removed.
      // Alpha's sovereignty is codified in governance, not re-asserted in every prompt.
      const noiseFloorPips = omega9Constraints?.noiseFloorPips ?? 0;
      stopLossDirective = `
ATR: ${extractATRValue(marketContext.atr).toFixed(5)} (${atrPips} pips)
noise_floor: ${noiseFloorPips.toFixed(1)} pips
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
        // CCIP-2026-0512A RAW-DATA DOCTRINE: Prior-thesis direction bias, narrative,
        // and validation instructions removed. Replaying a cached verdict into the
        // prompt is interpretation injection. Alpha re-reasons from the live raw
        // sensor payload below. The cache remains as a cost-avoidance optimization
        // on the infrastructure side only — nothing about the prior decision is
        // surfaced back into the prompt body.
        cachedThesisPrompt = '';
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

      if (!primaryCandles || primaryCandles.length < 5) {
        // CCIP-2026-0513F-M5-PRIMARY-HIERARCHY: M5 is the battlefield where SL/TP
        // live. Missing M5 data is a hard fail — Alpha cannot reason about an
        // entry he cannot see. This is the ONLY hard timeframe gate under 0513F.
        console.error(`[Alpha Coordinator] M5_DATA_MISSING: primary M5 candles unavailable for ${styleName}. Returning NO_TRADE.`);
        if (userId && sessionId) {
          writeStructuralAlert({
            userId,
            sessionId,
            symbol: marketContext.symbol,
            style: tradeStyle,
            ruleType: 'M5_DATA_MISSING',
            direction: '',
            detailsText: `M5 primary timeframe candle data unavailable for ${styleName}. Found ${primaryCandles?.length ?? 0} candles (need ≥5). M5 is the battlefield; cannot proceed.`,
          });
        }
        return {
          action: 'NO_TRADE',
          decision: 'NO_TRADE',
          entry: marketContext.price,
          stopLoss: marketContext.price,
          takeProfit: marketContext.price,
          confidence: 0,
          reasoning: `M5_DATA_MISSING: M5 primary timeframe candle data is required for ${styleName} (M5 is where SL/TP are placed) but is unavailable. Cannot proceed without M5 battlefield data.`,
          decision_origin: 'SYSTEM_DATA_MISSING' as const,
        };
      }

      {
        const recentPrimary = primaryCandles.slice(0, primaryTfConfig.candleCount).reverse();
        const pipInfo = getCurrencyPipInfo(marketContext.symbol);

        // CCIP-2026-0510B-TOKEN-COMPRESSION-COLUMNAR-CANDLES: compact pipe-delimited format (~45% reduction vs labeled KV pairs)
        const primaryLines: string[] = recentPrimary.map((c, i) => {
          const dir = c.close > c.open ? 'UP' : c.close < c.open ? 'DN' : 'FLAT';
          const bodyPips = Math.abs(c.close - c.open) / pipInfo.pipValue;
          const upperWick = (c.high - Math.max(c.open, c.close)) / pipInfo.pipValue;
          const lowerWick = (Math.min(c.open, c.close) - c.low) / pipInfo.pipValue;
          return `${i + 1}|${dir}|${c.open.toFixed(pipInfo.decimalPlaces)}|${c.high.toFixed(pipInfo.decimalPlaces)}|${c.low.toFixed(pipInfo.decimalPlaces)}|${c.close.toFixed(pipInfo.decimalPlaces)}|${bodyPips.toFixed(1)}|${upperWick.toFixed(1)}|${lowerWick.toFixed(1)}`;
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
        // CCIP-2026-0513K-COORDINATOR-PROMPT-SEALING: emit symmetric ±1/0/-1 codes.
        // ema_stack_known=false signals UNKNOWN (insufficient EMA data); when known,
        // +1 = aligned up, -1 = aligned down, 0 = mixed.
        const emaStackKnown = ema20Val > 0 && ema50Val > 0;
        const emaStackCode = !emaStackKnown
          ? 0
          : (ema20AboveEma50 && priceAboveEma20 ? 1 : !ema20AboveEma50 && !priceAboveEma20 ? -1 : 0);
        const prevEma20 = primaryCloses.length >= 21 ? calculateEMA(primaryCloses.slice(0, -1), 20) : ema20Val;
        const ema20Slope = ema20Val > 0 && prevEma20 > 0 ? (ema20Val - prevEma20) / pipInfo.pipValue : 0;
        const ema20SlopeCode = Math.abs(ema20Slope) < 0.1 ? 0 : ema20Slope > 0 ? 1 : -1;

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

        // CCIP-2026-0511E: M5 BOS / sweep-wick evidence computed from the primary
        // 30-candle window. Replaces the deleted m5SubConfirmationPrompt's 10-candle
        // duplicate fetch. Mirrors the HTF structural evidence pattern.
        const primaryBOSBull = recentPrimary.length >= 2 && lastCandle.close > recentPrimary[recentPrimary.length - 2].high;
        const primaryBOSBear = recentPrimary.length >= 2 && lastCandle.close < recentPrimary[recentPrimary.length - 2].low;
        const primarySweepWickBull = recentPrimary.slice(-2).some(c => {
          const body = Math.abs(c.close - c.open);
          const wick = Math.min(c.open, c.close) - c.low;
          return body > 0 && wick / body >= 1.5;
        });
        const primarySweepWickBear = recentPrimary.slice(-2).some(c => {
          const body = Math.abs(c.close - c.open);
          const wick = c.high - Math.max(c.open, c.close);
          return body > 0 && wick / body >= 1.5;
        });

        // CCIP-2026-0421 (ALPHA SL SOVEREIGNTY): SL structural distance block removed.
        // Alpha reads recentPrimary candles directly and identifies his own structural
        // invalidation point without being shown pre-computed SL anchor prices or
        // "INSIDE/BELOW the wick range" framing.

        // ═══════════════════════════════════════════════════════════════════
        // MICRO_INTRADAY M5 MOVE PHASE & SWEEP ADVISORY
        // CCIP-2026-0513L-MOVE-PHASE-SEALING: English verdicts removed. Raw
        // numeric codes only per Sealed-Prompt Doctrine. Alpha classifies
        // phase and sweep polarity from raw measurements.
        //   move_phase_code: 0=fresh (<0.75x ATR), 1=developing (0.75-1.5x), 2=exhausted (>1.5x)
        //   last_candle_body: +1 (last candle closed up), -1 (closed down), 0 (flat)
        //   sweep_of_high_detected / sweep_of_low_detected: raw booleans
        //   sweep_reversal_confirmed: bool (subsequent candles printed in reclaim direction)
        // ═══════════════════════════════════════════════════════════════════
        if (atrForStopLoss > 0) {
          const m5AtrPips = (atrForStopLoss / pipInfo.pipValue);

          // CCIP-2026-0527A: Renamed from leg_direction to last_candle_body. This code
          // measures only whether the LAST M5 candle closed up or down — NOT structural leg direction.
          let swingOriginPriceM5 = recentPrimary[0].close;
          const legDirCode = lastCandle.close > lastCandle.open ? 1 : lastCandle.close < lastCandle.open ? -1 : 0;
          for (let i = recentPrimary.length - 2; i >= 0; i--) {
            const cDirCode = recentPrimary[i].close > recentPrimary[i].open ? 1 : recentPrimary[i].close < recentPrimary[i].open ? -1 : 0;
            if (cDirCode !== legDirCode && cDirCode !== 0) {
              swingOriginPriceM5 = legDirCode === 1 ? recentPrimary[i].low : recentPrimary[i].high;
              break;
            }
          }
          const distFromSwingPipsM5 = Math.abs(marketContext.price - swingOriginPriceM5) / pipInfo.pipValue;
          const atrTraveledM5window = m5AtrPips > 0 ? distFromSwingPipsM5 / m5AtrPips : 0;

          const hasMicroM15Anchor = m15SwingHighMicro > 0 && m15SwingLowMicro > 0;
          const m15AnchorOrigin = hasMicroM15Anchor
            ? (legDirCode === -1 ? m15SwingHighMicro : m15SwingLowMicro)
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

          const movePhaseCode = atrTraveledFinal < 0.75 ? 0 : atrTraveledFinal < 1.5 ? 1 : 2;

          // Sweep detection — symmetric raw flags. No directional verdict labels.
          let sweepOfHighDetected = false;
          let sweepOfLowDetected = false;
          let sweepCandlesAgo = 0;
          let sweepReversalConfirmed = false;
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
                sweepOfHighDetected = true;
                sweepCandlesAgo = recentFewM5micro.length - i;
                const nextCandles = recentPrimary.slice(recentPrimary.indexOf(c) + 1);
                sweepReversalConfirmed = nextCandles.some(nc => nc.close < nc.open);
                break;
              } else if (sweptLowM5micro) {
                sweepOfLowDetected = true;
                sweepCandlesAgo = recentFewM5micro.length - i;
                const nextCandles = recentPrimary.slice(recentPrimary.indexOf(c) + 1);
                sweepReversalConfirmed = nextCandles.some(nc => nc.close > nc.open);
                break;
              }
            }
          }

          // most_recent_extreme_break_code: +1 if a low was the most recent
          // extreme broken (sweep_of_low → BUY-favored reclaim setup), -1 if a
          // high was the most recent extreme broken (sweep_of_high → SELL-favored
          // reclaim setup), 0 if no sweep detected. This is the raw polarity
          // anchor Alpha needs to reconcile his exhaustion read against.
          const mostRecentExtremeBreakCode = sweepOfLowDetected ? 1 : sweepOfHighDetected ? -1 : 0;

          microIntradayMovePhaseContext = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M5 MOVE PHASE & SWEEP READINGS (${marketContext.symbol}) — RAW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
m5_atr_pips=${m5AtrPips.toFixed(1)}
atr_traveled_multiple=${atrTraveledFinal.toFixed(2)}
atr_traveled_pips=${(atrTraveledFinal * m5AtrPips).toFixed(1)}
move_phase_code=${movePhaseCode}
last_candle_body=${legDirCode}
m15_anchor_known=${hasMicroM15Anchor}
m15_anchor_origin=${hasMicroM15Anchor ? m15AnchorOrigin.toFixed(pipInfo.decimalPlaces) : 'N/A'}
m15_anchor_dist_pips=${hasMicroM15Anchor ? m15AnchorDistPips.toFixed(1) : 'N/A'}
m5_window_dist_pips=${distFromSwingPipsM5.toFixed(1)}
sweep_of_high_detected=${sweepOfHighDetected}
sweep_of_low_detected=${sweepOfLowDetected}
sweep_candles_ago=${sweepCandlesAgo}
sweep_reversal_confirmed=${sweepReversalConfirmed}
most_recent_extreme_break_code=${mostRecentExtremeBreakCode}
MANDATORY JSON FIELD — Include in your response:
  "m5_move_phase_code": ${movePhaseCode}
  "m5_atr_traveled": ${atrTraveledFinal.toFixed(2)}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.log(`[Alpha Coordinator] M5 phase_code=${movePhaseCode} last_candle=${legDirCode} atr_x=${atrTraveledFinal.toFixed(2)} sweep_high=${sweepOfHighDetected} sweep_low=${sweepOfLowDetected} reversal=${sweepReversalConfirmed} extreme_break=${mostRecentExtremeBreakCode}`);
        }

        // CCIP-2026-0527A: EMA SIGNAL DENSITY FIX. Previously 6 correlated ±1 codes
        // (price_vs_ema20, price_vs_ema50, price_vs_ema200, ema_stack, ema20_vs_ema50,
        // ema20_slope) created compound vote-weight bias during pullbacks. Now consolidated
        // into a single weighted composite score (-1.0 to +1.0) plus raw EMA prices for
        // geometric reasoning. Alpha sees ONE trend assessment, not 6 correlated votes.
        const priceVsEma20Code = ema20Val > 0 ? (priceAboveEma20 ? 1 : -1) : 0;
        const priceVsEma50Code = ema50Val > 0 ? (priceAboveEma50 ? 1 : -1) : 0;
        const priceVsEma200Code = ema200Val > 0 ? (priceAboveEma200 ? 1 : -1) : 0;
        const ema20VsEma50Code = (ema20Val > 0 && ema50Val > 0) ? (ema20AboveEma50 ? 1 : -1) : 0;

        // Weighted composite: EMA20 position (40%), EMA50 position (25%),
        // EMA20 vs EMA50 alignment (20%), slope (15%). EMA200 excluded — not
        // meaningful on 30 M5 candles (only 2.5h of data).
        let emaCompositeNumerator = 0;
        let emaCompositeDenominator = 0;
        if (ema20Val > 0) { emaCompositeNumerator += priceVsEma20Code * 0.40; emaCompositeDenominator += 0.40; }
        if (ema50Val > 0) { emaCompositeNumerator += priceVsEma50Code * 0.25; emaCompositeDenominator += 0.25; }
        if (ema20Val > 0 && ema50Val > 0) { emaCompositeNumerator += ema20VsEma50Code * 0.20; emaCompositeDenominator += 0.20; }
        if (ema20Val > 0) { emaCompositeNumerator += ema20SlopeCode * 0.15; emaCompositeDenominator += 0.15; }
        const emaComposite = emaCompositeDenominator > 0 ? emaCompositeNumerator / emaCompositeDenominator : 0;

        const emaContextBlock = (ema20Val > 0 || ema50Val > 0) ? `
${primaryTfConfig.label} EMA CONTEXT:
- ema20=${ema20Val > 0 ? ema20Val.toFixed(pipInfo.decimalPlaces) : 'N/A'}${ema20Pips !== null ? ` | dist=${ema20Pips.toFixed(1)}p` : ''}
- ema50=${ema50Val > 0 ? ema50Val.toFixed(pipInfo.decimalPlaces) : 'N/A'}${ema50Pips !== null ? ` | dist=${ema50Pips.toFixed(1)}p` : ''}${ema200Val > 0 ? `
- ema200=${ema200Val.toFixed(pipInfo.decimalPlaces)}${ema200Pips !== null ? ` | dist=${ema200Pips.toFixed(1)}p` : ''}` : ''}
- ema_trend_composite=${emaComposite.toFixed(2)} | ema20_slope_pips_per_candle=${ema20Slope.toFixed(2)}` : '';

        primaryTfCandlePrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${primaryTfConfig.label} CANDLES (${marketContext.symbol}) — 30 candles, newest last
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CANDLE FORMAT (columnar, pipe-delimited, oldest→newest): i|dir|O|H|L|C|body_p|upW_p|loW_p
- i: index (1=oldest). dir: UP/DN/FLAT. O/H/L/C: OHLC prices. body_p: body size in pips. upW_p/loW_p: upper/lower wick in pips.
- body_p, upW_p, loW_p are raw pip measurements.

i|dir|O|H|L|C|body_p|upW_p|loW_p
${primaryLines.join('\n')}

${primaryTfConfig.label} STRUCTURE SUMMARY:
- ${primaryTfConfig.label} Range: ${tfRangePips.toFixed(1)} pips (High: ${tfHigh.toFixed(pipInfo.decimalPlaces)}, Low: ${tfLow.toFixed(pipInfo.decimalPlaces)})
- Consecutive same-direction ${primaryTfConfig.label} candles: ${consecutiveSameDir}
- Last ${primaryTfConfig.label} candle: body=${lastBody.toFixed(1)}p upper_wick=${lastUpperWick.toFixed(1)}p lower_wick=${lastLowerWick.toFixed(1)}p
${emaContextBlock}
${primaryTfConfig.label} STRUCTURAL EVIDENCE (pre-computed from same window):
- BOS BULL (last close > prior high): ${primaryBOSBull ? 'YES' : 'NO'}
- BOS BEAR (last close < prior low): ${primaryBOSBear ? 'YES' : 'NO'}
- SWEEP WICK BULL (lower wick ≥1.5x body in last 2 candles): ${primarySweepWickBull ? 'YES' : 'NO'}
- SWEEP WICK BEAR (upper wick ≥1.5x body in last 2 candles): ${primarySweepWickBear ? 'YES' : 'NO'}
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
      if (marketContext._h1_excluded_stale) {
        console.warn(`[Alpha Coordinator] H1 EXCLUDED — stale data flagged by orchestrator freshness gate. Proceeding on M5 + M15 only.`);
        htfCandlePrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${htfConfig.label} CANDLES (${marketContext.symbol})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${htfConfig.label} candles excluded — data staleness detected by freshness gate. Data unavailable — non-blocking.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
      } else {
      try {
        const mds = MarketDataService.getInstance();
        const htfCandles = await mds.getCandles(marketContext.symbol, htfConfig.timeframe, htfConfig.candleCount);

        if (!htfCandles || htfCandles.length < 5) {
          // CCIP-2026-0513F-M5-PRIMARY-HIERARCHY: H1 is background context only —
          // never authority over an active M5 leg. Missing H1 data is a soft
          // advisory, NOT an execution gate. Alpha proceeds on M5 + M15.
          console.warn(`[Alpha Coordinator] H1 background context unavailable for ${styleName} (non-blocking under 0513F). Found ${htfCandles?.length ?? 0} candles.`);
          htfCandlePrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${htfConfig.label} CANDLES (${marketContext.symbol})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${htfConfig.label} candles unavailable. Data unavailable — non-blocking.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        } else {
        const recentHtf = htfCandles.slice(0, htfConfig.candleCount).reverse();
        const pipInfo = getCurrencyPipInfo(marketContext.symbol);

        // CCIP-2026-0510B-TOKEN-COMPRESSION-COLUMNAR-CANDLES
        const htfLines: string[] = recentHtf.map((c, i) => {
          const dir = c.close > c.open ? 'UP' : c.close < c.open ? 'DN' : 'FLAT';
          const bodyPips = Math.abs(c.close - c.open) / pipInfo.pipValue;
          const upperWick = (c.high - Math.max(c.open, c.close)) / pipInfo.pipValue;
          const lowerWick = (Math.min(c.open, c.close) - c.low) / pipInfo.pipValue;
          return `${i + 1}|${dir}|${c.open.toFixed(pipInfo.decimalPlaces)}|${c.high.toFixed(pipInfo.decimalPlaces)}|${c.low.toFixed(pipInfo.decimalPlaces)}|${c.close.toFixed(pipInfo.decimalPlaces)}|${bodyPips.toFixed(1)}|${upperWick.toFixed(1)}|${lowerWick.toFixed(1)}`;
        });

        const htfHigh = Math.max(...recentHtf.map(c => c.high));
        const htfLow = Math.min(...recentHtf.map(c => c.low));
        const htfRangePips = (htfHigh - htfLow) / pipInfo.pipValue;

        const lastHtfCandle = recentHtf[recentHtf.length - 1];
        const prevHtfCandle = recentHtf.length >= 2 ? recentHtf[recentHtf.length - 2] : lastHtfCandle;
        // CCIP-2026-0513K-COORDINATOR-PROMPT-SEALING: symmetric ±1/0/-1 code.
        const htfCloseVsPrevCode = lastHtfCandle.close > prevHtfCandle.close ? 1 : lastHtfCandle.close < prevHtfCandle.close ? -1 : 0;

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

        // CCIP-2026-0512B-MTF-LAYER-CONTRACT: Raw-data only. No verdicts, no teachings,
        // no "DIRECTION RULE" translation, no MANDATORY instructions, no tailwind/counter-trend
        // framing. Alpha reads the numbers and booleans and reasons from them.
        console.log(`[Alpha Coordinator] ${htfConfig.label} raw flags: BOS_BULL=${htfBOSBull} BOS_BEAR=${htfBOSBear} WICK_BULL=${htfSweepWickBull} WICK_BEAR=${htfSweepWickBear}`);

        htfCandlePrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${htfConfig.label} CANDLES (${marketContext.symbol})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMAT (columnar, oldest→newest): i|dir|O|H|L|C|body_p|upW_p|loW_p

i|dir|O|H|L|C|body_p|upW_p|loW_p
${htfLines.join('\n')}

${htfConfig.label} RAW READINGS (last ${htfConfig.candleCount} candles):
- range_pips=${htfRangePips.toFixed(1)}
- window_high=${htfHigh.toFixed(pipInfo.decimalPlaces)}
- window_low=${htfLow.toFixed(pipInfo.decimalPlaces)}
- consecutive_same_direction_candles=${htfConsecutive}
- bos_bull=${htfBOSBull}
- bos_bear=${htfBOSBear}
- sweep_wick_bull=${htfSweepWickBull}
- sweep_wick_bear=${htfSweepWickBear}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        console.log(`[Alpha Coordinator] ${htfConfig.label} Direction TF: ${recentHtf.length} candles, close_vs_prev=${htfCloseVsPrevCode}, range ${htfRangePips.toFixed(1)} pips`);
        }
      } catch (error) {
        console.warn(`[Alpha Coordinator] H1 background context fetch failed for ${styleName} (non-blocking under 0513F):`, error instanceof Error ? error.message : 'Unknown');
        htfCandlePrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${htfConfig.label} CANDLES (${marketContext.symbol})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${htfConfig.label} candle fetch failed. Data unavailable — non-blocking.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
      }
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // CCIP-2026-0427E-STYLE-CONSOLIDATION: H4 background block (INTRADAY-only) removed.
    const h4BackgroundPrompt = '';

    // ═══════════════════════════════════════════════════════════════════
    // CCIP-2026-0511E: m5SubConfirmationPrompt deleted. Its 10-candle M5 fetch
    // duplicated primaryTfCandlePrompt's 30-candle M5 window. BOS and sweep-wick
    // evidence is now computed inline in primaryTfCandlePrompt from the same
    // 30-candle window (primaryBOSBull/Bear, primarySweepWickBull/Bear). Zero
    // information loss — Alpha sees a wider M5 view with identical structural flags.
    // ═══════════════════════════════════════════════════════════════════

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

          // CCIP-2026-0510B-TOKEN-COMPRESSION-COLUMNAR-CANDLES (extended: + ratio% + wb)
          const m15DirLines: string[] = recentM15Dir.map((c, i) => {
            const dir = c.close > c.open ? 'UP' : c.close < c.open ? 'DN' : 'FLAT';
            const bodyPips = Math.abs(c.close - c.open) / pipInfo.pipValue;
            const upperWick = (c.high - Math.max(c.open, c.close)) / pipInfo.pipValue;
            const lowerWick = (Math.min(c.open, c.close) - c.low) / pipInfo.pipValue;
            const totalRange = (c.high - c.low) / pipInfo.pipValue;
            const bodyRatio = totalRange > 0 ? Math.round((bodyPips / totalRange) * 100) : 0;
            // CCIP-2026-0513M-SEALED-COORDINATOR: symmetric ±1/0/-1 wick-bias code.
            const wbCode = upperWick > lowerWick * 1.5 ? 1 : lowerWick > upperWick * 1.5 ? -1 : 0;
            return `${i + 1}|${dir}|${c.open.toFixed(pipInfo.decimalPlaces)}|${c.high.toFixed(pipInfo.decimalPlaces)}|${c.low.toFixed(pipInfo.decimalPlaces)}|${c.close.toFixed(pipInfo.decimalPlaces)}|${bodyPips.toFixed(1)}|${upperWick.toFixed(1)}|${lowerWick.toFixed(1)}|${bodyRatio}|${wbCode}`;
          });

          const lastM15Dir = recentM15Dir[recentM15Dir.length - 1];
          const prevM15Dir = recentM15Dir.length >= 2 ? recentM15Dir[recentM15Dir.length - 2] : lastM15Dir;
          // CCIP-2026-0513K-COORDINATOR-PROMPT-SEALING: symmetric ±1/0/-1 code.
          const m15CloseVsPrevCode = lastM15Dir.close > prevM15Dir.close ? 1 : lastM15Dir.close < prevM15Dir.close ? -1 : 0;
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

          // CCIP-2026-0512B-MTF-LAYER-CONTRACT: raw data only — no narrative framing,
          // no verdict labels, no directional teachings.
          m15DirectionPromptMicro = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M15 CANDLES (${marketContext.symbol})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMAT (columnar, oldest→newest): i|dir|O|H|L|C|body_p|upW_p|loW_p|ratio|wb  — ratio=body% of range, wb=+1 upper / -1 lower / 0 balanced.

i|dir|O|H|L|C|body_p|upW_p|loW_p|ratio|wb
${m15DirLines.join('\n')}

M15 RAW READINGS (last ${recentM15Dir.length} candles):
- range_pips=${m15DirRangePips.toFixed(1)}
- window_high=${m15SwingHighMicro.toFixed(pipInfo.decimalPlaces)}
- window_low=${m15SwingLowMicro.toFixed(pipInfo.decimalPlaces)}
- consecutive_same_direction_candles=${m15DirConsecutive}
- last_candle_rejection_wick=${m15DirRejectionWick}
- bos_bull=${m15DirBOSBull}
- bos_bear=${m15DirBOSBear}
- sweep_wick_bull=${m15DirSweepWickBull}
- sweep_wick_bear=${m15DirSweepWickBear}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.log(`[Alpha Coordinator] M15 Direction (MICRO_INTRADAY): ${recentM15Dir.length} candles, close_vs_prev=${m15CloseVsPrevCode}, BOS_BULL=${m15DirBOSBull} BOS_BEAR=${m15DirBOSBear}, High=${m15SwingHighMicro.toFixed(pipInfo.decimalPlaces)} Low=${m15SwingLowMicro.toFixed(pipInfo.decimalPlaces)}`);
        } else {
          m15DirectionPromptMicro = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M15 CANDLES (${marketContext.symbol}) — DATA UNAVAILABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M15 candles unavailable (${m15DirCandles?.length ?? 0} found, need ≥5). Data unavailable — non-blocking.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
          console.warn(`[Alpha Coordinator] M15 direction data insufficient for MICRO_INTRADAY (${m15DirCandles?.length ?? 0} candles)`);
        }
      } catch (error) {
        m15DirectionPromptMicro = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M15 CANDLES (${marketContext.symbol}) — FETCH ERROR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
M15 candle fetch failed. Data unavailable — non-blocking.
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
      // CCIP-2026-0512B-MTF-LAYER-CONTRACT: D1 now served as raw columnar candles
      // (symmetric with H1/M15) plus raw PDH/PDL numerics. 10 candles gives Alpha
      // a two-week daily structural window to reason from without verdicts.
      const d1FetchCount = 10;
      const d1Candles = await mds.getCandles(marketContext.symbol, 'D1', d1FetchCount);

      if (d1Candles && d1Candles.length >= 2) {
        const pipInfo = getCurrencyPipInfo(marketContext.symbol);
        const prevDayCandle = d1Candles[1];
        const prevDayHigh = prevDayCandle.high;
        const prevDayLow = prevDayCandle.low;
        const prevDayClose = prevDayCandle.close;
        const prevDayOpen = prevDayCandle.open;
        const prevDayRange = (prevDayHigh - prevDayLow) / pipInfo.pipValue;
        const prevDayDate = prevDayCandle.time
          ? new Date(prevDayCandle.time * 1000).toISOString().split('T')[0]
          : 'N/A';

        const currentPrice = marketContext.livePrice ?? marketContext.price;
        const distToPDH = Math.abs(currentPrice - prevDayHigh) / pipInfo.pipValue;
        const distToPDL = Math.abs(currentPrice - prevDayLow) / pipInfo.pipValue;

        // ═══════════════════════════════════════════════════════════════════
        // CCIP-2026-0511E: PWH/PWL (W1 fetch) deleted. Weekly levels rarely
        // fired within 10-pip relevance window for MICRO_INTRADAY entries;
        // PDH/PDL + round numbers provide sufficient institutional reference.
        // Saves ~150 tokens/call + one MarketDataService round-trip.
        // ═══════════════════════════════════════════════════════════════════
        // ROUND NUMBERS: Compute nearest round price levels for TP path audit.
        // For FX pairs: major round = 00-pip (X.XX00), minor round = 50-pip (X.XX50).
        // For indices/metals: nearest 100 and 50 levels.
        const isIndexOrMetal = ['US30', 'NAS100', 'XAUUSD', 'XAGUSD'].includes(marketContext.symbol);
        let roundStep: number;
        let minorStep: number;
        if (isIndexOrMetal) {
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
        const roundNumbersBlock = `ROUND NUMBERS (raw price levels):
  major_above=${nearestMajorAbove.toFixed(pipInfo.decimalPlaces)} (${distToMajorAbove.toFixed(1)} pips)
  minor_above=${nearestMinorAbove.toFixed(pipInfo.decimalPlaces)} (${distToMinorAbove.toFixed(1)} pips)
  minor_below=${nearestMinorBelow.toFixed(pipInfo.decimalPlaces)} (${distToMinorBelow.toFixed(1)} pips)
  major_below=${nearestMajorBelow.toFixed(pipInfo.decimalPlaces)} (${distToMajorBelow.toFixed(1)} pips)`;

        const pdRangePips = prevDayHigh - prevDayLow;
        const pricePositionInPDRange = pdRangePips > 0
          ? ((currentPrice - prevDayLow) / pdRangePips * 100).toFixed(0)
          : '50';

        const abovePDH = currentPrice > prevDayHigh;
        const belowPDL = currentPrice < prevDayLow;
        const nearPDH = distToPDH < prevDayRange * 0.05;
        const nearPDL = distToPDL < prevDayRange * 0.05;

        // CCIP-2026-0512B-MTF-LAYER-CONTRACT: Build raw D1 columnar table
        // (oldest→newest), symmetric with H1 and M15 layers. Alpha reads raw
        // OHLC + wick structure himself without verdict narratives.
        const d1AscCandles = [...d1Candles].reverse();
        const d1Lines: string[] = [];
        d1AscCandles.forEach((c, idx) => {
          const dir = c.close > c.open ? 'U' : c.close < c.open ? 'D' : '=';
          const body = Math.abs(c.close - c.open) / pipInfo.pipValue;
          const upWick = (c.high - Math.max(c.open, c.close)) / pipInfo.pipValue;
          const loWick = (Math.min(c.open, c.close) - c.low) / pipInfo.pipValue;
          d1Lines.push(
            `${idx}|${dir}|${c.open.toFixed(pipInfo.decimalPlaces)}|${c.high.toFixed(pipInfo.decimalPlaces)}|${c.low.toFixed(pipInfo.decimalPlaces)}|${c.close.toFixed(pipInfo.decimalPlaces)}|${body.toFixed(1)}|${upWick.toFixed(1)}|${loWick.toFixed(1)}`
          );
        });

        d1ContextPrompt = `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
D1 CANDLES (${marketContext.symbol})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FORMAT (columnar, oldest→newest): i|dir|O|H|L|C|body_p|upW_p|loW_p

i|dir|O|H|L|C|body_p|upW_p|loW_p
${d1Lines.join('\n')}

D1 RAW READINGS:
- prev_day_date=${prevDayDate}
- PDH=${prevDayHigh.toFixed(pipInfo.decimalPlaces)}
- PDL=${prevDayLow.toFixed(pipInfo.decimalPlaces)}
- PDC=${prevDayClose.toFixed(pipInfo.decimalPlaces)}
- prev_day_range_pips=${prevDayRange.toFixed(1)}
- dist_to_PDH_pips=${distToPDH.toFixed(1)}
- dist_to_PDL_pips=${distToPDL.toFixed(1)}
- price_position_in_PD_range_pct=${pricePositionInPDRange}
- above_PDH=${abovePDH}
- below_PDL=${belowPDL}
- near_PDH=${nearPDH}
- near_PDL=${nearPDL}
${roundNumbersBlock}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
        console.log(`[Alpha Coordinator] D1 raw readings: PDH=${prevDayHigh.toFixed(pipInfo.decimalPlaces)} PDL=${prevDayLow.toFixed(pipInfo.decimalPlaces)} range=${prevDayRange.toFixed(1)}p pos=${pricePositionInPDRange}%`);
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
    // ═══════════════════════════════════════════════════════════════════
    // CCIP-2026-0511E: m1MicroContextPrompt deleted. M1 data duplicated
    // primary M5 timing signal; pulled ~400 tokens/call with no brain lift.
    // Alpha's M5 primary window (30 candles) already provides sufficient
    // timing refinement via primaryBOSBull/Bear + primarySweepWickBull/Bear.
    // ═══════════════════════════════════════════════════════════════════

    // ═══════════════════════════════════════════════════════════════════
    // IM SIGNAL CONTEXT: Pre-computed per-symbol intelligence from the
    // session_intelligence_data table. Applies to ALL trade styles.
    // Advisory only — Alpha retains full decision authority.
    // ═══════════════════════════════════════════════════════════════════
    // CCIP-2026-0513J SEALED-PROMPT DOCTRINE: IM signal emitted as RAW numerics only.
    // No "Directional Bias: SELL" verdict text. Alpha receives the raw pair score and
    // a symmetric +1/0/-1 direction code; he reasons about its meaning himself.
    let imSignalContext = '';
    if (imSignal && typeof imSignal === 'object') {
      const direction = imSignal.direction as string | undefined;
      const imConfidence = imSignal.confidence as number | undefined;
      const imScore = imSignal.score as number | undefined;

      const hasUsefulData = direction !== undefined || imScore !== undefined || imConfidence !== undefined;
      if (hasUsefulData) {
        const dirCode = direction === 'long' || direction === 'buy' || direction === 'bull'
          ? 1
          : direction === 'short' || direction === 'sell' || direction === 'bear'
            ? -1
            : 0;
        imSignalContext = `
INTELLIGENCE_MONITOR_RAW (${marketContext.symbol}): dir_code:${dirCode} pair_score:${imScore !== undefined ? imScore.toFixed(2) : 'null'} signal_conf:${imConfidence !== undefined ? imConfidence.toFixed(3) : 'null'}
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

MOVE_PHASE_THRESHOLDS_PIPS (for move stage calculations from swing origin):
  phase_0_max=${atrForStopLoss > 0 ? ((atrForStopLoss * 0.75) / pipInfoForLegend.pipValue).toFixed(1) : 'N/A'}
  phase_1_max=${atrForStopLoss > 0 ? ((atrForStopLoss * 1.5) / pipInfoForLegend.pipValue).toFixed(1) : 'N/A'}
  active_atr_pips=${activeAtrPips}
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

SCHEMA NOTE — confidence_tier permitted values: no_read, confident, very_confident, extremely_confident. Legacy tiers (low, cautious, moderate, high, very_high, extreme) are schema violations.

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

${conflictContext}${regimeLocationConflictAdvisory}${advisoryContext}${riskContext}${dailyNarrativeContext}${microRegimeContext}${liquidityIntentContext}${momentumTrajectoryContext}${patternContext}${intelligenceContext}${imSignalContext}${goalContextText}${liquidityContext}${constraintsText}

EXECUTION ANCHORS (price/ATR/spread already in briefing above — these are execution-only rules):
- Entry/SL/TP price anchor: ${(marketContext.livePrice ?? marketContext.price).toFixed(pipInfoForLegend.decimalPlaces)}
- Volatility guidance: ${volatilityRegime.recommendation}
- Minimum viable SL: ${getMinSlDistancePips(marketContext.symbol).toFixed(1)} pips (1.5x spread — SL below this is hard-blocked)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LAYER 4 — RAW CANDLE EVIDENCE (Interpret through macro lens above)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${m5ContextPrompt}
${primaryTfCandlePrompt}
${htfCandlePrompt}
${h4BackgroundPrompt}
${m15DirectionPromptMicro}
${m15ReferencePrompt}
${h1CampaignPrompt}
${d1ContextPrompt}
${scalpIntelligencePrompt}
${microIntradayMovePhaseContext}
${stopLossDirective}

Actions: BUY (bullish edge), SELL (bearish edge), NO_TRADE (no structural edge or hard block condition met).
When analyzing multiple pairs, execute the best opportunity. Scanner re-evaluates every cycle.
BUY: SL < Entry < TP | SELL: TP < Entry < SL

TAKE-PROFIT RULES (ALPHA SOLE AUTHORITY) — DISPLACEMENT TARGETS:
You choose ALL profit targets. No pre-computed ceiling exists. TP placement is driven entirely by where the displacement exhausts.
Process: (1) Identify the displacement trigger. (2) Name the structural magnet price will sprint toward. (3) Place TP there. (4) Calculate the R:R that results.

MICRO_INTRADAY uses TWO take-profits. TP1 captures the first structural fill on the sprint path. TP2 captures where the displacement exhausts (the structural magnet).
Minimum R:R 1.0:1 net of spread applies to TP2. Trades should resolve within 30-120 minutes — if the target requires longer, it is too far.

MANDATORY PRE-SUBMISSION GEOMETRY VERIFICATION (execute this as the final step before outputting JSON):
  Step A: Calculate my SL distance in pips — abs(entry - stopLoss).
  Step B: Verify SL distance >= minimum viable SL shown above (${getMinSlDistancePips(marketContext.symbol).toFixed(1)} pips for ${marketContext.symbol}). If my SL distance is below this floor, the position cannot survive the spread — widen the SL to the next structural level that clears this floor. If no structural anchor exists at or beyond the floor, I output NO_TRADE.
  Step C: Calculate my TP2 distance in pips — abs(tp2 - entry).
  Step D: Verify TP2 distance >= SL distance. If TP2 distance < SL distance, I have constructed a direction, not a trade. I select the next structural level further from entry that satisfies TP2 >= SL distance. If no such level exists after a genuine structural search, I output NO_TRADE with the specific structural reason.
  EURUSD example (Step B): Minimum SL = 3.0 pips. If my structural SL is at 2.8 pips, I widen to the next structural extreme that is >= 3.0 pips. I do NOT submit a 2.8 pip SL — it will be hard-blocked before execution.
  Geometry example (Step D): SL is 57 pips. My TP2 must be >= 57 pips. A TP2 of 50 pips with a 57-pip SL = 0.88:1 = not a trade.

- MICRO_INTRADAY: TWO take-profits. Minimum R:R 1.0:1 on TP2. REASONING ORDER IS FIXED — find TP2 first, then find TP1 inside.
  "tp2" (FIND FIRST) = Where the displacement EXHAUSTS — the structural magnet price is sprinting toward (M5 swing extreme, equal highs/lows cluster, untouched liquidity pool, or FVG fill zone). This is WHERE the sprint ends. MANDATORY. Do NOT fabricate TP2 by pointing at an M15 structural wall — name the M5 exhaustion point where the displacement energy runs out.
  "tp1" (FIND SECOND, INSIDE TP2) = The first structural fill on the sprint path. The highest-probability level price will reach quickly between entry and TP2. Scan M5 for: a prior M5 swing already printed between entry and TP2, M5 equal highs/lows clustering on the path, or an M5 FVG fill zone between entry and TP2. MANDATORY. Must be closer to entry than TP2.
  ${filterTF} shows you the displacement narrative. ${primaryTF} shows you where the sprint lands. The destination is always the ${primaryTF} structural magnet.
  tp1 must be closer to entry than tp2. TP2 R:R must be >= TP1 R:R.
  Document the displacement trigger and the structural magnet for each level.

${entryModePromptSection}

My answer_sheet is an audit trail. I fill every field honestly — what I see informs my confidence. My action and trade_confidence are always my own judgment.

Return PURE JSON only — all required fields from the schema in my system prompt must be present.`;

    // Emit final progress thought before LLM call (this is the 6.3s phase)
    if (sessionId && userId) {
      alphaThoughtStream.emitAlphaFinalDecision(sessionId, userId, marketContext.symbol).catch(err => {
        console.warn('[Alpha Coordinator] Failed to emit final decision thought:', err);
      });
    }

    // CCIP-2026-0511H — SINGLE-PASS DUAL-REASONING ARBITER.
    //
    // Replaces CCIP-2026-0510A (dual-advocate, 3 LLM calls per symbol) with a
    // single-pass arbiter that internally reasons both BUY and SELL cases before
    // committing to a direction. The reasoning obligations live in alpha-identity.ts
    // and are enforced structurally by the schema (buy_case_reasoning,
    // sell_case_reasoning, case_comparison, winning_direction, why_losing_case_rejected).
    // Alpha still audits both sides — the audit is now inside his own head, not
    // distributed across two gpt-4o-mini calls.
    //
    // Why this is reasoning-preserving (and not a constraint removal):
    //   - Alpha's own prompt mandates the internal dual audit.
    //   - The schema REQUIRES the five dual-reasoning fields — missing any of them
    //     is a transport-layer rejection.
    //   - trade_geometry / contradicting_evidence / thesis_survival_argument /
    //     conviction_after_challenge remain mandatory answer_sheet keys.
    //
    // Why this restores caching:
    //   - The system message is now byte-identical across all symbols in a scan
    //     and across scans until alpha-identity.ts changes. OpenAI KV-prefix cache
    //     hits on the huge identity block. Per-request uniqueness moves to the
    //     tail of the user message via injectCacheBustFingerprint().
    //
    // Why wall-clock drops ~2/3:
    //   - 3 LLM calls per symbol -> 1 LLM call per symbol.
    //   - At 2-wide concurrency, 9 symbols = 5 waves × ~22s = ~110s total,
    //     comfortably within the council timeout.
    const buildAlphaMessages = () => {
      return [
        {
          role: 'system' as const,
          content: getAlphaSystemPromptForStyle(styleName, huntContextForPrompt)
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
      // CCIP-2026-0510L: Pinned to gpt-4o-2024-08-06 because OpenAI Structured
      // Outputs (response_format.json_schema.strict=true) requires this dated
      // alias or newer. The plain 'gpt-4o' alias can resolve to an older model
      // that silently ignores strict schemas and returns abbreviated completions
      // missing the 10 mandatory audit keys (CCIP-2026-0508C gate trigger).
      model: 'gpt-4o-2024-08-06',
      temperature: 0.3,
      max_completion_tokens: 5000,
      requestType: 'alpha_coordination',
      endpoint: 'alpha-coordinator',
      symbol: marketContext.symbol,
      // CCIP-2026-0510L: Bind Alpha's output shape at the transport layer.
      // OpenAI will refuse responses missing any of the 10 mandatory audit
      // keys — this is Alpha's I/O contract made structural, not a new gate.
      // SSOT: src/config/alpha-output-schema.ts.
      response_format: ALPHA_RESPONSE_FORMAT
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
            // CCIP-2026-0511H: retryLabel no longer threaded into messages (cache-bust
          // fingerprint moved to openai-client.ts injectCacheBustFingerprint tail of
          // last user message). retryLabel is retained only for observability logging.
          void retryLabel;
          const retryResponse = await openAIClient.chat(buildAlphaMessages(), alphaCallOptions);
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

      // CCIP-2026-0511H: Dual-advocate architecture collapsed. Alpha now audits
      // BUY and SELL cases internally within a single arbiter call — see
      // alpha-output-schema.ts buy_case_reasoning / sell_case_reasoning /
      // case_comparison / winning_direction fields. The legacy advocate_briefs
      // slot is no longer populated.

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

      // ═══════════════════════════════════════════════════════════════════
      // CCIP-2026-0510L: SINGLE-SHOT SCHEMA REPAIR LOOP
      // ═══════════════════════════════════════════════════════════════════
      // Belt-and-suspenders for the primary defense (response_format.json_schema
      // on the arbiter call). In normal operation OpenAI refuses to return a
      // response missing any of the 10 mandatory audit keys — the strict schema
      // handles it at the transport layer. But if the API ever drifts, the
      // dated-model alias is bumped, or a caller forgets to attach the schema,
      // this loop fires ONE repair request with a minimal "fill the missing
      // fields" prompt and merges the result back into the decision.
      //
      // If the repair call also returns incomplete, we fall through to the
      // CCIP-2026-0508C HARD GATE which rewrites to NO_TRADE. The repair loop
      // is strictly recovery — it cannot weaken the audit contract.
      // ═══════════════════════════════════════════════════════════════════
      try {
        const missingAfterParse = detectMissingAuditKeys(decision as unknown);
        if (missingAfterParse.length > 0) {
          const primaryFinishReason =
            (response.choices?.[0] as { finish_reason?: string } | undefined)?.finish_reason ?? null;
          const primaryCached = response.usage?.prompt_tokens_details?.cached_tokens ?? 0;
          const primaryPrompt = response.usage?.prompt_tokens ?? 0;
          const primaryCompletion = response.usage?.completion_tokens ?? 0;
          const primaryCachePct = primaryPrompt > 0
            ? Math.round((primaryCached / primaryPrompt) * 100)
            : 0;

          // ═══════════════════════════════════════════════════════════════
          // CCIP-2026-0511U: REPAIR GATED ON TRADE-DECISION COMPLETENESS
          // ═══════════════════════════════════════════════════════════════
          // Under the 60s Netlify hard ceiling, firing a second LLM round-
          // trip for every symbol whose primary response lacks audit
          // extras (contradictions_*, hypothesis_*, Q_SWEEP_MAP_DIRECTION,
          // reconciliation_ledger_complete, etc.) doubles per-symbol
          // latency and caused every 7-symbol cycle to time out at the
          // 210s council gate, producing 7/7 SYSTEM_GATE NO_TRADEs.
          //
          // The primary trade decision (action + entry + stopLoss +
          // takeProfit + thesis + confidence_tier) is authoritative on
          // its own. Audit-extras from CCIP-2026-0508C / 0510A are
          // governance telemetry — valuable but NOT required for the
          // trade itself. If the primary response has a complete trade
          // decision, we accept it, log the missing audit keys for
          // governance, and skip the repair call.
          //
          // Repair fires ONLY when the trade decision itself is
          // structurally incomplete (no action, or action is BUY/SELL
          // without entry/SL/TP).
          // ═══════════════════════════════════════════════════════════════
          const dForGate = decision as Record<string, unknown>;
          const actionVal =
            typeof dForGate.action === 'string'
              ? (dForGate.action as string).toUpperCase()
              : null;
          const hasDirectionalAction = actionVal === 'BUY' || actionVal === 'SELL';
          const hasNoTradeAction = actionVal === 'NO_TRADE';
          const entryOk = typeof dForGate.entry === 'number' && Number.isFinite(dForGate.entry);
          const slOk = typeof dForGate.stopLoss === 'number' && Number.isFinite(dForGate.stopLoss);
          const tpOk =
            typeof dForGate.takeProfit === 'number' && Number.isFinite(dForGate.takeProfit);
          const thesisOk =
            typeof dForGate.thesis === 'string' && (dForGate.thesis as string).trim().length > 0;
          const confidenceTierOk =
            typeof dForGate.confidence_tier === 'string' &&
            (dForGate.confidence_tier as string).trim().length > 0;

          const tradeDecisionComplete =
            (hasDirectionalAction && entryOk && slOk && tpOk && thesisOk && confidenceTierOk) ||
            (hasNoTradeAction && thesisOk);

          if (tradeDecisionComplete) {
            console.warn(
              `[Alpha Coordinator] CCIP-2026-0511U REPAIR_SKIPPED: trade decision complete for ${marketContext.symbol} ` +
              `(action=${actionVal}) but ${missingAfterParse.length} audit-extras missing: ${missingAfterParse.join(',')}. ` +
              `finish_reason=${primaryFinishReason ?? 'n/a'} prompt_tokens=${primaryPrompt} completion_tokens=${primaryCompletion} ` +
              `cache_hit=${primaryCachePct}%. Accepting primary response; logging omission for governance.`
            );
            supabase.from('alpha_audit_incidents').insert({
              symbol: marketContext.symbol,
              style: styleName,
              incident_type: 'repair_skipped_trade_complete',
              missing_keys: missingAfterParse,
              prompt_tokens: primaryPrompt || null,
              completion_tokens: primaryCompletion || null,
              cached_tokens: primaryCached || null,
              cache_hit_pct: primaryPrompt > 0 ? primaryCachePct : null,
              finish_reason: primaryFinishReason,
              model: 'gpt-4o-2024-08-06',
              strict_mode: true,
              metadata: {
                phase: 'primary_response',
                ccip: 'CCIP-2026-0511U',
                action: actionVal,
                reason: 'trade_decision_complete_repair_bypassed_for_latency'
              }
            }).then(({ error }) => {
              if (error) {
                console.warn('[Alpha Coordinator] alpha_audit_incidents insert failed (non-fatal):', error.message);
              }
            });
            (decision as Record<string, unknown>).schema_repair_skipped = true;
            (decision as Record<string, unknown>).schema_repair_skipped_missing = missingAfterParse;
            // Short-circuit: do not dispatch the repair LLM call.
            throw new Error('__CCIP_0511U_REPAIR_SKIPPED__');
          }

          console.warn(
            `[Alpha Coordinator] CCIP-2026-0510L SCHEMA_REPAIR: ${missingAfterParse.length} mandatory audit keys missing ` +
            `after primary Alpha response for ${marketContext.symbol}. Missing=${missingAfterParse.join(',')}. ` +
            `finish_reason=${primaryFinishReason ?? 'n/a'} prompt_tokens=${primaryPrompt} completion_tokens=${primaryCompletion} ` +
            `cache_hit=${primaryCachePct}%. Trade decision incomplete — requesting single-shot repair.`
          );

          // CCIP-2026-0511M: Persist incident telemetry (fire-and-forget).
          supabase.from('alpha_audit_incidents').insert({
            symbol: marketContext.symbol,
            style: styleName,
            incident_type: primaryFinishReason === 'length' ? 'truncation' : 'schema_repair',
            missing_keys: missingAfterParse,
            prompt_tokens: primaryPrompt || null,
            completion_tokens: primaryCompletion || null,
            cached_tokens: primaryCached || null,
            cache_hit_pct: primaryPrompt > 0 ? primaryCachePct : null,
            finish_reason: primaryFinishReason,
            model: 'gpt-4o-2024-08-06',
            strict_mode: true,
            metadata: { phase: 'primary_response' }
          }).then(({ error }) => {
            if (error) {
              console.warn('[Alpha Coordinator] alpha_audit_incidents insert failed (non-fatal):', error.message);
            }
          });

          const repairMessages = [
            ...buildAlphaMessages(),
            {
              role: 'assistant' as const,
              content: JSON.stringify({
                action: decision.action,
                entry: decision.entry,
                stopLoss: decision.stopLoss,
                takeProfit: decision.takeProfit,
                answer_sheet: (decision as any).answer_sheet ?? {}
              })
            },
            {
              role: 'user' as const,
              content:
                `Your previous response omitted these mandatory audit keys: ${missingAfterParse.join(', ')}. ` +
                `Return ONLY a JSON object whose "answer_sheet" property contains ALL of the missing keys with ` +
                `genuine values derived from the same reasoning that produced your previous decision. ` +
                `Do not restate fields that were already present. Do not change your action, entry, stopLoss, ` +
                `takeProfit, or confidence_tier. The response MUST conform to the AlphaDecision schema.`
            }
          ];

          try {
            const repairResponse = await openAIClient.chat(repairMessages, {
              ...alphaCallOptions,
              max_completion_tokens: 2500,
              requestType: 'alpha_coordination_repair'
            });
            const repairContent = repairResponse.choices[0]?.message?.content || '{}';
            const repairParsed = tryParseLLMResponse(repairContent) ?? {};
            const repairSheet =
              repairParsed && typeof repairParsed === 'object' && repairParsed !== null &&
              'answer_sheet' in (repairParsed as Record<string, unknown>) &&
              typeof (repairParsed as Record<string, unknown>).answer_sheet === 'object'
                ? ((repairParsed as Record<string, unknown>).answer_sheet as Record<string, unknown>)
                : (repairParsed as Record<string, unknown>);

            const dMut = decision as Record<string, unknown>;
            const existingSheet =
              dMut.answer_sheet && typeof dMut.answer_sheet === 'object'
                ? (dMut.answer_sheet as Record<string, unknown>)
                : {};
            const mergedSheet: Record<string, unknown> = { ...existingSheet };
            let repairedCount = 0;
            for (const key of MANDATORY_AUDIT_KEYS) {
              if (
                (mergedSheet[key] == null) &&
                Object.prototype.hasOwnProperty.call(repairSheet, key) &&
                repairSheet[key] != null
              ) {
                mergedSheet[key] = repairSheet[key];
                repairedCount++;
              }
            }
            dMut.answer_sheet = mergedSheet;

            const stillMissing = detectMissingAuditKeys(decision as unknown);
            console.log(
              `[Alpha Coordinator] CCIP-2026-0510L SCHEMA_REPAIR complete for ${marketContext.symbol}: ` +
              `repaired=${repairedCount}, still_missing=${stillMissing.length} (${stillMissing.join(',') || 'none'}).`
            );
            if (stillMissing.length === 0 && typeof (dMut as any).decision_origin === 'string') {
              // Mark that repair was needed so analytics can track drift from the primary schema path.
              (dMut as any).schema_repair_applied = true;
            }

            // CCIP-2026-0511M: Persist repair outcome.
            const repairedKeys = MANDATORY_AUDIT_KEYS.filter(k => {
              const v = (mergedSheet as Record<string, unknown>)[k];
              return v != null;
            });
            supabase.from('alpha_audit_incidents').insert({
              symbol: marketContext.symbol,
              style: styleName,
              incident_type: stillMissing.length === 0 ? 'repair_success' : 'repair_failure',
              missing_keys: stillMissing.length > 0 ? stillMissing : null,
              repaired_keys: repairedKeys,
              prompt_tokens: repairResponse.usage?.prompt_tokens ?? null,
              completion_tokens: repairResponse.usage?.completion_tokens ?? null,
              cached_tokens: repairResponse.usage?.prompt_tokens_details?.cached_tokens ?? null,
              finish_reason:
                (repairResponse.choices?.[0] as { finish_reason?: string } | undefined)?.finish_reason ?? null,
              model: 'gpt-4o-2024-08-06',
              strict_mode: true,
              metadata: { phase: 'repair_response', repaired_count: repairedCount }
            }).then(({ error }) => {
              if (error) {
                console.warn('[Alpha Coordinator] repair outcome insert failed (non-fatal):', error.message);
              }
            });
          } catch (repairErr) {
            console.error(
              `[Alpha Coordinator] CCIP-2026-0510L SCHEMA_REPAIR request failed for ${marketContext.symbol}:`,
              repairErr
            );
            supabase.from('alpha_audit_incidents').insert({
              symbol: marketContext.symbol,
              style: styleName,
              incident_type: 'repair_failure',
              missing_keys: missingAfterParse,
              error_message: repairErr instanceof Error ? repairErr.message : String(repairErr),
              model: 'gpt-4o-2024-08-06',
              strict_mode: true,
              metadata: { phase: 'repair_exception' }
            }).then(({ error }) => {
              if (error) {
                console.warn('[Alpha Coordinator] repair failure insert failed (non-fatal):', error.message);
              }
            });
          }
        }
      } catch (repairLoopErr) {
        // CCIP-2026-0511U: Short-circuit signal — expected, not an error.
        if (
          repairLoopErr instanceof Error &&
          repairLoopErr.message === '__CCIP_0511U_REPAIR_SKIPPED__'
        ) {
          // Intentional bypass; governance logged above.
        } else {
          console.error('[Alpha Coordinator] CCIP-2026-0510L repair-loop evaluation error:', repairLoopErr);
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // CCIP-2026-0518A: MANDATORY AUDIT FIELDS — HARD GATE
      // ═══════════════════════════════════════════════════════════════════
      // This is an OUTPUT-SCHEMA COMPLETENESS GATE, not new trading logic.
      // Alpha's prompt mandates a devil's advocate stress-test and a
      // contradiction reconciliation ledger. If any mandatory field is
      // missing/invalid on a directional output, the coordinator rewrites
      // to NO_TRADE. On a NO_TRADE output incompleteness is audited.
      //
      // Fields enforced (CCIP-2026-0518A):
      //   1.  trade_geometry (non-null object with entry/sl/tp/reward_pips/risk_pips)
      //   2.  contradicting_evidence (non-empty array)
      //   3.  thesis_survival_argument (non-empty string)
      //   4.  conviction_after_challenge (boolean)
      //   5.  sweep_map_direction (BUY_FAVORED | SELL_FAVORED | BALANCED | INVERTED)
      //   6.  contradictions_fired (array)
      //   7.  contradictions_scanned_count (integer >= 5)
      //   8.  contradictions_unresolved_count (integer; must be 0 for execute_now)
      //   9.  reconciliation_ledger_complete (boolean true for execute_now)
      //   10. rr_planned_ratio (number)
      //   11. rr_profitability_check (PROFITABLE | MARGINAL | UNPROFITABLE)
      //
      // Direction-integrity cross-checks (hard-block):
      //   A. trade_geometry.direction !== action → reject
      //   B. conviction_after_challenge=false + execute_now → reject
      //   C. Q_SWEEP_RECLAIM_STATUS contains NO_RECLAIM / wait_pullback text
      //      while entry_mode=execute_now → reject
      // ═══════════════════════════════════════════════════════════════════
      try {
        const asRaw = (decision as Record<string, unknown>).answer_sheet as
          | Record<string, unknown>
          | undefined;
        const asTop = decision as Record<string, unknown>;
        const pickField = (name: string): unknown =>
          asRaw && Object.prototype.hasOwnProperty.call(asRaw, name)
            ? asRaw[name]
            : asTop[name];

        const missing: string[] = [];
        const invalid: string[] = [];

        // CCIP-2026-0520A: Moved declarations here to fix temporal dead zone ReferenceError
        const actionNorm = typeof decision.action === 'string'
          ? decision.action.trim().toUpperCase()
          : '';
        const entryMode = typeof (decision as Record<string, unknown>).entry_mode === 'string'
          ? ((decision as Record<string, unknown>).entry_mode as string)
          : '';

        // CCIP-2026-0518A: trade_geometry replaces dual-hypothesis objects
        const tradeGeom = pickField('trade_geometry');
        if (tradeGeom == null || typeof tradeGeom !== 'object') {
          missing.push('trade_geometry');
        } else {
          const geom = tradeGeom as Record<string, unknown>;
          if (typeof geom.entry !== 'number' || typeof geom.sl !== 'number' || typeof geom.tp !== 'number') {
            invalid.push('trade_geometry has null/missing entry/sl/tp');
          }
          if (typeof geom.reward_pips !== 'number' || typeof geom.risk_pips !== 'number') {
            invalid.push('trade_geometry has null/missing reward_pips/risk_pips');
          }
          if (typeof geom.direction === 'string' && geom.direction !== actionNorm) {
            invalid.push(`DIRECTION_MISMATCH: trade_geometry.direction=${geom.direction} vs action=${actionNorm}`);
          }
        }

        // CCIP-2026-0518A: Devil's advocate — contradicting_evidence must be non-empty array
        const contradictingEvidence = pickField('contradicting_evidence');
        if (!Array.isArray(contradictingEvidence) || contradictingEvidence.length === 0) {
          missing.push('contradicting_evidence');
        }

        // CCIP-2026-0518A: thesis_survival_argument must be non-empty string
        const survivalArg = pickField('thesis_survival_argument');
        if (typeof survivalArg !== 'string' || survivalArg.trim().length === 0) {
          missing.push('thesis_survival_argument');
        }

        // CCIP-2026-0518A: conviction_after_challenge must be boolean
        const conviction = pickField('conviction_after_challenge');
        if (typeof conviction !== 'boolean') {
          missing.push('conviction_after_challenge');
        }

        // CCIP-2026-0518A: conviction_after_challenge=false + execute_now is contradictory
        if (conviction === false && entryMode === 'execute_now') {
          invalid.push('CONVICTION_CONTRADICTION: conviction_after_challenge=false with entry_mode=execute_now');
        }

        const sweepMapDir = pickField('sweep_map_direction') || pickField('Q_SWEEP_MAP_DIRECTION');
        const validSweepMapDir = ['BUY_FAVORED', 'SELL_FAVORED', 'BALANCED', 'INVERTED'];
        if (typeof sweepMapDir !== 'string' || !validSweepMapDir.includes(sweepMapDir.trim().toUpperCase())) {
          if (sweepMapDir == null || sweepMapDir === '') missing.push('sweep_map_direction');
          else invalid.push(`sweep_map_direction=${String(sweepMapDir)}`);
        }

        // Derive winningNorm from trade_geometry.direction for downstream compatibility
        const winningNorm = actionNorm;

        // CCIP-2026-0518A: losing_hypothesis_disqualifier retired (replaced by contradicting_evidence)

        const contradictionsFired = pickField('contradictions_fired');
        if (!Array.isArray(contradictionsFired)) missing.push('contradictions_fired');

        const scannedCount = pickField('contradictions_scanned_count');
        if (typeof scannedCount !== 'number' || !Number.isFinite(scannedCount)) {
          missing.push('contradictions_scanned_count');
        } else if (scannedCount < 5) {
          invalid.push(`contradictions_scanned_count=${scannedCount} (<5)`);
        }

        const unresolvedCount = pickField('contradictions_unresolved_count');
        if (typeof unresolvedCount !== 'number' || !Number.isFinite(unresolvedCount)) {
          missing.push('contradictions_unresolved_count');
        }

        const ledgerComplete = pickField('reconciliation_ledger_complete');
        if (typeof ledgerComplete !== 'boolean') missing.push('reconciliation_ledger_complete');

        const isDirectional = actionNorm === 'BUY' || actionNorm === 'SELL';
        const isExecuteNow = entryMode === 'execute_now';

        // Direction-integrity A: trade_geometry.direction must match executing action
        // (already checked above via tradeGeom validation; winningNorm === actionNorm by definition)

        // Direction-integrity B: sweep-reclaim self-contradiction against execute_now
        const sweepReclaim = pickField('sweep_reclaim_status') || pickField('Q_SWEEP_RECLAIM_STATUS');
        if (isExecuteNow && typeof sweepReclaim === 'string') {
          const srUpper = sweepReclaim.toUpperCase();
          if (
            srUpper.includes('NO_RECLAIM') ||
            srUpper.includes('WAIT_PULLBACK') ||
            srUpper.includes('NO_SWEEP_PENDING') ||
            srUpper.includes('NO_RECLAIM_PENDING')
          ) {
            invalid.push(`SWEEP_RECLAIM_SELF_CONTRADICTION: sweep_reclaim_status contradicts execute_now`);
          }
        }

        // For execute_now on directional trades, ledger must be complete and no unresolved contradictions.
        if (isDirectional && isExecuteNow) {
          if (ledgerComplete !== true) {
            invalid.push('reconciliation_ledger_complete=false for execute_now');
          }
          if (typeof unresolvedCount === 'number' && unresolvedCount > 0) {
            invalid.push(`contradictions_unresolved_count=${unresolvedCount}>0 for execute_now`);
          }
          if (conviction === false) {
            invalid.push(`conviction_after_challenge=false for directional execute_now`);
          }
        }

        // ─── CCIP-2026-0513G: TP1 PARTIAL-VALUE CONTRADICTION ──────────
        // Phantom partial: TP1 worth less than 35% of risk while
        // tp1_omitted=false is geometry that closes the trade on spread
        // alone. Either widen TP1 to a real intermediate destination or
        // run the trade single-target.
        const tp1Ratio = pickField('tp1_partial_value_ratio');
        const tp1Omitted = pickField('tp1_omitted');
        if (
          typeof tp1Ratio === 'number' &&
          tp1Ratio < 0.35 &&
          tp1Omitted === false
        ) {
          invalid.push(
            `TP1_PHANTOM_PARTIAL: tp1_partial_value_ratio=${tp1Ratio.toFixed(3)}<0.35 with tp1_omitted=false`
          );
        }

        // ─── CCIP-2026-0513H: M5 ENTRY-SHARPNESS CONTRADICTIONS ────────
        // DULL entries route through wait_pullback / push_confirmation;
        // MAE forecasts above 45% of risk cannot coexist with execute_now.
        const sharpnessCheck = pickField('entry_sharpness_check');
        const maeRatio = pickField('m5_mae_vs_risk_ratio');
        if (isExecuteNow && typeof sharpnessCheck === 'string' && sharpnessCheck.toUpperCase() === 'DULL') {
          invalid.push(
            'ENTRY_SHARPNESS_CONTRADICTION: entry_sharpness_check=DULL with entry_mode=execute_now'
          );
        }
        if (isExecuteNow && typeof maeRatio === 'number' && maeRatio > 0.45) {
          invalid.push(
            `M5_MAE_CONTRADICTION: m5_mae_vs_risk_ratio=${maeRatio.toFixed(3)}>0.45 with entry_mode=execute_now`
          );
        }

        // ─── CCIP-2026-0517A: RR ARITHMETIC CONSISTENCY ──────────────────
        // Cross-validates Alpha's claimed rr_planned_ratio against the
        // reward_pips and risk_pips from trade_geometry. If Alpha
        // hallucinated the arithmetic, this catches it.
        const rrPlanned = pickField('rr_planned_ratio');
        const tradeGeomForRR = tradeGeom && typeof tradeGeom === 'object'
          ? (tradeGeom as Record<string, unknown>)
          : null;
        if (typeof rrPlanned === 'number' && tradeGeomForRR) {
          const rewardPips = typeof tradeGeomForRR.reward_pips === 'number' ? tradeGeomForRR.reward_pips : null;
          const riskPips = typeof tradeGeomForRR.risk_pips === 'number' ? tradeGeomForRR.risk_pips : null;
          if (rewardPips !== null && riskPips !== null && riskPips > 0) {
            const computedRR = rewardPips / riskPips;
            const deviation = Math.abs(rrPlanned - computedRR) / Math.max(computedRR, 0.001);
            if (deviation > 0.15) {
              invalid.push(
                `RR_ARITHMETIC_CONTRADICTION: rr_planned_ratio=${rrPlanned.toFixed(3)} but reward_pips/risk_pips=${computedRR.toFixed(3)} (${(deviation * 100).toFixed(0)}% deviation)`
              );
            }
            // CCIP-2026-0517B: Hard RR floor 1.0 for ALL entry modes
            if (computedRR < 1.0) {
              invalid.push(
                `RR_GEOMETRY_CONTRADICTION: actual_rr=${computedRR.toFixed(3)}<1.0 — risk (${riskPips.toFixed(2)} pips) exceeds reward (${rewardPips.toFixed(2)} pips). Geometry repair will be attempted.`
              );
            }
          }
        }

        // ═══════════════════════════════════════════════════════════════════
        // CCIP-2026-0511Z: LEDGER INTEGRITY OVERRIDE (narrow semantic scope)
        // ───────────────────────────────────────────────────────────────────
        // Q1-Q12 presence is now enforced at the transport layer by
        // alpha-output-schema.ts (strict-mode JSON Schema). OpenAI will not
        // return a response to the coordinator with missing Q-fields, so the
        // old Q-missing downgrade path (CCIP-2026-0511Y) is structurally
        // unreachable and has been retired.
        //
        // This validator only polices semantic contradictions strict-mode
        // cannot express:
        //   1. trade_geometry.direction !== action (direction integrity)
        //   2. contradictions_unresolved_count > 0 while ledger claims true
        //
        // Entry mode choices (wait_pullback, push_confirmation) are NOT
        // downgrades — they are Alpha's legitimate timing preference. This
        // block never touches entry_mode and never forces low_quality for a
        // clean-audit directional call. Only a ledger INTEGRITY failure
        // overrides confidence.
        // ═══════════════════════════════════════════════════════════════════
        const unresolvedResolved =
          typeof unresolvedCount === 'number' && unresolvedCount === 0;
        const ledgerIntegrityOK = unresolvedResolved;

        if (isDirectional && ledgerComplete === true && !ledgerIntegrityOK) {
          const reasons: string[] = [];
          if (!unresolvedResolved) reasons.push(`unresolved=${String(unresolvedCount)}`);
          if (asRaw && typeof asRaw === 'object') {
            (asRaw as Record<string, unknown>).reconciliation_ledger_complete = false;
          }
          (decision as Record<string, unknown>).reconciliation_ledger_complete = false;
          console.warn(
            `[Alpha Coordinator] CCIP-2026-0511Z LEDGER INTEGRITY OVERRIDE: ${reasons.join(' | ')}`
          );

          const blockReason = `SYSTEM_LEDGER_INTEGRITY_OVERRIDE: ${reasons.join(' | ')}`;

          logViolation({
            violationType: 'CCIP_0511Z_LEDGER_INTEGRITY_OVERRIDE',
            symbol: marketContext.symbol,
            attemptedOperation: 'ledger_integrity_gate',
            callLocation: 'coordinator-alpha/coordinate',
            blocked: false,
            errorDetails: {
              action: actionNorm,
              entry_mode: entryMode,
              unresolved_count: unresolvedCount,
              userId: userId || 'unknown',
            },
          }).catch(() => {});

          const dMut = decision as Record<string, unknown>;
          const priorTier = dMut.confidence_tier;
          const priorContinuous = dMut.confidence_continuous;
          dMut.confidence_tier = 'low_quality';
          dMut.block_reason = blockReason;
          dMut.decision_origin = 'SYSTEM_LEDGER_INTEGRITY_OVERRIDE';

          // Note: entry_mode is NOT forced here. If Alpha chose wait_pullback
          // or push_confirmation, that choice stands — it's his timing
          // preference, not a system override.

          const q5Raw = (decision as any)?.answer_sheet?.failure_probability ?? (decision as any)?.answer_sheet?.Q5_failure_probability;
          const counterRaw = (decision as any)?.counter_thesis_probability;
          const q5Fail = typeof q5Raw === 'number' ? q5Raw : null;
          const rewardProb = typeof counterRaw === 'number'
            ? Math.max(0, Math.min(100, 100 - counterRaw))
            : null;
          const recomputed = deriveContinuousConfidence('low_quality', q5Fail, rewardProb);
          dMut.confidence_continuous = recomputed;
          (decision as any).confidence = recomputed;
          console.info(
            `[Alpha Coordinator] CCIP-2026-0511Z integrity recompute: tier ${String(priorTier)} -> low_quality, continuous ${String(priorContinuous)} -> ${recomputed}`
          );
        }

        // missing/invalid arrays remain populated by the upper 10-field
        // presence gate for audit visibility, but no longer drive a
        // downgrade — schema-layer enforcement guarantees presence on every
        // accepted response.
        if (missing.length > 0 || invalid.length > 0) {
          console.warn(
            `[Alpha Coordinator] CCIP-2026-0511Z audit diagnostics (non-blocking) — missing=[${missing.join(',')}] invalid=[${invalid.join(' | ')}]`
          );
        }

        // ═══════════════════════════════════════════════════════════════════
        // CCIP-2026-0521A: RR GEOMETRY AUDIT (replaces 0517B repair gate)
        // ───────────────────────────────────────────────────────────────────
        // Alpha owns his geometry per Autonomy Doctrine. Sub-1.0 RR is
        // flagged for audit/learning but NEVER modified by infrastructure.
        // ═══════════════════════════════════════════════════════════════════
        if (isDirectional && decision.entry && decision.stopLoss && decision.takeProfit) {
          const rrRiskDist = Math.abs(decision.entry - decision.stopLoss);
          const rrRewardDist = Math.abs(decision.takeProfit - decision.entry);
          const rrActual = rrRiskDist > 0 ? rrRewardDist / rrRiskDist : 0;

          if (rrActual < 1.0 && rrRiskDist > 0) {
            // CCIP-2026-0521A: RR Geometry Repair REMOVED per Alpha Autonomy Doctrine.
            // Alpha owns his geometry. Sub-1.0 RR is flagged for audit but never modified.
            (decision as Record<string, unknown>).rr_below_floor = true;
            (decision as Record<string, unknown>).rr_actual = rrActual;

            console.warn(
              `[Alpha Coordinator] CCIP-2026-0521A: ${marketContext.symbol} sub-1.0 RR=${rrActual.toFixed(3)} ` +
              `(risk=${rrRiskDist.toFixed(5)}, reward=${rrRewardDist.toFixed(5)}). ` +
              `Geometry preserved — Alpha owns his output.`
            );

            import('../lib/supabase').then(({ supabase }) => {
              supabase.from('alpha_geometry_errors').insert({
                symbol: marketContext.symbol,
                direction: decision.action,
                entry_price: decision.entry,
                stop_loss: decision.stopLoss,
                take_profit: decision.takeProfit,
                rr_actual: rrActual,
                risk_distance: rrRiskDist,
                reward_distance: rrRewardDist,
                user_id: userId || null,
                action_taken: 'none_alpha_owns_geometry',
              }).then(({ error }) => {
                if (error) console.warn('[Alpha Coordinator] Geometry error log insert failed:', error.message);
              });
            }).catch(() => {});
          }
        }

        // CCIP-2026-0526C: REMOVED CCIP-2026-0521B RR hallucination gate.
        // Alpha must choose wait_pullback or push_confirmation himself when
        // geometry is unprofitable. The coordinator does not override Alpha's
        // entry mode selection. Alpha's identity prompt instructs him to use
        // alternative entry modes to fix RR geometry.

        // CCIP-2026-0526C: REMOVED CCIP-2026-0526A entry mode reroute.
        // Alpha is solely responsible for choosing the correct entry mode.
        // The coordinator follows Alpha's lead without modification.
      } catch (gateErr) {
        console.error('[Alpha Coordinator] CCIP-2026-0508C gate evaluation error:', gateErr);
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

      // CCIP-2026-0516A: Q12 market phase field removed from schema (free-form reasoning).
      // Legacy advisory check retired.

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
        // Use centralized pip calculation for consistency across all symbols (forex, metals, indices)
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
            auditSweepReclaimStatus = src.sweep_reclaim_status || src.Q_SWEEP_RECLAIM_STATUS || 'NOT_PRESENT';
            auditQTrappedFuel = src.trapped_fuel || src.Q_TRAPPED_FUEL || 'NOT_PRESENT';
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

      // CCIP-2026-0518A: Use trade_geometry.probability as Alpha's confidence.
      // Fallback chain: trade_geometry.probability → (100 - failure_probability) → tier midpoint.
      const tradeGeomProbRaw = parsed?.answer_sheet?.trade_geometry?.probability;
      const failureProbRaw = parsed?.answer_sheet?.failure_probability ?? parsed?.answer_sheet?.Q5_failure_probability;
      // CCIP-2026-0526C: Normalize decimal probabilities (0.6 means 60%, not 1%)
      const tradeGeomProb = typeof tradeGeomProbRaw === 'number' && tradeGeomProbRaw > 0 && tradeGeomProbRaw < 1
        ? tradeGeomProbRaw * 100
        : tradeGeomProbRaw;
      let tradeConfidenceContinuous: number;
      if (typeof tradeGeomProb === 'number' && tradeGeomProb > 0 && tradeGeomProb <= 100) {
        tradeConfidenceContinuous = Math.round(tradeGeomProb);
      } else if (typeof failureProbRaw === 'number' && failureProbRaw >= 0) {
        tradeConfidenceContinuous = Math.round(Math.max(0, Math.min(100, 100 - failureProbRaw)));
      } else {
        tradeConfidenceContinuous = tradeConfidence;
      }

      // CCIP-2026-0516: Confidence resolution log.
      console.log(
        `[Alpha Parse] symbol=${symbol} action=${parsed.action} ` +
        `confidence_tier=${rawTier ?? 'MISSING'} ` +
        `continuous=${tradeConfidenceContinuous} ` +
        `(source: ${typeof tradeGeomProb === 'number' ? `trade_geometry.probability=${tradeGeomProb}` : typeof failureProbRaw === 'number' ? `100-failure_probability=${failureProbRaw}` : 'tier_midpoint'})`
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
            confidence: tradeConfidenceContinuous,
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
          answerSheet.sweep_reclaim_status ?? answerSheet.Q_SWEEP_RECLAIM_STATUS,
          answerSheet.Q6_entry_trigger,
          answerSheet.Q_WHAT_DIRECTION_WHEN_THEY_RUN,
          (parsed as Record<string, unknown>).sweep_reclaim_status,
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

      // CCIP-2026-0516A: Extract Alpha's answer_sheet (free-form reasoning architecture).
      // The answer_sheet now contains Alpha's honest free-form reasoning rather than
      // Q1-Q12 checklist fields. Parse all fields with backward-compat for old schema.
      const rawAnswerSheet = parsed.answer_sheet;
      const answerSheet: AlphaDecision['answer_sheet'] = (
        rawAnswerSheet &&
        typeof rawAnswerSheet === 'object'
      ) ? {
        // CCIP-2026-0518A: Devil's advocate architecture
        trade_geometry: rawAnswerSheet.trade_geometry && typeof rawAnswerSheet.trade_geometry === 'object' ? rawAnswerSheet.trade_geometry as any : undefined,
        contradicting_evidence: Array.isArray(rawAnswerSheet.contradicting_evidence) ? rawAnswerSheet.contradicting_evidence : undefined,
        thesis_survival_argument: typeof rawAnswerSheet.thesis_survival_argument === 'string' ? rawAnswerSheet.thesis_survival_argument : undefined,
        conviction_after_challenge: typeof rawAnswerSheet.conviction_after_challenge === 'boolean' ? rawAnswerSheet.conviction_after_challenge : undefined,
        sweep_map_direction: typeof rawAnswerSheet.sweep_map_direction === 'string' ? rawAnswerSheet.sweep_map_direction : (typeof rawAnswerSheet.Q_SWEEP_MAP_DIRECTION === 'string' ? rawAnswerSheet.Q_SWEEP_MAP_DIRECTION : undefined),
        contradictions_fired: Array.isArray(rawAnswerSheet.contradictions_fired) ? rawAnswerSheet.contradictions_fired : undefined,
        contradictions_scanned_count: typeof rawAnswerSheet.contradictions_scanned_count === 'number' ? rawAnswerSheet.contradictions_scanned_count : undefined,
        contradictions_unresolved_count: typeof rawAnswerSheet.contradictions_unresolved_count === 'number' ? rawAnswerSheet.contradictions_unresolved_count : undefined,
        reconciliation_ledger_complete: typeof rawAnswerSheet.reconciliation_ledger_complete === 'boolean' ? rawAnswerSheet.reconciliation_ledger_complete : undefined,
        market_analysis: typeof rawAnswerSheet.market_analysis === 'string' ? rawAnswerSheet.market_analysis : undefined,
        direction_thesis: typeof rawAnswerSheet.direction_thesis === 'string' ? rawAnswerSheet.direction_thesis : undefined,
        invalidation_thesis: typeof rawAnswerSheet.invalidation_thesis === 'string' ? rawAnswerSheet.invalidation_thesis : undefined,
        reward_thesis: typeof rawAnswerSheet.reward_thesis === 'string' ? rawAnswerSheet.reward_thesis : undefined,
        risk_assessment: typeof rawAnswerSheet.risk_assessment === 'string' ? rawAnswerSheet.risk_assessment : undefined,
        session_context: typeof rawAnswerSheet.session_context === 'string' ? rawAnswerSheet.session_context : null,
        failure_scenario: typeof rawAnswerSheet.failure_scenario === 'string' ? rawAnswerSheet.failure_scenario : undefined,
        failure_probability: typeof rawAnswerSheet.failure_probability === 'number' ? rawAnswerSheet.failure_probability : (typeof rawAnswerSheet.Q5_failure_probability === 'number' ? rawAnswerSheet.Q5_failure_probability : undefined),
        // Sweep/liquidity
        sweep_reclaim_status: typeof rawAnswerSheet.sweep_reclaim_status === 'string' ? rawAnswerSheet.sweep_reclaim_status : (typeof rawAnswerSheet.Q_SWEEP_RECLAIM_STATUS === 'string' ? rawAnswerSheet.Q_SWEEP_RECLAIM_STATUS : undefined),
        trapped_fuel: typeof rawAnswerSheet.trapped_fuel === 'string' ? rawAnswerSheet.trapped_fuel : (typeof rawAnswerSheet.Q_TRAPPED_FUEL === 'string' ? rawAnswerSheet.Q_TRAPPED_FUEL : undefined),
        liquidity_sweep_read: typeof rawAnswerSheet.liquidity_sweep_read === 'string' ? rawAnswerSheet.liquidity_sweep_read : undefined,
        // Trap-aware geometry
        trap_map_invalidation_side: typeof rawAnswerSheet.trap_map_invalidation_side === 'string' ? rawAnswerSheet.trap_map_invalidation_side : null,
        trap_map_reward_side: typeof rawAnswerSheet.trap_map_reward_side === 'string' ? rawAnswerSheet.trap_map_reward_side : null,
        sl_sweep_risk_acknowledged: typeof rawAnswerSheet.sl_sweep_risk_acknowledged === 'string' ? rawAnswerSheet.sl_sweep_risk_acknowledged : null,
        entry_sweep_alignment: typeof rawAnswerSheet.entry_sweep_alignment === 'string' ? rawAnswerSheet.entry_sweep_alignment : null,
        tp_sweep_alignment: typeof rawAnswerSheet.tp_sweep_alignment === 'string' ? rawAnswerSheet.tp_sweep_alignment : null,
        trap_reconciliation_complete: typeof rawAnswerSheet.trap_reconciliation_complete === 'boolean' ? rawAnswerSheet.trap_reconciliation_complete : null,
        // RR profitability
        rr_planned_ratio: typeof rawAnswerSheet.rr_planned_ratio === 'number' ? rawAnswerSheet.rr_planned_ratio : null,
        breakeven_win_rate_implied: typeof rawAnswerSheet.breakeven_win_rate_implied === 'number' ? rawAnswerSheet.breakeven_win_rate_implied : null,
        rr_profitability_check: typeof rawAnswerSheet.rr_profitability_check === 'string' ? rawAnswerSheet.rr_profitability_check : null,
        rr_profitability_resolution: typeof rawAnswerSheet.rr_profitability_resolution === 'string' ? rawAnswerSheet.rr_profitability_resolution : null,
        // Entry sharpness
        m5_expected_mae_pips: typeof rawAnswerSheet.m5_expected_mae_pips === 'number' ? rawAnswerSheet.m5_expected_mae_pips : null,
        m5_mae_vs_risk_ratio: typeof rawAnswerSheet.m5_mae_vs_risk_ratio === 'number' ? rawAnswerSheet.m5_mae_vs_risk_ratio : null,
        entry_sharpness_check: typeof rawAnswerSheet.entry_sharpness_check === 'string' ? rawAnswerSheet.entry_sharpness_check : null,
        // SL reconciliation
        sl_distance_pips: typeof rawAnswerSheet.sl_distance_pips === 'number' ? rawAnswerSheet.sl_distance_pips : null,
        sl_distance_vs_m5_atr_ratio: typeof rawAnswerSheet.sl_distance_vs_m5_atr_ratio === 'number' ? rawAnswerSheet.sl_distance_vs_m5_atr_ratio : null,
        sl_distance_vs_mae_forecast_ratio: typeof rawAnswerSheet.sl_distance_vs_mae_forecast_ratio === 'number' ? rawAnswerSheet.sl_distance_vs_mae_forecast_ratio : null,
        sl_pool_clearance_pips: typeof rawAnswerSheet.sl_pool_clearance_pips === 'number' ? rawAnswerSheet.sl_pool_clearance_pips : null,
        sl_placement_verdict: typeof rawAnswerSheet.sl_placement_verdict === 'string' ? rawAnswerSheet.sl_placement_verdict : null,
        // TP geometry
        tp1_omitted: typeof rawAnswerSheet.tp1_omitted === 'boolean' ? rawAnswerSheet.tp1_omitted : null,
        tp1_omission_reason: typeof rawAnswerSheet.tp1_omission_reason === 'string' ? rawAnswerSheet.tp1_omission_reason : null,
        tp1_partial_value_pips: typeof rawAnswerSheet.tp1_partial_value_pips === 'number' ? rawAnswerSheet.tp1_partial_value_pips : null,
        tp1_partial_value_ratio: typeof rawAnswerSheet.tp1_partial_value_ratio === 'number' ? rawAnswerSheet.tp1_partial_value_ratio : null,
        tp2_omitted: typeof rawAnswerSheet.tp2_omitted === 'boolean' ? rawAnswerSheet.tp2_omitted : null,
        tp2_omission_reason: typeof rawAnswerSheet.tp2_omission_reason === 'string' ? rawAnswerSheet.tp2_omission_reason : null,
        // M5 hierarchy
        m5_micro_leg_state: typeof rawAnswerSheet.m5_micro_leg_state === 'string' ? rawAnswerSheet.m5_micro_leg_state : null,
        // Legacy backward-compat fields (old Q-field schema responses from historical records)
        Q_SWEEP_RECLAIM_STATUS: typeof rawAnswerSheet.Q_SWEEP_RECLAIM_STATUS === 'string' ? rawAnswerSheet.Q_SWEEP_RECLAIM_STATUS : undefined,
        Q_SWEEP_MAP_DIRECTION: typeof rawAnswerSheet.Q_SWEEP_MAP_DIRECTION === 'string' ? rawAnswerSheet.Q_SWEEP_MAP_DIRECTION : undefined,
        Q_TRAPPED_FUEL: typeof rawAnswerSheet.Q_TRAPPED_FUEL === 'string' ? rawAnswerSheet.Q_TRAPPED_FUEL : undefined,
        Q5_failure_probability: typeof rawAnswerSheet.Q5_failure_probability === 'number' ? rawAnswerSheet.Q5_failure_probability : undefined,
        Q6_entry_trigger: typeof rawAnswerSheet.Q6_entry_trigger === 'string' ? rawAnswerSheet.Q6_entry_trigger : undefined,
        Q1_trend_alignment: typeof rawAnswerSheet.Q1_trend_alignment === 'string' ? rawAnswerSheet.Q1_trend_alignment : undefined,
        Q2_structure_level: typeof rawAnswerSheet.Q2_structure_level === 'string' ? rawAnswerSheet.Q2_structure_level : undefined,
        Q4_momentum_stage: typeof rawAnswerSheet.Q4_momentum_stage === 'string' ? rawAnswerSheet.Q4_momentum_stage : undefined,
        Q5_failure_mode: typeof rawAnswerSheet.Q5_failure_mode === 'string' ? rawAnswerSheet.Q5_failure_mode : undefined,
        Q7_confluence_judgment: typeof rawAnswerSheet.Q7_confluence_judgment === 'string' ? rawAnswerSheet.Q7_confluence_judgment : undefined,
        Q8C_price_location_zone: typeof rawAnswerSheet.Q8C_price_location_zone === 'string' ? rawAnswerSheet.Q8C_price_location_zone : undefined,
        kill_zone: typeof rawAnswerSheet.kill_zone === 'string' ? rawAnswerSheet.kill_zone : undefined,
        intermarket_correlation: typeof rawAnswerSheet.intermarket_correlation === 'string' ? rawAnswerSheet.intermarket_correlation : undefined,
        Q9_sl_wick_proximity: typeof rawAnswerSheet.Q9_sl_wick_proximity === 'string' ? rawAnswerSheet.Q9_sl_wick_proximity : undefined,
        Q10_entry_conviction: (['SNIPER', 'ACCEPTABLE', 'FORCED'].includes(rawAnswerSheet.Q10_entry_conviction as string))
          ? (rawAnswerSheet.Q10_entry_conviction as 'SNIPER' | 'ACCEPTABLE' | 'FORCED') : undefined,
        Q11_zone_entry_quality: (['PRECISE', 'MID_ZONE', 'DEEP_ZONE'].includes(rawAnswerSheet.Q11_zone_entry_quality as string))
          ? (rawAnswerSheet.Q11_zone_entry_quality as 'PRECISE' | 'MID_ZONE' | 'DEEP_ZONE') : undefined,
      } : undefined;

      // CCIP-2026-0518B: Coordinator-level SL/ATR arithmetic verification.
      // Independently computes sl_distance_pips and sl_distance_vs_m5_atr_ratio from raw data
      // and corrects the answer_sheet if Alpha's self-report deviates beyond 20% tolerance.
      // This ensures the executor's noise-band survival check uses ground-truth data.
      if ((action === 'BUY' || action === 'SELL') && answerSheet && typeof parsed.entry === 'number' && typeof parsed.stopLoss === 'number') {
        const pipInfoVerify = getCurrencyPipInfo(symbol);
        const computedSLDistance = Math.abs(parsed.entry - parsed.stopLoss);
        const computedSLPips = pipInfoVerify.pipValue > 0 ? computedSLDistance / pipInfoVerify.pipValue : 0;
        const rawATR = extractATRValue(marketContext.atr);
        const computedATRPips = (pipInfoVerify.pipValue > 0 && rawATR > 0) ? rawATR / pipInfoVerify.pipValue : 0;
        const computedSlVsAtr = computedATRPips > 0 ? computedSLPips / computedATRPips : 0;

        if (computedSLPips > 0) {
          const alphaSLPips = answerSheet.sl_distance_pips;
          const alphaSlVsAtr = answerSheet.sl_distance_vs_m5_atr_ratio;

          if (typeof alphaSLPips === 'number' && Math.abs(alphaSLPips - computedSLPips) / computedSLPips > 0.2) {
            console.warn(`[Alpha Coordinator] CCIP-2026-0518B: sl_distance_pips corrected ${alphaSLPips.toFixed(1)} → ${computedSLPips.toFixed(1)} (${symbol})`);
            answerSheet.sl_distance_pips = Math.round(computedSLPips * 10) / 10;
          } else if (!alphaSLPips) {
            answerSheet.sl_distance_pips = Math.round(computedSLPips * 10) / 10;
          }

          if (computedSlVsAtr > 0) {
            if (typeof alphaSlVsAtr === 'number' && Math.abs(alphaSlVsAtr - computedSlVsAtr) / computedSlVsAtr > 0.2) {
              console.warn(`[Alpha Coordinator] CCIP-2026-0518B: sl_distance_vs_m5_atr_ratio corrected ${alphaSlVsAtr.toFixed(2)} → ${computedSlVsAtr.toFixed(2)} (${symbol})`);
              answerSheet.sl_distance_vs_m5_atr_ratio = Math.round(computedSlVsAtr * 100) / 100;
            } else if (!alphaSlVsAtr) {
              answerSheet.sl_distance_vs_m5_atr_ratio = Math.round(computedSlVsAtr * 100) / 100;
            }
          }
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

      // CCIP-2026-0513N: Q8D weekly narrative deleted entirely. Alpha receives raw D1
      // candles + daily narrative; he does not pre-classify the week in English. The
      // prior conflict gate (CCIP-2026-0324D) was an infrastructure-level direction
      // check on a verdict label Alpha was forced to populate — both the field and
      // the gate are removed under the Sealed-Prompt Doctrine.

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
        const failProb = typeof answerSheet.failure_probability === 'number'
          ? answerSheet.failure_probability
          : typeof answerSheet.Q5_failure_probability === 'number'
            ? answerSheet.Q5_failure_probability
            : null;
        const rawConf = parsed.trade_confidence ?? parsed.confidence;
        const confVal = typeof rawConf === 'number' ? rawConf : null;
        if (failProb !== null && confVal !== null) {
          const gap = confVal - failProb;
          if (gap <= 10 && gap >= -20) {
            const hasCoherence = typeof parsed.thesis_coherence_statement === 'string' &&
              parsed.thesis_coherence_statement.length > 20;
            if (!hasCoherence) {
              logViolation({
                violationType: 'FAILURE_PROB_CONFIDENCE_GAP_NARROW',
                symbol: marketContext.symbol,
                attemptedOperation: 'answer_sheet_validation',
                callLocation: 'coordinator-alpha/parseDecision',
                blocked: false,
                errorDetails: { failProb, confVal, gap, userId: userId || 'unknown' },
              }).catch(() => {});
              console.warn(
                `[Alpha Coordinator] CCIP-2026-0324E: failure_probability gap=${gap}pts (prob=${failProb}, conf=${confVal}) without coherence statement. ` +
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
      // CCIP-2026-0514H-CONFIDENCE-SSOT: `confidence` carries the continuous
      // band-spread value. The tier midpoint is no longer the persisted scalar —
      // `confidence_tier` (text) + `confidence` (continuous) are the SSOT pair.
      let adjustedConfidence = tradeConfidenceContinuous;

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
            confidence: tradeConfidenceContinuous,
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
            confidence: tradeConfidenceContinuous,
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
            confidence: tradeConfidenceContinuous,
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
            confidence: tradeConfidenceContinuous,
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
          // CCIP-2026-0511B: Prefer Alpha's own M5-anchored reasoning. The generic
          // pip/RR fallback only engages when Alpha fails to emit tp1_reasoning —
          // the schema now requires it, so the fallback is a safety net for older
          // model responses or schema drift.
          const alphaTp1Reasoning = typeof (parsed as Record<string, unknown>).tp1_reasoning === 'string'
            ? ((parsed as Record<string, unknown>).tp1_reasoning as string).trim()
            : (typeof (parsed as { answer_sheet?: Record<string, unknown> }).answer_sheet?.tp1_reasoning === 'string'
                ? (((parsed as { answer_sheet: Record<string, unknown> }).answer_sheet.tp1_reasoning as string).trim())
                : '');
          tp1Reasoning = alphaTp1Reasoning
            ? alphaTp1Reasoning
            : `Alpha conservative target at ${tp1Pips.toFixed(1)} pips (${tp1RR.toFixed(2)}:1 R:R)`;
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
              confidence: tradeConfidenceContinuous,
              entry_mode: entryMode,
              reasoning: parsed.reasoning,
            },
          };
        }
        tp2Price = takeProfit;
        // CCIP-2026-0511B: Prefer Alpha's own M5-anchored TP2 reasoning.
        const alphaTp2Reasoning = typeof (parsed as Record<string, unknown>).tp2_reasoning === 'string'
          ? ((parsed as Record<string, unknown>).tp2_reasoning as string).trim()
          : (typeof (parsed as { answer_sheet?: Record<string, unknown> }).answer_sheet?.tp2_reasoning === 'string'
              ? (((parsed as { answer_sheet: Record<string, unknown> }).answer_sheet.tp2_reasoning as string).trim())
              : '');
        tp2Reasoning = alphaTp2Reasoning
          ? alphaTp2Reasoning
          : `Alpha full target at ${tpPips.toFixed(1)} pips (${rr.toFixed(2)}:1 R:R)`;

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
      // Fallbacks (reasoning pips): forex=20, metals=80, indices=50.
      const rawDevPips = parsed.max_entry_deviation_pips;
      let alphaMaxDeviationPips: number | undefined;
      if (typeof rawDevPips === 'number' && Number.isFinite(rawDevPips) && rawDevPips > 0) {
        alphaMaxDeviationPips = Math.round(rawDevPips);
      } else {
        const sym = symbol.toUpperCase();
        if (['XAUUSD', 'XAGUSD', 'GOLD'].some(m => sym.includes(m.replace('USD', '')))) {
          alphaMaxDeviationPips = 80;
        } else if (['US30', 'NAS100', 'UK100', 'DE30', 'JP225'].some(i => sym.includes(i))) {
          alphaMaxDeviationPips = 50;
        } else {
          alphaMaxDeviationPips = 20;
        }
        if (correctedAction !== 'NO_TRADE') {
          console.warn(`[Alpha Coordinator] max_entry_deviation_pips missing from Alpha response — applying ${alphaMaxDeviationPips} pip fallback for ${symbol}`);
        }
      }

      // ------------------------------------------------------------------
      // CCIP-2026-0511B: M5 TP CONTRACT — extract proof fields + validate.
      // ------------------------------------------------------------------
      // TP placement must be anchored to the CURRENT M5 leg's deliverable reach.
      // Alpha emits proof fields on every BUY/SELL output. The coordinator:
      //   (a) extracts each field from answer_sheet (fallback: top-level),
      //   (b) persists them for audit + post-trade analysis,
      //   (c) logs a governance advisory when anchors reference H1/M15/round
      //       numbers or when TP1 is placed beyond the M5 exhaustion pocket.
      // This is the Q-field enforcement pattern: schema forces presence, the
      // coordinator enforces semantic quality.
      const sheetForM5 = (parsed as { answer_sheet?: Record<string, unknown> }).answer_sheet ?? {};
      const topForM5 = parsed as Record<string, unknown>;
      const readSheetString = (key: string): string | undefined => {
        const v = (sheetForM5 as Record<string, unknown>)[key] ?? topForM5[key];
        return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
      };
      const readSheetNumber = (key: string): number | undefined => {
        const v = (sheetForM5 as Record<string, unknown>)[key] ?? topForM5[key];
        return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
      };
      const readSheetInteger = (key: string): number | undefined => {
        const v = readSheetNumber(key);
        return v == null ? undefined : Math.round(v);
      };
      const readSheetBoolean = (key: string): boolean | undefined => {
        const v = (sheetForM5 as Record<string, unknown>)[key] ?? topForM5[key];
        return typeof v === 'boolean' ? v : undefined;
      };

      const tpStructuralJustification = readSheetString('tp_structural_justification');
      const tpM5LegLengthPips = readSheetNumber('tp_m5_leg_length_pips');
      const tpM5ConsecutiveSameColor = readSheetInteger('tp_m5_consecutive_same_color_candles');
      const tpM5NearestExhaustionPrice = readSheetNumber('tp_m5_nearest_exhaustion_price');
      const tpM5NearestExhaustionReference = readSheetString('tp_m5_nearest_exhaustion_reference');
      const tp1M5AnchorPrice = readSheetNumber('tp1_m5_anchor_price');
      const tp1M5AnchorReference = readSheetString('tp1_m5_anchor_reference');
      const rawTp1PlacementVsAnchor = readSheetString('tp1_placement_vs_anchor');
      const tp1PlacementVsAnchor: 'before_anchor' | 'at_anchor' | 'beyond_pocket' | undefined =
        rawTp1PlacementVsAnchor === 'before_anchor' || rawTp1PlacementVsAnchor === 'at_anchor' || rawTp1PlacementVsAnchor === 'beyond_pocket'
          ? rawTp1PlacementVsAnchor
          : undefined;
      const tp2M5AnchorPrice = readSheetNumber('tp2_m5_anchor_price');
      const tp2M5AnchorReference = readSheetString('tp2_m5_anchor_reference');
      const tp2SequentialLegJustification = readSheetString('tp2_sequential_leg_justification');
      const tpIsScalpOnly = readSheetBoolean('tp_is_scalp_only');

      if (correctedAction === 'BUY' || correctedAction === 'SELL') {
        const advisories: string[] = [];
        if (!tpStructuralJustification) advisories.push('tp_structural_justification_missing');
        if (tpM5LegLengthPips == null) advisories.push('tp_m5_leg_length_pips_missing');
        if (!tp1M5AnchorReference || tp1M5AnchorPrice == null) advisories.push('tp1_m5_anchor_missing');
        if (!tp1PlacementVsAnchor) advisories.push('tp1_placement_vs_anchor_missing');
        if (tp1PlacementVsAnchor === 'beyond_pocket') advisories.push('tp1_placed_beyond_m5_pocket');

        // Forbidden anchor vocabulary — H1/M15 or round-number references as the PRIMARY anchor.
        const ROUND_NUMBER_RE = /\b(round\s*(number|level)|whole\s*(hundred|thousand)|psychological|\d{2,}0{2,}(\.0+)?)\b/i;
        const HTF_ANCHOR_RE = /\b(h1|h4|d1|w1|m15|1h|4h|daily|weekly|higher\s*time\s*frame|htf)\b/i;
        const anchorsToCheck = [
          { key: 'tp_structural_justification', val: tpStructuralJustification },
          { key: 'tp1_m5_anchor_reference', val: tp1M5AnchorReference },
          { key: 'tp2_m5_anchor_reference', val: tp2M5AnchorReference },
          { key: 'tp_m5_nearest_exhaustion_reference', val: tpM5NearestExhaustionReference },
        ];
        for (const { key, val } of anchorsToCheck) {
          if (!val) continue;
          if (HTF_ANCHOR_RE.test(val)) advisories.push(`${key}_references_HTF_anchor`);
          if (ROUND_NUMBER_RE.test(val)) advisories.push(`${key}_references_round_number`);
        }

        // TP1 distance > M5 leg length ⇒ asking the next leg to do current-leg work.
        if (tp1Price != null && tpM5LegLengthPips != null) {
          const tp1PipsFromEntry = calculatePipDistance(symbol, entry, tp1Price);
          if (tp1PipsFromEntry > tpM5LegLengthPips * 1.05) {
            advisories.push(`tp1_distance_${tp1PipsFromEntry.toFixed(1)}p_exceeds_m5_leg_${tpM5LegLengthPips.toFixed(1)}p`);
          }
        }

        if (tp2Price != null && (!tp2M5AnchorReference || tp2M5AnchorPrice == null || !tp2SequentialLegJustification)) {
          advisories.push('tp2_present_but_m5_anchor_or_sequential_justification_missing');
        }

        if (advisories.length > 0) {
          console.warn(
            `[Alpha M5 TP Contract] ${symbol} ${correctedAction} — advisories: ${advisories.join(', ')}`
          );
          logViolation({
            violationType: 'M5_TP_CONTRACT_ADVISORY',
            symbol,
            attemptedOperation: 'm5_tp_contract_validation',
            callLocation: 'coordinator-alpha/parseDecision',
            blocked: false,
            errorDetails: {
              advisories,
              tp1Price,
              tp2Price,
              tpM5LegLengthPips,
              tp1PlacementVsAnchor,
              tpIsScalpOnly,
              userId: userId || 'unknown',
            },
          }).catch(() => {});
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
        // CCIP-2026-0510C: Continuous confidence inside the tier band — surfaces per-scan spread.
        confidence_continuous: tradeConfidenceContinuous,
        // CCIP-2026-0420A: Structural references for TP and SL — persisted to alpha_decisions.
        // These were defined in the output schema and produced by Alpha but never extracted
        // from the parsed response. Both fields are now passed through for DB audit.
        tp_structural_reference: typeof parsed.tp_structural_reference === 'string' ? parsed.tp_structural_reference : undefined,
        sl_structural_reference: typeof parsed.sl_structural_reference === 'string' ? parsed.sl_structural_reference : undefined,
        // CCIP-2026-0511B: M5 TP CONTRACT proof fields — persisted to goal_session_trades.
        tp_structural_justification: tpStructuralJustification,
        tp_m5_leg_length_pips: tpM5LegLengthPips,
        tp_m5_consecutive_same_color_candles: tpM5ConsecutiveSameColor,
        tp_m5_nearest_exhaustion_price: tpM5NearestExhaustionPrice,
        tp_m5_nearest_exhaustion_reference: tpM5NearestExhaustionReference,
        tp1_m5_anchor_price: tp1M5AnchorPrice,
        tp1_m5_anchor_reference: tp1M5AnchorReference,
        tp1_placement_vs_anchor: tp1PlacementVsAnchor,
        tp2_m5_anchor_price: tp2M5AnchorPrice,
        tp2_m5_anchor_reference: tp2M5AnchorReference,
        tp2_sequential_leg_justification: tp2SequentialLegJustification,
        tp_is_scalp_only: tpIsScalpOnly,
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
      // CCIP-2026-0512A RAW-DATA DOCTRINE: narrative "Reasoning" string and
      // "[STRUCTURAL NOTE]" interpretive paragraph removed. Alpha receives the
      // raw classification fields and reads them himself.
      parts.push(`  stop_run_type=${adversarial.stop_run_classification.type} candles_ago=${adversarial.stop_run_classification.candles_ago} bos_confirmed=${adversarial.stop_run_classification.has_bos}`);
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
