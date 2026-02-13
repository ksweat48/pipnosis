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

export type EnvelopeAssetClass = 'FOREX' | 'CRYPTO' | 'METAL' | 'INDEX';

export interface AssetClassBounds {
  tpPips: { min: number; max: number };
  slPips: { min: number; max: number };
}

export interface StyleExecutionEnvelope {
  style: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY' | 'SWING';
  timeframe: string;
  validationTimeframes: string[];

  targetCandles: { min: number; max: number };

  tpPips: { min: number; max: number };
  slPips: { min: number; max: number };

  assetClassBounds: Record<EnvelopeAssetClass, AssetClassBounds>;

  atrTimeframe: string;

  typicalDuration: { min: number; max: number };

  entryMode: 'IMMEDIATE' | 'PATIENT';

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

  assetClassBounds: {
    FOREX: { tpPips: { min: 10, max: 60 }, slPips: { min: 5, max: 25 } },
    CRYPTO: { tpPips: { min: 30, max: 150 }, slPips: { min: 15, max: 80 } },
    METAL: { tpPips: { min: 10, max: 60 }, slPips: { min: 5, max: 25 } },
    INDEX: { tpPips: { min: 15, max: 80 }, slPips: { min: 8, max: 35 } },
  },

  atrTimeframe: 'M5',

  typicalDuration: { min: 15, max: 60 },

  entryMode: 'IMMEDIATE',
  requiresHighEQS: false,
};

/**
 * MICRO_INTRADAY - M15 Tactical Execution
 *
 * Identity:
 * - Captures structural M15 moves
 * - Typically 4-8 M15 candles
 * - Medium TP (40-120 pips)
 * - Moderate SL (15-40 pips)
 * - M15 structure primary, H1 for validation
 * - Pullback entry preferred
 */
export const MICRO_INTRADAY_ENVELOPE: StyleExecutionEnvelope = {
  style: 'MICRO_INTRADAY',
  timeframe: 'M15',
  validationTimeframes: ['H1', 'H4'],

  targetCandles: { min: 4, max: 8 },

  tpPips: { min: 40, max: 120 },
  slPips: { min: 15, max: 40 },

  assetClassBounds: {
    FOREX: { tpPips: { min: 30, max: 120 }, slPips: { min: 15, max: 50 } },
    CRYPTO: { tpPips: { min: 80, max: 300 }, slPips: { min: 40, max: 150 } },
    METAL: { tpPips: { min: 30, max: 120 }, slPips: { min: 15, max: 50 } },
    INDEX: { tpPips: { min: 40, max: 150 }, slPips: { min: 20, max: 70 } },
  },

  atrTimeframe: 'M15',

  typicalDuration: { min: 60, max: 360 },

  entryMode: 'PATIENT',
  requiresHighEQS: false,
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

  assetClassBounds: {
    FOREX: { tpPips: { min: 50, max: 200 }, slPips: { min: 25, max: 80 } },
    CRYPTO: { tpPips: { min: 150, max: 500 }, slPips: { min: 80, max: 250 } },
    METAL: { tpPips: { min: 50, max: 200 }, slPips: { min: 25, max: 80 } },
    INDEX: { tpPips: { min: 60, max: 250 }, slPips: { min: 30, max: 100 } },
  },

  atrTimeframe: 'H1',

  typicalDuration: { min: 120, max: 720 },

  entryMode: 'PATIENT',
  requiresHighEQS: true,
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

  assetClassBounds: {
    FOREX: { tpPips: { min: 150, max: 500 }, slPips: { min: 60, max: 150 } },
    CRYPTO: { tpPips: { min: 300, max: 1000 }, slPips: { min: 150, max: 400 } },
    METAL: { tpPips: { min: 150, max: 500 }, slPips: { min: 60, max: 150 } },
    INDEX: { tpPips: { min: 200, max: 600 }, slPips: { min: 80, max: 200 } },
  },

  atrTimeframe: 'H4',

  typicalDuration: { min: 1440, max: 10080 },

  entryMode: 'PATIENT',
  requiresHighEQS: true,
};

/**
 * Get execution envelope for a style (base defaults)
 */
export function getExecutionEnvelope(style: string): StyleExecutionEnvelope {
  switch (style.toUpperCase()) {
    case 'SCALP':
      return SCALP_ENVELOPE;
    case 'MICRO_INTRADAY':
      return MICRO_INTRADAY_ENVELOPE;
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
 * Get asset-class-resolved TP/SL bounds for a style.
 *
 * SSOT: The Style Qualification Gate already defines per-asset-class contracts.
 * This function aligns the execution envelope with those contracts so that
 * the capping logic uses the correct bounds for each instrument category.
 *
 * Falls back to the base envelope defaults if no asset class is provided.
 */
export function getAssetClassEnvelopeBounds(
  style: string,
  assetClass?: EnvelopeAssetClass
): AssetClassBounds {
  const envelope = getExecutionEnvelope(style);
  if (!assetClass) {
    return {
      tpPips: envelope.tpPips,
      slPips: envelope.slPips,
    };
  }
  return envelope.assetClassBounds[assetClass] || {
    tpPips: envelope.tpPips,
    slPips: envelope.slPips,
  };
}

/**
 * Validate TP/SL against style envelope (asset-class-aware)
 *
 * Returns revision request if outside bounds.
 * When assetClass is provided, uses asset-class-specific bounds.
 */
export function validateTPSLAgainstEnvelope(
  style: string,
  tpPips: number,
  slPips: number,
  assetClass?: EnvelopeAssetClass
): { valid: boolean; violations: string[]; envelope: StyleExecutionEnvelope } {
  const envelope = getExecutionEnvelope(style);
  const bounds = getAssetClassEnvelopeBounds(style, assetClass);
  const violations: string[] = [];
  const boundsLabel = assetClass ? `${style} ${assetClass}` : style;

  if (tpPips < bounds.tpPips.min) {
    violations.push(
      `TP ${tpPips.toFixed(1)} pips below ${boundsLabel} minimum ${bounds.tpPips.min} pips`
    );
  }

  if (tpPips > bounds.tpPips.max) {
    violations.push(
      `TP ${tpPips.toFixed(1)} pips exceeds ${boundsLabel} maximum ${bounds.tpPips.max} pips. ` +
      `This is ${envelope.timeframe} ${style} trading, not ${tpPips > 150 ? 'SWING' : 'INTRADAY'}.`
    );
  }

  if (slPips < bounds.slPips.min) {
    violations.push(
      `SL ${slPips.toFixed(1)} pips below ${boundsLabel} minimum ${bounds.slPips.min} pips (too tight)`
    );
  }

  if (slPips > bounds.slPips.max) {
    violations.push(
      `SL ${slPips.toFixed(1)} pips exceeds ${boundsLabel} maximum ${bounds.slPips.max} pips. ` +
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
 * Constraint Sandwich Detection (SSOT)
 *
 * Detects when a style's envelope SL cap is below the noise floor for a given instrument,
 * making the style mathematically impossible. This is the "envelope cap vs noise floor"
 * conflict (Constraint Sandwich).
 *
 * GOVERNANCE: When detected, the ONLY resolution is NO_TRADE.
 * Style upgrades are NEVER permitted.
 *
 * Returns a clear advisory string for Alpha if sandwich is detected, or null if viable.
 */
export function detectConstraintSandwich(
  style: string,
  assetClass: EnvelopeAssetClass,
  noiseFloorPips: number,
  symbol: string
): { sandwiched: boolean; advisory: string | null } {
  const bounds = getAssetClassEnvelopeBounds(style, assetClass);
  const slMax = bounds.slPips.max;

  if (noiseFloorPips > slMax) {
    const advisory =
      `${style} not viable on ${symbol} -- noise floor (${noiseFloorPips.toFixed(1)} pips) ` +
      `exceeds ${style} ${assetClass} SL max (${slMax} pips). Recommend NO_TRADE.`;

    console.warn(`[CONSTRAINT_SANDWICH] ${advisory}`);

    return { sandwiched: true, advisory };
  }

  return { sandwiched: false, advisory: null };
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
