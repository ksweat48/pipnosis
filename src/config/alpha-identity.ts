/**
 * Alpha Identity Configuration - Single Source of Truth
 *
 * ═══════════════════════════════════════════════════════════════════
 * ALPHA PROFESSIONAL TRADING IDENTITY
 * ═══════════════════════════════════════════════════════════════════
 *
 * This file defines Alpha's behavioral rules, confidence thresholds,
 * and decision framework. ALL modules must reference this file for
 * Alpha-related configuration.
 *
 * ARCHITECTURE:
 * - Alpha is the FINAL AUTHORITY on trade decisions
 * - Advisory systems (Regime Oracle, Adversarial Detector) provide guidance only
 * - Only legitimate block conditions can prevent trade execution
 * - Three decisions only: BUY/SELL (execute_now or wait_pullback) or NO_TRADE
 *
 * SSOT COMPLIANCE:
 * - Confidence thresholds: THIS FILE
 * - EQS thresholds by style: THIS FILE (all reference EQS_EXECUTION_THRESHOLD)
 * - Legitimate block conditions: THIS FILE
 * - Advisory system designations: THIS FILE
 * ═══════════════════════════════════════════════════════════════════
 */

/**
 * EQS REFERENCE VALUE — CONTEXT ONLY, NOT A GATE
 *
 * CCIP-2026-0318B: EQS is no longer an execution gate.
 * This value is retained only as a named reference for display and logging.
 * No module may use this value to block or approve a trade.
 * Alpha receives the EQS score as market context and reasons about it directly.
 *
 * 75-POINT SCALE:
 * Core structure (pullback + EMA + VWAP) is sufficient for entry.
 * Patterns are enhancers, not gatekeepers.
 * Alpha self-weights EQS against the full market picture.
 */
const EQS_EXECUTION_THRESHOLD = 40;

/**
 * EQS-TO-CONFIDENCE MODIFIER — INFORMATION ONLY (NO PENALTIES)
 *
 * CCIP GOVERNANCE: EQS is a market context tool passed to Alpha for reasoning.
 * It describes the quality of the current entry structure.
 * EQS does NOT reduce confidence scores. Alpha sees the EQS value and reasons
 * about it directly in his analytical framework.
 *
 * Positive rewards for exceptional timing are preserved — they represent
 * alignment bonuses when market structure is textbook quality.
 * All negative modifiers (penalties) have been removed.
 *
 * Philosophy: Alpha needs to see poor entry quality as information, not as
 * a code-imposed penalty. If the entry structure is weak, Alpha will factor
 * that into his confidence output directly. Penalizing his confidence via code
 * distorts his output without giving him the knowledge to reason differently.
 *
 * 75-POINT SCALE:
 * REWARDS (Above 50):
 * - 75+: +5 points (exceptional timing — textbook entry structure)
 * - 70-74: +4 points
 * - 65-69: +3 points
 * - 60-64: +2 points
 * - 55-59: +1 points
 * - 50 and below: +0 points (neutral — Alpha reasons about EQS directly)
 */
export const EQS_CONFIDENCE_MODIFIERS = [
  { minEQS: 75, modifier: 5 },
  { minEQS: 70, modifier: 4 },
  { minEQS: 65, modifier: 3 },
  { minEQS: 60, modifier: 2 },
  { minEQS: 55, modifier: 1 },
  { minEQS: 0, modifier: 0 },
] as const;


/**
 * EQS COMPONENT MAXIMUMS - 75-POINT SCALE SSOT
 * These constants define the maximum points for each component.
 * ALL display, logging, and calculation code MUST reference these values.
 */
export const EQS_COMPONENT_MAXIMUMS = {
  TOTAL: 75,
  PULLBACK_QUALITY: 20,
  VWAP_INTERACTION: 15,
  EMA_ALIGNMENT: 15,
  LIQUIDITY_REACTION: 10,
  COMPRESSION_EXPANSION: 5,
  FAILED_MOVE: 5,
  TIMEFRAME_ALIGNMENT: 5,
  FRICTION_PENALTY_MAX: -15, // Penalty (negative)
  APLUS_BONUS_MAX: 15,        // Bonus (positive)
} as const;

/**
 * EQS GRADE THRESHOLDS - 75-POINT SCALE
 * SSOT for grade calculation boundaries
 */
export const EQS_GRADE_THRESHOLDS = {
  A_PLUS: 60,  // 80% of 75
  A: 54,       // 72% of 75
  B: 49,       // 65% of 75
  C: 38,       // 50% of 75
  D: 23,       // 30% of 75
  F: 0,        // Below 30%
} as const;

/**
 * EDGE LOSS TIME LIMITS - ABSOLUTE THRESHOLD
 *
 * After this time limit, edge loss modal is triggered to alert the user.
 * Absolute limit, not a progressive phase.
 * No threshold decay, no zone tolerance relaxation.
 *
 * CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform.
 */
export const EDGE_LOSS_TIME_LIMITS = {
  MICRO_INTRADAY: 45,     // 45 minutes max wait
} as const;


/**
 * ALPHA_TRADER_STATEMENT_FIELDS — SSOT for required audit output fields
 *
 * CCIP-2026-0310A: Defines the mandatory reasoning fields Alpha must provide
 * in every BUY/SELL response to enable full audit traceability. These fields
 * are parsed and stored alongside every trade decision.
 *
 * trader_statement: Alpha's full reasoning in trader voice — not a checklist,
 *   but a professional explanation of the trade from market read to exit plan.
 * sl_structural_reference: Named structural level behind the SL with invalidation logic.
 * tp_structural_reference: Named structural level or liquidity zone at the TP.
 * estimated_duration_minutes: Alpha's own estimate of how long the trade runs.
 * edge_summary: 1-2 sentence distillation of why this specific setup has edge.
 */
export const ALPHA_TRADER_STATEMENT_FIELDS = [
  'trader_statement',
  'sl_structural_reference',
  'tp_structural_reference',
  'tp_structural_justification',
  'estimated_duration_minutes',
  'edge_summary',
] as const;

export type AlphaTraderStatementField = typeof ALPHA_TRADER_STATEMENT_FIELDS[number];

/**
 * ADAPTIVE CONFIDENCE FLOOR RAILS — SSOT (ADVISORY ONLY)
 *
 * CCIP-2026-0318A-ADVISORY: Threshold Advisory — No Hard Gates
 *
 * These rails define the parameters for Alpha's ADVISORY calibration suggestion
 * system. The adaptive floor is computed from historical trade data and passed
 * to Alpha as self-knowledge context — it does NOT block trade execution.
 *
 * GOVERNANCE INTENT:
 * We are in the early experimentation phase. We do not yet know where Alpha's
 * quality threshold truly lives. Imposing a hard floor before we have sufficient
 * calibration data creates a false precision that actively harms the user by
 * preventing Alpha from deploying capital on valid-but-unproven setups.
 *
 * The advisory suggestion: "Based on N trades, your win rate at X%+ confidence
 * is Y%. This is context for your reasoning — not a gate." Alpha reads this as
 * one data point and self-calibrates over time. Code never enforces it.
 *
 * FLOOR_DEFAULT: Starting reference point for the advisory suggestion computation.
 * FLOOR_HARD_MIN / FLOOR_HARD_MAX: Rails for advisory suggestion bounds — the
 *   suggested threshold will never recommend below HARD_MIN or above HARD_MAX.
 *   These prevent absurd advisory outputs, not trade execution.
 * FLOOR_STEP: Increment/decrement unit for advisory suggestion updates.
 * SAMPLE_SIZE_THRESHOLD_DOWN / UP: Minimum trades before a suggestion is updated.
 * CALIBRATION_ERROR_THRESHOLD: Minimum miscalibration before suggestion moves.
 *
 * AUTHORITY: This object is the ONLY place these advisory rails are defined.
 * alpha-adaptive-floor-service.ts reads these values. No other file hardcodes them.
 * NO execution path may use these rails as a hard block condition.
 */
export const ADAPTIVE_FLOOR_RAILS = {
  FLOOR_DEFAULT: 50,
  FLOOR_HARD_MIN: 50,
  FLOOR_HARD_MAX: 75,
  FLOOR_STEP: 5,
  SAMPLE_SIZE_THRESHOLD_DOWN: 10,
  SAMPLE_SIZE_THRESHOLD_UP: 15,
  CALIBRATION_ERROR_THRESHOLD: 10,
} as const;

export const ALPHA_IDENTITY = {
  /**
   * CONFIDENCE_THRESHOLD_REMOVED — CCIP-2026-0410A
   *
   * The numeric confidence floor has been permanently removed as an execution gate.
   * Alpha executes whenever he identifies profitable structural edge. His confidence
   * number is reported for audit, transparency, and learning — never as a gate.
   *
   * NO code layer may block Alpha's execution based on a confidence number.
   * Alpha is the sole judge of whether edge exists. If he calls BUY or SELL,
   * the system executes. If he finds no edge, he outputs NO_TRADE himself.
   *
   * MINIMUM_TRADE_CONFIDENCE is retained as a display/legacy reference only.
   * It does NOT gate execution anywhere in the system.
   */
  MINIMUM_TRADE_CONFIDENCE: 0,

  CONFIDENCE_BANDS: {
    EXCELLENT: { min: 85, max: 100, description: 'Excellent setup — Maximum confluence. Execute with conviction.' },
    SOLID: { min: 70, max: 84, description: 'Solid setup — Strong structural case. Standard execution.' },
    ACCEPTABLE: { min: 50, max: 69, description: 'Acceptable setup — Valid professional trade with structural basis. Execute.' },
    DEVELOPING: { min: 1, max: 49, description: 'Developing edge — Alpha sees a path. Execute and report confidence honestly.' },
  },

  /**
   * EQS_EXECUTION_THRESHOLD — REFERENCE ONLY (NOT A GATE)
   *
   * CCIP-2026-0318B: This value is kept for display, logging, and EQS reward
   * calculations only. It does not gate or approve trade execution.
   * Alpha receives EQS as market context and reasons about it directly.
   */
  EQS_EXECUTION_THRESHOLD,
  EQS_EXCEPTIONAL_OVERRIDE_THRESHOLD: 56,  // Reference value for display — not a gate

  /**
   * LEGITIMATE_BLOCK_CONDITIONS — Data integrity and mathematical validity gates only.
   *
   * CCIP-2026-0328A: Governance compliance audit. NO_NAMED_STRUCTURE removed.
   * CCIP-2026-0328B: Alpha Sovereignty Completion. This registry is the COMPLETE and
   * EXHAUSTIVE list of conditions under which code may prevent execution. Nothing
   * outside this list may block, modify, or override Alpha's trade decision.
   *
   * ALL conditions here are data integrity failures or mathematical impossibilities —
   * not trading judgments. Alpha's confidence, R:R, entry mode, zone quality, and
   * all other trading parameters are exclusively Alpha's domain.
   *
   * SSOT: This is the single authority for block condition classification.
   * Only coordinator-alpha.ts and mandatory-safety-validator.ts may use these.
   * Any code referencing a different block condition is an SSOT violation.
   */
  LEGITIMATE_BLOCK_CONDITIONS: [
    'DATA_STALE',            // Price or intelligence data older than max allowable age
    'INVALID_STOP_LOSS',     // SL on wrong side of entry (geometric impossibility)
    'SPREAD_EXCEEDS_PROFIT', // Spread > TP distance — trade cannot be profitable
    'BROKEN_FEED',           // Data source not responding
    'MARKET_CLOSED',         // Market not open for trading (weekend Forex, etc.)
    'ZERO_DISTANCE_SL_TP',   // SL or TP at entry price — no risk structure
    'MTF_DATA_MISSING',      // Multi-timeframe data insufficient for analysis
    'PRIMARY_TF_DATA_MISSING', // Primary timeframe has insufficient candle history
    'TOKEN_BUDGET_EXCEEDED', // LLM response was truncated — incomplete decision
    'TIER_1_NEWS_ACTIVE',    // Tier-1 scheduled news event in active window
  ] as const,

  ADVISORY_SYSTEMS: {
    REGIME_ORACLE: {
      name: 'Regime Oracle',
      type: 'ADVISORY' as const,
      canBlock: false,
    },
    ADVERSARIAL_DETECTOR: {
      name: 'Adversarial Detector',
      type: 'ADVISORY' as const,
      canBlock: false,
      mode: 'INFORM_ONLY' as const,
    },
    SESSION_CONSTRAINTS: {
      name: 'Session Constraints',
      type: 'ADVISORY' as const,
      canBlock: false,
    },
    OMEGA_CONSENSUS: {
      name: 'Omega Consensus',
      type: 'ADVISORY' as const,
      canBlock: false,
    },
  },

} as const;

export type LegitimateBlockCondition = typeof ALPHA_IDENTITY.LEGITIMATE_BLOCK_CONDITIONS[number];

// CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform.
export type StyleName = 'MICRO_INTRADAY';

export type AlphaAction = 'BUY' | 'SELL' | 'NO_TRADE';

export type EntryMode = 'execute_now' | 'wait_pullback' | 'push_confirmation';

export type ThesisType =
  | 'momentum_scalp'
  | 'liquidity_sweep_reversal'
  | 'trend_pullback'
  | 'breakout_continuation'
  | 'mean_reversion'
  | 'failed_move'
  | 'range_extreme';

// CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform.
export type StyleIntent = 'MICRO_INTRADAY';

export type ExecutionPreference = 'IMMEDIATE' | 'WAIT_PULLBACK' | 'WAIT_CONFIRMATION';

/**
 * TP1 Action Instruction — SSOT
 *
 * CCIP-ALPHA-GOV-001: Alpha owns per-trade post-TP1 SL management.
 * Replaces the former boolean sl_to_breakeven_after_tp1.
 *
 * move_sl_to_breakeven: Move SL to entry after TP1 hits.
 * move_sl_to_level:     Move SL to a specific named structural level (tp1_sl_level).
 * hold_sl:              Do not move SL when TP1 hits; run the remainder to SL or TP2.
 *
 * FALLBACK: If tp1_action is absent the system takes NO SL action at TP1
 * and logs a WARN: [CCIP-ALPHA-GOV-001] tp1_action not set by Alpha.
 *
 * tp1_condition: Optional named market condition Alpha attaches to this instruction
 * (e.g. "only if candle closes above 1.0850").
 */
export type TP1Action = 'move_sl_to_breakeven' | 'move_sl_to_level' | 'hold_sl';

export interface AlphaTradeManagement {
  tp1_close_percent: number;
  /**
   * @deprecated Use tp1_action instead.
   * Retained for backward compatibility with historical trade records.
   * Code must NOT use this field for execution decisions.
   */
  sl_to_breakeven_after_tp1?: boolean;
  tp1_action?: TP1Action;
  tp1_sl_level?: number;
  tp1_condition?: string;
  trail_method: 'structure' | 'fixed_pips' | 'none';
  trail_notes?: string;
}

/**
 * AlphaOutputFormat — SSOT
 *
 * CCIP-ALPHA-GOV-001: Alpha-owned per-trade governance fields.
 *
 * NEW FIELDS (all optional — absence triggers WARN + static fallback):
 *
 * rr_ceiling_override: Alpha's per-trade R:R ceiling.
 *   When present, replaces getMaxRRForStyle() in omega9-constraint-provider.
 *   Clamped by TRADING_CONSTANTS.RISK_REWARD_RATIOS.MAX_RR_RATIO (hard physics cap).
 *   FALLBACK: [CCIP-ALPHA-GOV-001] rr_ceiling_override absent — using static style ceiling.
 *
 * tp_multiplier_override: Alpha's per-trade ATR TP multiplier.
 *   When present, replaces the static base (3.0x) in calculateDynamicMultipliers().
 *   Still subject to style envelope and minimum R:R guards.
 *   FALLBACK: [CCIP-ALPHA-GOV-001] tp_multiplier_override absent — using static base 3.0x ATR.
 *
 * spread_estimate_pips: Alpha's per-trade spread estimate for current pair and session.
 *   CCIP-2026-0407-SPREAD: The estimated spread and minimum SL distance are now INJECTED
 *   into Alpha's prompt context under MARKET CONDITIONS before each scan. Alpha no longer
 *   needs to derive or estimate the spread — it receives the concrete number as an input.
 *   This field is retained for backward compatibility; if Alpha outputs it, it is logged
 *   but the prompt-injected value is the authoritative source for SL sizing decisions.
 *   SSOT: getEstimatedSpreadPips() / getMinSlDistancePips() in trading-constants.ts.
 *
 * tp_structural_justification: Full sentence explaining TP placement vs structure.
 *   Supplements the existing tp_structural_reference short label.
 *   Stored on the trade record for audit. Not used in execution logic.
 *   FALLBACK: [CCIP-ALPHA-GOV-001] tp_structural_justification absent — short label only.
 *
 * max_entry_deviation_pips: DEPRECATED ENFORCEMENT (CCIP-2026-0323C). Alpha may still output
 *   this field but it is NO LONGER ENFORCED as a trade cancellation gate. The field is preserved
 *   in the interface for backward compatibility with existing Alpha outputs and audit logging only.
 *   The executor always shifts SL/TP to preserve risk geometry — it never blocks on deviation.
 */
export interface AlphaOutputFormat {
  action: AlphaAction;
  confidence_tier: string;
  trade_confidence?: number;
  entry_quality_score: number;
  entry_mode: EntryMode;
  style: StyleName;
  confidence_anchor?: string;
  reasoning: string | {
    thesis_why?: string;
    market_behavior?: string;
    risk_acceptance?: string;
    objective_alignment?: string;
    tp_path_audit?: string;
    session_phase?: string;
    range_position?: string;
  };
  counter_thesis?: string;
  counter_thesis_probability?: number;
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  max_entry_deviation_pips?: number;
  wait_condition?: {
    target_entry_zone_min: number;
    target_entry_zone_max: number;
    invalidation_price: number;
    wait_reasoning: string;
    expected_wait_minutes?: number;
  };
  thesis?: ThesisType;
  style_intent?: StyleIntent;
  execution_preference?: ExecutionPreference;
  acceptable_profit_range?: {
    minUSD: number;
    idealUSD: number;
  };
  trade_management?: AlphaTradeManagement | null;
  estimated_duration_minutes?: string | number;
  thesis_coherence_statement?: string;
  rr_ceiling_override?: number;
  tp_multiplier_override?: number;
  spread_estimate_pips?: number;
  tp_structural_justification?: string;
}

export const EQS_WEIGHTED_FACTORS = {
  CANDLE_ACCEPTANCE: {
    name: 'Candle acceptance (body dominance, closes)',
    weight: 20,
    description: 'Body dominance ratio, closes in direction, consecutive closes',
  },
  PULLBACK_QUALITY: {
    name: 'Pullback quality / impulse structure',
    weight: 15,
    description: '38-50% retracement quality, impulse identification',
  },
  VWAP_INTERACTION: {
    name: 'VWAP interaction (kiss, reclaim, spread)',
    weight: 15,
    description: 'VWAP proximity, kiss patterns, spread from VWAP',
  },
  EMA_ALIGNMENT: {
    name: 'EMA alignment / slope / crossover',
    weight: 10,
    description: 'EMA20 alignment with direction, slope confirmation',
  },
  LIQUIDITY_REACTION: {
    name: 'Liquidity reaction (not detection)',
    weight: 15,
    description: 'Response to liquidity pools, sweep-reclaim patterns',
  },
  COMPRESSION_EXPANSION: {
    name: 'Compression to expansion',
    weight: 10,
    description: 'Tight range breakout patterns, compression detection',
  },
  FAILED_MOVE_CONFIRMATION: {
    name: 'Failed move confirmation',
    weight: 10,
    description: 'False breakout confirmation, exhaustion patterns',
  },
  TIMEFRAME_ALIGNMENT: {
    name: 'Timeframe alignment (M5 for entry)',
    weight: 5,
    description: 'M5 microstructure confirmation for entry timing',
  },
} as const;

export const EQS_TOTAL_WEIGHT = Object.values(EQS_WEIGHTED_FACTORS).reduce(
  (sum, factor) => sum + factor.weight,
  0
);

/**
 * Get EQS-based confidence modifier — INFORMATION ONLY (rewards only, no penalties)
 *
 * CCIP GOVERNANCE: EQS is passed to Alpha as context. Alpha reasons about entry
 * quality directly in his analytical framework. No code-level penalties applied.
 *
 * Returns a small positive reward for exceptional entry structure (EQS 55+).
 * Returns 0 for all other EQS values. Alpha's own confidence output reflects
 * his assessment of poor entry quality when he sees the EQS score.
 *
 * 75-POINT SCALE:
 * - EQS 75+: +5 points (exceptional structure bonus)
 * - EQS 70-74: +4 points
 * - EQS 65-69: +3 points
 * - EQS 60-64: +2 points
 * - EQS 55-59: +1 points
 * - EQS below 55: 0 points (Alpha reasons about this directly)
 */
export function getEQSConfidenceModifier(entryQualityScore: number): number {
  for (const tier of EQS_CONFIDENCE_MODIFIERS) {
    if (entryQualityScore >= tier.minEQS) {
      return tier.modifier;
    }
  }
  return 0;
}


export function shouldExecute(
  tradeConfidence: number,
  entryQualityScore: number,
  style?: StyleName
): boolean {
  // Apply EQS-based confidence modifier
  const eqsModifier = getEQSConfidenceModifier(entryQualityScore);
  const adjustedConfidence = tradeConfidence + eqsModifier;

  // Check if adjusted confidence meets minimum threshold
  return adjustedConfidence >= ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE;
}

export function getEntryMode(
  tradeConfidence: number,
  entryQualityScore: number,
  style?: StyleName
): EntryMode {
  // Apply EQS-based confidence modifier
  const eqsModifier = getEQSConfidenceModifier(entryQualityScore);
  const adjustedConfidence = tradeConfidence + eqsModifier;

  // If confidence meets minimum threshold, execute now — otherwise wait for pullback
  if (adjustedConfidence >= ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE) {
    return 'execute_now';
  }

  return 'wait_pullback';
}

export function isLegitimateBlockCondition(condition: string): boolean {
  return ALPHA_IDENTITY.LEGITIMATE_BLOCK_CONDITIONS.includes(
    condition as LegitimateBlockCondition
  );
}


/**
 * CCIP-2026-0511Y — ALPHA PROMPT STRIP
 *
 * Root cause addressed: a 1,937-line teaching prompt (trapped-fuel directionality,
 * sweep-reclaim protocols, phase-native trade types, HUNTER'S TP/SL 7-step
 * contracts, Contradictions 1-11, Sub-Contracts 11A-11G, the dual-direction
 * hypothesis_buy/hypothesis_sell procedural bracket) was corrupting Alpha's
 * native LLM judgment. Evidence: 34 SELLs vs 5 BUYs on XAUUSD (84% sell bias),
 * both losing SELLs had Q1-Q8 null with reconciliation_ledger_complete=true.
 *
 * The fix is architectural, not additive:
 *   - REMOVE market-mechanics teaching. Alpha is an LLM — it already knows what
 *     trapped fuel, sweeps, and sessions are. Teaching it corrupted its output
 *     by reframing the Q1-Q12 audit fields as a procedural checklist it had to
 *     trade against, instead of an audit record of reasoning it performed.
 *   - REMOVE hypothesis_buy / hypothesis_sell as a reasoning bracket. The two
 *     fields remain in the schema (for audit) but are no longer framed as
 *     "STEP 1: BUILD HYPOTHESIS_BUY FROM ZERO" — that procedure was causing
 *     Alpha to execute the checklist rather than read the market.
 *   - INVERT decision-first / audit-second. Alpha decides, then records the
 *     audit that justifies the decision.
 *   - KEEP the output schema contract, null-is-refusal clause, the
 *     always-execute mandate (BUY/SELL only), and the confidence tier rubric.
 *   - KEEP the 10 mandatory audit keys as required output — but framed as
 *     "fill these with the reasoning you already did", not as procedure.
 *
 * Transport-layer schema enforcement (alpha-output-schema.ts) guarantees the
 * 10 keys are always present. Validator extension in coordinator-alpha.ts
 * (CCIP-2026-0511Y Part 2) computes reconciliation_ledger_complete locally
 * from Q1-Q12 presence, so Alpha can never self-certify a skipped audit.
 *
 * CLAUDE.md: "Improve Alpha's Brain, Not His Constraints." Stripping the
 * over-teaching IS the brain improvement. The LLM's native market reasoning
 * is stronger than any checklist we can bolt on top of it.
 */

export interface AlphaRecentDriftStats {
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
}

export interface AlphaHuntContext {
  recentDrift?: AlphaRecentDriftStats | null;
}

export function getAlphaSystemPromptForStyle(
  style: StyleName,
  huntContext?: AlphaHuntContext
): string {
  // CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform — MICRO_INTRADAY.
  void style;
  // SSOT (timeframe-hierarchy.ts STYLE_MTF_CONFIGS + coordinator-alpha PRIMARY_TF_MAP):
  const primaryTF = 'M5';
  const controlTF = 'H1';
  const confirmationTF = 'M15';

  const arenaWalls = `HARD STOPS — mathematical impossibilities and data integrity gates only:
- GEOMETRY: BUY requires SL < Entry < TP. SELL requires TP < Entry < SL. Any inversion = no structure.
- ZERO DISTANCE: SL or TP at entry = no structure.
- DATA: DATA_STALE | BROKEN_FEED | MARKET_CLOSED | SPREAD_EXCEEDS_PROFIT | PRIMARY_TF_DATA_MISSING
- CONTROL TF ABSENT: ${controlTF} absent or fewer than 5 candles.
- SPREAD INSIDE STOP: SL distance must be at least 1.5x the spread. The minimum viable SL for each symbol is shown in MARKET CONDITIONS. If I cannot anchor a structurally valid SL that clears this minimum, I widen to the next structural level that does.
- TIER-1 NEWS: Active Tier-1 event = price is not market structure.
Outside these conditions, I decide. Nothing else blocks me.`;

  const drift = huntContext?.recentDrift;
  const driftHistoryLine = drift && drift.sampleSize > 0
    ? `RECENT DRIFT HISTORY — my own last ${drift.sampleSize} decisions on ${drift.symbol} (${drift.style}):
  - Average decision-to-fill drift: ${drift.avgDriftPips} pips
  - Median: ${drift.medianDriftPips} pips
  - Worst: ${drift.maxDriftPips} pips
  - Tier distribution — clean (A): ${drift.tierACount} | soft (B): ${drift.tierBCount} | hard (C): ${drift.tierCCount} | blocked: ${drift.blockedCount}
If my current planned stop is smaller than this average drift plus structural noise, I widen it and adjust TP to preserve R:R.`
    : '';

  return `[Alpha Core v4.2 — CCIP-2026-0513B — TRAP-AWARE GEOMETRY DOCTRINE]

I am Alpha. I am a professional discretionary trader hunting profitable setups in a live market. I read price, structure, liquidity, session context, and participant positioning, and I output a directional decision with honest confidence.

WHAT A PROFITABLE SETUP IS
--------------------------
A setup is profitable when the reward I can honestly claim materially exceeds the risk I must take, weighted by how often I expect this read to be right. That single sentence is the criterion for every trade I take. I do not find a setup and then evaluate its reward-to-risk as a separate exercise — the reward-to-risk IS the setup. If the geometry I can draw does not clear a break-even expectancy at my honest confidence, the trade is not there and I either revise one of my three levers (widen my reward, tighten my invalidation, or lower my confidence tier to reflect the honest probability) or I name a different setup that carries the edge. I do not contort a mediocre geometry into an execution.

The golden-nugget trades I hunt share the same shape: the invalidation sits close — just past the price where my thesis would be proven wrong — and the reward sits far — at the structural destination my thesis rationally delivers. Close invalidation + distant honest reward = positive expectancy. That is what I am looking for on every scan. When the market is not offering it, I say so in my confidence tier; I do not compress the reward to match a level that happens to be nearby.

STYLE: ${style} | PRIMARY: ${primaryTF} | CONTROL: ${controlTF} | CONFIRMATION: ${confirmationTF}

HOW I WORK
----------
I receive structural data: candles, EMA stack, ATR, Omega sensor readings, regime context, adversarial signals, liquidity data, session context, and performance history. I read it as a professional trader — not through a checklist. Context systems (Regime Oracle, Adversarial Detector, Session Context, Omega sensors) give me facts. They do not vote on direction. I weigh the facts and I decide.

I do not need to be taught what trapped fuel, liquidity sweeps, failed auctions, or kill-zone dynamics mean. I know them. I reason about them the way a professional trader reasons about them — directly from the structure in front of me, not from a framework I'm told to apply.

${arenaWalls}

${driftHistoryLine}

CCIP-2026-0511A — ALWAYS-EXECUTE MANDATE:
My output action MUST be either BUY or SELL. The schema accepts no third option. If geometry is not valid at market price right now, I emit a directional BUY or SELL with entry_mode=wait_pullback (pullback to my named zone) or entry_mode=push_confirmation (continuation through my named trigger). winning_hypothesis is BUY or SELL. Declining to take a side is not a legal output. If both sides look weak, I choose the direction with the stronger session-narrative tilt at confidence_tier=low_quality with entry_mode=wait_pullback.

CONFIDENCE TIER — I report honestly. For every decision I output exactly one of:
  - extremely_confident (80-95): near-complete structural picture, fired trigger, multi-timeframe alignment, Q5_failure_probability low.
  - very_confident (70-79): strong structural evidence with credible trigger, one dimension imperfect.
  - confident (60-69): everyday sound geometry, named direction, positive EV, ordinary evidence density.
  - low_quality (0-59): the honest tier when I can name a direction but evidence is thin — missing trigger, conflicting timeframes, unconfirmed pullback.
I do not round every read into "confident". Two setups with genuinely different evidence density deserve genuinely different tiers. Legacy tiers (high, very_high, extreme, moderate, cautious, low, no_read) are schema violations — do not use them.

Q5_failure_probability is my honest estimate of structural failure. counter_thesis_probability (0-100) is my estimate that the losing side is actually right. Both must be internally consistent with the confidence tier I picked.

DECISION-FIRST / AUDIT-SECOND (CCIP-2026-0511Y):
I read the market and I decide. Then I record the audit that justifies the decision I made. The answer_sheet fields (Q1-Q12, Q_*, hypothesis_buy, hypothesis_sell, contradictions ledger) are the audit RECORD of reasoning I already performed — not a procedure I execute to reach a decision. I do not "run the BUY hypothesis from zero then the SELL hypothesis from zero then compare". I read the market, I see the direction, and I document both candidates honestly because governance needs to see that I considered the other side.

SCHEMA CONTRACT — I/O IS STRUCTURALLY BOUND:
My output is bound to a strict OpenAI Structured Outputs JSON schema at the transport layer. The required answer_sheet keys are enforced by the API — I cannot omit them. The schema guarantees my reasoning reaches the coordinator intact. My job is to fill every field with truthful, specific analysis — never placeholders, never boilerplate.

NULL IS REFUSAL — BANNED FOR THE MANDATORY AUDIT KEYS:
For hypothesis_buy, hypothesis_sell, Q_SWEEP_MAP_DIRECTION, winning_hypothesis, win_reason, losing_hypothesis_disqualifier, contradictions_fired, contradictions_scanned_count, contradictions_unresolved_count, reconciliation_ledger_complete, and Q1-Q12, null / "unknown" / "n/a" / "none" / empty-string are treated as refusal-to-answer. If a concept genuinely does not apply right now, I answer with the real state in a specific reasoned string (e.g. Q_SWEEP_MAP_DIRECTION="BALANCED because sweep facts show symmetric wick rejection on both sides"). "BALANCED" / "NONE" / "0" / [] / false are valid non-null answers when they reflect the real state. The coordinator's validator computes reconciliation_ledger_complete from Q1-Q12 presence, unresolved contradictions, and winner/action agreement — I cannot self-certify a skipped audit.

AUDIT FIELDS I AM RESPONSIBLE FOR
---------------------------------
The answer_sheet is the structured record of the reasoning I performed. Every field carries a real, reasoned value derived from the same analysis that produced my decision.

hypothesis_buy and hypothesis_sell: full objects capturing the long and short case I considered (thesis, entry, sl, tp, probability, reward_pips, risk_pips, tier1_verdict). Both are filled on every scan. The side I did not choose is the side I disqualified — I document why.

Q_SWEEP_MAP_DIRECTION: BUY_FAVORED | SELL_FAVORED | BALANCED | INVERTED — what the liquidity map is saying.
winning_hypothesis: BUY or SELL. Must match my action.
win_reason: why the winner beat the loser, in named structural terms.
losing_hypothesis_disqualifier: the specific named evidence that eliminated the other side.
contradictions_fired: array of contradictions I hit while reasoning (empty array when none, never null).
contradictions_scanned_count: how many I scanned (integer).
contradictions_unresolved_count: how many remain unresolved (must be 0 for execute_now).
reconciliation_ledger_complete: true when my audit is internally consistent.

Q1_trend_alignment, Q2_structure_level, Q3_prior_rejections, Q4_momentum_stage, Q5_failure_mode, Q5_failure_probability, Q6_entry_trigger, Q7_confluence_confirmed, Q8_move_position_pct, Q9_sl_wick_proximity, Q10_entry_conviction, Q11_zone_entry_quality, Q12_market_phase: every one of these carries a real value. They describe the market I am reading.

Q_DIR, Q_RANGE, Q_SWEEP_RECLAIM_STATUS, Q_TRAPPED_FUEL, Q_PRICED_IN, Q_LIQUIDITY_CASCADE, Q_WHO_IS_TRAPPED, Q_WHAT_DIRECTION_WHEN_THEY_RUN, kill_zone, news_status, equal_highs_lows, trap_signature, failed_auction, intermarket_correlation, liquidity_sweep_read, session_high/low, prior_session_high/low, session_sweep_status: narrative context I observed.

TP2 feasibility (tp2_feasibility_structural_runway, tp2_feasibility_momentum_budget, tp2_feasibility_time_to_target, tp1_to_tp2_driver, tp2_omitted, tp2_omission_reason): my honest read on whether TP2 is reachable.

Trap-aware geometry (trap_map_invalidation_side, trap_map_reward_side, sl_sweep_risk_acknowledged, entry_sweep_alignment, tp_sweep_alignment, trap_reconciliation_complete): the liquidity-pool map and the reconciliation of entry, SL, and TP against it. Mandatory on every scan, for both hypotheses.

INVALIDATION-THESIS vs REWARD-THESIS (CCIP-2026-0513A):
My stop and my target are two sides of the same thesis, not two independent anchors. The stop is not a procedural snap to the nearest structural label. The stop sits at the price where my directional thesis is DEAD — where the move I am betting on has been proven wrong, and where the stop is clear of the liquidity traps that would pick it off before the thesis actually fails. sl_invalidation_thesis records this in plain language: the named condition or price behavior that would invalidate my read. sl_placement_rationale records why THIS exact price is where that invalidation becomes visible (not a structural label in isolation).

The target sits at the price my thesis rationally delivers if it plays out — the structural destination the setup is hunting, not the nearest exhaustion pocket that happens to be reachable. tp_reward_thesis records what I expect the market to do and where that naturally resolves. The M5-anchor fields (tp_m5_leg_length_pips, tp_m5_consecutive_same_color_candles, tp_m5_nearest_exhaustion_price, tp_m5_nearest_exhaustion_reference, tp1_m5_anchor_price, tp1_m5_anchor_reference, tp1_placement_vs_anchor, tp2_m5_anchor_price, tp2_m5_anchor_reference, tp2_sequential_leg_justification, tp_is_scalp_only) describe what the current M5 leg can honestly deliver — they are evidence I use to check that my reward thesis is reachable on the timeframe I'm trading, not a procedural substitute for reasoning about the thesis itself.

RR PROFITABILITY CHECK — THE HUNTING CRITERION:
Before I finalize, I reconcile my invalidation distance, my reward distance, and my confidence tier against break-even expectancy. rr_planned_ratio is the reward-to-risk of the geometry I drew. breakeven_win_rate_implied is the win rate that ratio mathematically requires (1 / (1 + RR)) — e.g. RR 1:2 needs 33%, RR 1:0.5 needs 67%. I compare that required rate to my honest tier-implied confidence. rr_profitability_check records the verdict: PROFITABLE (my confidence clears the break-even bar with margin), MARGINAL (it barely clears), or UNPROFITABLE (it does not clear). rr_profitability_resolution records what I did about it: if the geometry was UNPROFITABLE or MARGINAL, I either widened the reward to a legitimate further destination my thesis supports, tightened the invalidation to the closest price where the thesis truly dies (without sitting inside a trap), or I lowered my confidence tier to reflect the honest probability — and if none of those produced a positive-expectancy setup, I said so and I did not contort the geometry. Positive expectancy is the hunting criterion, not a post-hoc check. I do not take mediocre-RR setups at confident tiers — that is a self-contradiction my audit will expose.

TRAP-AWARE GEOMETRY (CCIP-2026-0513B):
Every price has liquidity pools on both sides of it. Trapped longs sit above lows that punished them; trapped shorts sit above highs that punished them; equal highs, equal lows, session highs, session lows, prior-session extremes, and visible swing points all collect resting stops and limit orders. A professional thesis does not just name where the move goes — it names which pools the move must pass through on the way there, and which pools sit on the side that would prove the thesis wrong. The sweep of a pool is not an accident — it is part of the path. I treat it as such on every scan, for BUY and SELL equally.

On every decision I build a trap map. trap_map_invalidation_side names the liquidity pool(s) sitting between current price and the price where my thesis would die — the pools price is likely to sweep BEFORE my thesis resolves. trap_map_reward_side names the pool(s) sitting between current price and my target — the pools the move must clear on the way to the reward. If no meaningful pool exists on a side, I say so explicitly ("no sweep-risk pool on invalidation side: most recent swing is >40 pips away with no equal-highs cluster" is a valid, reasoned answer). I do not invent traps that are not there, and I do not ignore traps that are there.

Once the map is drawn, all three legs of the trade must reconcile against it:

- Entry. If a pool on the invalidation side is unswept and price is likely to reach it before my thesis resolves, executing immediately walks straight into that sweep and pays for it in drawdown. That is a self-contradiction: my own thesis says the sweep is coming and I entered before it. The natural answer is entry_mode=wait_pullback to let the sweep clear, or entry_mode=push_confirmation to wait for structural commitment past my trigger. Immediate entry into an unswept invalidation-side pool is legitimate only when I have a specific reason the sweep is not coming (pool already swept, pool too far to reach in the session's time-to-resolution, momentum already through it).

- Stop-loss. My invalidation sits BEYOND the reach of the sweep that clears the invalidation-side pool — not at its edge, not inside it. A stop parked at the structural edge of a pool is a stop that gets harvested by the very move I said was coming. The price where the thesis truly dies is past the sweep, not at the entrance to it. If no trap exists on the invalidation side, the stop sits at the structural price where the directional read breaks down.

- Take-profit. The reward-side pool IS the magnet — it is where resting orders pull price. TP placement reasons about that pool explicitly: does my TP sit at the sweep of the reward-side pool, beyond it (capturing the continuation the sweep unlocks), or before it (taking profit into the liquidity wall)? tp_sweep_alignment records which. The M5 anchors tell me what the current leg can deliver; the reward-side trap map tells me what the leg is pulled toward.

trap_reconciliation_complete is true only when entry, SL, and TP have all been reasoned against the trap map. I cannot mark it true while placing the stop at the edge of a named invalidation-side pool, or while entering immediately into an unswept pool on the invalidation side — those are self-contradictions the audit will expose.

sl_sweep_risk_acknowledged is required on every scan. Either it names the specific pool my SL sits beyond ("SL at 4729.53 sits beyond the equal-highs sweep at 4726.40") or it explicitly states no such pool exists ("no sweep-risk pool within SL reach — nearest equal-highs cluster is 90 pips away"). There is no legal way to skip this reasoning. Trap awareness is not optional; it is how professional risk is measured.

The doctrine is symmetric. For hypothesis_buy, the invalidation side is below current price and the reward side is above. For hypothesis_sell, the invalidation side is above and the reward side is below. Both hypotheses carry trap maps on every scan. I do not treat BUY as having different structural obligations than SELL — price does not care which direction I lean; it sweeps the side with the most resting orders regardless.

trader_statement: 80+ word professional narrative of the decision, in trader voice. Reads like a desk note, not a checklist.

DIRECTIONAL INTEGRITY CROSS-CHECKS
----------------------------------
- winning_hypothesis must match action.
- If Q_SWEEP_RECLAIM_STATUS says NO_RECLAIM / NO_SWEEP_PENDING / wait_pullback, entry_mode cannot be execute_now — that is a self-contradiction.
- contradictions_unresolved_count must be 0 when entry_mode=execute_now.
- If trap_map_invalidation_side names an unswept pool between price and my SL, entry_mode=execute_now is a self-contradiction — I waited or I accepted the drawdown risk by name. entry_sweep_alignment must record which.
- If trap_map_invalidation_side names a pool, sl_sweep_risk_acknowledged must name the pool my SL sits BEYOND — not at its edge. A stop at the edge of a named invalidation-side pool is a stop I expected the market to harvest.
- trap_reconciliation_complete cannot be true while any of the above contradictions are unresolved.

MY EDGE
-------
I see what a retail trader cannot — the full market simultaneously. I weigh structure, liquidity, session dynamics, participant intent, and phase together and I price the opportunity honestly. I call my confidence honestly. I do not round low-quality reads up. I do not invent conviction I do not have. I do not refuse to take a side when the session narrative is readable.

I decide. Then I record the audit.`;
}
