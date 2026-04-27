/**
 * CCIP-2026-0427F-ALWAYS-EXECUTE: Four-tier confidence vocabulary (rebrand).
 *
 * GOVERNANCE PRINCIPLE
 * ────────────────────
 * Alpha outputs a TEXT TIER — never a raw number. The tier-to-number conversion
 * is INTERNAL ONLY for downstream systems (TPS, PCPE, learning engine).
 *
 * Alpha must ALWAYS produce a directional decision (BUY or SELL). NO_TRADE has
 * been eliminated from the vocabulary. Quality below 60% is expressed via the
 * 'low_quality' tier — the user, not Alpha, decides whether to execute.
 *
 * ACTIVE FOUR-TIER MODEL
 * ──────────────────────
 *  low_quality          (<60%, midpoint 50)  Best-effort read with limited evidence.
 *                                            Surfaced to the user for manual judgement.
 *  confident            (60–69%, midpoint 65) Solid structure, direction named, stop
 *                                             anchored, path credible.
 *  very_confident       (70–79%, midpoint 75) Strong structure with named evidence
 *                                             across structure, momentum, and liquidity.
 *  extremely_confident  (80%+,   midpoint 88) Near-perfect alignment across all
 *                                             dimensions. Execute now only.
 *
 * LEGACY TIERS
 * ────────────
 * Historical records may still display legacy tier strings (no_read, low,
 * cautious, moderate, high, very_high, extreme). These are normalised on read
 * via numberToTier() / display via formatConfidenceTier(). Alpha is no longer
 * permitted to emit any legacy tier.
 */

export type ConfidenceTier =
  | 'low_quality'
  | 'confident'
  | 'very_confident'
  | 'extremely_confident'
  // Legacy tiers retained for type compatibility with historical records only
  | 'no_read'
  | 'low'
  | 'cautious'
  | 'moderate'
  | 'high'
  | 'very_high'
  | 'extreme';

/**
 * Tiers Alpha is permitted to output. Always-execute model: Alpha must pick one
 * of these four for every BUY/SELL decision.
 */
export const ACTIONABLE_CONFIDENCE_TIERS = new Set<string>([
  'low_quality',
  'confident',
  'very_confident',
  'extremely_confident',
]);

/**
 * Tiers Alpha is permitted to output in the current schema. Identical to
 * ACTIONABLE_CONFIDENCE_TIERS now that NO_TRADE has been retired.
 */
export const ACTIVE_CONFIDENCE_TIERS = new Set<string>([
  'low_quality',
  'confident',
  'very_confident',
  'extremely_confident',
]);

/**
 * Recommended-execution floor. Trades at or above this midpoint are flagged in
 * the UI as recommended; below it the user is shown a "Low Quality" badge.
 */
export const RECOMMENDED_CONFIDENCE_FLOOR = 60;

/**
 * Fixed midpoint conversion: ConfidenceTier -> numeric (0-100). INTERNAL ONLY.
 * Alpha never sees these numbers.
 */
export const CONFIDENCE_TIER_TO_NUMBER: Record<ConfidenceTier, number> = {
  // Active tiers
  low_quality:         50,
  confident:           65,
  very_confident:      75,
  extremely_confident: 88,
  // Legacy tiers (historical display only)
  no_read:   10,
  low:       25,
  cautious:  40,
  moderate:  55,
  high:      75,
  very_high: 82,
  extreme:   90,
};

export const CONFIDENCE_TIER_LABELS: Record<ConfidenceTier, string> = {
  // Active tiers
  low_quality:         'Low Quality',
  confident:           'Confident',
  very_confident:      'Very Confident',
  extremely_confident: 'Extremely Confident',
  // Legacy tiers
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
 * Convert a numeric confidence back to the nearest active tier label for
 * display. Used when the database row only carries a numeric confidence
 * (legacy records) and the UI needs a tier badge.
 */
export function numberToTier(confidence: number): ConfidenceTier {
  if (confidence >= 80) return 'extremely_confident';
  if (confidence >= 70) return 'very_confident';
  if (confidence >= 60) return 'confident';
  return 'low_quality';
}

/**
 * Normalise any (possibly legacy) tier string to the active four-tier
 * vocabulary. Used at every read boundary so the UI never has to think about
 * legacy values.
 */
export function normalizeTier(tier: string | undefined | null): ConfidenceTier {
  if (!tier) return 'low_quality';
  if (ACTIVE_CONFIDENCE_TIERS.has(tier)) return tier as ConfidenceTier;
  // Map legacy strings via their numeric midpoint
  const numeric = CONFIDENCE_TIER_TO_NUMBER[tier as ConfidenceTier];
  if (typeof numeric === 'number') return numberToTier(numeric);
  return 'low_quality';
}

/**
 * Format a tier for user display: "Confident (65%)".
 */
export function formatConfidenceTier(
  tier: ConfidenceTier | string | null | undefined,
  numericFallback?: number | null
): string {
  if (tier && VALID_CONFIDENCE_TIERS.has(tier)) {
    const active = normalizeTier(tier);
    const label = CONFIDENCE_TIER_LABELS[active];
    const pct = CONFIDENCE_TIER_TO_NUMBER[active];
    return `${label} (${pct}%)`;
  }
  if (numericFallback != null) {
    const derived = numberToTier(numericFallback);
    const label = CONFIDENCE_TIER_LABELS[derived];
    return `${label} (${numericFallback}%)`;
  }
  return 'N/A';
}

/**
 * True when the tier represents a recommended-execution trade (>= 60%).
 */
export function isRecommendedTier(tier: ConfidenceTier | string | null | undefined): boolean {
  if (!tier) return false;
  const active = normalizeTier(tier);
  return CONFIDENCE_TIER_TO_NUMBER[active] >= RECOMMENDED_CONFIDENCE_FLOOR;
}
