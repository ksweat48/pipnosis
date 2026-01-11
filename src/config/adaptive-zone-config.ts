/**
 * Adaptive Zone Configuration - CCIP v2.0
 *
 * Central configuration for regime-adaptive entry zones with reachability gates.
 * All tuning parameters for zone calculation, reachability validation, and position sizing.
 */

export const ADAPTIVE_ZONE_CONFIG = {
  /**
   * Reachability Gate Parameters
   * Formula: distance ≤ (k1 × ATR_15m + k2 × spread)
   */
  reachability: {
    k1_atr_multiplier: 1.2,        // ATR multiplier for reachability limit
    k2_spread_multiplier: 2.0,     // Spread multiplier for reachability limit
    chase_cap_momentum: 0.60,      // Max ATR distance before downgrade to 40% size
    hard_wait_threshold: 1.0       // Max ATR distance before WAIT (no execution)
  },

  /**
   * Zone Model Parameters by Type
   */
  zoneModels: {
    limit: {
      vwap_ema_priority: 'max' as const,           // Use max(VWAP, EMA_slow) as anchor
      asymmetric_below_multiplier: 0.35,           // Zone width below anchor (BUY)
      asymmetric_above_multiplier: 0.15,           // Zone width above anchor (BUY)
      tightness_multiplier: 0.08,                  // General tightness factor
      use_swing_levels: true                       // Incorporate swing highs/lows
    },
    hybrid: {
      trigger_below_multiplier: 0.20,              // Zone width below entry
      trigger_above_multiplier: 0.10,              // Zone width above entry
      balanced_spread: true,                       // More balanced than limit zones
      fallback_atr_multiplier: 0.25               // Fallback if no VWAP/EMA available
    },
    momentum: {
      pullback_allowance_multiplier: 0.25,         // Allow minor pullback
      tightness_multiplier: 0.05,                  // Very tight zones
      immediate_execution_bias: true,              // Bias toward immediate execution
      max_zone_width_pips: 5                      // Hard cap for momentum zones (JPY: 0.05)
    }
  },

  /**
   * Position Sizing Multipliers by Zone Type
   */
  positionSizing: {
    primary_zone_multiplier: 1.0,                  // Full size in primary zone
    secondary_zone_multiplier: 0.65,               // 65% size in secondary zone
    momentum_chase_multiplier: 0.40,               // 40% size when chasing (0.6-1.0 ATR)
    wait_only_beyond_atr: 1.0                     // WAIT status if beyond this ATR distance
  },

  /**
   * Secondary Zone Offset
   * How far secondary zone is from primary (in ATR units)
   */
  secondaryZone: {
    offset_multiplier: 0.30,                       // Secondary zone is 0.3x ATR away from primary
    width_multiplier: 0.80,                        // Secondary zone is 80% as wide as primary
    enabled: true                                  // Enable/disable secondary zones globally
  },

  /**
   * Feature Flags
   */
  features: {
    adaptive_zones_enabled: true,                  // Master switch for adaptive zones
    reachability_gate_enabled: true,              // Enable reachability validation
    auto_downgrade_enabled: true,                 // Auto-downgrade unreachable zones
    meta_learning_enabled: true,                  // Log analytics for Alpha learning
    fallback_to_hybrid: true                      // Use Hybrid if regime missing
  },

  /**
   * Regime-to-Zone Type Mapping Overrides
   * Default mappings can be overridden here
   */
  regimeOverrides: {
    // Example: force specific regime to always use Hybrid
    // 'trend_exhaustion': 'hybrid'
  }
} as const;

export type ZoneType = 'limit' | 'hybrid' | 'momentum';
export type ExecutedZoneType = 'primary' | 'secondary' | 'none';
