/**
 * Style Execution Envelopes - SSOT for Trade Style Boundaries
 *
 * GOVERNANCE PRINCIPLE:
 * Alpha chooses direction and execution intent.
 * The SYSTEM defines the allowable execution envelope per style.
 *
 * Alpha does NOT get to redefine:
 * - Timeframe
 * - Swing size
 * - Candle horizon
 * - TP/SL ranges
 *
 * That's not "authority removal" — that's style identity enforcement.
 *
 * CRITICAL DISTINCTION:
 * - Authority WITHIN a style: ✅ Alpha decides
 * - Authority to REDEFINE a style: ❌ System enforces
 */

export interface StyleExecutionEnvelope {
  style: 'SCALP' | 'INTRADAY' | 'SWING';
  timeframe: string;                    // Primary execution timeframe
  validationTimeframes: string[];       // HTF for validation only

  // Target parameters (instrument will be scaled)
  targetCandles: { min: number; max: number };

  // TP/SL bounds (in pips/points, will be instrument-adjusted)
  tpPips: { min: number; max: number };
  slPips: { min: number; max: number };

  // ATR source (must match timeframe)
  atrTimeframe: string;

  // Duration expectations (minutes)
  typicalDuration: { min: number; max: number };

  // Entry urgency
  entryMode: 'IMMEDIATE' | 'PATIENT';

  // EQS requirement
  requiresHighEQS: boolean;
}

/**
 * SCALP - M5 Momentum Execution
 *
 * Identity:
 * - Captures ONE M5 swing leg
 * - Typically 3-5 candles
 * - Quick TP (20-60 pips/points)
 * - Tight SL (8-20 pips)
 * - M5 structure ONLY
 * - HTF is validation, not execution anchor
 * - Entry = NOW or NO TRADE
 */
export const SCALP_ENVELOPE: StyleExecutionEnvelope = {
  style: 'SCALP',
  timeframe: 'M5',
  validationTimeframes: ['M15', 'H1'],

  targetCandles: { min: 3, max: 5 },

  tpPips: { min: 15, max: 60 },
  slPips: { min: 8, max: 20 },

  atrTimeframe: 'M5',

  typicalDuration: { min: 15, max: 60 },

  entryMode: 'IMMEDIATE',
  requiresHighEQS: false, // SCALP = momentum, not perfection
};

/**
 * INTRADAY - M15/H1 Swing Execution
 *
 * Identity:
 * - Captures multi-swing moves
 * - Typically 6-12 H1 candles
 * - Medium TP (60-150 pips)
 * - Standard SL (30-60 pips)
 * - H1 structure primary
 * - Can wait for optimal entry
 */
export const INTRADAY_ENVELOPE: StyleExecutionEnvelope = {
  style: 'INTRADAY',
  timeframe: 'H1',
  validationTimeframes: ['H4', 'D1'],

  targetCandles: { min: 6, max: 12 },

  tpPips: { min: 60, max: 150 },
  slPips: { min: 30, max: 60 },

  atrTimeframe: 'H1',

  typicalDuration: { min: 120, max: 720 },

  entryMode: 'PATIENT',
  requiresHighEQS: true, // INTRADAY can wait for quality
};

/**
 * SWING - H4/D1 Position Execution
 *
 * Identity:
 * - Captures major trend legs
 * - Days to weeks holding
 * - Large TP (150-500+ pips)
 * - Wide SL (60-150 pips)
 * - D1 structure primary
 * - High patience required
 */
export const SWING_ENVELOPE: StyleExecutionEnvelope = {
  style: 'SWING',
  timeframe: 'H4',
  validationTimeframes: ['D1', 'W1'],

  targetCandles: { min: 8, max: 20 },

  tpPips: { min: 150, max: 500 },
  slPips: { min: 60, max: 150 },

  atrTimeframe: 'H4',

  typicalDuration: { min: 1440, max: 10080 }, // Days to weeks

  entryMode: 'PATIENT',
  requiresHighEQS: true, // SWING must be high quality
};

/**
 * Get execution envelope for a style
 */
export function getExecutionEnvelope(style: string): StyleExecutionEnvelope {
  switch (style.toUpperCase()) {
    case 'SCALP':
      return SCALP_ENVELOPE;
    case 'INTRADAY':
      return INTRADAY_ENVELOPE;
    case 'SWING':
      return SWING_ENVELOPE;
    default:
      console.warn(`[Style Envelope] Unknown style '${style}', defaulting to INTRADAY`);
      return INTRADAY_ENVELOPE;
  }
}

/**
 * Validate TP/SL against style envelope
 *
 * Returns revision request if outside bounds
 */
export function validateTPSLAgainstEnvelope(
  style: string,
  tpPips: number,
  slPips: number
): { valid: boolean; violations: string[]; envelope: StyleExecutionEnvelope } {
  const envelope = getExecutionEnvelope(style);
  const violations: string[] = [];

  // TP validation
  if (tpPips < envelope.tpPips.min) {
    violations.push(
      `TP ${tpPips.toFixed(1)} pips below ${style} minimum ${envelope.tpPips.min} pips`
    );
  }

  if (tpPips > envelope.tpPips.max) {
    violations.push(
      `TP ${tpPips.toFixed(1)} pips exceeds ${style} maximum ${envelope.tpPips.max} pips. ` +
      `This is ${envelope.timeframe} ${style} trading, not ${tpPips > 150 ? 'SWING' : 'INTRADAY'}.`
    );
  }

  // SL validation
  if (slPips < envelope.slPips.min) {
    violations.push(
      `SL ${slPips.toFixed(1)} pips below ${style} minimum ${envelope.slPips.min} pips (too tight)`
    );
  }

  if (slPips > envelope.slPips.max) {
    violations.push(
      `SL ${slPips.toFixed(1)} pips exceeds ${style} maximum ${envelope.slPips.max} pips. ` +
      `This is ${envelope.timeframe} ${style} trading, not wider timeframe.`
    );
  }

  return {
    valid: violations.length === 0,
    violations,
    envelope,
  };
}

/**
 * Get revision prompt for out-of-bounds TP/SL
 */
export function getRevisionPrompt(
  style: string,
  violations: string[]
): string {
  const envelope = getExecutionEnvelope(style);

  return `
STYLE ENVELOPE VIOLATION

You are trading ${style} mode on ${envelope.timeframe}.

Violations:
${violations.map(v => `- ${v}`).join('\n')}

REQUIRED BOUNDS for ${style}:
- TP: ${envelope.tpPips.min}-${envelope.tpPips.max} pips
- SL: ${envelope.slPips.min}-${envelope.slPips.max} pips
- Target: ${envelope.targetCandles.min}-${envelope.targetCandles.max} ${envelope.timeframe} candles
- ATR Source: ${envelope.atrTimeframe} ONLY

Please revise your TP/SL to match ${style} execution reality.
Use ${envelope.timeframe} structure, not higher timeframe targets.
`.trim();
}

/**
 * Check if style requires EQS gating
 */
export function requiresEQSGate(style: string): boolean {
  const envelope = getExecutionEnvelope(style);
  return envelope.requiresHighEQS;
}

/**
 * Get appropriate ATR timeframe for style
 */
export function getStyleATRTimeframe(style: string): string {
  const envelope = getExecutionEnvelope(style);
  return envelope.atrTimeframe;
}
