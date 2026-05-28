/**
 * CCIP-2026-0528A: Continuous Confidence Architecture.
 *
 * Alpha outputs a direct integer (1-99) representing genuine probability.
 * Display tiers are DERIVED from the numeric value for UI display only.
 *
 * DISPLAY TIER RANGES (derived from numeric confidence):
 *  low_quality          (< 60)   Best-effort read with limited evidence.
 *  confident            (60-69)  Solid structure, direction named, positive EV.
 *  very_confident       (70-79)  Strong multi-dimensional evidence.
 *  extremely_confident  (80+)    Near-perfect alignment, high conviction.
 *
 * LEGACY TIERS
 * Historical records may still carry legacy tier strings. These are normalised
 * via numberToTier() / display via formatConfidenceTier().
 */

export type ConfidenceTier =
  | 'low_quality'
  | 'confident'
  | 'very_confident'
  | 'extremely_confident'
  | 'no_read'
  | 'low'
  | 'cautious'
  | 'moderate'
  | 'high'
  | 'very_high'
  | 'extreme';

/**
 * Active display tiers used by the UI.
 */
export const ACTIONABLE_CONFIDENCE_TIERS = new Set<string>([
  'low_quality',
  'confident',
  'very_confident',
  'extremely_confident',
]);

export const ACTIVE_CONFIDENCE_TIERS = new Set<string>([
  'low_quality',
  'confident',
  'very_confident',
  'extremely_confident',
]);

/**
 * Recommended-execution floor. Trades at or above this value are flagged in
 * the UI as recommended; below it the user is shown a "Low Quality" badge.
 */
export const RECOMMENDED_CONFIDENCE_FLOOR = 60;

/**
 * Fixed midpoint conversion for legacy tier strings. Used when reading old
 * database records that only have a text tier and no numeric confidence.
 */
export const CONFIDENCE_TIER_TO_NUMBER: Record<ConfidenceTier, number> = {
  low_quality:         50,
  confident:           65,
  very_confident:      75,
  extremely_confident: 88,
  no_read:   10,
  low:       25,
  cautious:  40,
  moderate:  55,
  high:      75,
  very_high: 82,
  extreme:   90,
};

export const CONFIDENCE_TIER_LABELS: Record<ConfidenceTier, string> = {
  low_quality:         'Low Quality',
  confident:           'Confident',
  very_confident:      'Very Confident',
  extremely_confident: 'Extremely Confident',
  no_read:   'No Read',
  low:       'Low',
  cautious:  'Cautious',
  moderate:  'Moderate',
  high:      'High',
  very_high: 'Very High',
  extreme:   'Extreme',
};

export const VALID_CONFIDENCE_TIERS = new Set<string>(Object.keys(CONFIDENCE_TIER_TO_NUMBER));

/**
 * Convert Alpha's text tier to the numeric confidence used by all downstream
 * systems. Returns 0 if the tier is unrecognised (signals a schema violation).
 */
export function tierToNumber(tier: string | undefined | null): number {
  if (!tier) return 0;
  return CONFIDENCE_TIER_TO_NUMBER[tier as ConfidenceTier] ?? 0;
}

/**
 * Convert a numeric confidence to the display tier label.
 * This is the PRIMARY conversion path under CCIP-2026-0528A.
 */
export function numberToTier(confidence: number): ConfidenceTier {
  if (confidence >= 80) return 'extremely_confident';
  if (confidence >= 70) return 'very_confident';
  if (confidence >= 60) return 'confident';
  return 'low_quality';
}

/**
 * Normalise any (possibly legacy) tier string to the active four-tier
 * vocabulary.
 */
export function normalizeTier(tier: string | undefined | null): ConfidenceTier {
  if (!tier) return 'low_quality';
  if (ACTIVE_CONFIDENCE_TIERS.has(tier)) return tier as ConfidenceTier;
  const numeric = CONFIDENCE_TIER_TO_NUMBER[tier as ConfidenceTier];
  if (typeof numeric === 'number') return numberToTier(numeric);
  return 'low_quality';
}

/**
 * Format confidence for user display: "Confident (65%)".
 * Prefers numeric value when available.
 */
export function formatConfidenceTier(
  tier: ConfidenceTier | string | null | undefined,
  numericFallback?: number | null
): string {
  if (numericFallback != null && numericFallback > 0) {
    const derived = numberToTier(numericFallback);
    const label = CONFIDENCE_TIER_LABELS[derived];
    return `${label} (${numericFallback}%)`;
  }
  if (tier && VALID_CONFIDENCE_TIERS.has(tier)) {
    const active = normalizeTier(tier);
    const label = CONFIDENCE_TIER_LABELS[active];
    const pct = CONFIDENCE_TIER_TO_NUMBER[active];
    return `${label} (${pct}%)`;
  }
  return 'N/A';
}

/**
 * True when the confidence represents a recommended-execution trade (>= 60%).
 */
export function isRecommendedTier(tier: ConfidenceTier | string | null | undefined): boolean {
  if (!tier) return false;
  const active = normalizeTier(tier);
  return CONFIDENCE_TIER_TO_NUMBER[active] >= RECOMMENDED_CONFIDENCE_FLOOR;
}

/**
 * True when a numeric confidence value is at or above the recommended floor.
 */
export function isRecommendedConfidence(confidence: number): boolean {
  return confidence >= RECOMMENDED_CONFIDENCE_FLOOR;
}
