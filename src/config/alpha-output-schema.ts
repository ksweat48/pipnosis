/**
 * Alpha Output Schema — SSOT
 *
 * CCIP-2026-0516A: FREE-FORM REASONING ARCHITECTURE
 *
 * This migration eliminates the Q1-Q12 audit checklist fields that functioned
 * as a decision-shaping procedure rather than a post-hoc audit record. Because
 * OpenAI Structured Outputs generates all tokens in a single autoregressive pass,
 * the LLM reads ALL field definitions before producing the first output token —
 * meaning named audit fields (Q1_trend_alignment, Q5_failure_mode, etc.) were
 * acting as a decision CHECKLIST, biasing Alpha toward trend-following SELL
 * trades (103 SELL vs 15 BUY over 14 days, 23.7% win rate).
 *
 * REPLACEMENT: Free-form reasoning fields where Alpha writes his honest analysis
 * in his own structure. The audit trail captures WHAT Alpha thought, not WHAT
 * we wanted him to think about.
 *
 * KEPT INTACT:
 * - Dual-hypothesis objects (forces consideration of both sides)
 * - Reconciliation/contradiction ledger (schema-enforced integrity)
 * - Geometry fields (numerical reconciliation, not checklist answers)
 * - Trap-aware geometry (structural, not directional bias)
 * - Entry sharpness / MAE (numerical self-consistency check)
 * - SL reconciliation fields (numerical, not procedural)
 *
 * REMOVED:
 * - Q1-Q12 named audit fields (trend_alignment, structure_level, etc.)
 * - Narrative Q-fields (Q_DIR, Q_RANGE, Q_PRICED_IN, Q_LIQUIDITY_CASCADE, etc.)
 * - Session boundary price recording (not a decision factor)
 * - TP2 feasibility sub-fields (folded into tp2_reasoning top-level field)
 *
 * OpenAI Structured Outputs strict-mode rules still apply:
 *   - additionalProperties: false on every object
 *   - Every key in properties must be in required (nullable types for optionality)
 *   - No minLength, minimum, maximum, pattern, format keywords
 */

import { VALID_CONFIDENCE_TIERS } from './confidence-tier';

/**
 * Mandatory fields the coordinator validates for completeness.
 * These are the hard-gated fields that drive execution integrity.
 *
 * CCIP-2026-0518A: Devil's Advocate Architecture replaces dual-hypothesis.
 * Alpha forms one directional thesis, then stress-tests it against contradicting
 * evidence in the raw data. The system validates that Alpha addressed known
 * warnings/conflicts present in his context.
 */
export const MANDATORY_AUDIT_KEYS = [
  'trade_geometry',
  'sweep_map_direction',
  'contradicting_evidence',
  'thesis_survival_argument',
  'conviction_after_challenge',
  'contradictions_fired',
  'contradictions_scanned_count',
  'contradictions_unresolved_count',
  'reconciliation_ledger_complete',
  'rr_planned_ratio',
  'rr_profitability_check',
] as const;

export type MandatoryAuditKey = (typeof MANDATORY_AUDIT_KEYS)[number];

/**
 * Answer sheet properties — Alpha's free-form reasoning record.
 *
 * Strict-mode rule: every key listed under properties must also appear in
 * required. Optional values are expressed as nullable types.
 */
const ANSWER_SHEET_PROPERTIES: Record<string, Record<string, unknown>> = {
  // ═══════════════════════════════════════════════════════════════════
  // TRADE GEOMETRY — Alpha's chosen directional trade plan
  // CCIP-2026-0518A: Single trade plan (replaces dual-hypothesis stubs)
  // ═══════════════════════════════════════════════════════════════════
  trade_geometry: {
    type: 'object',
    additionalProperties: false,
    required: ['direction', 'thesis', 'entry', 'sl', 'tp', 'probability', 'reward_pips', 'risk_pips'],
    properties: {
      direction: { type: 'string', enum: ['BUY', 'SELL'] },
      thesis: { type: 'string' },
      entry: { type: 'number' },
      sl: { type: 'number' },
      tp: { type: 'number' },
      probability: { type: 'number' },
      reward_pips: { type: 'number' },
      risk_pips: { type: 'number' },
    },
  },

  // ═══════════════════════════════════════════════════════════════════
  // DEVIL'S ADVOCATE — stress-test against own thesis
  // CCIP-2026-0518A: Alpha must confront contradicting evidence in raw data
  // ═══════════════════════════════════════════════════════════════════
  contradicting_evidence: {
    type: 'array',
    items: { type: 'string' },
  },
  thesis_survival_argument: { type: 'string' },
  conviction_after_challenge: { type: 'boolean' },

  // ═══════════════════════════════════════════════════════════════════
  // SWEEP / LIQUIDITY CONTEXT
  // ═══════════════════════════════════════════════════════════════════
  sweep_map_direction: { type: 'string' },

  // ═══════════════════════════════════════════════════════════════════
  // SELF-CONSISTENCY / RECONCILIATION
  // ═══════════════════════════════════════════════════════════════════
  contradictions_fired: {
    type: 'array',
    items: { type: 'string' },
  },
  contradictions_scanned_count: { type: 'integer' },
  contradictions_unresolved_count: { type: 'integer' },
  reconciliation_ledger_complete: { type: 'boolean' },

  // ═══════════════════════════════════════════════════════════════════
  // FREE-FORM REASONING — Alpha's honest analysis in his own structure
  // ═══════════════════════════════════════════════════════════════════
  market_analysis: { type: 'string' },
  direction_thesis: { type: 'string' },
  invalidation_thesis: { type: 'string' },
  reward_thesis: { type: 'string' },
  risk_assessment: { type: 'string' },
  session_context: { type: ['string', 'null'] },
  failure_scenario: { type: 'string' },
  failure_probability: { type: 'number' },

  // ═══════════════════════════════════════════════════════════════════
  // SWEEP / LIQUIDITY — hard-validated fields (used by coordinator)
  // ═══════════════════════════════════════════════════════════════════
  sweep_reclaim_status: { type: ['string', 'null'] },
  trapped_fuel: { type: ['string', 'null'] },
  liquidity_sweep_read: { type: ['string', 'null'] },

  // ═══════════════════════════════════════════════════════════════════
  // TRAP-AWARE GEOMETRY (CCIP-2026-0513B) — numerical reconciliation
  // ═══════════════════════════════════════════════════════════════════
  trap_map_invalidation_side: { type: ['string', 'null'] },
  trap_map_reward_side: { type: ['string', 'null'] },
  sl_sweep_risk_acknowledged: { type: ['string', 'null'] },
  entry_sweep_alignment: {
    anyOf: [
      {
        type: 'string',
        enum: ['waits_for_sweep', 'executes_before_sweep', 'no_sweep_expected'],
      },
      { type: 'null' },
    ],
  },
  tp_sweep_alignment: {
    anyOf: [
      {
        type: 'string',
        enum: ['at_reward_sweep', 'beyond_reward_sweep', 'before_reward_sweep', 'no_reward_sweep'],
      },
      { type: 'null' },
    ],
  },
  trap_reconciliation_complete: { type: ['boolean', 'null'] },

  // ═══════════════════════════════════════════════════════════════════
  // PROFITABILITY & RR RECONCILIATION (CCIP-2026-0513A, amended 0517B)
  // rr_planned_ratio and rr_profitability_check are NON-NULLABLE —
  // Alpha MUST always compute and declare his RR reasoning.
  // ═══════════════════════════════════════════════════════════════════
  rr_planned_ratio: { type: 'number' },
  breakeven_win_rate_implied: { type: ['number', 'null'] },
  rr_profitability_check: {
    type: 'string',
    enum: ['PROFITABLE', 'MARGINAL', 'UNPROFITABLE'],
  },
  rr_profitability_resolution: { type: ['string', 'null'] },

  // ═══════════════════════════════════════════════════════════════════
  // M5 ENTRY-SHARPNESS (CCIP-2026-0513H) — numerical self-consistency
  // ═══════════════════════════════════════════════════════════════════
  m5_expected_mae_pips: { type: ['number', 'null'] },
  m5_mae_vs_risk_ratio: { type: ['number', 'null'] },
  entry_sharpness_check: {
    anyOf: [
      { type: 'string', enum: ['SHARP', 'ACCEPTABLE', 'DULL'] },
      { type: 'null' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // SL RECONCILIATION DOCTRINE (CCIP-2026-0514F)
  // ═══════════════════════════════════════════════════════════════════
  sl_distance_pips: { type: ['number', 'null'] },
  sl_distance_vs_m5_atr_ratio: { type: ['number', 'null'] },
  sl_distance_after_drift_pips: { type: ['number', 'null'] },
  sl_post_drift_vs_atr_ratio: { type: ['number', 'null'] },
  sl_distance_vs_mae_forecast_ratio: { type: ['number', 'null'] },
  sl_pool_clearance_pips: { type: ['number', 'null'] },
  sl_placement_verdict: {
    anyOf: [
      {
        type: 'string',
        enum: ['BEYOND_TRAP', 'AT_TRAP_EDGE', 'INSIDE_TRAP', 'NO_TRAP_PRESENT'],
      },
      { type: 'null' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════
  // TP GEOMETRY (TP1 omission, partial value, M5 anchoring, kill guarantee)
  // CCIP-2026-0518D: tp_crowd_awareness records where crowd TPs cluster
  // ═══════════════════════════════════════════════════════════════════
  tp1_omitted: { type: ['boolean', 'null'] },
  tp1_omission_reason: { type: ['string', 'null'] },
  tp1_partial_value_pips: { type: ['number', 'null'] },
  tp1_partial_value_ratio: { type: ['number', 'null'] },
  tp2_omitted: { type: ['boolean', 'null'] },
  tp2_omission_reason: { type: ['string', 'null'] },
  tp_crowd_awareness: { type: ['string', 'null'] },

  // ═══════════════════════════════════════════════════════════════════
  // M5-PRIMARY HIERARCHY — directional authority record
  // ═══════════════════════════════════════════════════════════════════
  m5_micro_leg_state: {
    anyOf: [
      {
        type: 'string',
        enum: ['building', 'extending', 'exhausting', 'reversing', 'consolidating'],
      },
      { type: 'null' },
    ],
  },
};

const ANSWER_SHEET_REQUIRED = Object.keys(ANSWER_SHEET_PROPERTIES);

/**
 * Strict JSON schema for Alpha's arbiter response.
 *
 * Strict-mode rules:
 *   - additionalProperties: false on every object
 *   - Every key in properties is also in required (nullable types express optionality)
 *   - No minLength, minimum, maximum, pattern, format keywords
 */
export const ALPHA_OUTPUT_JSON_SCHEMA = {
  name: 'AlphaDecision',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'action',
      'entry',
      'stopLoss',
      'takeProfit',
      'tp1',
      'tp2',
      'confidence_tier',
      'reasoning',
      'trader_statement',
      'entry_mode',
      'sl_structural_reference',
      'tp1_reasoning',
      'tp2_reasoning',
      'max_entry_deviation_pips',
      'spread_estimate_pips',
      'counter_thesis_probability',
      'answer_sheet',
    ],
    properties: {
      action: { type: 'string', enum: ['BUY', 'SELL'] },
      entry: { type: ['number', 'null'] },
      stopLoss: { type: ['number', 'null'] },
      takeProfit: { type: ['number', 'null'] },
      tp1: { type: ['number', 'null'] },
      tp2: { type: ['number', 'null'] },
      confidence_tier: {
        type: 'string',
        enum: Array.from(VALID_CONFIDENCE_TIERS),
      },
      reasoning: { type: 'string' },
      trader_statement: { type: 'string' },
      entry_mode: {
        anyOf: [
          { type: 'string', enum: ['execute_now', 'wait_pullback', 'push_confirmation'] },
          { type: 'null' },
        ],
      },
      sl_structural_reference: { type: ['string', 'null'] },
      tp1_reasoning: { type: ['string', 'null'] },
      tp2_reasoning: { type: ['string', 'null'] },
      max_entry_deviation_pips: { type: ['number', 'null'] },
      spread_estimate_pips: { type: ['number', 'null'] },
      counter_thesis_probability: { type: ['integer', 'null'] },
      answer_sheet: {
        type: 'object',
        additionalProperties: false,
        required: ANSWER_SHEET_REQUIRED,
        properties: ANSWER_SHEET_PROPERTIES,
      },
    },
  },
} as const;

/**
 * Response format payload ready to drop into the OpenAI chat completion body.
 */
export const ALPHA_RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  json_schema: ALPHA_OUTPUT_JSON_SCHEMA,
};

/**
 * Detect whether a parsed Alpha response is missing any of the mandatory
 * audit keys. Used by the coordinator's repair loop as a belt-and-suspenders
 * check in case the OpenAI API silently drifts.
 *
 * Returns the list of missing keys (empty array => complete).
 */
export function detectMissingAuditKeys(parsed: unknown): MandatoryAuditKey[] {
  if (parsed == null || typeof parsed !== 'object') {
    return [...MANDATORY_AUDIT_KEYS];
  }
  const top = parsed as Record<string, unknown>;
  const sheet =
    top.answer_sheet && typeof top.answer_sheet === 'object'
      ? (top.answer_sheet as Record<string, unknown>)
      : {};
  const missing: MandatoryAuditKey[] = [];
  for (const key of MANDATORY_AUDIT_KEYS) {
    const hasOnSheet = Object.prototype.hasOwnProperty.call(sheet, key) && sheet[key] != null;
    const hasOnTop = Object.prototype.hasOwnProperty.call(top, key) && top[key] != null;
    if (!hasOnSheet && !hasOnTop) {
      missing.push(key);
    }
  }
  return missing;
}
