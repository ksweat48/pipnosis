/**
 * TPS Urgency Curves Configuration
 *
 * SSOT for time-decay urgency calculations across different trade styles.
 * Defines half-life decay, maximum urgency scores, and momentum modifiers.
 */

import type { TradeStyle, UrgencyConfig } from '../types/tps';

/**
 * Style-specific urgency configurations.
 * Each style has different patience tolerances and urgency decay rates.
 *
 * Half-life: Time for urgency to decay to 50% of max
 * Max urgency: Maximum bonus points from time pressure
 * Expiration: When intent is considered stale and should be abandoned
 * Impulse bonus: Additional urgency when market is in impulse move
 * Stalled penalty: Urgency reduction when market is stalled
 */
export const URGENCY_CONFIGS: Record<TradeStyle, UrgencyConfig> = {
  SCALP: {
    halfLifeMinutes: 8,
    maxUrgencyScore: 15,
    expirationMinutes: 25,
    impulseBonus: 3,
    stalledPenalty: -2,
  },

  MICRO: {
    halfLifeMinutes: 25,
    maxUrgencyScore: 10,
    expirationMinutes: 90,
    impulseBonus: 3,
    stalledPenalty: -2,
  },

  INTRADAY: {
    halfLifeMinutes: 60,
    maxUrgencyScore: 7,
    expirationMinutes: 240,
    impulseBonus: 3,
    stalledPenalty: -2,
  },
};

/**
 * TPS scoring weights.
 * These define how much each component contributes to the final score.
 */
export const TPS_WEIGHTS = {
  confidence: 0.62,
  readiness: 0.30,
  urgency: 0.08,
} as const;

/**
 * Patience gate configuration.
 * Prevents premature execution when waiting for better setup is warranted.
 */
export const PATIENCE_GATE = {
  // Minimum margin required for WAIT to beat NOW during impulse
  impulseMarginRequired: 8.0,

  // Minimum margin required for WAIT to beat NOW in normal conditions
  normalMarginRequired: 5.0,

  // Minimum margin required for WAIT to beat NOW when stalled
  stalledMarginRequired: 3.0,
} as const;

/**
 * Entry readiness thresholds.
 * Define how EQS satisfaction translates to readiness scores.
 */
export const READINESS_THRESHOLDS = {
  // Full readiness (30 points): EQS exceeds requirement
  fullReadiness: 1.0,

  // Partial readiness starts at this fraction of requirement
  partialReadinessStart: 0.7,

  // WAIT intent bonus when setup is improving
  improvementProjectionBonus: 5,

  // Max bonus from high projection confidence
  maxProjectionBonus: 10,
} as const;

/**
 * Calculate urgency score with exponential decay.
 *
 * Formula: urgency = maxUrgency * exp(-ln(2) * elapsedMinutes / halfLife) + momentumModifier
 *
 * @param minutesSinceSignal - Time elapsed since signal was generated
 * @param style - Trade style determining decay curve
 * @param momentumState - Current market momentum state
 * @returns Urgency score (0-max urgency + modifiers)
 */
export function calculateUrgency(
  minutesSinceSignal: number,
  style: TradeStyle,
  momentumState: 'IMPULSE' | 'NORMAL' | 'STALLED'
): number {
  const config = URGENCY_CONFIGS[style];

  // Exponential decay using half-life
  const decayConstant = Math.log(2) / config.halfLifeMinutes;
  const baseUrgency = config.maxUrgencyScore * Math.exp(-decayConstant * minutesSinceSignal);

  // Apply momentum modifier
  let momentumModifier = 0;
  if (momentumState === 'IMPULSE') {
    momentumModifier = config.impulseBonus;
  } else if (momentumState === 'STALLED') {
    momentumModifier = config.stalledPenalty;
  }

  // Ensure non-negative
  return Math.max(0, baseUrgency + momentumModifier);
}

/**
 * Check if intent has expired based on style-specific timeout.
 *
 * @param minutesSinceSignal - Time elapsed since signal
 * @param style - Trade style
 * @returns True if intent should be abandoned
 */
export function isIntentExpired(minutesSinceSignal: number, style: TradeStyle): boolean {
  return minutesSinceSignal >= URGENCY_CONFIGS[style].expirationMinutes;
}

/**
 * Get patience gate margin requirement based on momentum.
 *
 * @param momentumState - Current market momentum
 * @returns Required TPS margin for WAIT to override NOW
 */
export function getPatienceGateMargin(momentumState: 'IMPULSE' | 'NORMAL' | 'STALLED'): number {
  switch (momentumState) {
    case 'IMPULSE':
      return PATIENCE_GATE.impulseMarginRequired;
    case 'STALLED':
      return PATIENCE_GATE.stalledMarginRequired;
    default:
      return PATIENCE_GATE.normalMarginRequired;
  }
}
