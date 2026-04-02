/**
 * Entry intent classification for monitoring logic routing.
 *
 * CCIP-ALPHA-AUDIT-TEXT GOVERNANCE:
 * This enum governs MONITORING BEHAVIOR — it tells the entry monitor which
 * evaluation strategy to apply (momentum check, VWAP proximity check, etc.)
 * It is a machine-routing tag, NOT Alpha's description of the trade setup.
 *
 * Alpha's actual read of why this entry type was chosen — the specific confluence,
 * structure, and context — must be recorded in the companion `alpha_reasoning` field
 * as free text. A populated intent_type with empty alpha_reasoning is a governance gap.
 *
 * Example:
 *   intent_type = 'break_and_retest' (routing tag)
 *   alpha_reasoning = "EURUSD broke above the Asian range high at 1.0847 with a strong
 *     M15 momentum candle. Waiting for price to retrace into the broken level which
 *     should now act as demand. FVG sits at 1.0838-1.0841 — that's the retest zone."
 */
export type EntryIntentType =
  | 'immediate_momentum'
  | 'pullback_to_vwap'
  | 'pullback_to_support'
  | 'break_and_retest'
  | 'range_extreme'
  | 'retest_structure'
  | 'wait_for_volatility';

/**
 * Entry Monitor State Machine States
 *
 * Two-mode lifecycle:
 * 1. DISCOVERY_SCANNING - Multi-symbol evaluation with LLM allowed
 * 2. ENTRY_MONITOR_ACTIVE - Single-symbol execution waiting with ZERO LLM
 */
export type EntryMonitorState =
  | 'DISCOVERY_SCANNING'
  | 'ENTRY_INTENT_CREATED'
  | 'ENTRY_MONITOR_ACTIVE'
  | 'EXECUTE_PENDING'
  | 'TRADE_ACTIVE'
  | 'ABANDONED_RESCAN_REQUESTED';

/**
 * Monitor decision outcomes during ENTRY_MONITOR mode
 */
export type MonitorDecision =
  | 'EXECUTE_NOW'
  | 'CONTINUE_WAITING'
  | 'ABANDON_INTENT_AND_RESCAN';

/**
 * Reasons for abandoning an entry intent
 *
 * CCIP-ALPHA-AUDIT-TEXT:
 * This enum governs machine routing only (which recovery path to take).
 * Alpha's actual reasoning for abandonment must be stored in the companion
 * `abandon_reason_detail` free-text field. The enum is a routing tag;
 * the detail field is Alpha's words. Both are required for a complete audit trail.
 */
export type AbandonReason =
  | 'TIMEOUT_EXCEEDED'
  | 'HARD_INVALIDATION_CROSSED'
  | 'RUNAWAY_DETECTED'
  | 'OPPOSITE_DIRECTION_ACCEPTANCE'
  | 'MANUAL_CANCEL'
  | 'ORDER_REJECTED';

/**
 * Entry Outcome Taxonomy - Rich classification of why entry was abandoned
 *
 * EXPIRED: Execution window closed (do NOT rescan same thesis)
 * INVALIDATED: Structure broken (rescan allowed - market changed)
 * PAUSED: Temporary condition (rescan after condition clears)
 *
 * CCIP-ALPHA-AUDIT-TEXT:
 * This enum is a routing tag that governs rescan eligibility.
 * Alpha's specific observation of WHY the outcome occurred must be stored
 * in the companion `outcome_reason_detail` free-text field.
 * Example: reason = 'STRUCTURE_INVALIDATED', detail = "M15 BOS through Asian low at
 * 1.0832 confirmed by two closes below — original BOS assumption invalidated."
 */
export type EntryOutcomeReason =
  | 'RUNAWAY_DETECTED'          // EXPIRED: Price moved too far (> 3x ATR)
  | 'STRUCTURE_INVALIDATED'     // INVALIDATED: BOS failed, level broken
  | 'REGIME_SHIFT'              // PAUSED: Market regime changed
  | 'VOLATILITY_SPIKE'          // PAUSED: Abnormal volatility detected
  | 'NEWS_EVENT'                // PAUSED: High-impact news event
  | 'STOP_RUN'                  // INVALIDATED: Stop hunt detected
  | 'TIMEOUT'                   // EXPIRED: Time limit exceeded
  | 'EXECUTION_COMPLETED'       // Success: Trade entered
  | 'USER_CANCELLED';           // User action

/**
 * Alpha's free-text explanation companion to EntryOutcomeReason.
 *
 * CCIP-ALPHA-AUDIT-TEXT GOVERNANCE:
 * Wherever an EntryOutcomeReason is recorded, this string MUST accompany it.
 * Alpha writes this in his own words — no predefined options, no menus.
 * This is Alpha's voice in the audit trail. A missing detail is a governance gap.
 */
export type EntryOutcomeReasonDetail = string;

/**
 * Entry Outcome Status - Lifecycle state of entry intent
 */
export type EntryOutcomeStatus =
  | 'ACTIVE'                    // Currently monitoring
  | 'EXECUTED'                  // Trade entered successfully
  | 'EXPIRED'                   // Execution window closed - do NOT rescan
  | 'INVALIDATED'               // Structure broken - rescan allowed
  | 'PAUSED'                    // Temporary hold - rescan after condition clears
  | 'ESCALATED';                // Escalated to continuation entry

/**
 * Thesis Fingerprint - Unique identifier for a trading thesis
 * Used to prevent recreating the same thesis after EXPIRED status
 */
export interface ThesisFingerprint {
  symbol: string;
  direction: 'BUY' | 'SELL';
  structure_anchor: number;     // Entry zone center, rounded to 2 decimals
  timeframe: string;
  fingerprint: string;          // Generated hash: symbol_direction_anchor_timeframe
}

/**
 * Thesis Memory Entry - Tracks thesis lifecycle across abandonment cycles
 */
export interface ThesisMemoryEntry {
  id: string;
  session_id: string;
  user_id: string;
  symbol: string;
  direction: 'BUY' | 'SELL';
  structure_anchor: number;
  timeframe: string;
  thesis_fingerprint: string;
  status: 'ACTIVE' | 'EXPIRED' | 'INVALIDATED' | 'ESCALATED';
  entry_intent_id?: string;
  created_at: string;
  expires_at?: string;          // Expiration timestamp (typically +10 minutes)
  alpha_confidence?: number;
  abandonment_count: number;
}

/**
 * Pre-flight advisory level - NOT a hard gate
 *
 * GREEN: 0-1.5x ATR - Optimal entry conditions
 * AMBER: 1.5-3x ATR - Suboptimal but acceptable (log warning)
 * RED: 3x+ ATR - Strong advisory against entry (Alpha should reconsider)
 */
export type PreFlightAdvisoryLevel = 'GREEN' | 'AMBER' | 'RED';

/**
 * Pre-flight validation result for entry intent creation
 *
 * IMPORTANT: This is an ADVISORY system, not a gate
 * - Even RED advisories should not hard block execution
 * - Alpha retains authority to proceed despite advisories
 * - Advisories inform risk management but don't prevent entry
 */
export interface EntryPreFlightResult {
  is_viable: boolean;                     // Should intent be created?
  advisory_level: PreFlightAdvisoryLevel; // Distance-based advisory
  distance_from_zone_atr?: number;        // How far from entry zone
  rejection_reason?: EntryOutcomeReason;  // Data integrity issues only
  current_price?: number;                 // Current market price
  entry_zone_center?: number;             // Center of entry zone
  message: string;                        // Human-readable explanation
  should_consult_alpha?: boolean;         // Should Alpha reconsider continuation?
}

/**
 * Escalation decision for continuation entry
 */
export interface EntryEscalationDecision {
  should_escalate: boolean;
  reasoning: string;
  continuation_entry?: {
    entry_price: number;        // Current market price
    stop_loss: number;          // Tighter SL (1.5x ATR)
    take_profit: number;        // Same TP as original
    size_multiplier: number;    // Reduced size (0.5x)
    confidence_boost: number;   // Increased confidence requirement
  };
  rejection_reason?: string;
}

export type EntryUrgencyLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export type TimeoutAction = 'EXECUTE_AT_MARKET' | 'CANCEL';

export type EntryIntentStatus =
  | 'monitoring'
  | 'executed'
  | 'timeout'
  | 'canceled'
  | 'conditions_changed';

export interface EntryIntent {
  id: string;
  session_id: string;
  user_id: string;
  symbol: string;
  intent_type: EntryIntentType;
  urgency: EntryUrgencyLevel;
  direction: 'long' | 'short';
  entry_zone_min: number;
  entry_zone_max: number;
  timeout_minutes: number;
  timeout_at: string;
  max_wait_seconds: number;
  timeout_action: TimeoutAction;
  invalidation_price?: number;
  status: EntryIntentStatus;
  alpha_confidence?: number;
  alpha_reasoning?: string;
  market_context?: Record<string, any>;
  created_at: string;
  executed_at?: string;
  canceled_at?: string;
  canceled_reason?: string;
  actual_entry_price?: number;
  executed_price?: number;
  trade_id?: string;

  // Entry Lifecycle Taxonomy
  abandonment_reason?: EntryOutcomeReason;
  /**
   * CCIP-ALPHA-AUDIT-TEXT: Alpha's free-text explanation of why this intent was abandoned.
   * Required whenever abandonment_reason is set. Alpha's words, not a label from a list.
   * Example: "Equal highs at 1.0847 were swept with no BOS follow-through after 3 candles —
   * manipulation confirmed, original breakout thesis invalidated."
   */
  abandonment_reason_detail?: EntryOutcomeReasonDetail;
  outcome_status?: EntryOutcomeStatus;
  distance_from_zone_atr?: number;
  escalation_attempted?: boolean;

  // Post-execution advisory fields (CCIP GOVERNANCE COMPLIANT)
  advisor_mode?: 'monitoring' | 'post_execution_advisory';
  entry_quality_grade?: 'optimal' | 'good' | 'acceptable' | 'suboptimal';
  retrospective_optimal_zone?: Record<string, any>;
  opportunity_cost_analysis?: Record<string, any>;
}

export interface EntryMonitoringLog {
  id: string;
  intent_id: string;
  timestamp: string;
  current_price: number;
  distance_to_zone_pips?: number;
  conditions_met?: Record<string, boolean>;
  message?: string;
  candle_data?: Record<string, any>;
  market_conditions?: Record<string, any>;
}

export interface EntryQualityScore {
  id: string;
  trade_id: string;
  intent_id?: string;
  ideal_entry_price: number;
  actual_entry_price: number;
  entry_quality_score: number;
  slippage_pips: number;
  intent_type?: EntryIntentType;
  urgency?: EntryUrgencyLevel;
  timeout_used_seconds?: number;
  monitoring_duration_seconds?: number;
  conditions_at_entry?: Record<string, any>;
  created_at: string;
}

export interface ActiveEntryIntent {
  intent_id: string;
  session_id: string;
  symbol: string;
  intent_type: EntryIntentType;
  urgency: EntryUrgencyLevel;
  direction: 'long' | 'short';
  entry_zone_min: number;
  entry_zone_max: number;
  timeout_at: string;
  created_at: string;
  alpha_reasoning?: string;
  minutes_remaining: number;
  seconds_remaining: number;
  max_wait_seconds: number;
  timeout_action: TimeoutAction;
  invalidation_price?: number;
  latest_price?: number;
  distance_to_zone_pips?: number;
}

export interface EntryConditions {
  vwap_touch?: boolean;
  support_resistance_hold?: boolean;
  breakout_confirmed?: boolean;
  retest_hold?: boolean;
  momentum_sustained?: boolean;
  volume_confirmation?: boolean;
  candle_pattern_confirmed?: boolean;
  range_boundary_reached?: boolean;
}

export interface EntryValidationResult {
  is_valid: boolean;
  conditions_met: EntryConditions;
  should_execute: boolean;
  should_wait: boolean;
  should_cancel: boolean;
  cancel_reason?: string;
  message: string;
}

export interface EntryPlannerDecision {
  intent_id: string;
  action: 'execute' | 'wait' | 'cancel';
  entry_price?: number;
  conditions_met: EntryConditions;
  quality_score_estimate: number;
  reasoning: string;
  user_message: string;
}

export interface EntryIntentRequest {
  session_id: string;
  symbol: string;
  intent_type: EntryIntentType;
  urgency: EntryUrgencyLevel;
  direction: 'long' | 'short';
  entry_zone_min: number;
  entry_zone_max: number;
  timeout_minutes: number;
  max_wait_seconds: number;
  timeout_action: TimeoutAction;
  invalidation_price?: number;
  alpha_confidence?: number;
  alpha_reasoning: string;
  market_context?: Record<string, any>;

  // Thesis-aware fields (Phase 2: Integration)
  thesis?: string;
  style_intent?: string;
  execution_preference?: string;
  acceptable_profit_range?: { minUSD: number; idealUSD: number };

  // Adaptive zone fields (v2.0) - SSOT: Calculated by EntryIntentClassifier
  zone_type?: string;
  micro_regime_used?: string;
  primary_zone_min?: number;
  primary_zone_max?: number;
  secondary_zone_min?: number;
  secondary_zone_max?: number;
  zone_reachability_distance_pips?: number;
  zone_downgrade_applied?: boolean;
  position_size_multiplier?: number;

  // PCPE governance fields (v3.0) - SSOT: Applied by PCPE Execution Governor
  pcpe_execution_band?: 'FULL' | 'REDUCED' | 'MICRO' | 'BLOCKED';
  pcpe_original_band?: 'FULL' | 'REDUCED' | 'MICRO';
  pcpe_downgrade_applied?: boolean;
  pcpe_downgrade_reason?: string;
  pcpe_distance_to_atr_ratio?: number;
}

export interface EntryMetrics {
  total_intents: number;
  executed_intents: number;
  timeout_intents: number;
  canceled_intents: number;
  average_quality_score: number;
  average_time_to_entry: number;
  success_rate_by_urgency: Record<EntryUrgencyLevel, number>;
  success_rate_by_intent_type: Record<EntryIntentType, number>;
}

export type EQERejectionReason =
  | 'CHASING_IMPULSE_MOVE'
  | 'EXHAUSTION_DETECTED'
  | 'TOO_FAR_FROM_VWAP'
  | 'FAILED_MICROSTRUCTURE';

export type EEGRejectionReason =
  | 'TTF_EXCEEDS_TIER4'
  | 'INSUFFICIENT_ATR'
  | 'ENTRY_TOO_FAR_FROM_PRICE'
  | 'FAILED_ECONOMIC_PRECHECK';

export type EEGAction =
  | 'EXECUTE_IMMEDIATELY'
  | 'EXECUTE_WITH_ADVISORY'
  | 'CONVERT_TO_VOLATILITY_WAIT'
  | 'HARD_BLOCK';

export interface VolatilityWaitIntent {
  id: string;
  session_id: string;
  user_id: string;
  symbol: string;
  direction: 'long' | 'short';
  original_ttf_minutes: number;
  target_atr: number;
  current_atr: number;
  wait_start: string;
  max_wait_hours: number;
  recheck_interval_minutes: number;
  status: 'waiting' | 'conditions_met' | 'expired' | 'canceled';
  alpha_reasoning?: string;
  created_at: string;
  resolved_at?: string;
}

/**
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ENTRY QUALITY SCORE (EQS) SYSTEM
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Professional-grade entry evaluation based on technical quality,
 * not confidence thresholds. Entries are scored on four factors:
 *
 * 1. Location Score (0-30): Where you enter (VWAP, levels, liquidity)
 * 2. Confirmation Score (0-30): Why now (candles, patterns, momentum)
 * 3. Timing Score (0-25): Entry finesse (pullback, compression, precision)
 * 4. Friction Penalty (0 to -15): Market conditions (wicks, spread, spikes)
 *
 * Total EQS: 0-100 points (can be negative with high friction)
 *
 * Grade A+ Entry (80+): Execute immediately at optimal microstructure
 * Grade A Entry (72-79): Execute with strong acceptance + VWAP
 * Grade B Entry (65-71): Wait for better entry with structured triggers
 * Grade C Entry (50-64): Wait tight, require confirmation candle
 * Grade D Entry (<50): Wait passive, monitor for improvement
 *
 * NO REJECTIONS - only execute-now or wait-for-better-entry decisions.
 * Alpha's directional signal is trusted; EQE optimizes entry timing only.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */

/**
 * Entry Quality Score breakdown - 75-POINT SCALE
 *
 * Core Requirements (60 points):
 * 1. Pullback Structure: 20 pts (ESSENTIAL)
 * 2. VWAP Proximity: 15 pts (IMPORTANT but not perfect)
 * 3. EMA Alignment: 15 pts (ESSENTIAL for momentum)
 * 4. Liquidity Location: 10 pts (HELPFUL)
 *
 * Boosters (15 points - optional):
 * 5. Compression pattern: 5 pts (NICE TO HAVE)
 * 6. Failed move confirmation: 5 pts (NICE TO HAVE)
 * 7. Timeframe alignment: 5 pts (ALREADY IN ALPHA ANALYSIS)
 *
 * Other:
 * 8. Friction penalties: -15 to 0
 * 9. A+ Pattern bonuses: +10 to +15
 *
 * Philosophy: Patterns are enhancers, not gatekeepers.
 * Core structure (pullback + EMA + VWAP) is sufficient for entry.
 */
export interface EQSBreakdown {
  pullbackQuality: number;        // 0-20: 38-50% retracement quality, impulse structure (ESSENTIAL)
  vwapInteraction: number;        // 0-15: VWAP kiss, reclaim, spread from VWAP (IMPORTANT)
  emaAlignment: number;           // 0-15: EMA20 alignment, slope, crossover confirmation (ESSENTIAL)
  liquidityReaction: number;      // 0-10: Response to liquidity pools, sweep-reclaim (HELPFUL)
  compressionExpansion: number;   // 0-5: Tight range breakout patterns (NICE TO HAVE)
  failedMoveConfirmation: number; // 0-5: False breakout confirmation, exhaustion (NICE TO HAVE)
  timeframeAlignment: number;     // 0-5: M5 microstructure confirmation (NICE TO HAVE)
  totalScore: number;             // Sum of all components (0-75)

  factorDetails: {
    pullbackQuality: {
      retracementDepth: number;   // 0-8
      impulseIdentification: number; // 0-7
    };
    vwapInteraction: {
      distance: number;           // 0-6
      kissPattern: number;        // 0-5
      reclaimQuality: number;     // 0-4
    };
    emaAlignment: {
      directionMatch: number;     // 0-4
      slopeStrength: number;      // 0-3
      crossoverRecent: number;    // 0-3
    };
    liquidityReaction: {
      poolResponse: number;       // 0-8
      sweepReclaim: number;       // 0-7
    };
    compressionExpansion: {
      compressionDetected: number; // 0-5
      expansionFollows: number;    // 0-5
    };
    failedMoveConfirmation: {
      failureDetected: number;    // 0-5
      confirmationPresent: number; // 0-5
    };
    timeframeAlignment: {
      m5Confirmation: number;     // 0-3
      mtfAlignment: number;       // 0-2
    };
  };

  aplusPatternBonus?: number;
  aplusPatternType?: string;

  locationScore: number;
  confirmationScore: number;
  timingScore: number;
  frictionPenalty: number;
  locationDetails: {
    vwapSetup: number;
    keyLevelConfluence: number;
    liquidityLocation: number;
  };
  confirmationDetails: {
    patternConfirmation: number;
    momentumAlignment: number;
  };
  timingDetails: {
    pullbackQuality: number;
    compressionExpansion: number;
    entryPrecision: number;
  };
  frictionDetails: {
    wickRisk: number;
    spreadPenalty: number;
    newsSpikePenalty: number;
  };
}

/**
 * Entry qualification status - removed REJECT_ENTRY per architectural mandate
 * Entry Qualification Engine decides WHEN to enter, not IF
 */
export type EntryQualificationStatus =
  | 'EXECUTE_NOW'              // Grade A+ or A entry: Execute immediately
  | 'WAIT_FOR_BETTER_ENTRY';   // Grade B/C/D: Wait for improvement

/**
 * Entry action tier - granular execution decisions based on EQS
 */
export type EntryActionTier =
  | 'EXECUTE_NOW'              // EQS 80+ or 72+ with strong setup
  | 'WAIT_FOR_BETTER_ENTRY'    // EQS 65-79: structured triggers
  | 'WAIT_TIGHT'               // EQS 50-64: require confirmation
  | 'WAIT_PASSIVE';            // EQS <50: monitor for improvement

/**
 * Entry mode - how Alpha wants to enter
 *
 * Three values:
 * - execute_now: Enter immediately. Trigger has confirmed. Trade executes on receipt.
 * - wait_pullback: Price must retrace back into Alpha's target zone before execution.
 *   wait_condition block is REQUIRED when entry_mode is wait_pullback.
 * - push_confirmation: Price must push forward INTO the zone AND an M5 candle must
 *   close inside the zone to confirm the thesis before execution.
 *   wait_condition block is REQUIRED. Only active when entry monitor toggle is ON.
 */
export type EntryMode =
  | 'execute_now'
  | 'wait_pullback'
  | 'push_confirmation';

/**
 * Style display names used in Alpha outputs and UI
 */
export type StyleDisplayName = 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';

/**
 * Alpha decision action types
 */
export type AlphaAction = 'BUY' | 'SELL' | 'NO_TRADE';

/**
 * Alpha output format - standardized response structure
 *
 * This interface defines the expected output format from Alpha's decisions.
 * All downstream consumers should use this format.
 */
export interface AlphaOutputFormat {
  action: AlphaAction;
  trade_confidence: number;
  entry_quality_score: number;
  entry_mode: EntryMode;
  style: StyleDisplayName;
  reasoning: string;
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  wait_condition?: {
    target_entry_zone_min: number;
    target_entry_zone_max: number;
    invalidation_price: number;
    wait_reasoning: string;
    intent_mode?: 'pullback_to_zone' | 'push_confirmation_zone';
    expected_wait_minutes?: number;
  };
  override?: {
    type: 'adversarial_block' | 'regime_avoid' | 'risk_limit' | 'none';
    justification: string;
  };
}

/**
 * Entry trigger routing classification.
 *
 * CCIP-ALPHA-AUDIT-TEXT GOVERNANCE:
 * This enum is a routing/categorisation tag for monitoring logic only.
 * It tells the entry monitor WHAT TYPE of condition to evaluate.
 * Alpha's actual description of the trigger — what he sees, why it matters,
 * what specific market event he is waiting for — must go in EntryTrigger.name
 * and EntryTrigger.description as free text. Never compress Alpha's trigger
 * read into this enum alone.
 *
 * Example:
 *   type = 'pattern_confirmation' (routing tag)
 *   name = "BOS reclaim above Asian session high at 1.0832" (Alpha's words)
 *   description = "Need M5 close above 1.0832 with body — not wick — to confirm
 *                  the sweep-reclaim structure. Volume should expand on the close."
 */
export type EntryTriggerType =
  | 'vwap_kiss'
  | 'acceptance_candle'
  | 'pullback_complete'
  | 'pattern_confirmation'
  | 'level_retest';

/**
 * Entry trigger - specific condition to monitor for entry execution
 * Generated when WAIT_FOR_BETTER_ENTRY is chosen
 */
export interface EntryTrigger {
  /**
   * Routing classification — tells the monitor what evaluation logic to run.
   * SSOT: Use EntryTriggerType enum. Do not use this field to express Alpha's reasoning.
   */
  type: EntryTriggerType;

  /**
   * CCIP-ALPHA-AUDIT-TEXT: Alpha's name for this specific trigger in his own words.
   * Not a label from a list. Not a category name. Alpha's precise description of
   * the exact market event he is waiting for.
   * Example: "BOS reclaim above Asian high 1.0832" or "CHoCH at London open lows"
   */
  name: string;

  /**
   * CCIP-ALPHA-AUDIT-TEXT: Alpha's full explanation of what this trigger means,
   * why it matters, and what confirms it. Free text, no constraints.
   */
  description: string;

  targetConditions: {
    priceLevel?: number;         // Target price level
    vwapDistance?: number;       // Distance from VWAP (in ATR)
    candleRequirement?: string;  // Required candle pattern/behavior
    volumeRequirement?: string;  // Required volume confirmation
    patternType?: string;        // Required pattern (e.g., "engulfing", "sweep_reclaim")
  };
  monitoringParams: {
    maxWaitMinutes: number;      // How long to monitor for this trigger
    recheckInterval: number;     // How often to evaluate (in seconds)
    invalidationPrice?: number;  // Price that invalidates this trigger
  };
}

/**
 * Entry specification - Alpha's explicit instructions for entry execution
 * Replaces implicit inference from confidence levels
 */
export interface EntrySpec {
  entry_mode: EntryMode;
  entry_zone: {
    min: number;                 // Minimum acceptable entry price
    max: number;                 // Maximum acceptable entry price
    ideal: number;               // Ideal entry price (center of zone)
  };
  entry_triggers?: EntryTrigger[]; // Specific conditions to wait for (if not immediate)
  min_entry_quality_score: number; // Minimum EQS required to execute (70-80)
  max_wait_minutes: number;        // Maximum time to wait for better entry
  alpha_reasoning: string;         // Why this entry spec was chosen

  // TPS System Extensions
  entryMode?: 'EXECUTE_NOW' | 'WAIT_ENTRY' | 'WAIT_HIGHER_EDGE'; // TPS entry mode classification
  eqsThesis?: string;              // Entry thesis label for EQS weight mapping
  eqsRequired?: number;            // Minimum EQS threshold (0-100)
  eqsFocus?: string[];             // Array of 3-5 key entry quality drivers
  runawayPolicy?: 'RESCAN' | 'EXECUTE_ON_FIRST_PULLBACK'; // What to do if price runs away
  projection?: {
    eqsProjected: number;          // Expected EQS if conditions improve
    projectionConfidence: number;  // Confidence in projection (0-100)
    expectedMinutesToImprove: number; // Expected time to reach projected EQS
  };
}
