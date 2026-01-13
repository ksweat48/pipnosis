/**
 * PCPE Configuration - SSOT for Execution Governance Thresholds
 *
 * PCPE v2.0 - Hardened Edition
 *
 * Three-layer governance:
 * 1. Confidence band classification (FULL/REDUCED/MICRO/BLOCKED)
 * 2. Distance-to-ATR reachability gates (auto-downgrade unreachable zones)
 * 3. Chase zone viability (regime-specific professional logic)
 */

export const PCPE_CONFIG = {
  /**
   * Feature flag - Kill switch for PCPE system
   * Set to false to bypass all PCPE governance
   */
  enabled: true,

  /**
   * Confidence Band Thresholds
   *
   * ALPHA SOVEREIGNTY: No more BLOCKED band - Alpha decides execution
   *
   * FULL: ≥78% confidence = 1.0x size, PRIMARY + SECONDARY zones
   * REDUCED: 68-77% = 0.5x size, PRIMARY only
   * MICRO: <68% = 0.25x size, PRIMARY only (was 58-67%, now unlimited floor)
   *
   * All confidence levels execute - just with different sizing
   */
  thresholds: {
    full_band: 78,      // Minimum confidence for FULL band
    reduced_band: 68,   // Minimum confidence for REDUCED band
    micro_band: 0,      // MICRO band has no floor - Alpha authority
  },

  /**
   * Reachability Gates - Distance-to-ATR Downgrade Rules (ADVISORY)
   *
   * ALPHA SOVEREIGNTY: No longer blocks - only downgrades size
   * If Alpha says WAIT for distant zone, we honor it with reduced size
   *
   * FULL band: distance ≤ 1.2 × ATR, else downgrade to REDUCED
   * REDUCED band: distance ≤ 1.5 × ATR, else downgrade to MICRO
   * MICRO band: NO LIMIT - Alpha authority (monitoring may abandon)
   */
  reachability: {
    full_max_distance_atr: 1.2,    // FULL → REDUCED if distance > 1.2x ATR
    reduced_max_distance_atr: 1.5, // REDUCED → MICRO if distance > 1.5x ATR
    micro_max_distance_atr: 999,   // MICRO never downgrades - Alpha decides
  },

  /**
   * Chase Zone Rules - Professional Momentum Logic
   *
   * Chase entries are legitimate in momentum regimes but require:
   * - MICRO band only (0.25x size = reduced risk)
   * - Momentum-specific regime confirmation
   * - Economic validation (spread ≤ 30% of ATR)
   *
   * Blocks chase in mean reversion or neutral regimes.
   */
  chase: {
    /**
     * Regimes where chase entries are permitted
     * Only high-momentum situations justify chasing price
     */
    allowed_regimes: [
      'Trend Acceleration',
      'Liquidity Vacuum',
      'Post-Break Retest',
    ],

    /**
     * Chase only allowed in MICRO band (0.25x size)
     * Never allow chase with FULL or REDUCED bands
     */
    required_band: 'MICRO' as const,

    /**
     * Maximum spread as percentage of ATR
     * Chase must be economically viable (tight spread)
     */
    max_spread_ratio: 0.3,  // Spread must be < 30% of ATR
  },

  /**
   * Band Multipliers - Position Size Scaling
   *
   * ALPHA SOVEREIGNTY: BLOCKED removed - all trades execute
   * Applied on top of base position size calculation
   */
  multipliers: {
    FULL: 1.0,      // 100% size
    REDUCED: 0.5,   // 50% size
    MICRO: 0.25,    // 25% size
  },

  /**
   * Zone Permissions by Band
   *
   * ALPHA SOVEREIGNTY: BLOCKED removed
   * FULL: Can use PRIMARY and SECONDARY zones
   * REDUCED: PRIMARY only
   * MICRO: PRIMARY only (or CHASE if regime permits)
   */
  zone_permissions: {
    FULL: ['PRIMARY', 'SECONDARY'] as const,
    REDUCED: ['PRIMARY'] as const,
    MICRO: ['PRIMARY'] as const,  // Note: CHASE added dynamically if regime permits
  },
} as const;

/**
 * Validate PCPE configuration on startup
 */
export function validatePCPEConfig(): boolean {
  const { thresholds, reachability, chase, multipliers } = PCPE_CONFIG;

  // Validate threshold ordering
  if (thresholds.full_band <= thresholds.reduced_band ||
      thresholds.reduced_band <= thresholds.micro_band) {
    console.error('[PCPE Config] Invalid threshold ordering. Must be: FULL > REDUCED > MICRO');
    return false;
  }

  // Validate reachability thresholds
  if (reachability.full_max_distance_atr <= 0 ||
      reachability.reduced_max_distance_atr <= 0 ||
      reachability.micro_max_distance_atr <= 0) {
    console.error('[PCPE Config] Reachability thresholds must be > 0');
    return false;
  }

  // Validate chase config
  if (chase.max_spread_ratio <= 0 || chase.max_spread_ratio > 1) {
    console.error('[PCPE Config] Chase max_spread_ratio must be between 0 and 1');
    return false;
  }

  if (chase.allowed_regimes.length === 0) {
    console.error('[PCPE Config] Must define at least one allowed chase regime');
    return false;
  }

  // Validate multipliers
  if (multipliers.FULL !== 1.0) {
    console.error('[PCPE Config] FULL multiplier must be 1.0');
    return false;
  }

  // BLOCKED band removed - Alpha sovereignty

  return true;
}
