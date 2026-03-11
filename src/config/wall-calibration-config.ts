/**
 * Wall Calibration Config — SSOT for Dynamic Wall Adjustment
 *
 * GOVERNANCE PRINCIPLE (CCIP-2026-02-18):
 * Walls are physics — they define the safe trading corridor.
 * But physics can breathe with the market. This config defines
 * HOW the walls expand or contract based on live conditions,
 * ensuring Alpha always has a valid corridor to execute in.
 *
 * ARCHITECTURE:
 * - All calibration constants live HERE — never scattered as magic numbers
 * - WallCalibrationEngine reads this config exclusively
 * - Any future tuning happens in this file, inherited everywhere automatically
 *
 * SAFETY PRINCIPLE:
 * Walls only EXPAND when conditions demand it (giving Alpha more space).
 * Walls never compress below the envelope minimum (style identity is preserved).
 * All expansions are bounded by per-asset-class absolute safety ceilings.
 *
 * SSOT COMPLIANCE:
 * - ATR multiplier authority: this file
 * - TP floor adjustment authority: this file
 * - Calibration reason enum: this file
 */

export type WallCalibrationReason =
  | 'LOW_VOLATILITY_EXPANSION'
  | 'SESSION_TIME_EXPANSION'
  | 'NORMAL_VOLATILITY'
  | 'HIGH_VOLATILITY_STANDARD'
  | 'CORRIDOR_INFEASIBLE_EXPANSION'
  | 'NO_ADJUSTMENT';

export type AssetCalibrationClass = 'FOREX' | 'CRYPTO' | 'METAL' | 'INDEX';

/**
 * ATR multiplier by volatility regime.
 *
 * Logic: When volatility is low, the ATR value itself is smaller.
 * Using the same 12x multiplier on a small ATR produces a compressed
 * ceiling that blocks valid structural trades. We expand the multiplier
 * to compensate so the TP ceiling reflects what the STRUCTURE demands,
 * not what a compressed ATR measurement suggests.
 *
 * HIGH: Use default (12x) — ATR is expanded, ceiling is already wide
 * NORMAL/MEDIUM: Slightly wider (14x) — moderate compensation
 * LOW: Maximum expansion (16x) — ATR is suppressed, corridor needs room
 */
export const ATR_MULTIPLIER_BY_REGIME: Record<'low' | 'medium' | 'high', number> = {
  low: 16,
  medium: 14,
  high: 12,
};

/**
 * Absolute maximum ATR multiplier per asset class.
 *
 * These are hard ceilings — the calibration engine will NEVER exceed these
 * regardless of how compressed conditions are. Protects against alpha
 * receiving absurdly wide TP ceilings.
 *
 * CRYPTO: 20x — crypto can move dramatically, needs wide ceiling
 * FOREX: 16x — forex has bounded ATR ranges, 16x is already generous
 * METAL: 18x — gold/silver can spike but less extreme than crypto
 * INDEX: 16x — indices have session-bounded moves
 */
export const MAX_SAFE_ATR_MULTIPLIER: Record<AssetCalibrationClass, number> = {
  CRYPTO: 20,
  FOREX: 16,
  METAL: 18,
  INDEX: 16,
};

/**
 * Minimum ATR multiplier — never compress below this.
 * Even in the most extreme conditions, a 10x floor preserves
 * the meaning of the ATR as a trading range reference.
 */
export const MIN_ATR_MULTIPLIER = 10;

/**
 * Session time thresholds for triggering session-based expansion.
 *
 * When session time remaining is below these thresholds, the calibration
 * engine expands the ATR multiplier to ensure Alpha has a reachable corridor.
 *
 * CRITICAL: This does NOT cap TP to session time. It EXPANDS the ATR
 * multiplier so the calculated walls remain wider than the feasible travel,
 * preserving Alpha's ability to place a valid TP.
 */
export const SESSION_TIME_EXPANSION_THRESHOLDS = {
  CRITICAL_MINUTES: 30,
  LOW_MINUTES: 60,
  MODERATE_MINUTES: 120,
};

/**
 * Multiplier applied to the ATR multiplier when session time is short.
 * These stack on top of the regime-based multiplier.
 *
 * CRITICAL (<30min): +25% expansion on top of regime multiplier
 * LOW (<60min): +15% expansion
 * MODERATE (<120min): +8% expansion
 */
export const SESSION_EXPANSION_FACTORS = {
  CRITICAL: 1.25,
  LOW: 1.15,
  MODERATE: 1.08,
};

/**
 * TP percentage floor adjustments by volatility regime.
 *
 * The envelope defines absolute percentage bounds (e.g., INTRADAY CRYPTO
 * has tpPercent { min: 3.00, max: 10.00 }). In low-volatility conditions
 * the MARKET cannot support the 3.00% floor — that minimum is calibrated
 * for active/volatile sessions. This config adjusts the effective floor
 * downward while staying within the envelope's own range.
 *
 * HIGH: Use envelope stated floor (1.0x — no adjustment)
 * MEDIUM/NORMAL: Reduce to 75% of envelope floor
 * LOW: Reduce to 50% of envelope floor
 *
 * This keeps the adjustment within the envelope range (since the envelope
 * defines min and max — the calibrated floor must stay above the envelope
 * minimum's lower cousin, specifically: >= envelope tpPercent.min * 0.35
 * to avoid collapsing the floor to zero).
 */
export const TP_FLOOR_RATIO_BY_REGIME: Record<'low' | 'medium' | 'high', number> = {
  low: 0.50,
  medium: 0.75,
  high: 1.00,
};

/**
 * Absolute minimum TP floor ratio — never compress below 35% of envelope floor.
 * This ensures even the most calibrated-down floor has structural meaning.
 */
export const MIN_TP_FLOOR_RATIO = 0.35;

/**
 * Minimum corridor width required (in pips) before the calibration engine
 * concludes a corridor is infeasible and applies emergency expansion.
 *
 * If after initial calibration (tpMax - tpMin) < this value,
 * the engine further expands the ATR multiplier until the corridor
 * reaches this minimum width, up to the asset-class safety ceiling.
 */
export const MIN_CORRIDOR_WIDTH_PIPS: Record<AssetCalibrationClass, number> = {
  FOREX: 5,
  CRYPTO: 50,
  METAL: 20,
  INDEX: 10,
};

/**
 * Governs whether calibration adjustments are logged to Supabase.
 * Set to false only during testing. Always true in production.
 */
export const CALIBRATION_AUDIT_ENABLED = true;

/**
 * INDEX PRICE-TIER SCALING CONFIG — SSOT (CCIP-2026-03-11)
 *
 * Problem: INDEX envelope percentages (e.g. SCALP SL floor 0.15%) are calibrated
 * for mid-range index prices (~5,000-15,000). At US30 ($47,000+), 0.15% = 70 pips —
 * far too wide for a SCALP style trade. At NAS100 ($25,000), 0.15% = 37 pips —
 * still excessive for M5 SCALP execution. The percentage itself must scale INVERSELY
 * with nominal price magnitude so that pip walls remain structurally meaningful
 * regardless of what price level the index trades at in the future.
 *
 * Design principle:
 * - Target SCALP SL floor: 15–30 pips (appropriate for M5 index scalp)
 * - Target SCALP SL ceiling: 35–70 pips (style identity preserved)
 * - At each price tier, percentages are chosen so these targets hold
 * - TP bounds scale proportionally to maintain valid R:R windows
 *
 * Tiers are price-agnostic — they will automatically accommodate any future
 * index price level without code changes.
 *
 * SSOT: This config is the ONLY place index price-tier percentages are defined.
 * style-execution-envelopes.ts reads this for all INDEX envelope computations.
 */
export interface IndexPriceTierBounds {
  slPercent: { min: number; max: number };
  tpPercent: { min: number; max: number };
}

export interface IndexPriceTier {
  maxPrice: number;
  scalp: IndexPriceTierBounds;
  microIntraday: IndexPriceTierBounds;
  intraday: IndexPriceTierBounds;
}

export const INDEX_PRICE_TIERS: IndexPriceTier[] = [
  {
    maxPrice: 5_000,
    scalp:         { slPercent: { min: 0.15, max: 0.35 }, tpPercent: { min: 0.20, max: 1.00 } },
    microIntraday: { slPercent: { min: 0.15, max: 0.35 }, tpPercent: { min: 0.25, max: 1.00 } },
    intraday:      { slPercent: { min: 0.15, max: 0.40 }, tpPercent: { min: 0.35, max: 1.30 } },
  },
  {
    maxPrice: 15_000,
    scalp:         { slPercent: { min: 0.10, max: 0.25 }, tpPercent: { min: 0.12, max: 0.70 } },
    microIntraday: { slPercent: { min: 0.10, max: 0.25 }, tpPercent: { min: 0.15, max: 0.75 } },
    intraday:      { slPercent: { min: 0.10, max: 0.30 }, tpPercent: { min: 0.25, max: 1.00 } },
  },
  {
    maxPrice: 30_000,
    scalp:         { slPercent: { min: 0.07, max: 0.18 }, tpPercent: { min: 0.08, max: 0.50 } },
    microIntraday: { slPercent: { min: 0.07, max: 0.18 }, tpPercent: { min: 0.10, max: 0.55 } },
    intraday:      { slPercent: { min: 0.07, max: 0.22 }, tpPercent: { min: 0.18, max: 0.80 } },
  },
  {
    maxPrice: 60_000,
    scalp:         { slPercent: { min: 0.05, max: 0.13 }, tpPercent: { min: 0.06, max: 0.35 } },
    microIntraday: { slPercent: { min: 0.05, max: 0.13 }, tpPercent: { min: 0.07, max: 0.40 } },
    intraday:      { slPercent: { min: 0.05, max: 0.16 }, tpPercent: { min: 0.12, max: 0.60 } },
  },
  {
    maxPrice: Infinity,
    scalp:         { slPercent: { min: 0.03, max: 0.09 }, tpPercent: { min: 0.04, max: 0.25 } },
    microIntraday: { slPercent: { min: 0.03, max: 0.09 }, tpPercent: { min: 0.05, max: 0.28 } },
    intraday:      { slPercent: { min: 0.03, max: 0.11 }, tpPercent: { min: 0.08, max: 0.40 } },
  },
];

/**
 * Get the price-tier-scaled INDEX percent bounds for a given style and price.
 * Returns null if the price is not positive (falls back to static envelope).
 */
export function getIndexPriceTierBounds(
  style: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY' | 'SWING',
  currentPrice: number
): IndexPriceTierBounds | null {
  if (!currentPrice || currentPrice <= 0) return null;
  const tier = INDEX_PRICE_TIERS.find(t => currentPrice <= t.maxPrice);
  if (!tier) return null;
  switch (style) {
    case 'SCALP': return tier.scalp;
    case 'MICRO_INTRADAY': return tier.microIntraday;
    case 'INTRADAY': return tier.intraday;
    default: return tier.intraday;
  }
}
