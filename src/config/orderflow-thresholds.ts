/**
 * Orderflow Analysis Thresholds - Single Source of Truth
 *
 * ═══════════════════════════════════════════════════════════════════
 * ORDERFLOW & VOLUME ANALYSIS CONSTANTS
 * ═══════════════════════════════════════════════════════════════════
 *
 * All thresholds for volume analysis, orderflow detection, and
 * institutional activity identification.
 *
 * PHASE 2 GOVERNANCE FIX (2026-02-02):
 * - Consolidated orderflow thresholds from multiple services
 * - Documented institutional footprint detection logic
 * - Standardized volume spike detection
 *
 * SSOT COMPLIANCE:
 * - omega8-hybrid-orderflow.ts MUST import from this file
 * - liquidity-intent-analyzer.ts MUST import from this file
 * - NO hardcoded orderflow thresholds in analysis logic
 *
 * ═══════════════════════════════════════════════════════════════════
 */

/**
 * VOLUME ANALYSIS THRESHOLDS
 *
 * Determines what constitutes abnormal volume activity.
 */
export const VOLUME_THRESHOLDS = {
  /**
   * Volume spike detection
   * - Moderate spike: 1.5x average volume
   * - Significant spike: 2.0x average volume
   * - Extreme spike: 3.0x average volume
   */
  MODERATE_SPIKE_MULTIPLIER: 1.5,
  SIGNIFICANT_SPIKE_MULTIPLIER: 2.0,
  EXTREME_SPIKE_MULTIPLIER: 3.0,

  /**
   * Low volume threshold
   * Below 50% of average = low liquidity warning
   */
  LOW_VOLUME_THRESHOLD: 0.5,

  /**
   * Volume moving average period
   * Use 20-period average as baseline
   */
  VOLUME_MA_PERIOD: 20,

  /**
   * Minimum candles required for reliable volume analysis
   */
  MIN_CANDLES_FOR_ANALYSIS: 20,
} as const;

/**
 * ORDERFLOW IMBALANCE THRESHOLDS
 *
 * Detects buying vs selling pressure imbalances.
 */
export const ORDERFLOW_IMBALANCE = {
  /**
   * Buy/Sell ratio thresholds
   * - Balanced: 0.8 - 1.2 ratio
   * - Moderate imbalance: 1.5+ or 0.67- ratio
   * - Strong imbalance: 2.0+ or 0.5- ratio
   */
  BALANCED_MIN: 0.8,
  BALANCED_MAX: 1.2,
  MODERATE_IMBALANCE: 1.5,
  STRONG_IMBALANCE: 2.0,

  /**
   * Delta volume threshold
   * Net buying - selling pressure significance
   */
  SIGNIFICANT_DELTA_THRESHOLD: 0.3, // 30% net imbalance
  EXTREME_DELTA_THRESHOLD: 0.5,     // 50% net imbalance
} as const;

/**
 * INSTITUTIONAL FOOTPRINT DETECTION
 *
 * Identifies large player activity patterns.
 */
export const INSTITUTIONAL_FOOTPRINT = {
  /**
   * Large order detection
   * Order size relative to average volume
   * - Notable: 5x average order size
   * - Institutional: 10x average order size
   * - Whale: 20x average order size
   */
  NOTABLE_ORDER_MULTIPLIER: 5,
  INSTITUTIONAL_ORDER_MULTIPLIER: 10,
  WHALE_ORDER_MULTIPLIER: 20,

  /**
   * Absorption patterns
   * Volume absorbed at key levels without price movement
   */
  ABSORPTION_VOLUME_THRESHOLD: 2.0,  // 2x normal volume
  MAX_PRICE_MOVE_DURING_ABSORPTION: 0.001, // 0.1% max move

  /**
   * Iceberg order detection
   * Repeated fills at same price level
   */
  MIN_ICEBERG_REFILLS: 3,           // 3+ refills at same level
  ICEBERG_SIZE_CONSISTENCY: 0.9,    // 90% size consistency
} as const;

/**
 * LIQUIDITY ZONES
 *
 * Identifies support/resistance based on volume clustering.
 */
export const LIQUIDITY_ZONES = {
  /**
   * Volume clustering threshold
   * Minimum volume concentration to mark as liquidity zone
   */
  MIN_VOLUME_CLUSTER_MULTIPLIER: 1.8, // 1.8x average volume

  /**
   * Zone width tolerance
   * How tight the price range must be for valid zone
   */
  ZONE_WIDTH_MAX_PIPS: 5,           // Max 5 pips wide for cluster
  ZONE_WIDTH_MAX_PERCENT: 0.002,    // Or 0.2% for percentage-based

  /**
   * Zone strength classification
   * Based on volume concentration and test count
   */
  WEAK_ZONE_TESTS: 2,
  MODERATE_ZONE_TESTS: 4,
  STRONG_ZONE_TESTS: 6,
} as const;

/**
 * SMART MONEY INDICATORS
 *
 * Patterns suggesting institutional accumulation/distribution.
 */
export const SMART_MONEY = {
  /**
   * Accumulation detection
   * - Rising volume on pullbacks
   * - Decreasing volume on rallies
   */
  ACCUMULATION_VOLUME_INCREASE: 1.3, // 30% more volume on dips
  ACCUMULATION_RALLY_DECREASE: 0.8,  // 20% less volume on rallies

  /**
   * Distribution detection
   * - Rising volume on rallies
   * - Decreasing volume on pullbacks
   */
  DISTRIBUTION_VOLUME_INCREASE: 1.3, // 30% more volume on rallies
  DISTRIBUTION_DIP_DECREASE: 0.8,    // 20% less volume on dips

  /**
   * Stop hunting detection
   * Volume spike + wick reversal
   */
  STOP_HUNT_VOLUME_SPIKE: 2.5,       // 2.5x volume
  STOP_HUNT_WICK_RATIO: 0.6,         // Wick is 60%+ of candle range
} as const;

/**
 * BID/ASK SPREAD ANALYSIS
 *
 * Spread widening as liquidity indicator.
 */
export const SPREAD_ANALYSIS = {
  /**
   * Normal spread multipliers by market condition
   * - Tight: < 1.2x average spread
   * - Normal: 1.2-1.8x average spread
   * - Wide: 1.8-2.5x average spread
   * - Very wide: > 2.5x average spread
   */
  TIGHT_SPREAD_MAX: 1.2,
  NORMAL_SPREAD_MAX: 1.8,
  WIDE_SPREAD_MAX: 2.5,

  /**
   * Spread widening alert threshold
   * Sudden widening indicates liquidity drain
   */
  WIDENING_ALERT_MULTIPLIER: 2.0, // 2x normal = alert
  CRITICAL_WIDENING_MULTIPLIER: 3.0, // 3x normal = critical
} as const;

/**
 * EXECUTION QUALITY METRICS
 *
 * Slippage and fill quality thresholds.
 */
export const EXECUTION_QUALITY = {
  /**
   * Expected slippage thresholds (in pips)
   * - Good conditions: < 0.5 pips
   * - Acceptable: 0.5-1.5 pips
   * - Poor: 1.5-3.0 pips
   * - Unacceptable: > 3.0 pips
   */
  GOOD_SLIPPAGE_PIPS: 0.5,
  ACCEPTABLE_SLIPPAGE_PIPS: 1.5,
  POOR_SLIPPAGE_PIPS: 3.0,

  /**
   * Partial fill detection
   * Order filled in multiple chunks
   */
  PARTIAL_FILL_THRESHOLD: 0.95, // < 95% filled in one go = partial

  /**
   * Requote frequency
   * Too many requotes = poor liquidity
   */
  MAX_ACCEPTABLE_REQUOTES: 2, // 2+ requotes = abandon
} as const;

/**
 * VOLUME PROFILE ANALYSIS
 *
 * Price-volume distribution analysis.
 */
export const VOLUME_PROFILE = {
  /**
   * Value area calculation
   * - Value area: contains 70% of volume
   * - High volume node: > 2x average volume per price level
   * - Low volume node: < 0.5x average volume per price level
   */
  VALUE_AREA_PERCENT: 0.70,
  HIGH_VOLUME_NODE_MULTIPLIER: 2.0,
  LOW_VOLUME_NODE_MULTIPLIER: 0.5,

  /**
   * POC (Point of Control) strength
   * Price level with highest volume concentration
   */
  POC_MIN_VOLUME_MULTIPLIER: 1.5, // Must be 1.5x average to qualify

  /**
   * Volume gaps
   * Areas with very low volume = potential fast moves
   */
  VOLUME_GAP_THRESHOLD: 0.3, // < 30% of average volume
} as const;

/**
 * TIME & SALES ANALYSIS
 *
 * Tick-by-tick trade analysis.
 */
export const TIME_AND_SALES = {
  /**
   * Aggressive vs passive order ratio
   * - Aggressive: market orders (takers)
   * - Passive: limit orders (makers)
   */
  AGGRESSIVE_RATIO_THRESHOLD: 0.6, // > 60% aggressive = bullish/bearish pressure

  /**
   * Trade clustering
   * Multiple trades in rapid succession
   */
  CLUSTER_TIME_WINDOW_MS: 1000,    // 1 second window
  MIN_CLUSTER_TRADES: 5,           // 5+ trades = cluster

  /**
   * Large trade detection
   * Trade size relative to average
   */
  LARGE_TRADE_MULTIPLIER: 3.0, // 3x average trade size
} as const;

/**
 * Default values for fallback scenarios
 */
export const ORDERFLOW_DEFAULTS = {
  AVERAGE_VOLUME: 1000,           // Fallback volume
  AVERAGE_SPREAD_PIPS: 1.0,       // Fallback spread
  BUY_SELL_RATIO: 1.0,            // Balanced by default
  DELTA_VOLUME: 0.0,              // Neutral delta
} as const;

/**
 * Type exports for type safety
 */
export type VolumeLevel = 'low' | 'normal' | 'elevated' | 'spike' | 'extreme';
export type OrderflowImbalance = 'strong_buying' | 'buying' | 'balanced' | 'selling' | 'strong_selling';
export type InstitutionalActivity = 'none' | 'notable' | 'institutional' | 'whale';
export type SpreadCondition = 'tight' | 'normal' | 'wide' | 'very_wide';
export type ExecutionQuality = 'excellent' | 'good' | 'acceptable' | 'poor' | 'unacceptable';

/**
 * Helper functions for classification
 */
export function classifyVolumeLevel(volumeRatio: number): VolumeLevel {
  if (volumeRatio < VOLUME_THRESHOLDS.LOW_VOLUME_THRESHOLD) return 'low';
  if (volumeRatio < VOLUME_THRESHOLDS.MODERATE_SPIKE_MULTIPLIER) return 'normal';
  if (volumeRatio < VOLUME_THRESHOLDS.SIGNIFICANT_SPIKE_MULTIPLIER) return 'elevated';
  if (volumeRatio < VOLUME_THRESHOLDS.EXTREME_SPIKE_MULTIPLIER) return 'spike';
  return 'extreme';
}

export function classifyOrderflowImbalance(buySellRatio: number): OrderflowImbalance {
  if (buySellRatio >= ORDERFLOW_IMBALANCE.STRONG_IMBALANCE) return 'strong_buying';
  if (buySellRatio >= ORDERFLOW_IMBALANCE.MODERATE_IMBALANCE) return 'buying';
  if (buySellRatio >= ORDERFLOW_IMBALANCE.BALANCED_MIN && buySellRatio <= ORDERFLOW_IMBALANCE.BALANCED_MAX) return 'balanced';
  if (buySellRatio <= 1 / ORDERFLOW_IMBALANCE.MODERATE_IMBALANCE) return 'selling';
  return 'strong_selling';
}

export function classifyInstitutionalActivity(orderSizeRatio: number): InstitutionalActivity {
  if (orderSizeRatio >= INSTITUTIONAL_FOOTPRINT.WHALE_ORDER_MULTIPLIER) return 'whale';
  if (orderSizeRatio >= INSTITUTIONAL_FOOTPRINT.INSTITUTIONAL_ORDER_MULTIPLIER) return 'institutional';
  if (orderSizeRatio >= INSTITUTIONAL_FOOTPRINT.NOTABLE_ORDER_MULTIPLIER) return 'notable';
  return 'none';
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * USAGE GUIDELINES
 * ═══════════════════════════════════════════════════════════════════
 *
 * IMPORTING:
 * ```typescript
 * import { VOLUME_THRESHOLDS, ORDERFLOW_IMBALANCE, INSTITUTIONAL_FOOTPRINT } from '@/config/orderflow-thresholds';
 * ```
 *
 * VOLUME SPIKE DETECTION:
 * ```typescript
 * const volumeRatio = currentVolume / averageVolume;
 * if (volumeRatio > VOLUME_THRESHOLDS.SIGNIFICANT_SPIKE_MULTIPLIER) {
 *   console.log('Significant volume spike detected');
 * }
 * ```
 *
 * ORDERFLOW IMBALANCE:
 * ```typescript
 * const buySellRatio = buyVolume / sellVolume;
 * const imbalance = classifyOrderflowImbalance(buySellRatio);
 * ```
 *
 * INSTITUTIONAL DETECTION:
 * ```typescript
 * const orderSizeRatio = orderSize / averageOrderSize;
 * const activity = classifyInstitutionalActivity(orderSizeRatio);
 * ```
 *
 * ═══════════════════════════════════════════════════════════════════
 */
