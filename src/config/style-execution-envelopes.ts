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
 * That's not "authority removal" -- that's style identity enforcement.
 *
 * CRITICAL DISTINCTION:
 * - Authority WITHIN a style: Alpha decides
 * - Authority to REDEFINE a style: System enforces
 *
 * DYNAMIC BOUNDS (CCIP-2026-02-15):
 * All TP/SL bounds are now PERCENTAGE-BASED, computed dynamically from current price.
 * This eliminates static pip limits that break when asset prices change.
 * Formula: pipBound = (currentPrice * percentBound / 100) / pipValue
 */

import { getCurrencyPipInfo } from '../utils/currencyHelpers';

export type EnvelopeAssetClass = 'FOREX' | 'CRYPTO' | 'METAL' | 'INDEX';

export interface AssetClassBounds {
  tpPips: { min: number; max: number };
  slPips: { min: number; max: number };
}

export interface AssetClassPercentBounds {
  tpPercent: { min: number; max: number };
  slPercent: { min: number; max: number };
}

export interface StyleExecutionEnvelope {
  style: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY' | 'SWING';
  timeframe: string;
  validationTimeframes: string[];

  targetCandles: { min: number; max: number };

  tpPips: { min: number; max: number };
  slPips: { min: number; max: number };

  assetClassPercentBounds: Record<EnvelopeAssetClass, AssetClassPercentBounds>;

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
 * - M5 structure ONLY
 * - HTF is validation, not execution anchor
 * - Entry = NOW or NO TRADE
 */
export const SCALP_ENVELOPE: StyleExecutionEnvelope = {
  style: 'SCALP',
  timeframe: 'M5',
  validationTimeframes: ['M15', 'H1'],

  targetCandles: { min: 3, max: 5 },

  tpPips: { min: 12, max: 60 },
  slPips: { min: 8, max: 20 },

  assetClassPercentBounds: {
    FOREX: { tpPercent: { min: 0.08, max: 0.60 }, slPercent: { min: 0.04, max: 0.25 } },
    CRYPTO: { tpPercent: { min: 0.50, max: 3.00 }, slPercent: { min: 0.30, max: 1.50 } },
    METAL: { tpPercent: { min: 0.30, max: 2.50 }, slPercent: { min: 0.15, max: 1.00 } },
    INDEX: { tpPercent: { min: 0.06, max: 0.50 }, slPercent: { min: 0.04, max: 0.25 } },
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
 * - M15 structure primary, H1 for validation
 * - Pullback entry preferred
 *
 * CCIP (2026-02-17): Recalibrated percentage bounds to prevent permanent infeasibility.
 * Previous bounds were set too aggressively, causing ALL 9 symbols to be envelope-blocked
 * during low/normal volatility conditions:
 * - FOREX SL min 0.12% produced ~14 pip minimum vs ATR-based stops of ~5-10 pips
 * - INDEX SL max 0.12% was BELOW the 0.15% noise floor, creating permanent sandwiches
 * - METAL SL min 0.50% produced ~25 pip minimum vs ATR-based stops of ~10 pips
 * - CRYPTO SL min 0.80% produced ~542 pip minimum for BTCUSD vs ~339 pip ATR stops
 *
 * New bounds maintain style hierarchy (wider than SCALP, tighter than INTRADAY)
 * while being achievable in normal market conditions.
 */
export const MICRO_INTRADAY_ENVELOPE: StyleExecutionEnvelope = {
  style: 'MICRO_INTRADAY',
  timeframe: 'M15',
  validationTimeframes: ['H1', 'H4'],

  targetCandles: { min: 4, max: 8 },

  tpPips: { min: 40, max: 120 },
  slPips: { min: 15, max: 50 },

  assetClassPercentBounds: {
    FOREX: { tpPercent: { min: 0.12, max: 1.20 }, slPercent: { min: 0.06, max: 0.50 } },
    CRYPTO: { tpPercent: { min: 0.75, max: 5.00 }, slPercent: { min: 0.40, max: 2.50 } },
    METAL: { tpPercent: { min: 0.50, max: 5.00 }, slPercent: { min: 0.25, max: 2.00 } },
    INDEX: { tpPercent: { min: 0.08, max: 1.00 }, slPercent: { min: 0.05, max: 0.25 } },
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

  assetClassPercentBounds: {
    FOREX: { tpPercent: { min: 0.40, max: 2.00 }, slPercent: { min: 0.20, max: 0.80 } },
    CRYPTO: { tpPercent: { min: 3.00, max: 10.00 }, slPercent: { min: 1.50, max: 4.00 } },
    METAL: { tpPercent: { min: 1.60, max: 8.00 }, slPercent: { min: 0.80, max: 3.20 } },
    INDEX: { tpPercent: { min: 0.25, max: 0.45 }, slPercent: { min: 0.10, max: 0.20 } },
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

  assetClassPercentBounds: {
    FOREX: { tpPercent: { min: 1.20, max: 5.00 }, slPercent: { min: 0.50, max: 1.50 } },
    CRYPTO: { tpPercent: { min: 5.00, max: 15.00 }, slPercent: { min: 3.00, max: 7.00 } },
    METAL: { tpPercent: { min: 5.00, max: 20.00 }, slPercent: { min: 2.00, max: 6.00 } },
    INDEX: { tpPercent: { min: 0.50, max: 3.00 }, slPercent: { min: 0.20, max: 1.00 } },
  },

  atrTimeframe: 'H4',

  typicalDuration: { min: 1440, max: 10080 },

  entryMode: 'PATIENT',
  requiresHighEQS: true,
};

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

function computePipBounds(
  percentBounds: AssetClassPercentBounds,
  currentPrice: number,
  pipValue: number
): AssetClassBounds {
  return {
    tpPips: {
      min: Math.round((currentPrice * percentBounds.tpPercent.min / 100) / pipValue * 10) / 10,
      max: Math.round((currentPrice * percentBounds.tpPercent.max / 100) / pipValue * 10) / 10,
    },
    slPips: {
      min: Math.round((currentPrice * percentBounds.slPercent.min / 100) / pipValue * 10) / 10,
      max: Math.round((currentPrice * percentBounds.slPercent.max / 100) / pipValue * 10) / 10,
    },
  };
}

/**
 * Get asset-class-resolved TP/SL bounds for a style.
 *
 * SSOT: Bounds are computed dynamically from percentage-of-price.
 * This ensures envelopes scale automatically with asset price changes.
 *
 * When currentPrice is provided: computes dynamic pip bounds from percentages.
 * When currentPrice is NOT provided: returns base envelope defaults (fallback).
 */
export function getAssetClassEnvelopeBounds(
  style: string,
  assetClass?: EnvelopeAssetClass,
  symbol?: string,
  currentPrice?: number
): AssetClassBounds {
  const envelope = getExecutionEnvelope(style);

  if (currentPrice && currentPrice > 0 && assetClass) {
    const pipValue = symbol ? getCurrencyPipInfo(symbol).pipValue : 1.0;
    const percentBounds = envelope.assetClassPercentBounds[assetClass];
    if (percentBounds) {
      return computePipBounds(percentBounds, currentPrice, pipValue);
    }
  }

  if (!assetClass) {
    return {
      tpPips: envelope.tpPips,
      slPips: envelope.slPips,
    };
  }

  const percentBounds = envelope.assetClassPercentBounds[assetClass];
  if (!percentBounds) {
    return {
      tpPips: envelope.tpPips,
      slPips: envelope.slPips,
    };
  }

  return {
    tpPips: envelope.tpPips,
    slPips: envelope.slPips,
  };
}

/**
 * Get the raw percentage bounds for a style and asset class.
 * Used by systems that need to communicate percentages directly (e.g., Intelligence Monitor).
 */
export function getEnvelopePercentBounds(
  style: string,
  assetClass: EnvelopeAssetClass
): AssetClassPercentBounds | null {
  const envelope = getExecutionEnvelope(style);
  return envelope.assetClassPercentBounds[assetClass] || null;
}

/**
 * Validate TP/SL against style envelope (asset-class-aware, price-dynamic)
 *
 * Returns revision request if outside bounds.
 * When currentPrice is provided, uses dynamic percentage-based bounds.
 */
export function validateTPSLAgainstEnvelope(
  style: string,
  tpPips: number,
  slPips: number,
  assetClass?: EnvelopeAssetClass,
  symbol?: string,
  currentPrice?: number
): { valid: boolean; violations: string[]; envelope: StyleExecutionEnvelope } {
  const envelope = getExecutionEnvelope(style);
  const bounds = getAssetClassEnvelopeBounds(style, assetClass, symbol, currentPrice);
  const violations: string[] = [];
  const boundsLabel = assetClass ? `${style} ${assetClass}` : style;

  if (tpPips < bounds.tpPips.min) {
    violations.push(
      `TP ${tpPips.toFixed(1)} pips below ${boundsLabel} minimum ${bounds.tpPips.min.toFixed(1)} pips`
    );
  }

  if (tpPips > bounds.tpPips.max) {
    violations.push(
      `TP ${tpPips.toFixed(1)} pips exceeds ${boundsLabel} maximum ${bounds.tpPips.max.toFixed(1)} pips. ` +
      `This is ${envelope.timeframe} ${style} trading, not ${tpPips > 150 ? 'SWING' : 'INTRADAY'}.`
    );
  }

  if (slPips < bounds.slPips.min) {
    violations.push(
      `SL ${slPips.toFixed(1)} pips below ${boundsLabel} minimum ${bounds.slPips.min.toFixed(1)} pips (too tight)`
    );
  }

  if (slPips > bounds.slPips.max) {
    violations.push(
      `SL ${slPips.toFixed(1)} pips exceeds ${boundsLabel} maximum ${bounds.slPips.max.toFixed(1)} pips. ` +
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
 * making the style mathematically impossible.
 *
 * GOVERNANCE: When detected, the ONLY resolution is NO_TRADE.
 * Style upgrades are NEVER permitted.
 */
export function detectConstraintSandwich(
  style: string,
  assetClass: EnvelopeAssetClass,
  noiseFloorPips: number,
  symbol: string,
  currentPrice?: number
): { sandwiched: boolean; advisory: string | null; slMax?: number; noiseFloor?: number } {
  const bounds = getAssetClassEnvelopeBounds(style, assetClass, symbol, currentPrice);
  const slMax = bounds.slPips.max;

  if (noiseFloorPips > slMax) {
    const advisory =
      `${style} not viable on ${symbol} -- noise floor (${noiseFloorPips.toFixed(1)} pips) ` +
      `exceeds ${style} ${assetClass} SL max (${slMax.toFixed(1)} pips). Recommend NO_TRADE.`;

    console.warn(`[CONSTRAINT_SANDWICH] ${advisory}`);

    return { sandwiched: true, advisory, slMax, noiseFloor: noiseFloorPips };
  }

  return { sandwiched: false, advisory: null };
}

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

export function requiresEQSGate(style: string): boolean {
  const envelope = getExecutionEnvelope(style);
  return envelope.requiresHighEQS;
}

export function getStyleATRTimeframe(style: string): string {
  const envelope = getExecutionEnvelope(style);
  return envelope.atrTimeframe;
}

const ALL_TRADEABLE_STYLES = ['SCALP', 'MICRO_INTRADAY', 'INTRADAY'] as const;

export function getViableStyles(
  symbol: string,
  assetClass: EnvelopeAssetClass,
  noiseFloorPips: number,
  currentPrice?: number
): string[] {
  return ALL_TRADEABLE_STYLES.filter(style => {
    const result = detectConstraintSandwich(style, assetClass, noiseFloorPips, symbol, currentPrice);
    return !result.sandwiched;
  });
}
