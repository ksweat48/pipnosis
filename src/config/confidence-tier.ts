/**
 * CCIP-2026-0422F: Simplified Alpha Confidence Tier System
 *
 * GOVERNANCE PRINCIPLE:
 * Alpha outputs a TEXT TIER — never a raw number. This eliminates numeric anchoring.
 *
 * The tier-to-number conversion is INTERNAL ONLY. Alpha never sees the number.
 * The user sees both the text Alpha chose and its numeric equivalent.
 * All downstream systems (TPS, PCPE, learning engine) receive a number as before.
 *
 * DECISION MODEL (CCIP-2026-0422F):
 * Alpha follows a sequential decision process:
 *   1. Can I execute NOW? → output BUY/SELL + execute_now + confidence tier
 *   2. Can I set a wait intent? → output BUY/SELL + wait_pullback/push_confirmation + confidence tier
 *   3. Only if BOTH fail → output NO_TRADE (no confidence tier required)
 *
 * Confidence tiers apply equally to execute_now AND wait intents.
 * The tier describes setup quality — it does NOT determine which action is permitted.
 *
 * TIER DEFINITIONS (structural, not numeric):
 * - "confident"  : Solid, named structure. Direction is clear, path to target is clean,
 *                  stop is structurally anchored. Minor unknowns only.
 * - "high"       : Strong structure across multiple timeframes. Trigger has fired or is
 *                  imminent. Named liquidity fuel behind the thesis. High-quality confirmation stack.
 * - "very_high"  : Exceptional structural clarity. Named evidence stack across structure,
 *                  momentum, session, and liquidity. Rare — reserved for genuinely aligned setups.
 * - "extreme"    : Near-perfect alignment across all observed dimensions. Extremely rare.
 *                  Alpha uses this only when structure, momentum, liquidity, session phase,
 *                  and participant positioning all converge on the same conclusion.
 *
 * NO_TRADE does not use a confidence tier. It stores null in the database so the learning
 * engine can still record that Alpha evaluated the symbol and found no actionable opportunity.
 *
 * LEGACY TIERS (no_read, low, cautious, moderate):
 * Retained in numberToTier() for display of historical database records only.
 * Alpha no longer outputs these tiers. Any Alpha output of these tiers is a schema violation.
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
 * Tiers Alpha is permitted to output for BUY/SELL decisions (execute_now or wait intent).
 * CCIP-2026-0422F: Only confident → extreme are valid actionable tiers.
 */
export const ACTIONABLE_CONFIDENCE_TIERS = new Set<string>([
  'confident',
  'high',
  'very_high',
  'extreme',
]);

/**
 * Fixed midpoint conversion: ConfidenceTier → numeric (0–100).
 * This mapping is INTERNAL ONLY. Alpha never sees these numbers.
 * All downstream logic (TPS, PCPE, learning) consumes the numeric form.
 * Legacy tiers retained for historical record display only.
 */
export const CONFIDENCE_TIER_TO_NUMBER: Record<ConfidenceTier, number> = {
  no_read:   10,
  low:       25,
  cautious:  40,
  moderate:  55,
  confident: 65,
  high:      75,
  very_high: 82,
  extreme:   90,
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
 * All valid tier strings — used for parsing Alpha output and display.
 * Includes legacy tiers for backward compatibility with historical records.
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
