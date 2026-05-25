/**
 * Style Execution Envelopes - SSOT for Trade Style Boundaries
 *
 * CCIP-2026-0427E-STYLE-CONSOLIDATION: Pipnosis is single-style.
 * Only MICRO_INTRADAY remains. The scalp use case is handled by TP1 (fast partial),
 * the intraday use case by TP2 (full target). All legacy style strings normalise to MICRO_INTRADAY.
 *
 * GOVERNANCE PRINCIPLE:
 * Alpha chooses direction and execution intent.
 * The SYSTEM defines the allowable execution envelope (entry timeframe, TP/SL bounds,
 * candle horizon). Alpha cannot redefine the envelope — that is style identity enforcement.
 *
 * DYNAMIC BOUNDS:
 * All TP/SL bounds are PERCENTAGE-BASED, computed dynamically from current price.
 * pipBound = (currentPrice * percentBound / 100) / pipValue
 *
 * INDEX PRICE-TIER SCALING:
 * INDEX envelopes use price-tier-scaled percentages so walls remain structurally
 * meaningful regardless of nominal index price level.
 * Authority: wall-calibration-config.ts INDEX_PRICE_TIERS.
 *
 * NOISE FLOOR ALIGNMENT:
 * slPercent.min values MUST be >= the noise floor for the asset class:
 *   INDEX: 0.15%, METAL: 0.20%, FOREX: 0.05%
 */

import { getCurrencyPipInfo } from '../utils/currencyHelpers';
import { getIndexPriceTierBounds } from './wall-calibration-config';

export type EnvelopeAssetClass = 'FOREX' | 'METAL' | 'INDEX';

export interface AssetClassBounds {
  tpPips: { min: number; max: number };
  slPips: { min: number; max: number };
}

export interface AssetClassPercentBounds {
  tpPercent: { min: number; max: number };
  slPercent: { min: number; max: number };
}

export interface StyleExecutionEnvelope {
  style: 'MICRO_INTRADAY';
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
 * MICRO_INTRADAY - M5 Tactical Execution (sole style)
 *
 * Identity:
 * - Captures structural M5 moves
 * - Typically 4-8 M5 candles
 * - M5 structure primary, M15 for validation, H1 for context
 * - TP1 = scalp partial; TP2 = full intraday target
 */
export const MICRO_INTRADAY_ENVELOPE: StyleExecutionEnvelope = {
  style: 'MICRO_INTRADAY',
  timeframe: 'M5',
  validationTimeframes: ['M15', 'H1'],

  targetCandles: { min: 4, max: 8 },

  tpPips: { min: 40, max: 120 },
  slPips: { min: 15, max: 50 },

  assetClassPercentBounds: {
    FOREX:   { tpPercent: { min: 0.12, max: 1.20 }, slPercent: { min: 0.06, max: 0.50 } },
    METAL:   { tpPercent: { min: 0.50, max: 5.00 }, slPercent: { min: 0.25, max: 2.00 } },
    INDEX:   { tpPercent: { min: 0.25, max: 1.00 }, slPercent: { min: 0.15, max: 0.35 } },
  },

  atrTimeframe: 'M5',

  typicalDuration: { min: 60, max: 360 },

  entryMode: 'PATIENT',
  requiresHighEQS: false,
};

export function getExecutionEnvelope(_style?: string): StyleExecutionEnvelope {
  return MICRO_INTRADAY_ENVELOPE;
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
 * Get asset-class-resolved TP/SL bounds.
 * INDEX uses price-tier-scaled percentages from wall-calibration-config.
 */
export function getAssetClassEnvelopeBounds(
  _style: string | undefined,
  assetClass?: EnvelopeAssetClass,
  symbol?: string,
  currentPrice?: number
): AssetClassBounds {
  const envelope = MICRO_INTRADAY_ENVELOPE;

  if (currentPrice && currentPrice > 0 && assetClass) {
    const pipValue = symbol ? getCurrencyPipInfo(symbol).pipValue : 1.0;

    if (assetClass === 'INDEX') {
      const tierBounds = getIndexPriceTierBounds('MICRO_INTRADAY', currentPrice);
      if (tierBounds) {
        const result = computePipBounds(tierBounds, currentPrice, pipValue);
        console.log(
          `[Index Price-Tier Scaling] ${symbol || 'INDEX'} @ ${currentPrice.toFixed(2)}: ` +
          `SL ${tierBounds.slPercent.min}%-${tierBounds.slPercent.max}% = ` +
          `${result.slPips.min.toFixed(1)}-${result.slPips.max.toFixed(1)} pips | ` +
          `TP ${tierBounds.tpPercent.min}%-${tierBounds.tpPercent.max}% = ` +
          `${result.tpPips.min.toFixed(1)}-${result.tpPips.max.toFixed(1)} pips (MICRO_INTRADAY)`
        );
        return result;
      }
    }

    const percentBounds = envelope.assetClassPercentBounds[assetClass];
    if (percentBounds) {
      return computePipBounds(percentBounds, currentPrice, pipValue);
    }
  }

  return {
    tpPips: envelope.tpPips,
    slPips: envelope.slPips,
  };
}

export function getEnvelopePercentBounds(
  _style: string | undefined,
  assetClass: EnvelopeAssetClass
): AssetClassPercentBounds | null {
  return MICRO_INTRADAY_ENVELOPE.assetClassPercentBounds[assetClass] || null;
}

const ENVELOPE_COMPARISON_EPSILON = 0.15;

export function validateTPSLAgainstEnvelope(
  style: string,
  tpPips: number,
  slPips: number,
  assetClass?: EnvelopeAssetClass,
  symbol?: string,
  currentPrice?: number
): { valid: boolean; violations: string[]; envelope: StyleExecutionEnvelope } {
  const envelope = MICRO_INTRADAY_ENVELOPE;
  const bounds = getAssetClassEnvelopeBounds(style, assetClass, symbol, currentPrice);
  const violations: string[] = [];
  const boundsLabel = assetClass ? `MICRO_INTRADAY ${assetClass}` : 'MICRO_INTRADAY';

  if (tpPips < bounds.tpPips.min - ENVELOPE_COMPARISON_EPSILON) {
    violations.push(`TP ${tpPips.toFixed(1)} pips below ${boundsLabel} minimum ${bounds.tpPips.min.toFixed(1)} pips`);
  }
  if (tpPips > bounds.tpPips.max + ENVELOPE_COMPARISON_EPSILON) {
    violations.push(`TP ${tpPips.toFixed(1)} pips exceeds ${boundsLabel} maximum ${bounds.tpPips.max.toFixed(1)} pips.`);
  }
  if (slPips < bounds.slPips.min - ENVELOPE_COMPARISON_EPSILON) {
    violations.push(`SL ${slPips.toFixed(1)} pips below ${boundsLabel} minimum ${bounds.slPips.min.toFixed(1)} pips (too tight)`);
  }
  if (slPips > bounds.slPips.max + ENVELOPE_COMPARISON_EPSILON) {
    violations.push(`SL ${slPips.toFixed(1)} pips exceeds ${boundsLabel} maximum ${bounds.slPips.max.toFixed(1)} pips.`);
  }

  return { valid: violations.length === 0, violations, envelope };
}

/**
 * Noise Floor Advisory (Diagnostic Only).
 * Detects when noise floor exceeds the style envelope SL cap.
 * Never blocks. Alpha decides whether to proceed.
 */
export function detectConstraintSandwich(
  _style: string | undefined,
  assetClass: EnvelopeAssetClass,
  noiseFloorPips: number,
  symbol: string,
  currentPrice?: number
): { sandwiched: boolean; advisory: string | null; slMax?: number; noiseFloor?: number } {
  const bounds = getAssetClassEnvelopeBounds('MICRO_INTRADAY', assetClass, symbol, currentPrice);
  const slMax = bounds.slPips.max;

  if (noiseFloorPips > slMax) {
    const advisory =
      `High noise on ${symbol}: noise (${noiseFloorPips.toFixed(1)} pips) ` +
      `exceeds MICRO_INTRADAY ${assetClass} SL max (${slMax.toFixed(1)} pips). Consider wide stops.`;
    console.log(`[NOISE_ADVISORY] ${advisory}`);
    return { sandwiched: false, advisory, slMax, noiseFloor: noiseFloorPips };
  }

  return { sandwiched: false, advisory: null };
}

export function getRevisionPrompt(_style: string | undefined, violations: string[]): string {
  const envelope = MICRO_INTRADAY_ENVELOPE;
  return `
STYLE ENVELOPE VIOLATION

You are trading MICRO_INTRADAY mode on ${envelope.timeframe}.

Violations:
${violations.map(v => `- ${v}`).join('\n')}

REQUIRED BOUNDS for MICRO_INTRADAY:
- TP: ${envelope.tpPips.min}-${envelope.tpPips.max} pips
- SL: ${envelope.slPips.min}-${envelope.slPips.max} pips
- Target: ${envelope.targetCandles.min}-${envelope.targetCandles.max} ${envelope.timeframe} candles
- ATR Source: ${envelope.atrTimeframe} ONLY

Please revise your TP/SL to match MICRO_INTRADAY execution reality.
`.trim();
}

export function requiresEQSGate(_style?: string): boolean {
  return MICRO_INTRADAY_ENVELOPE.requiresHighEQS;
}

export function getStyleATRTimeframe(_style?: string): string {
  return MICRO_INTRADAY_ENVELOPE.atrTimeframe;
}

/**
 * All styles collapse to MICRO_INTRADAY. The list returned here is for legacy callers
 * that iterate over "available styles" — there is exactly one.
 */
export function getViableStyles(
  _symbol: string,
  _assetClass: EnvelopeAssetClass,
  _noiseFloorPips: number,
  _currentPrice?: number
): string[] {
  return ['MICRO_INTRADAY'];
}
