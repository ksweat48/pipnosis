/**
 * UNIFIED TRADING POLICY - Single Source of Truth for All Constraints
 *
 * This is the ONLY file that defines trading thresholds.
 * All constraint checks must reference this policy.
 *
 * THREE-TIER SYSTEM:
 * 1. RISK_HARD_BLOCKS: Catastrophic risk only - CAN stop trades
 * 2. SOFT_WARNINGS: Advisory guidance - CANNOT stop trades
 * 3. POLICY_GUIDELINES: Alpha's decision framework - CANNOT stop trades
 *
 * PHILOSOPHY:
 * If the market can offer some profit, Alpha should be able to take it.
 * Hard blocks exist only to prevent catastrophic outcomes.
 */

import { TradeStyle, RiskMode } from '../types';

// ============================================================================
// TIER 1: RISK HARD BLOCKS (Catastrophic Risk Prevention)
// ============================================================================

/**
 * These are the ONLY conditions that may block trade execution.
 * Everything else is advisory with penalties.
 */
export const RISK_HARD_BLOCKS = {
  /**
   * Account Protection
   * Prevents total account destruction
   */
  maxDailyLoss: {
    LOW: 0.04,        // 4% max daily loss
    MEDIUM: 0.07,     // 7% max daily loss
    HIGH: 0.10        // 10% max daily loss
  },

  /**
   * Position Size Validation
   * Prevents broker rejection and invalid orders
   */
  positionSize: {
    minLots: 0.01,
    maxLotsPerSymbol: 2.0,
    maxTotalExposure: 5.0
  },

  /**
   * Margin Requirements
   * Prevents margin calls and forced liquidation
   */
  margin: {
    minFreeMargin: 1000,  // USD
    minMarginPercent: 0.20 // 20% of account
  },

  /**
   * Trade Frequency Limits
   * Prevents runaway execution loops
   */
  frequency: {
    minSecondsBetweenTrades: 30
  },

  /**
   * Data Integrity
   * Prevents trading on invalid or stale data
   */
  dataIntegrity: {
    maxPriceAgeSeconds: 300,  // 5 minutes max staleness
    requiredFields: ['symbol', 'entry', 'stopLoss', 'takeProfit', 'atr']
  },

  /**
   * Mathematical Correctness
   * Prevents physically impossible trades
   */
  positioning: {
    // BUY: SL < entry < TP
    // SELL: TP < entry < SL
    enforceCorrectSides: true
  },

  spreadFeasibility: {
    // If spread > 50% of SL distance, mathematically infeasible
    maxSpreadToSlPercent: 0.50
  },

  /**
   * Market Availability
   * Cannot trade closed markets
   */
  marketHours: {
    enforceMarketOpen: true,
    exemptMarkets: ['24/7'] // Crypto markets
  }
} as const;

// ============================================================================
// TIER 2: SOFT WARNINGS (Advisory Only - Never Block)
// ============================================================================

/**
 * These provide guidance to Alpha but NEVER block execution.
 * Alpha can override with justification.
 */
export const SOFT_WARNINGS = {
  /**
   * Entry Distance Thresholds
   * Guide pullback vs continuation strategy selection
   */
  entryDistance: {
    softWarning: 2.5,      // ATR multiple - warn but allow
    advisory: 4.0,         // ATR multiple - strong advisory
    hardBackstop: 7.0,     // ATR multiple - likely invalid setup
    description: 'Distance from ideal entry zone in ATR multiples'
  },

  /**
   * Spread Warnings
   * Alert on high transaction costs
   */
  spread: {
    warning: 2.0,          // pips - advisory
    extreme: 5.0,          // pips - strong advisory
    description: 'Spread width in pips'
  },

  /**
   * Risk:Reward Thresholds
   * Guide trade quality assessment
   */
  riskReward: {
    professional: {
      LOW: 1.2,            // Capital preservation
      MEDIUM: 1.0,         // Breakeven threshold
      HIGH: 0.5            // Aggressive deployment
    },
    target: 1.5,           // Professional target
    optimal: 2.0,          // Elite standard
    description: 'Minimum R:R by risk profile'
  },

  /**
   * Stop Loss Distance
   * Prevent stops too tight for volatility
   */
  stopLoss: {
    floors: {
      FOREX: { HIGH: 0.05, MEDIUM: 0.08, LOW: 0.12 },
      CRYPTO: { HIGH: 0.50, MEDIUM: 1.00, LOW: 2.00 },
      METAL: { HIGH: 0.15, MEDIUM: 0.25, LOW: 0.40 },
      INDEX: { HIGH: 0.10, MEDIUM: 0.15, LOW: 0.25 }
    },
    description: 'Percentage-based SL distance minimums by asset class'
  },

  /**
   * Take Profit Distance
   * Ensure realistic profit targets
   */
  takeProfit: {
    maxAtrMultiple: 12,    // Maximum TP distance
    minAtrMultiple: 1.0,   // Minimum TP distance
    feasibilityFactor: 0.8, // Use 80% of theoretical max
    description: 'TP distance guidelines'
  },

  /**
   * Minimum Expected Profit
   * Ensure trade worth transaction costs
   */
  minProfit: {
    absoluteMinUSD: 3,
    balancePercentMin: 0.0003,
    spreadSafetyMultiplier: 2.0,
    description: 'Minimum profit must exceed spread costs'
  }
} as const;

// ============================================================================
// TIER 3: POLICY GUIDELINES (Alpha Decision Framework)
// ============================================================================

/**
 * These define Alpha's decision-making framework.
 * Not constraints, but policy that guides intelligent behavior.
 */
export const POLICY_GUIDELINES = {
  /**
   * Entry Strategy Selection
   * When to prefer pullback vs continuation vs breakout
   */
  entryStrategies: {
    pullback: {
      maxDistanceATR: 2.5,
      preferredPhases: ['FRESH'],
      description: 'Wait for price to retrace into zone'
    },
    continuation: {
      minDistanceATR: 2.5,
      maxDistanceATR: 7.0,
      requiredConditions: ['strong_momentum', 'clean_orderflow'],
      description: 'Trade into momentum when pullback unlikely'
    },
    breakout: {
      requiredConditions: ['structure_break', 'volume_confirmation'],
      description: 'Trade the break of key level'
    },
    immediate: {
      maxDistanceFromZone: 8, // pips
      description: 'Execute immediately at current price'
    }
  },

  /**
   * Urgency Phase System
   * How strategy preferences change over time
   */
  urgencyPhases: {
    PHASE_A: {
      durationMinutes: 15,
      preferredStrategy: 'pullback',
      description: 'Fresh setup - prefer pullback entries'
    },
    PHASE_B: {
      durationMinutes: 45, // 15-60 minutes total
      allowedStrategies: ['pullback', 'continuation', 'breakout'],
      zoneToleranceMultiplier: 1.5,
      description: 'Aging setup - allow alternative entries'
    }
  },

  /**
   * Style-Based ATR Gates
   * Volatility requirements for each style
   */
  styleValidity: {
    atrGates: {
      FOREX: { SCALP: 0.05, MICRO_INTRADAY: 0.03, INTRADAY: 0.03 },
      CRYPTO: { SCALP: 0.20, MICRO_INTRADAY: 0.10, INTRADAY: 0.10 },
      METAL: { SCALP: 0.08, MICRO_INTRADAY: 0.05, INTRADAY: 0.05 },
      INDEX: { SCALP: 0.06, MICRO_INTRADAY: 0.04, INTRADAY: 0.04 }
    },
    description: 'Minimum ATR% for style viability'
  },

  /**
   * Session Constraints
   * Time-based trade management
   */
  sessionConstraints: {
    SCALP: {
      mode: 'ADVISORY',
      maxDurationMinutes: 30,
      penaltyIfExceeded: 0.15
    },
    MICRO_INTRADAY: {
      mode: 'ADVISORY',
      maxDurationMinutes: 120,
      penaltyIfExceeded: 0.10
    },
    INTRADAY: {
      mode: 'ADVISORY',
      maxDurationMinutes: 480,
      penaltyIfExceeded: 0.05
    }
  },

  /**
   * Confidence Penalty Caps
   * Prevent death by 1000 cuts
   */
  confidencePenaltyCaps: {
    LOW: 0.70,     // Max 30% penalty
    MEDIUM: 0.60,  // Max 40% penalty
    HIGH: 0.50     // Max 50% penalty
  },

  /**
   * Safety Zone Classification
   * Setup quality tiers
   */
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
      description: 'Critical quality warning'
    }
  },

  /**
   * Fallback Strategy
   * What to try when primary strategy fails
   */
  fallbackBehavior: {
    maxSymbolsToTry: 3,
    strategiesPerSymbol: ['pullback', 'continuation'],
    cooldownSeconds: 60,
    maxScanAttempts: 5,
    description: 'Try multiple options before giving up'
  }
} as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Check if drawdown requires hard block
 * @deprecated Drawdown protection removed - always returns false
 */
export function isDrawdownBlocking(drawdownPercent: number): boolean {
  return false;
}

/**
 * Get maximum daily loss for risk mode
 */
export function getMaxDailyLoss(riskMode: RiskMode): number {
  return RISK_HARD_BLOCKS.maxDailyLoss[riskMode];
}

/**
 * Get minimum R:R for risk mode
 */
export function getMinimumRR(riskMode: RiskMode): number {
  return SOFT_WARNINGS.riskReward.professional[riskMode];
}

/**
 * Get entry distance thresholds
 */
export function getEntryDistanceThresholds() {
  return SOFT_WARNINGS.entryDistance;
}

/**
 * Get spread warning thresholds
 */
export function getSpreadThresholds() {
  return SOFT_WARNINGS.spread;
}

/**
 * Get confidence penalty cap
 */
export function getConfidencePenaltyCap(riskMode: RiskMode): number {
  return POLICY_GUIDELINES.confidencePenaltyCaps[riskMode];
}

/**
 * Get ATR gate for style
 */
export function getAtrGate(
  assetClass: 'FOREX' | 'CRYPTO' | 'METAL' | 'INDEX',
  style: TradeStyle
): number {
  return POLICY_GUIDELINES.styleValidity.atrGates[assetClass]?.[style] || 0.05;
}

/**
 * Get SL floor percentage
 */
export function getSlFloor(
  assetClass: 'FOREX' | 'CRYPTO' | 'METAL' | 'INDEX',
  riskMode: RiskMode
): number {
  return SOFT_WARNINGS.stopLoss.floors[assetClass]?.[riskMode] || 0.50;
}

/**
 * Classify R:R into safety zone
 */
export function classifyRRToZone(
  rrRatio: number,
  tpAtrMultiple: number
): 'GREEN' | 'YELLOW' | 'ORANGE' | 'RED' {
  const zones = POLICY_GUIDELINES.safetyZones;

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
 * Determine preferred entry strategy based on distance and phase
 */
export function getPreferredStrategy(
  distanceATR: number,
  minutesActive: number
): 'pullback' | 'continuation' | 'breakout' | 'immediate' {
  const strategies = POLICY_GUIDELINES.entryStrategies;
  const phases = POLICY_GUIDELINES.urgencyPhases;

  // Immediate if very close
  if (distanceATR < 0.5) {
    return 'immediate';
  }

  // Phase A (fresh): Prefer pullback
  if (minutesActive < phases.PHASE_A.durationMinutes) {
    if (distanceATR <= strategies.pullback.maxDistanceATR) {
      return 'pullback';
    }
    // Even in Phase A, suggest continuation if too far
    if (distanceATR <= strategies.continuation.maxDistanceATR) {
      return 'continuation';
    }
  }

  // Phase B (aging): More flexible
  if (minutesActive < phases.PHASE_B.durationMinutes) {
    if (distanceATR <= strategies.pullback.maxDistanceATR) {
      return 'pullback';
    }
    if (distanceATR <= strategies.continuation.maxDistanceATR) {
      return 'continuation';
    }
  }

  // Default to continuation for moderate distances
  return 'continuation';
}

/**
 * Get fallback configuration
 */
export function getFallbackConfig() {
  return POLICY_GUIDELINES.fallbackBehavior;
}

/**
 * Check if condition is a risk hard block
 */
export function isRiskHardBlock(condition: string): boolean {
  const hardBlockConditions = [
    'MAX_DAILY_LOSS_EXCEEDED',
    'INSUFFICIENT_MARGIN',
    'INVALID_POSITION_SIZE',
    'DATA_STALE',
    'MARKET_CLOSED',
    'INVALID_STOP_LOSS',
    'SPREAD_EXCEEDS_PROFIT'
  ];
  return hardBlockConditions.includes(condition);
}

/**
 * Format policy for logging
 */
export function formatPolicyForLogging(): string {
  return `
[Unified Trading Policy]
RISK HARD BLOCKS:
  - Max Daily Loss: 4-10% (by risk mode)
  - Max Drawdown: 20% hard stop
  - Position Limits: 2.0 lots/symbol, 5.0 total exposure
  - Margin: Min $1000 or 20% account
  - Data Freshness: Max 5 minutes

SOFT WARNINGS (Advisory Only):
  - Entry Distance: 2.5x ATR warning, 7x ATR backstop
  - Spread: 2 pips warning, 5 pips extreme
  - R:R: 0.5-1.2 minimum (by risk mode)
  - Min Profit: Max($3, 0.03% balance)

POLICY GUIDELINES:
  - Entry Strategies: Pullback (<2.5 ATR), Continuation (2.5-7 ATR), Immediate (<0.5 ATR)
  - Urgency Phases: A (0-15min pullback), B (15-60min flexible)
  - Fallback: Try 3 symbols × 2 strategies before 60s cooldown
  `.trim();
}
