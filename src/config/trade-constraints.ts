import { TradeStyle, RiskMode } from '../types';

/**
 * Centralized Trade Constraints Configuration
 *
 * AUTHORITY LEVELS:
 * - HARD: Can block trades (safety/mathematical impossibility only)
 * - ADVISORY: Provides warnings/guidance, NEVER blocks trades
 *
 * GUIDING PRINCIPLE:
 * Heuristics guide intelligence. Safety and physics enforce reality.
 */

export type ConstraintAuthority = 'HARD' | 'ADVISORY';

export interface ConstraintDefinition {
  authority: ConstraintAuthority;
  description: string;
}

export const TRADE_CONSTRAINTS = {

  // ============================================================================
  // HARD CONSTRAINTS (Safety & Mathematical Impossibility)
  // ============================================================================
  // TIER 4 FIX: Removed drawdown protection - users can reload balance freely

  positioning: {
    authority: 'HARD' as ConstraintAuthority,
    description: 'Mathematical correctness - BUY must have SL < entry < TP, SELL must have TP < entry < SL'
  },

  spreadFeasibility: {
    maxImpactPercent: 50, // If spread > 50% of SL, mathematically infeasible
    authority: 'HARD' as ConstraintAuthority,
    description: 'Mathematical impossibility - spread cannot exceed 50% of stop loss distance'
  },

  // ============================================================================
  // ADVISORY CONSTRAINTS (Guidance & Quality Heuristics)
  // ============================================================================

  riskReward: {
    // DEPRECATED: Use MINIMUM_RR_BY_RISK for risk-profile-specific minimums
    minimum: 1.0,         // Professional floor (advisory) - MEDIUM risk default
    target: 1.5,          // Professional target (advisory)
    optimal: 2.0,         // Elite standard (advisory)
    criticalWarning: 0.3, // Severe advisory below this
    authority: 'ADVISORY' as ConstraintAuthority,
    description: 'Risk:reward quality thresholds - guide Alpha toward high-quality setups'
  },

  takeProfit: {
    maxAtrMultiple: 12,   // Maximum TP distance (advisory ceiling)
    feasibilityFactor: 0.8, // Session time safety factor (0.8 = use 80% of theoretical max)
    minAtrMultiple: 1.0,  // Minimum TP distance for quality (advisory floor)
    authority: 'ADVISORY' as ConstraintAuthority,
    description: 'TP distance guidelines - ensure realistic profit targets'
  },

  stopLoss: {
    // Percentage floors by asset class and risk mode (advisory minimums)
    floors: {
      FOREX: { HIGH: 0.05, MEDIUM: 0.08, LOW: 0.12 },
      CRYPTO: { HIGH: 0.50, MEDIUM: 1.00, LOW: 2.00 },
      METAL: { HIGH: 0.15, MEDIUM: 0.25, LOW: 0.40 },
      INDEX: { HIGH: 0.10, MEDIUM: 0.15, LOW: 0.25 }
    },
    authority: 'ADVISORY' as ConstraintAuthority,
    description: 'SL distance minimums - prevent stops too tight for normal volatility'
  },

  styleValidity: {
    // ATR% gates for style viability (advisory thresholds)
    atrGates: {
      FOREX: { SCALP: 0.05, MICRO_INTRADAY: 0.04, INTRADAY: 0.03, SWING: 0.02 },
      CRYPTO: { SCALP: 0.20, MICRO_INTRADAY: 0.15, INTRADAY: 0.10, SWING: 0.05 },
      METAL: { SCALP: 0.08, MICRO_INTRADAY: 0.06, INTRADAY: 0.05, SWING: 0.03 },
      INDEX: { SCALP: 0.06, MICRO_INTRADAY: 0.05, INTRADAY: 0.04, SWING: 0.02 }
    },
    authority: 'ADVISORY' as ConstraintAuthority,
    description: 'ATR% minimums for each style - advisory only, Alpha may override with justification',
    enforcementNote: 'These are volatility quality gates, not mathematical impossibilities'
  },

  positionSizing: {
    kelly: {
      fractionalMultiplier: 0.25,  // Use 25% of Kelly (conservative)
      minWinRateAdvisory: 0.35,    // Warn if below 35% win rate
      minEdgeAdvisory: 0.01,       // Warn if below 1% edge
      maxRiskCap: 0.05,            // 5% maximum risk per trade
      minLotSize: 0.01,            // Minimum lot size when warnings triggered
      authority: 'ADVISORY' as ConstraintAuthority,
      description: 'Kelly Criterion guidance - suggests sizing based on historical performance'
    },

    expectedValue: {
      minComfortable: 5,    // 5 pips for medium confidence
      minExcellent: 10,     // 10 pips for high confidence
      threshold: 0,         // 0 pips = breakeven (advisory, not blocking)
      authority: 'ADVISORY' as ConstraintAuthority,
      description: 'Expected Value thresholds - guide toward positive expectancy setups'
    },

    correlation: {
      maxCorrelatedRisk: 0.15,  // 15% total risk in correlated pairs
      warningThreshold: 0.10,   // 10% warning
      authority: 'ADVISORY' as ConstraintAuthority,
      description: 'Correlation risk management - prevent overexposure to related instruments'
    }
  },

  sessionConstraints: {
    applyHardConstraintsTo: ['SCALP'] as TradeStyle[],  // Only SCALP has hard session limits
    applyAdvisoryTo: ['INTRADAY'] as TradeStyle[],      // INTRADAY gets advisory warnings
    ignoreFor: ['SWING'] as TradeStyle[],               // SWING ignores session boundaries
    exemptMarketSchedules: ['24/7'] as const,           // 24/7 markets (crypto) ignore ALL session constraints
    feasibilityFactor: 0.8,                             // Use 80% of session time for feasibility
    authority: 'ADVISORY' as ConstraintAuthority,
    description: 'Session time management - SCALP constrained, INTRADAY advisory, SWING unconstrained. 24/7 markets (crypto) ALWAYS exempt.'
  },

  safetyZones: {
    GREEN: {
      minRR: 1.5,
      minTpAtr: 5.0,
      confidence: 'high',
      description: 'Excellent setup quality'
    },
    YELLOW: {
      minRR: 1.0,
      minTpAtr: 3.0,
      confidence: 'medium',
      description: 'Acceptable setup quality'
    },
    ORANGE: {
      minRR: 0.5,
      minTpAtr: 2.0,
      requiresJustification: true,
      confidence: 'low',
      description: 'Marginal setup - requires explicit reasoning'
    },
    RED: {
      minRR: 0.3,
      minTpAtr: 1.0,
      requiresJustification: true,
      confidence: 'very-low',
      description: 'Critical quality warning - strongly requires Alpha justification'
    },
    authority: 'ADVISORY' as ConstraintAuthority,
    description: 'Setup quality classification - provides context, does not block'
  },

  goalFeasibility: {
    minSuccessRate: 0.15,     // 15% success rate for "realistic" (advisory)
    difficultyThresholds: {
      easy: 0.50,             // 50%+ success rate
      moderate: 0.30,         // 30-50% success rate
      challenging: 0.15,      // 15-30% success rate
      unrealistic: 0.15       // < 15% success rate (advisory warning, not block)
    },
    authority: 'ADVISORY' as ConstraintAuthority,
    description: 'Goal difficulty assessment - informs user expectations, never blocks goals'
  }

} as const;

// ============================================================================
// RISK-PROFILE-SPECIFIC CONFIGURATIONS
// ============================================================================

/**
 * Confidence Penalty Caps by Risk Profile
 *
 * These caps prevent "death by 1000 cuts" where stacked penalties
 * completely paralyze Alpha, especially in imperfect conditions.
 *
 * Philosophy:
 * - LOW risk: Users expect restraint, larger cap for safety
 * - MEDIUM risk: Balanced approach
 * - HIGH risk: Users accept uncertainty, tighter cap for freedom
 *
 * The cap represents the MAXIMUM total confidence reduction from all penalties.
 */
export const CONFIDENCE_PENALTY_CAPS = {
  LOW: 0.70,    // 30% max penalty - cautious users expect restraint
  MEDIUM: 0.60, // 40% max penalty - balanced
  HIGH: 0.50    // 50% max penalty - aggressive users accept uncertainty
} as const;

/**
 * Minimum Acceptable R:R by Risk Profile
 *
 * This is the floor before Alpha should trigger repair cascades.
 * NOT a hard block - if repair fails, Alpha may still proceed with justification.
 *
 * Philosophy:
 * - LOW risk: Capital preservation priority
 * - MEDIUM risk: Professional baseline (1:1 breakeven threshold)
 * - HIGH risk: Opportunity prioritized over textbook ratios
 *
 * HIGH risk accepts 0.5:1 because many profitable scalps and intraday
 * trades operate at these ratios with high probability.
 */
export const MINIMUM_RR_BY_RISK: Record<RiskMode, number> = {
  LOW: 1.2,    // Capital preservation - professional floor
  MEDIUM: 1.0, // Professional baseline - standard expectation
  HIGH: 0.5    // Aggressive deployment - opportunity prioritized
} as const;

/**
 * Maximum Session Loss by Risk Profile
 *
 * Controls total money exposure per session, NOT trade frequency or style.
 * This is a HARD constraint for account safety.
 */
export const MAX_SESSION_LOSS_BY_RISK: Record<RiskMode, number> = {
  LOW: 0.04,   // 4% max session loss
  MEDIUM: 0.07, // 7% max session loss
  HIGH: 0.10   // 10% max session loss
} as const;

/**
 * Helper: Get constraint by path
 */
export function getConstraint(path: keyof typeof TRADE_CONSTRAINTS) {
  return TRADE_CONSTRAINTS[path];
}

/**
 * Validate if a constraint can block trades
 */
export function canBlock(constraintPath: keyof typeof TRADE_CONSTRAINTS): boolean {
  const constraint = TRADE_CONSTRAINTS[constraintPath];
  return constraint.authority === 'HARD';
}

/**
 * Get ATR gate for a style (advisory threshold)
 */
export function getAtrGate(
  assetClass: 'FOREX' | 'CRYPTO' | 'METAL' | 'INDEX',
  style: TradeStyle
): number {
  return TRADE_CONSTRAINTS.styleValidity.atrGates[assetClass]?.[style] || 0.05;
}

/**
 * Get SL floor percentage (advisory minimum)
 */
export function getSlFloor(
  assetClass: 'FOREX' | 'CRYPTO' | 'METAL' | 'INDEX',
  riskMode: RiskMode
): number {
  return TRADE_CONSTRAINTS.stopLoss.floors[assetClass]?.[riskMode] || 0.50;
}

/**
 * Determine if session constraints apply to a style
 *
 * IMPORTANT: No longer returns 'ENFORCED'. All constraints are ADVISORY or NONE.
 * Session mismatches apply confidence penalties, never block trades.
 */
export function getSessionConstraintMode(style: TradeStyle): 'ADVISORY' | 'NONE' {
  // DEPRECATED: applyHardConstraintsTo - now treated as ADVISORY with higher penalties
  if (TRADE_CONSTRAINTS.sessionConstraints.applyHardConstraintsTo.includes(style)) {
    return 'ADVISORY'; // Was ENFORCED - now advisory with -15% penalty
  }
  if (TRADE_CONSTRAINTS.sessionConstraints.applyAdvisoryTo.includes(style)) {
    return 'ADVISORY';
  }
  return 'NONE';
}

/**
 * Get safety zone configuration
 */
export function getSafetyZone(zone: 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED') {
  return TRADE_CONSTRAINTS.safetyZones[zone];
}

/**
 * Classify RR ratio into safety zone
 */
export function classifyRRToZone(rrRatio: number, tpAtrMultiple: number): 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' {
  const zones = TRADE_CONSTRAINTS.safetyZones;

  if (rrRatio >= zones.GREEN.minRR && tpAtrMultiple >= zones.GREEN.minTpAtr) {
    return 'GREEN';
  }
  if (rrRatio >= zones.YELLOW.minRR && tpAtrMultiple >= zones.YELLOW.minTpAtr) {
    return 'YELLOW';
  }
  if (rrRatio >= zones.ORANGE.minRR && tpAtrMultiple >= zones.ORANGE.minTpAtr) {
    return 'ORANGE';
  }
  return 'RED';
}

/**
 * Get confidence penalty cap for risk profile
 */
export function getConfidencePenaltyCap(riskMode: RiskMode): number {
  return CONFIDENCE_PENALTY_CAPS[riskMode];
}

/**
 * Get minimum R:R for risk profile
 */
export function getMinimumRR(riskMode: RiskMode): number {
  return MINIMUM_RR_BY_RISK[riskMode];
}

/**
 * Get maximum session loss for risk profile
 */
export function getMaxSessionLoss(riskMode: RiskMode): number {
  return MAX_SESSION_LOSS_BY_RISK[riskMode];
}
