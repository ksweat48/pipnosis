/**
 * Alpha Output Schema — SSOT
 *
 * CCIP-2026-0510L: Structural enforcement of Alpha's output contract via
 * OpenAI Structured Outputs (`response_format: { type: "json_schema", strict: true }`).
 *
 * WHY THIS EXISTS
 * ----------------
 * Prior prompt-only enforcement (CCIP-2026-0510K literal 10-item checklist plus
 * JSON skeleton examples) failed in production: gpt-4o emitted 2,400 rich
 * reasoning tokens per scan while silently dropping all 10 mandatory audit keys,
 * forcing the CCIP-2026-0508C HARD GATE to rewrite every directional output to
 * NO_TRADE. Alpha is not refusing to reason — he is omitting schema fields the
 * prose contract cannot bind.
 *
 * The OpenAI Structured Outputs API binds the output shape to the request at
 * the transport layer. A response missing any `required` field cannot be
 * returned to us — the API refuses it and retries internally. This is not a
 * new execution gate; it is Alpha's I/O contract — part of his brain — made
 * structural instead of advisory.
 *
 * CLAUDE.md RECONCILIATION
 * ------------------------
 * The project mandate "Improve Alpha's Brain, Not His Constraints" forbids
 * adding execution gates that redirect Alpha's output. This schema does the
 * opposite: it guarantees Alpha's own reasoning obligations reach the
 * coordinator intact. The CCIP-2026-0508C gate exists precisely because
 * Alpha's answer_sheet arrives incomplete. Binding the schema eliminates that
 * failure mode so Alpha's genuine decisions survive to execution.
 *
 * REQUIREMENTS
 * ------------
 * - OpenAI Structured Outputs requires gpt-4o-2024-08-06 or later. The
 *   coordinator pins Alpha's arbiter model to this alias.
 * - `strict: true` requires `additionalProperties: false` on every object
 *   and every property listed in `required`.
 * - The two gpt-4o-mini advocate brains do NOT receive this schema — they
 *   continue to emit free-form briefs that the arbiter synthesizes.
 */

/**
 * Canonical list of the 10 mandatory answer_sheet audit keys enforced by
 * CCIP-2026-0508C / CCIP-2026-0508D. Used as the source of truth for both the
 * JSON schema's `required` array AND the coordinator's repair-loop detector.
 *
 * Any change here must also update coordinator-alpha.ts CCIP-2026-0508C gate.
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
 * Strict JSON schema for Alpha's arbiter response.
 *
 * Shape mirrors AlphaDecision in coordinator-alpha.ts closely enough that
 * parseDecision() continues to accept the output untouched. Fields that vary
 * per trade (entry, SL, TP) are numbers; fields carrying Alpha's reasoning
 * audit live inside `answer_sheet`.
 *
 * Strictness rules:
 *   - `additionalProperties: false` on every object
 *   - Every key listed in an object's `properties` is also in `required`
 *     (OpenAI strict-mode requirement — use explicit null types for optional
 *      values).
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
      'tp1Price',
      'tp2Price',
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
      'answer_sheet',
    ],
    properties: {
      action: { type: 'string', enum: ['BUY', 'SELL', 'NO_TRADE'] },
      entry: { type: ['number', 'null'] },
      stopLoss: { type: ['number', 'null'] },
      takeProfit: { type: ['number', 'null'] },
      tp1Price: { type: ['number', 'null'] },
      tp2Price: { type: ['number', 'null'] },
      confidence_tier: {
        type: 'string',
        description:
          "Alpha's text confidence tier. Canonical values include NO_TRADE, cautious, neutral, confident, high_conviction.",
      },
      reasoning: { type: 'string', minLength: 1 },
      trader_statement: {
        type: 'string',
        description: '80+ word human-readable narrative justifying the decision.',
      },
      entry_mode: {
        type: ['string', 'null'],
        enum: ['execute_now', 'wait_pullback', 'push_confirmation', null],
      },
      tp_structural_reference: { type: ['string', 'null'] },
      sl_structural_reference: { type: ['string', 'null'] },
      max_entry_deviation_pips: { type: ['number', 'null'] },
      tp_multiplier_override: { type: ['number', 'null'] },
      rr_ceiling_override: { type: ['number', 'null'] },
      spread_estimate_pips: { type: ['number', 'null'] },
      answer_sheet: {
        type: 'object',
        additionalProperties: true,
        required: [...MANDATORY_AUDIT_KEYS],
        properties: {
          hypothesis_buy: {
            type: ['object', 'null'],
            description:
              'Direction-locked BUY brief: thesis, evidence citations, entry zone, invalidation, target.',
            additionalProperties: true,
          },
          hypothesis_sell: {
            type: ['object', 'null'],
            description:
              'Direction-locked SELL brief: thesis, evidence citations, entry zone, invalidation, target.',
            additionalProperties: true,
          },
          Q_SWEEP_MAP_DIRECTION: {
            type: 'string',
            enum: ['BUY_FAVORED', 'SELL_FAVORED', 'BALANCED', 'INVERTED'],
          },
          winning_hypothesis: {
            type: 'string',
            enum: ['BUY', 'SELL', 'NONE'],
          },
          win_reason: {
            type: 'string',
            minLength: 1,
            description: 'Why the winning hypothesis beat the loser — structural reasoning.',
          },
          losing_hypothesis_disqualifier: {
            type: 'string',
            minLength: 1,
            description: 'The specific evidence that invalidates the losing hypothesis.',
          },
          contradictions_fired: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Each contradiction Alpha detected during reasoning (named fact vs named fact).',
          },
          contradictions_scanned_count: {
            type: 'integer',
            minimum: 17,
            description:
              'Total contradictions scanned. Must be >=17 per CCIP-2026-0508B reconciliation ledger.',
          },
          contradictions_unresolved_count: {
            type: 'integer',
            minimum: 0,
            description: 'Count of contradictions still unresolved. Must be 0 for execute_now.',
          },
          reconciliation_ledger_complete: {
            type: 'boolean',
            description: 'True when every fired contradiction has a reconciliation entry.',
          },
        },
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
