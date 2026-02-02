/**
 * Regime Scoring Constants - Single Source of Truth
 *
 * ═══════════════════════════════════════════════════════════════════
 * REGIME ORACLE SCORING THRESHOLDS
 * ═══════════════════════════════════════════════════════════════════
 *
 * All regime classification, volatility scoring, and penalty thresholds
 * consolidated from regime-oracle.ts into a single authoritative source.
 *
 * PHASE 2 GOVERNANCE FIX (2026-02-02):
 * - Extracted 15+ magic numbers from regime-oracle.ts
 * - Documented rationale for each threshold
 * - Enables easy adjustment without code changes
 *
 * SSOT COMPLIANCE:
 * - regime-oracle.ts MUST import from this file
 * - NO hardcoded thresholds in regime detection logic
 * - All changes documented with version control
 *
 * ═══════════════════════════════════════════════════════════════════
 */

/**
 * VOLATILITY REGIME THRESHOLDS
 *
 * These determine how we classify market volatility based on ATR analysis.
 */
export const VOLATILITY_REGIME = {
  /**
   * ATR compression/expansion thresholds
   * Compression = current ATR < avg * 0.75 (25% below average)
   * Expansion = current ATR > avg * 1.25 (25% above average)
   */
  ATR_COMPRESSION_THRESHOLD: 0.75,  // Below 75% of 20-period average
  ATR_EXPANSION_THRESHOLD: 1.25,    // Above 125% of 20-period average

  /**
   * Volatility score calculation
   * Score = min(100, round((currentATR / atr20Avg) * 50))
   * - Normal volatility (ATR = avg) → score of 50
   * - High volatility (ATR = 2x avg) → score of 100
   */
  VOLATILITY_SCORE_MULTIPLIER: 50,
  VOLATILITY_SCORE_MAX: 100,

  /**
   * Volatility score classification bands
   * - Very Low: < 15 (dead/compressed market)
   * - Low: 15-40 (quiet conditions)
   * - Normal: 40-65 (typical trading)
   * - High: 65-85 (elevated volatility)
   * - Extreme: > 85 (dangerous conditions)
   */
  SCORE_VERY_LOW: 15,
  SCORE_LOW: 40,
  SCORE_NORMAL: 65,
  SCORE_HIGH: 85,
  SCORE_EXTREME: 90,

  /**
   * Session-specific volatility thresholds
   * - NY Open high volatility: > 75 (first hour spike)
   * - Compression + range: < 25 (avoid breakout traps)
   */
  NY_OPEN_HIGH_THRESHOLD: 75,
  COMPRESSION_RANGE_THRESHOLD: 25,
} as const;

/**
 * TREND STRENGTH REGIME THRESHOLDS
 *
 * Determines trend strength based on EMA separation.
 */
export const TREND_REGIME = {
  /**
   * Trend strength calculation
   * Strength = min(100, round((emaDiff / atr) * 20))
   * - Weak: < 20 (EMAs close together)
   * - Moderate: 20-50 (clear separation)
   * - Strong: 50-75 (wide separation)
   * - Very Strong: > 75 (extreme divergence)
   */
  TREND_STRENGTH_MULTIPLIER: 20,
  TREND_STRENGTH_MAX: 100,

  /**
   * Trend strength classification bands
   */
  STRENGTH_WEAK: 20,
  STRENGTH_MODERATE: 50,
  STRENGTH_STRONG: 75,
} as const;

/**
 * REGIME CLASSIFICATION THRESHOLDS
 *
 * Maps total penalty percentage to regime severity.
 * Used to classify overall market conditions.
 */
export const REGIME_CLASSIFICATION = {
  /**
   * Penalty bands (additive percentage points)
   * - NORMAL: 0-4% penalty (safe conditions)
   * - ELEVATED: 5-9% penalty (caution warranted)
   * - HIGH_RISK: 10-14% penalty (significant risk)
   * - CHAOTIC: 15% penalty (maximum advisory concern)
   */
  NORMAL_MAX: 5,        // Below 5% = NORMAL
  ELEVATED_MAX: 10,     // 5-9% = ELEVATED
  HIGH_RISK_MAX: 15,    // 10-14% = HIGH_RISK
  // 15% = CHAOTIC (hard cap, see REGIME_MAX_PENALTY_PERCENT)
} as const;

/**
 * PENALTY COMPONENTS
 *
 * Individual penalty contributions from different risk factors.
 * All penalties are additive percentage points (not multipliers).
 */
export const REGIME_PENALTIES = {
  /**
   * Dead zone penalties (session-based, 0-5% max)
   * Applied during low-liquidity periods
   */
  DEAD_ZONE: {
    LIGHT: 2,    // -2% confidence (minor dead zone)
    MODERATE: 3, // -3% confidence (typical dead zone)
    HEAVY: 5,    // -5% confidence (severe dead zone)
  },

  /**
   * Volatility-based penalties (0-8% max)
   * - Very low volatility: -5% (compression trap risk)
   * - Extreme volatility: -8% (unpredictable conditions)
   */
  VOLATILITY: {
    VERY_LOW: 5,   // < 15 score
    EXTREME: 8,    // > 90 score
  },

  /**
   * Structure penalties (0-5% max)
   * - Chaotic structure: -5% (no clear pattern)
   * - Range + compression: -3% (breakout trap risk)
   */
  STRUCTURE: {
    CHAOTIC: 5,
    RANGE_COMPRESSION: 3,
  },

  /**
   * Session-specific penalties (0-7% max)
   * - NY Open high volatility: -5% (first-hour chaos)
   * - High volatility + extreme: -7% (dangerous combination)
   */
  SESSION: {
    NY_OPEN_HIGH: 5,
    HIGH_VOLATILITY_EXTREME: 7,
  },
} as const;

/**
 * WICK RISK CLASSIFICATION
 *
 * Determines stop-hunting risk based on wick size analysis.
 */
export const WICK_RISK = {
  /**
   * Wick size thresholds (as percentage of candle body)
   * - Low risk: wicks < 1.5x body
   * - Medium risk: wicks 1.5-2.5x body
   * - High risk: wicks > 2.5x body
   */
  MEDIUM_THRESHOLD: 1.5,
  HIGH_THRESHOLD: 2.5,

  /**
   * Wick count thresholds for recent candles
   * Number of high-wick candles in last N periods
   */
  HIGH_WICK_COUNT_THRESHOLD: 3, // 3+ high-wick candles = elevated risk
  LOOKBACK_PERIOD: 10,           // Analyze last 10 candles
} as const;

/**
 * SPREAD RISK ESTIMATION
 *
 * Estimates spread widening based on volatility score.
 */
export const SPREAD_RISK = {
  /**
   * Volatility score to spread risk mapping
   * - Low volatility (< 30): minimal spread risk
   * - High volatility (> 75): significant spread widening
   */
  LOW_VOLATILITY_THRESHOLD: 30,
  HIGH_VOLATILITY_THRESHOLD: 75,

  RISK_LEVELS: {
    MINIMAL: 'minimal' as const,
    MODERATE: 'moderate' as const,
    HIGH: 'high' as const,
    SEVERE: 'severe' as const,
  },
} as const;

/**
 * ATR PERIOD CONSTANTS
 *
 * Standard periods used for ATR calculations.
 */
export const ATR_PERIODS = {
  /**
   * 20-period ATR average
   * Used as baseline for volatility comparison
   */
  BASELINE: 20,

  /**
   * Minimum candles required for reliable regime detection
   */
  MIN_CANDLES_REQUIRED: 20,
} as const;

/**
 * STRUCTURE QUALITY THRESHOLDS
 *
 * Assesses market structure clarity and reliability.
 */
export const STRUCTURE_QUALITY = {
  /**
   * Higher-high / lower-low detection sensitivity
   * - Strict: requires 0.3% price difference
   * - Lenient: requires 0.1% price difference
   */
  MIN_STRUCTURE_MOVE_PERCENT: 0.003, // 0.3% minimum move to count as structure

  /**
   * Swing count thresholds for structure classification
   * - Clean structure: 3-6 swings
   * - Choppy structure: < 3 or > 8 swings
   */
  MIN_CLEAN_SWINGS: 3,
  MAX_CLEAN_SWINGS: 6,
  MAX_SWINGS_BEFORE_CHOPPY: 8,
} as const;

/**
 * Default values for fallback scenarios
 */
export const REGIME_DEFAULTS = {
  VOLATILITY_SCORE: 50,        // Neutral volatility
  TREND_STRENGTH_SCORE: 0,     // No trend
  CONFIDENCE_PENALTY: 0,       // No penalty
  RISK_REDUCTION_FACTOR: 1.0,  // No reduction (DEPRECATED)
} as const;

/**
 * Type exports for type safety
 */
export type VolatilityScoreBand = 'very_low' | 'low' | 'normal' | 'high' | 'extreme';
export type TrendStrengthBand = 'weak' | 'moderate' | 'strong' | 'very_strong';
export type RegimeClassification = 'NORMAL' | 'ELEVATED' | 'HIGH_RISK' | 'CHAOTIC';
export type WickRiskLevel = 'low' | 'medium' | 'high';
export type SpreadRiskLevel = 'minimal' | 'moderate' | 'high' | 'severe';

/**
 * Helper functions for classification
 */
export function classifyVolatilityScore(score: number): VolatilityScoreBand {
  if (score < VOLATILITY_REGIME.SCORE_VERY_LOW) return 'very_low';
  if (score < VOLATILITY_REGIME.SCORE_LOW) return 'low';
  if (score < VOLATILITY_REGIME.SCORE_NORMAL) return 'normal';
  if (score < VOLATILITY_REGIME.SCORE_EXTREME) return 'high';
  return 'extreme';
}

export function classifyTrendStrength(strength: number): TrendStrengthBand {
  if (strength < TREND_REGIME.STRENGTH_WEAK) return 'weak';
  if (strength < TREND_REGIME.STRENGTH_MODERATE) return 'moderate';
  if (strength < TREND_REGIME.STRENGTH_STRONG) return 'strong';
  return 'very_strong';
}

export function classifyRegimeByPenalty(penalty: number): RegimeClassification {
  if (penalty < REGIME_CLASSIFICATION.NORMAL_MAX) return 'NORMAL';
  if (penalty < REGIME_CLASSIFICATION.ELEVATED_MAX) return 'ELEVATED';
  if (penalty < REGIME_CLASSIFICATION.HIGH_RISK_MAX) return 'HIGH_RISK';
  return 'CHAOTIC';
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * USAGE GUIDELINES
 * ═══════════════════════════════════════════════════════════════════
 *
 * IMPORTING:
 * ```typescript
 * import { VOLATILITY_REGIME, TREND_REGIME, REGIME_PENALTIES } from '@/config/regime-scoring-constants';
 * ```
 *
 * VOLATILITY DETECTION:
 * ```typescript
 * const isCompressed = currentATR < atr20Avg * VOLATILITY_REGIME.ATR_COMPRESSION_THRESHOLD;
 * const score = Math.min(VOLATILITY_REGIME.VOLATILITY_SCORE_MAX,
 *   Math.round((currentATR / atr20Avg) * VOLATILITY_REGIME.VOLATILITY_SCORE_MULTIPLIER));
 * ```
 *
 * PENALTY APPLICATION:
 * ```typescript
 * if (volatilityScore < VOLATILITY_REGIME.SCORE_VERY_LOW) {
 *   penalties.push({ penalty: REGIME_PENALTIES.VOLATILITY.VERY_LOW, reason: 'Very low volatility' });
 * }
 * ```
 *
 * CLASSIFICATION:
 * ```typescript
 * const regimeClass = classifyRegimeByPenalty(totalPenalty);
 * const volatilityBand = classifyVolatilityScore(volatilityScore);
 * ```
 *
 * ═══════════════════════════════════════════════════════════════════
 */
