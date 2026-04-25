/**
 * CCIP-2026-0425B: Simplified Alpha Confidence Tier System (4-tier rewrite)
 *
 * GOVERNANCE PRINCIPLE:
 * Alpha outputs a TEXT TIER — never a raw number. This eliminates numeric anchoring.
 *
 * The tier-to-number conversion is INTERNAL ONLY. Alpha never sees the number.
 * The user sees both the text Alpha chose and its numeric equivalent.
 * All downstream systems (TPS, PCPE, learning engine) receive a number as before.
 *
 * FOUR-TIER MODEL:
 * ─────────────────────────────────────────────────────────────────────────────
 * no_read           → Answer sheet is genuinely blank. No patterns, no named
 *                     levels, no sweeps, no BOS, no directional lean. NO_TRADE
 *                     is the only valid output. This tier is rare.
 *
 * confident         → Solid structure. Direction named. Stop anchored. Path
 *                     credible. Some unknowns remain. Execute now or wait intent.
 *
 * very_confident    → Strong structure. Named evidence stack across structure,
 *                     momentum, and liquidity. Clear directional case. Execute
 *                     now or wait intent.
 *
 * extremely_confident → Near-perfect alignment across all dimensions. All
 *                       evidence converges on the same conclusion. Rare. Execute
 *                       now only — waiting surrenders the edge.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * DECISION MODEL (CCIP-2026-0425B):
 * Alpha follows a sequential decision process:
 *   1. Can I execute NOW? → BUY/SELL + execute_now + confident/very_confident/extremely_confident
 *   2. Can I set a wait intent? → BUY/SELL + wait_pullback/push_confirmation + confident/very_confident
 *   3. Only if BOTH fail AND answer sheet is genuinely blank → NO_TRADE (no_read)
 *
 * PATTERN-DETECTED LOCK: If ANY pattern field is populated, no_read is forbidden.
 * Alpha MUST output BUY or SELL. The only question remaining is entry timing.
 *
 * LEGACY TIERS (low, cautious, moderate, high, very_high, extreme):
 * Retained in numberToTier() and VALID_CONFIDENCE_TIERS for display of historical
 * database records only. Alpha no longer outputs these tiers. Any Alpha output of
 * these tiers is a schema violation and will be normalised by the coordinator.
 */

export type ConfidenceTier =
  | 'no_read'
  | 'confident'
  | 'very_confident'
  | 'extremely_confident'
  // Legacy tiers — historical records only, not valid Alpha outputs
  | 'low'
  | 'cautious'
  | 'moderate'
  | 'high'
  | 'very_high'
  | 'extreme';

/**
 * Tiers Alpha is permitted to output for BUY/SELL decisions.
 * CCIP-2026-0425B: Only the 3 actionable tiers (confident → extremely_confident).
 */
export const ACTIONABLE_CONFIDENCE_TIERS = new Set<string>([
  'confident',
  'very_confident',
  'extremely_confident',
]);

/**
 * Fixed midpoint conversion: ConfidenceTier → numeric (0–100).
 * INTERNAL ONLY. Alpha never sees these numbers.
 * Legacy tiers retained for historical record display.
 */
export const CONFIDENCE_TIER_TO_NUMBER: Record<ConfidenceTier, number> = {
  // Active tiers (CCIP-2026-0425B)
  no_read:              10,
  confident:            60,
  very_confident:       80,
  extremely_confident:  95,
  // Legacy tiers (historical display only)
  low:       25,
  cautious:  40,
  moderate:  55,
  high:      75,
  very_high: 82,
  extreme:   90,
};

/**
 * Human-readable label shown in the UI alongside the numeric equivalent.
 */
export const CONFIDENCE_TIER_LABELS: Record<ConfidenceTier, string> = {
  // Active tiers
  no_read:              'No Read',
  confident:            'Confident',
  very_confident:       'Very Confident',
  extremely_confident:  'Extremely Confident',
  // Legacy tiers
  low:       'Low',
  cautious:  'Cautious',
  moderate:  'Moderate',
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
 * Active tiers Alpha may output in the current schema.
 * Used for schema violation detection.
 */
export const ACTIVE_CONFIDENCE_TIERS = new Set<string>([
  'no_read',
  'confident',
  'very_confident',
  'extremely_confident',
]);

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
 * nearest tier label for display purposes. Maps to new 4-tier system for recent
 * records, legacy tier names for older records.
 */
export function numberToTier(confidence: number): ConfidenceTier {
  if (confidence >= 90) return 'extremely_confident';
  if (confidence >= 70) return 'very_confident';
  if (confidence >= 55) return 'confident';
  // Legacy fallbacks for old records stored below 55
  if (confidence >= 48) return 'moderate';
  if (confidence >= 33) return 'cautious';
  if (confidence >= 17) return 'low';
  return 'no_read';
}

/**
 * Format a tier for user display: "Confident (60%)"
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
