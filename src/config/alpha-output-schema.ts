/**
 * Alpha Output Schema — SSOT
 *
 * CCIP-2026-0510M: Hotfix for CCIP-2026-0510L.
 *
 * CCIP-2026-0510L shipped a strict JSON-schema contract that OpenAI rejected
 * with HTTP 400 on every arbiter call. Root cause: the schema used keywords
 * forbidden in OpenAI Structured Outputs strict mode:
 *   - `minLength` on string fields
 *   - `minimum` on integer fields
 *   - `additionalProperties: true` on nested objects
 * Because the request was rejected at the transport layer, Alpha never saw the
 * prompt and never produced an answer_sheet — every symbol fell through to a
 * SYSTEM_NETWORK_FAILURE NO_TRADE.
 *
 * FIX (CCIP-2026-0510M):
 *   1. Remove every forbidden keyword (minLength, minimum, etc.).
 *   2. Close every nested object with `additionalProperties: false`.
 *   3. Strict mode requires EVERY property in `properties` to also be listed
 *      in `required`. Optional values are expressed as nullable types
 *      (`type: ['string', 'null']` or `type: ['number', 'null']`).
 *   4. Enumerate every canonical answer_sheet field Alpha is documented to
 *      emit — Q1…Q12, Q_*, session boundary fields, TP2 feasibility fields,
 *      liquidity/sweep fields — so Alpha can still fill them without losing
 *      the closed-object guarantee.
 *   5. Semantic quality rules that strict mode cannot express (reasoning
 *      length floor, contradictions_scanned_count >= 17, non-empty
 *      win_reason / losing_hypothesis_disqualifier) are enforced downstream
 *      in coordinator-alpha.ts CCIP-2026-0508C gate and CCIP-2026-0510L
 *      repair loop — where they already live. The schema enforces PRESENCE;
 *      the coordinator enforces QUALITY.
 *
 * CLAUDE.md RECONCILIATION
 * ------------------------
 * The project mandate "Improve Alpha's Brain, Not His Constraints" forbids
 * adding execution gates that redirect Alpha's output. This schema does the
 * opposite: it guarantees Alpha's own reasoning obligations reach the
 * coordinator intact. It is Alpha's I/O contract — part of his brain — made
 * structural instead of advisory.
 *
 * REQUIREMENTS
 * ------------
 * - OpenAI Structured Outputs requires gpt-4o-2024-08-06 or later. The
 *   coordinator pins Alpha's arbiter model to this alias.
 * - The two gpt-4o-mini advocate brains do NOT receive this schema — they
 *   continue to emit free-form briefs that the arbiter synthesizes.
 */

import { VALID_CONFIDENCE_TIERS } from './confidence-tier';

/**
 * Canonical list of the 10 mandatory answer_sheet audit keys enforced by
 * CCIP-2026-0508C / CCIP-2026-0508D. These are the keys the coordinator's
 * CCIP-2026-0510L repair loop looks for. They are ALL listed in the schema's
 * `required` array for answer_sheet, but the `required` array additionally
 * contains every other canonical field to satisfy strict-mode rules.
 */
export const MANDATORY_AUDIT_KEYS = [
  'hypothesis_buy',
  'hypothesis_sell',
  'Q_SWEEP_MAP_DIRECTION',
  'winning_hypothesis',
  'win_reason',
  'losing_hypothesis_disqualifier',
  'contradictions_fired',
  'contradictions_scanned_count',
  'contradictions_unresolved_count',
  'reconciliation_ledger_complete',
] as const;

export type MandatoryAuditKey = (typeof MANDATORY_AUDIT_KEYS)[number];

/**
 * All answer_sheet properties Alpha is canonically allowed to emit.
 *
 * Strict-mode rule: every key listed under `properties` must also appear in
 * `required`. If Alpha has no value for a field, he returns null — this is
 * legal because every field type is nullable.
 *
 * Adding a new answer_sheet field: add the property here AND to the
 * `required` array below (both lists must stay in sync for strict mode).
 */
const ANSWER_SHEET_PROPERTIES: Record<string, Record<string, unknown>> = {
  // Dual-audition hypotheses (CCIP-2026-0510A)
  // CCIP-2026-0510O: null branch removed — the dual audition is MANDATORY on
  // every scan (including NO_TRADE paths). Alpha must return full objects for
  // both sides, even when one side is the disqualified hypothesis.
  hypothesis_buy: {
    type: 'object',
    additionalProperties: false,
    required: ['thesis', 'entry', 'sl', 'tp', 'probability', 'reward_pips', 'risk_pips', 'tier1_verdict'],
    properties: {
      thesis: { type: 'string' },
      entry: { type: ['number', 'null'] },
      sl: { type: ['number', 'null'] },
      tp: { type: ['number', 'null'] },
      probability: { type: ['number', 'null'] },
      reward_pips: { type: ['number', 'null'] },
      risk_pips: { type: ['number', 'null'] },
      tier1_verdict: { type: 'string' },
    },
  },
  hypothesis_sell: {
    type: 'object',
    additionalProperties: false,
    required: ['thesis', 'entry', 'sl', 'tp', 'probability', 'reward_pips', 'risk_pips', 'tier1_verdict'],
    properties: {
      thesis: { type: 'string' },
      entry: { type: ['number', 'null'] },
      sl: { type: ['number', 'null'] },
      tp: { type: ['number', 'null'] },
      probability: { type: ['number', 'null'] },
      reward_pips: { type: ['number', 'null'] },
      risk_pips: { type: ['number', 'null'] },
      tier1_verdict: { type: 'string' },
    },
  },

  // Reconciliation / winner selection
  // CCIP-2026-0510O: null branches removed on the 10 mandatory audit keys so
  // strict-mode schema validation alone is sufficient — the coordinator's
  // SCHEMA_REPAIR loop becomes a fallback, not the default code path.
  Q_SWEEP_MAP_DIRECTION: { type: 'string' },
  winning_hypothesis: { type: 'string' },
  win_reason: { type: 'string' },
  losing_hypothesis_disqualifier: { type: 'string' },
  contradictions_fired: {
    type: 'array',
    items: { type: 'string' },
  },
  contradictions_scanned_count: { type: 'integer' },
  contradictions_unresolved_count: { type: 'integer' },
  reconciliation_ledger_complete: { type: 'boolean' },

  // Canonical Q1-Q12 audit spine — MANDATORY (CCIP-2026-0511Z)
  // Promoted to non-nullable so OpenAI strict-mode rejects any response
  // missing the audit spine at the transport layer. Alpha fills these as
  // the RECORD of reasoning he already performed (decision-first /
  // audit-second) — no prompt teaching added; the contract is structural.
  // Extended Q-variants (Q4B, Q5B, Q7 judgment, Q8B/C/D) remain nullable
  // because they are context enrichments, not the core audit spine.
  Q1_trend_alignment: { type: 'string' },
  Q2_structure_level: { type: 'string' },
  Q3_prior_rejections: { type: 'string' },
  Q4_momentum_stage: { type: 'string' },
  Q4B_realtime_participant_read: { type: ['string', 'null'] },
  Q5_failure_mode: { type: 'string' },
  Q5_failure_probability: { type: 'number' },
  Q5B_objective_alignment: { type: ['string', 'null'] },
  Q6_entry_trigger: { type: 'string' },
  Q7_confluence_confirmed: { type: 'string' },
  Q7_confluence_judgment: { type: ['string', 'null'] },
  Q8_move_position_pct: { type: 'number' },
  Q8B_session_range_pct: { type: ['number', 'null'] },
  Q8C_price_location_zone: { type: ['string', 'null'] },
  Q9_sl_wick_proximity: { type: 'string' },
  Q10_entry_conviction: { type: 'string' },
  Q11_zone_entry_quality: { type: 'string' },
  Q12_market_phase: { type: 'string' },

  // Narrative / structural fields
  Q_DIR: { type: ['string', 'null'] },
  Q_RANGE: { type: ['string', 'null'] },
  Q_SWEEP_RECLAIM_STATUS: { type: ['string', 'null'] },
  Q_TRAPPED_FUEL: { type: ['string', 'null'] },
  Q_PRICED_IN: { type: ['string', 'null'] },
  Q_LIQUIDITY_CASCADE: { type: ['string', 'null'] },
  Q_WHO_IS_TRAPPED: { type: ['string', 'null'] },
  Q_WHAT_DIRECTION_WHEN_THEY_RUN: { type: ['string', 'null'] },

  // Session / context tags
  kill_zone: { type: ['string', 'null'] },
  news_status: { type: ['string', 'null'] },
  equal_highs_lows: { type: ['string', 'null'] },
  trap_signature: { type: ['string', 'null'] },
  failed_auction: { type: ['string', 'null'] },
  intermarket_correlation: { type: ['string', 'null'] },
  liquidity_sweep_read: { type: ['string', 'null'] },

  // Session boundary prices
  session_high: { type: ['number', 'string', 'null'] },
  session_low: { type: ['number', 'string', 'null'] },
  prior_session_high: { type: ['number', 'string', 'null'] },
  prior_session_low: { type: ['number', 'string', 'null'] },
  session_sweep_status: { type: ['string', 'null'] },

  // TP2 feasibility (CCIP-2026-0506F / 0507B)
  tp2_feasibility_structural_runway: { type: ['string', 'null'] },
  tp2_feasibility_momentum_budget: { type: ['string', 'null'] },
  tp2_feasibility_time_to_target: { type: ['string', 'null'] },
  tp1_to_tp2_driver: { type: ['string', 'null'] },
  tp2_omitted: { type: ['boolean', 'null'] },
  tp2_omission_reason: { type: ['string', 'null'] },

  // ------------------------------------------------------------------
  // CCIP-2026-0513C: TP1 GEOMETRY INTEGRITY DOCTRINE
  // ------------------------------------------------------------------
  // TP1 must clear the entry zone with margin and must be tied to a
  // reward-side pool that is structurally distinct from TP2's pool.
  // When no distinct intermediate pool exists, Alpha emits a single TP
  // (TP2 only) and sets tp1_omitted=true with a reasoned justification.
  // Mirrors the TP2 omission path so single-target trades are first-class.
  tp1_omitted: { type: ['boolean', 'null'] },
  tp1_omission_reason: { type: ['string', 'null'] },
  tp1_clears_entry_zone_by_pips: { type: ['number', 'null'] },
  tp1_distinct_from_tp2_pool: { type: ['boolean', 'null'] },

  // SL placement (CCIP-2026-0507A)
  sl_placement_rationale: { type: ['string', 'null'] },

  // ------------------------------------------------------------------
  // CCIP-2026-0511B: M5 TP CONTRACT — MANDATORY (Q-field pattern)
  // ------------------------------------------------------------------
  // TP placement must be anchored to M5 timeframe reality (what the current
  // 5-minute leg can actually deliver), NOT H1 structure, M15 bias, or round
  // psychological numbers. These fields are the proof-fields Alpha fills to
  // demonstrate he reasoned from M5 first principles. The coordinator
  // rejects output that leaves them null, references H1/M15/round numbers,
  // or places TP1 beyond the current M5 leg's exhaustion pocket.
  //
  // These mirror the Q-field enforcement pattern used for Q1-Q12: the
  // schema forces presence, the coordinator validates semantic quality.
  tp_m5_leg_length_pips: { type: ['number', 'null'] },
  tp_m5_consecutive_same_color_candles: { type: ['integer', 'null'] },
  tp_m5_nearest_exhaustion_price: { type: ['number', 'null'] },
  tp_m5_nearest_exhaustion_reference: { type: ['string', 'null'] },
  tp1_m5_anchor_price: { type: ['number', 'null'] },
  tp1_m5_anchor_reference: { type: ['string', 'null'] },
  tp1_placement_vs_anchor: {
    anyOf: [
      { type: 'string', enum: ['before_anchor', 'at_anchor', 'beyond_pocket'] },
      { type: 'null' },
    ],
  },
  tp2_m5_anchor_price: { type: ['number', 'null'] },
  tp2_m5_anchor_reference: { type: ['string', 'null'] },
  tp2_sequential_leg_justification: { type: ['string', 'null'] },
  tp_is_scalp_only: { type: ['boolean', 'null'] },

  // ------------------------------------------------------------------
  // CCIP-2026-0513A: PROFITABILITY & INVALIDATION DOCTRINE
  // ------------------------------------------------------------------
  // Alpha reconciles invalidation-thesis, reward-thesis, and honest
  // confidence against break-even expectancy BEFORE finalizing. These
  // fields record that reconciliation so the audit can catch RR/tier
  // self-contradictions (e.g. "confident" at RR 1:0.5 requires 67%
  // win rate, which contradicts the tier). The schema enforces
  // presence; Alpha's reasoning enforces quality.
  sl_invalidation_thesis: { type: ['string', 'null'] },
  tp_reward_thesis: { type: ['string', 'null'] },
  rr_planned_ratio: { type: ['number', 'null'] },
  breakeven_win_rate_implied: { type: ['number', 'null'] },
  rr_profitability_check: {
    anyOf: [
      { type: 'string', enum: ['PROFITABLE', 'MARGINAL', 'UNPROFITABLE'] },
      { type: 'null' },
    ],
  },
  rr_profitability_resolution: { type: ['string', 'null'] },

  // ------------------------------------------------------------------
  // CCIP-2026-0513B: TRAP-AWARE GEOMETRY DOCTRINE (amendment to 0513A)
  // ------------------------------------------------------------------
  // Alpha maps liquidity pools on both sides of price on every scan and
  // reconciles entry, stop-loss, and take-profit against that map.
  // Applies symmetrically to hypothesis_buy and hypothesis_sell. The
  // schema enforces presence of the reconciliation; Alpha's reasoning
  // enforces that entry/SL/TP are actually consistent with it.
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

  // ------------------------------------------------------------------
  // CCIP-2026-0513F: M5-PRIMARY HIERARCHY DOCTRINE
  // ------------------------------------------------------------------
  // M5 is the battlefield where SL/TP live. M15 is a one-line filter.
  // M1 is optional sniper timing. H1 is background context only — never
  // authority over an active M5 leg. These fields record that the
  // hierarchy was respected on every scan. The schema enforces presence;
  // Alpha's reasoning enforces that the call genuinely came from M5.
  directional_authority: {
    anyOf: [
      { type: 'string', enum: ['m5'] },
      { type: 'null' },
    ],
  },
  m5_direction_call: { type: ['string', 'null'] },
  m5_micro_leg_state: {
    anyOf: [
      {
        type: 'string',
        enum: ['building', 'extending', 'exhausting', 'reversing', 'consolidating'],
      },
      { type: 'null' },
    ],
  },
  m15_filter_check: { type: ['string', 'null'] },
  m1_sniper_used: { type: ['boolean', 'null'] },
  h1_background_only: { type: ['boolean', 'null'] },

  // ------------------------------------------------------------------
  // CCIP-2026-0513G: TP1 PARTIAL-VALUE DOCTRINE
  // ------------------------------------------------------------------
  // TP1 worth less than 35% of risk is a stop in disguise. The pips
  // value and ratio (vs. risk distance) record Alpha's reconciliation;
  // the coordinator catches phantom-partial contradictions where
  // tp1_partial_value_ratio < 0.35 yet tp1_omitted=false.
  tp1_partial_value_pips: { type: ['number', 'null'] },
  tp1_partial_value_ratio: { type: ['number', 'null'] },

  // ------------------------------------------------------------------
  // CCIP-2026-0513H: M5 ENTRY-SHARPNESS DOCTRINE
  // ------------------------------------------------------------------
  // Drawdown minimization is Alpha's signature edge on M5. Alpha
  // forecasts maximum adverse excursion BEFORE finalizing entry and
  // routes DULL entries through wait_pullback / push_confirmation
  // rather than executing immediately. Schema enforces presence;
  // coordinator enforces MAE-mode coherence.
  m5_expected_mae_pips: { type: ['number', 'null'] },
  m5_mae_vs_risk_ratio: { type: ['number', 'null'] },
  entry_sharpness_thesis: { type: ['string', 'null'] },
  entry_sharpness_check: {
    anyOf: [
      { type: 'string', enum: ['SHARP', 'ACCEPTABLE', 'DULL'] },
      { type: 'null' },
    ],
  },
};

const ANSWER_SHEET_REQUIRED = Object.keys(ANSWER_SHEET_PROPERTIES);

/**
 * Strict JSON schema for Alpha's arbiter response.
 *
 * Strict-mode rules:
 *   - `additionalProperties: false` on every object
 *   - Every key in `properties` is also in `required` (nullable types
 *     express optionality)
 *   - No `minLength`, `minimum`, `maximum`, `pattern`, `format` keywords
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
      'tp_structural_reference',
      'tp_structural_justification',
      'tp1_reasoning',
      'tp2_reasoning',
      'sl_structural_reference',
      'max_entry_deviation_pips',
      'tp_multiplier_override',
      'rr_ceiling_override',
      'spread_estimate_pips',
      'directional_lean',
      'lean_confidence',
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
        description:
          "Alpha's text confidence tier. Active tiers: low_quality, confident, very_confident, extremely_confident. Legacy tiers are accepted only for backward compatibility with historical records.",
      },
      reasoning: { type: 'string' },
      trader_statement: {
        type: 'string',
        description: '80+ word human-readable narrative justifying the decision.',
      },
      entry_mode: {
        anyOf: [
          { type: 'string', enum: ['execute_now', 'wait_pullback', 'push_confirmation'] },
          { type: 'null' },
        ],
      },
      tp_structural_reference: { type: ['string', 'null'] },
      tp_structural_justification: { type: ['string', 'null'] },
      tp1_reasoning: { type: ['string', 'null'] },
      tp2_reasoning: { type: ['string', 'null'] },
      sl_structural_reference: { type: ['string', 'null'] },
      max_entry_deviation_pips: { type: ['number', 'null'] },
      tp_multiplier_override: { type: ['number', 'null'] },
      rr_ceiling_override: { type: ['number', 'null'] },
      spread_estimate_pips: { type: ['number', 'null'] },
      // CCIP-2026-0511A: Always-execute mandate. NO_TRADE has been eliminated
      // from the vocabulary (see confidence-tier.ts SSOT). Alpha must always
      // produce a directional decision (BUY or SELL). `directional_lean` and
      // `lean_confidence` remain as conviction-tilt diagnostics but no longer
      // serve a NO_TRADE transparency purpose.
      directional_lean: {
        anyOf: [
          { type: 'string', enum: ['BUY_LEAN', 'SELL_LEAN', 'NEUTRAL'] },
          { type: 'null' },
        ],
      },
      lean_confidence: { type: ['number', 'null'] },
      // CCIP-2026-0511D: counter_thesis_probability (0-100). Alpha's estimate
      // that the losing hypothesis is actually correct. Paired with
      // Q5_failure_probability to drive the continuous-confidence blend inside
      // the tier band (see confidence-tier.ts deriveContinuousConfidence).
      // Without this field, OpenAI strict mode strips it and every trade
      // collapses to the tier midpoint — users see the same 65% forever.
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
 *
 * Usage:
 *   openAIClient.chat(messages, {
 *     model: 'gpt-4o-2024-08-06',
 *     response_format: ALPHA_RESPONSE_FORMAT,
 *     ...
 *   });
 */
export const ALPHA_RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  json_schema: ALPHA_OUTPUT_JSON_SCHEMA,
};

/**
 * Detect whether a parsed Alpha response is missing any of the 10 mandatory
 * audit keys. Used by the coordinator's single-shot repair loop as a
 * belt-and-suspenders check in case the OpenAI API silently drifts or an
 * older model alias returns a non-strict response.
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
