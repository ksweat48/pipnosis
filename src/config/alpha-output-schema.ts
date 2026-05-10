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

  // Canonical Q1-Q12 checklist
  Q1_trend_alignment: { type: ['string', 'null'] },
  Q2_structure_level: { type: ['string', 'null'] },
  Q3_prior_rejections: { type: ['string', 'null'] },
  Q4_momentum_stage: { type: ['string', 'null'] },
  Q4B_realtime_participant_read: { type: ['string', 'null'] },
  Q5_failure_mode: { type: ['string', 'null'] },
  Q5_failure_probability: { type: ['number', 'null'] },
  Q5B_objective_alignment: { type: ['string', 'null'] },
  Q6_entry_trigger: { type: ['string', 'null'] },
  Q7_confluence_confirmed: { type: ['string', 'null'] },
  Q7_confluence_judgment: { type: ['string', 'null'] },
  Q8_move_position_pct: { type: ['number', 'null'] },
  Q8B_session_range_pct: { type: ['number', 'null'] },
  Q8C_price_location_zone: { type: ['string', 'null'] },
  Q8D_weekly_narrative: { type: ['string', 'null'] },
  Q9_sl_wick_proximity: { type: ['string', 'null'] },
  Q10_entry_conviction: { type: ['string', 'null'] },
  Q11_zone_entry_quality: { type: ['string', 'null'] },
  // CCIP-2026-0510O: Q12_market_phase is mandatory. Every decision — BUY,
  // SELL, or NO_TRADE — must name the active market phase. The coordinator's
  // Q12_MARKET_PHASE_OMITTED advisory becomes unreachable when the schema
  // enforces presence at the transport layer.
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

  // SL placement (CCIP-2026-0507A)
  sl_placement_rationale: { type: ['string', 'null'] },
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
      'sl_structural_reference',
      'max_entry_deviation_pips',
      'tp_multiplier_override',
      'rr_ceiling_override',
      'spread_estimate_pips',
      'no_trade_statement',
      'directional_lean',
      'lean_confidence',
      'answer_sheet',
    ],
    properties: {
      action: { type: 'string', enum: ['BUY', 'SELL', 'NO_TRADE'] },
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
      sl_structural_reference: { type: ['string', 'null'] },
      max_entry_deviation_pips: { type: ['number', 'null'] },
      tp_multiplier_override: { type: ['number', 'null'] },
      rr_ceiling_override: { type: ['number', 'null'] },
      spread_estimate_pips: { type: ['number', 'null'] },
      // CCIP-2026-0510O: NO_TRADE transparency block.
      // On BUY/SELL these are null; on NO_TRADE Alpha must fill them with a
      // specific price-level + trigger-event sentence (no_trade_statement) and
      // a directional opinion (directional_lean / lean_confidence). Schema-
      // level presence pairs with the coordinator's 0333 quality gate.
      no_trade_statement: { type: ['string', 'null'] },
      directional_lean: {
        anyOf: [
          { type: 'string', enum: ['BUY_LEAN', 'SELL_LEAN', 'NEUTRAL'] },
          { type: 'null' },
        ],
      },
      lean_confidence: { type: ['number', 'null'] },
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
