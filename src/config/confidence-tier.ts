/**
 * CCIP-2026-0413-CONFIDENCE-TEXT: Alpha Confidence Tier System
 *
 * GOVERNANCE PRINCIPLE:
 * Alpha outputs a TEXT TIER — never a raw number. This eliminates numeric anchoring:
 * the model cannot echo a number it read in the prompt because the prompt contains
 * no confidence numbers. Alpha reads the structural evidence and picks the label
 * that matches what he genuinely sees.
 *
 * The tier-to-number conversion is INTERNAL ONLY. Alpha never sees the number.
 * The user sees both the text Alpha chose and its numeric equivalent.
 * All downstream systems (TPS, PCPE, learning engine) receive a number as before.
 *
 * TIER DEFINITIONS (structural, not numeric):
 * - "no_read"    : Nothing credible visible. No structural basis for an opinion.
 * - "low"        : A signal is present but the edge is clearly insufficient — missing confirmation,
 *                  obstructed path, or weak structure.
 * - "cautious"   : Partial structure. The direction is readable but there are significant gaps —
 *                  one or more key confirmations absent, path partially obstructed.
 * - "moderate"   : Structure is present and the direction is supported. Some uncertainty remains —
 *                  trigger not fully confirmed, path mostly clean with one minor obstacle.
 * - "confident"  : Solid, named structure. Direction is clear, path to target is clean, stop is
 *                  structurally anchored. Minor unknowns only.
 * - "high"       : Strong structure across multiple timeframes. Trigger has fired or is imminent.
 *                  Named liquidity fuel behind the thesis. High-quality confirmation stack.
 * - "very_high"  : Exceptional structural clarity. Named evidence stack across structure, momentum,
 *                  session, and liquidity. Rare — reserved for genuinely aligned setups.
 * - "extreme"    : Near-perfect alignment across all observed dimensions. Extremely rare.
 *                  Alpha uses this only when structure, momentum, liquidity, session phase,
 *                  and participant positioning all converge on the same conclusion.
 */

export type ConfidenceTier =
  | 'no_read'
  | 'low'
  | 'cautious'
  | 'moderate'
  | 'confident'
  | 'high'
  | 'very_high'
  | 'extreme';

/**
 * Fixed midpoint conversion: ConfidenceTier → numeric (0–100).
 * This mapping is INTERNAL ONLY. Alpha never sees these numbers.
 * All downstream logic (TPS, PCPE, learning) consumes the numeric form.
 */
export const CONFIDENCE_TIER_TO_NUMBER: Record<ConfidenceTier, number> = {
  no_read:  10,
  low:      25,
  cautious: 40,
  moderate: 55,
  confident: 65,
  high:     75,
  very_high: 82,
  extreme:  90,
};

/**
 * Human-readable label shown in the UI alongside the numeric equivalent.
 * Example: "Confident (65%)"
 */
export const CONFIDENCE_TIER_LABELS: Record<ConfidenceTier, string> = {
  no_read:   'No Read',
  low:       'Low',
  cautious:  'Cautious',
  moderate:  'Moderate',
  confident: 'Confident',
  high:      'High',
  very_high: 'Very High',
  extreme:   'Extreme',
};

/**
 * All valid tier strings — used to validate Alpha's output.
 */
export const VALID_CONFIDENCE_TIERS = new Set<string>(Object.keys(CONFIDENCE_TIER_TO_NUMBER));

/**
 * Convert Alpha's text tier to the numeric confidence used by all downstream systems.
 * Returns 0 if the tier is unrecognized (signals a schema violation).
 */
export function tierToNumber(tier: string | undefined | null): number {
  if (!tier) return 0;
  return CONFIDENCE_TIER_TO_NUMBER[tier as ConfidenceTier] ?? 0;
}

/**
 * Convert a numeric confidence (from the database or legacy records) back to the
 * nearest tier label for display purposes.
 */
export function numberToTier(confidence: number): ConfidenceTier {
  if (confidence >= 88) return 'extreme';
  if (confidence >= 78) return 'very_high';
  if (confidence >= 70) return 'high';
  if (confidence >= 60) return 'confident';
  if (confidence >= 48) return 'moderate';
  if (confidence >= 33) return 'cautious';
  if (confidence >= 17) return 'low';
  return 'no_read';
}

/**
 * Format a tier for user display: "Confident (65%)"
 */
export function formatConfidenceTier(tier: ConfidenceTier | string | null | undefined, numericFallback?: number | null): string {
  if (tier && VALID_CONFIDENCE_TIERS.has(tier)) {
    const label = CONFIDENCE_TIER_LABELS[tier as ConfidenceTier];
    const pct = CONFIDENCE_TIER_TO_NUMBER[tier as ConfidenceTier];
    return `${label} (${pct}%)`;
  }
  if (numericFallback != null) {
    const derivedTier = numberToTier(numericFallback);
    const label = CONFIDENCE_TIER_LABELS[derivedTier];
    return `${label} (${numericFallback}%)`;
  }
  return 'N/A';
}
