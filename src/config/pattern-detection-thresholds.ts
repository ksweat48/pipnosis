/**
 * Pattern Detection Thresholds - Single Source of Truth
 *
 * ═══════════════════════════════════════════════════════════════════
 * TECHNICAL PATTERN RECOGNITION CONSTANTS
 * ═══════════════════════════════════════════════════════════════════
 *
 * All thresholds for detecting pullbacks, swings, reversals, and
 * continuation patterns in price action.
 *
 * PHASE 2 GOVERNANCE FIX (2026-02-02):
 * - Consolidated pattern thresholds from multiple services
 * - Documented pattern quality scoring
 * - Standardized swing detection logic
 *
 * SSOT COMPLIANCE:
 * - pattern-detection-service.ts MUST import from this file
 * - m5-swing-analyzer.ts MUST import from this file
 * - NO hardcoded pattern thresholds in detection logic
 *
 * ═══════════════════════════════════════════════════════════════════
 */

/**
 * PULLBACK DETECTION THRESHOLDS
 *
 * Defines what constitutes a valid pullback vs noise.
 */
export const PULLBACK_THRESHOLDS = {
  /**
   * Minimum pullback depth (as fraction of prior move)
   * - Shallow: 0.236 (23.6% retracement)
   * - Standard: 0.382 (38.2% Fibonacci level)
   * - Deep: 0.618 (61.8% Fibonacci level)
   * - Too deep: > 0.786 (likely reversal, not pullback)
   */
  MIN_SHALLOW_RETRACEMENT: 0.236,
  MIN_STANDARD_RETRACEMENT: 0.382,
  IDEAL_RETRACEMENT: 0.5,           // 50% pullback is ideal
  MAX_DEEP_RETRACEMENT: 0.618,
  REVERSAL_THRESHOLD: 0.786,        // Beyond this = likely reversal

  /**
   * Pullback duration (in candles)
   * - Too quick: < 2 candles (likely noise)
   * - Ideal: 3-5 candles (healthy consolidation)
   * - Too long: > 8 candles (trend may be changing)
   */
  MIN_CANDLES: 2,
  IDEAL_MIN_CANDLES: 3,
  IDEAL_MAX_CANDLES: 5,
  MAX_CANDLES_BEFORE_REVERSAL: 8,

  /**
   * Pullback quality scoring factors
   * - Touches EMA20: +20 points
   * - Within ideal retracement zone: +30 points
   * - Clean structure (no whipsaws): +25 points
   * - Volume decrease on pullback: +25 points
   */
  QUALITY_EMA20_TOUCH: 20,
  QUALITY_IDEAL_ZONE: 30,
  QUALITY_CLEAN_STRUCTURE: 25,
  QUALITY_VOLUME_DECREASE: 25,
} as const;

/**
 * SWING DETECTION THRESHOLDS
 *
 * Identifies significant highs and lows in price action.
 */
export const SWING_THRESHOLDS = {
  /**
   * Minimum swing size (as multiple of ATR)
   * - Micro swing: 0.5 ATR (intraday noise)
   * - Minor swing: 1.0 ATR (valid short-term pivot)
   * - Major swing: 2.0 ATR (significant structure point)
   * - Key swing: 3.0+ ATR (major support/resistance)
   */
  MICRO_SWING_ATR: 0.5,
  MINOR_SWING_ATR: 1.0,
  MAJOR_SWING_ATR: 2.0,
  KEY_SWING_ATR: 3.0,

  /**
   * Swing confirmation period
   * Number of candles that must respect the swing
   */
  MIN_CONFIRMATION_CANDLES: 2,      // Must hold for 2+ candles
  STRONG_CONFIRMATION_CANDLES: 3,   // 3+ candles = strong swing

  /**
   * Higher-high / Lower-low detection
   * Minimum difference to count as new structure
   */
  MIN_STRUCTURE_MOVE_PERCENT: 0.003, // 0.3% minimum move
  MIN_STRUCTURE_MOVE_ATR: 0.5,       // Or 0.5 ATR

  /**
   * Swing invalidation
   * Price move beyond this invalidates the swing
   */
  INVALIDATION_BUFFER_ATR: 0.3,     // 0.3 ATR beyond swing point
} as const;

/**
 * REVERSAL PATTERN THRESHOLDS
 *
 * Detects potential trend reversals.
 */
export const REVERSAL_THRESHOLDS = {
  /**
   * Double top/bottom detection
   * - Price tests previous high/low within tolerance
   * - Minimum time between tests
   * - Maximum time before pattern expires
   */
  DOUBLE_TOP_TOLERANCE_PERCENT: 0.002, // 0.2% tolerance
  DOUBLE_TOP_TOLERANCE_ATR: 0.2,        // Or 0.2 ATR
  MIN_CANDLES_BETWEEN_TESTS: 5,
  MAX_CANDLES_BETWEEN_TESTS: 30,

  /**
   * Head and shoulders detection
   * - Left shoulder height relative to head
   * - Right shoulder symmetry
   */
  H_AND_S_SHOULDER_MIN_RATIO: 0.7,  // Shoulders >= 70% of head height
  H_AND_S_SHOULDER_MAX_RATIO: 0.95, // Shoulders <= 95% of head height
  H_AND_S_SYMMETRY_TOLERANCE: 0.15, // 15% tolerance for symmetry

  /**
   * Divergence detection
   * Price makes new high/low but indicator doesn't
   */
  DIVERGENCE_MIN_SEPARATION_CANDLES: 10, // 10+ candles apart
  DIVERGENCE_INDICATOR_THRESHOLD: 0.1,    // 10% difference in indicator
} as const;

/**
 * CONTINUATION PATTERN THRESHOLDS
 *
 * Detects patterns suggesting trend continuation.
 */
export const CONTINUATION_THRESHOLDS = {
  /**
   * Flag/pennant pattern detection
   * - Consolidation range tightness
   * - Maximum consolidation duration
   */
  FLAG_MAX_RANGE_PERCENT: 0.015,    // 1.5% max range
  FLAG_MAX_RANGE_ATR: 0.7,          // Or 0.7 ATR
  FLAG_MIN_CANDLES: 3,
  FLAG_MAX_CANDLES: 12,

  /**
   * Triangle pattern detection
   * - Converging trendlines
   * - Minimum apex distance
   */
  TRIANGLE_MIN_APEX_CANDLES: 8,     // At least 8 candles to apex
  TRIANGLE_CONVERGENCE_ANGLE: 10,   // Max 10 degree angle difference

  /**
   * Channel/range detection
   * - Parallel levels
   * - Minimum touch count
   */
  CHANNEL_MIN_TOUCHES: 4,           // 4+ touches (2 per side)
  CHANNEL_PARALLEL_TOLERANCE: 0.15, // 15% tolerance for parallel
} as const;

/**
 * VWAP INTERACTION THRESHOLDS
 *
 * Patterns involving VWAP touches and crosses.
 */
export const VWAP_THRESHOLDS = {
  /**
   * VWAP "kiss" detection
   * - Price touches but doesn't break VWAP
   * - Bounce quality assessment
   */
  KISS_TOLERANCE_PERCENT: 0.001,    // 0.1% from VWAP = touch
  KISS_TOLERANCE_PIPS: 3,           // Or 3 pips from VWAP
  MIN_BOUNCE_PIPS: 5,               // Must bounce 5+ pips to count
  MIN_BOUNCE_ATR: 0.3,              // Or 0.3 ATR bounce

  /**
   * VWAP rejection detection
   * - Strong rejection with wick
   */
  REJECTION_WICK_RATIO: 0.5,        // Wick >= 50% of candle range
  REJECTION_VOLUME_MULTIPLIER: 1.3, // 30% higher volume on rejection

  /**
   * VWAP reclaim/loss detection
   * - Clean break and hold
   */
  RECLAIM_CONFIRMATION_CANDLES: 2,  // Must hold 2+ candles above/below
  RECLAIM_VOLUME_MULTIPLIER: 1.2,   // 20% higher volume on break
} as const;

/**
 * STRUCTURE BREAK THRESHOLDS
 *
 * Break of structure (BOS) and change of character (CHoCH) detection.
 */
export const STRUCTURE_BREAK_THRESHOLDS = {
  /**
   * BOS confirmation requirements
   * - Must break previous swing with conviction
   * - Volume confirmation
   * - Clean close beyond level
   */
  BOS_MIN_BREAK_PERCENT: 0.002,     // 0.2% clean break
  BOS_MIN_BREAK_ATR: 0.3,           // Or 0.3 ATR beyond
  BOS_VOLUME_MULTIPLIER: 1.3,       // 30% higher volume
  BOS_CONFIRMATION_CANDLES: 1,      // 1+ candle confirmation

  /**
   * CHoCH (Change of Character) detection
   * - Failed to make new high/low
   * - Break of internal structure
   */
  CHOCH_FAILED_EXTENSION_RATIO: 0.7, // Failed to reach 70% of expected
  CHOCH_INTERNAL_BREAK_ATR: 0.5,     // Broke 0.5 ATR of structure
} as const;

/**
 * PATTERN CONFIDENCE SCORING
 *
 * How confident we are in pattern validity.
 */
export const PATTERN_CONFIDENCE = {
  /**
   * Base confidence by pattern type
   * - Pullback: 70 base (common, reliable)
   * - Swing: 60 base (structural pivot)
   * - Reversal: 50 base (less reliable, need confirmation)
   * - Continuation: 65 base (trend is friend)
   */
  BASE_PULLBACK: 70,
  BASE_SWING: 60,
  BASE_REVERSAL: 50,
  BASE_CONTINUATION: 65,
  BASE_VWAP_INTERACTION: 60,

  /**
   * Confidence modifiers
   * - EMA alignment: +15 points
   * - Volume confirmation: +10 points
   * - Multiple timeframe confirmation: +15 points
   * - Clean structure: +10 points
   * - Contradicting signals: -20 points
   */
  MODIFIER_EMA_ALIGNMENT: 15,
  MODIFIER_VOLUME_CONFIRM: 10,
  MODIFIER_MTF_CONFIRM: 15,
  MODIFIER_CLEAN_STRUCTURE: 10,
  PENALTY_CONTRADICTING: -20,

  /**
   * Minimum confidence thresholds
   * - Trade consideration: 50+ confidence
   * - High conviction: 70+ confidence
   * - Elite setup: 85+ confidence
   */
  MIN_TRADEABLE: 50,
  HIGH_CONVICTION: 70,
  ELITE_SETUP: 85,
} as const;

/**
 * PATTERN EXPIRATION
 *
 * How long patterns remain valid before expiring.
 */
export const PATTERN_EXPIRATION = {
  /**
   * Expiration periods (in candles)
   * - Pullback: 5 candles (quick entry required)
   * - Swing: 10 candles (structural, longer validity)
   * - Reversal: 8 candles (need follow-through)
   * - Continuation: 12 candles (trend gives more time)
   */
  PULLBACK_CANDLES: 5,
  SWING_CANDLES: 10,
  REVERSAL_CANDLES: 8,
  CONTINUATION_CANDLES: 12,
  VWAP_INTERACTION_CANDLES: 3,      // Very time-sensitive

  /**
   * Pattern degradation
   * Confidence decreases as pattern ages
   */
  CONFIDENCE_DECAY_PER_CANDLE: 5,   // -5% per candle after ideal window
} as const;

/**
 * NOISE FILTERING
 *
 * Reject low-quality or choppy price action.
 */
export const NOISE_FILTERING = {
  /**
   * Chop detection
   * - Too many swings in short period = choppy
   * - ATR compression = low volatility noise
   */
  MAX_SWINGS_PER_10_CANDLES: 6,     // > 6 swings in 10 candles = chop
  CHOP_ATR_COMPRESSION: 0.6,        // ATR < 60% average = compressed

  /**
   * Minimum move significance
   * - Ignore moves smaller than this
   */
  MIN_SIGNIFICANT_MOVE_PERCENT: 0.002, // 0.2% minimum
  MIN_SIGNIFICANT_MOVE_ATR: 0.3,       // Or 0.3 ATR

  /**
   * Whipsaw detection
   * - Rapid back-and-forth price action
   */
  WHIPSAW_REVERSAL_CANDLES: 2,      // 2 quick reversals = whipsaw
  WHIPSAW_MIN_REVERSALS: 3,         // 3+ in short period
} as const;

/**
 * Default values for fallback scenarios
 */
export const PATTERN_DEFAULTS = {
  CONFIDENCE: 50,                   // Neutral confidence
  QUALITY_SCORE: 50,                // Average quality
  EXPIRATION_CANDLES: 5,            // Conservative expiration
  MIN_ATR_MULTIPLIER: 1.0,          // Standard ATR requirement
} as const;

/**
 * Type exports for type safety
 */
export type PatternType = 'pullback' | 'swing' | 'reversal' | 'continuation' | 'vwap_interaction';
export type PatternQuality = 'poor' | 'fair' | 'good' | 'excellent';
export type SwingSignificance = 'micro' | 'minor' | 'major' | 'key';
export type StructureBreak = 'none' | 'bos' | 'choch';

/**
 * Helper functions for classification
 */
export function classifyPatternQuality(confidenceScore: number): PatternQuality {
  if (confidenceScore >= PATTERN_CONFIDENCE.ELITE_SETUP) return 'excellent';
  if (confidenceScore >= PATTERN_CONFIDENCE.HIGH_CONVICTION) return 'good';
  if (confidenceScore >= PATTERN_CONFIDENCE.MIN_TRADEABLE) return 'fair';
  return 'poor';
}

export function classifySwingSignificance(atrMultiple: number): SwingSignificance {
  if (atrMultiple >= SWING_THRESHOLDS.KEY_SWING_ATR) return 'key';
  if (atrMultiple >= SWING_THRESHOLDS.MAJOR_SWING_ATR) return 'major';
  if (atrMultiple >= SWING_THRESHOLDS.MINOR_SWING_ATR) return 'minor';
  return 'micro';
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * USAGE GUIDELINES
 * ═══════════════════════════════════════════════════════════════════
 *
 * IMPORTING:
 * ```typescript
 * import { PULLBACK_THRESHOLDS, SWING_THRESHOLDS, PATTERN_CONFIDENCE } from '@/config/pattern-detection-thresholds';
 * ```
 *
 * PULLBACK DETECTION:
 * ```typescript
 * const retracement = pullbackDepth / priorMove;
 * if (retracement >= PULLBACK_THRESHOLDS.MIN_STANDARD_RETRACEMENT &&
 *     retracement <= PULLBACK_THRESHOLDS.MAX_DEEP_RETRACEMENT) {
 *   console.log('Valid pullback detected');
 * }
 * ```
 *
 * SWING DETECTION:
 * ```typescript
 * const swingSize = Math.abs(high - low);
 * const atrMultiple = swingSize / atr;
 * const significance = classifySwingSignificance(atrMultiple);
 * ```
 *
 * PATTERN CONFIDENCE:
 * ```typescript
 * let confidence = PATTERN_CONFIDENCE.BASE_PULLBACK;
 * if (hasEMAAlignment) confidence += PATTERN_CONFIDENCE.MODIFIER_EMA_ALIGNMENT;
 * if (hasVolumeConfirm) confidence += PATTERN_CONFIDENCE.MODIFIER_VOLUME_CONFIRM;
 * const quality = classifyPatternQuality(confidence);
 * ```
 *
 * ═══════════════════════════════════════════════════════════════════
 */
