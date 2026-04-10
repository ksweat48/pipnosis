/**
 * PIPNOSIS INTRADAY-ONLY TRADE STYLES
 *
 * CRITICAL: Pipnosis is an INTRADAY platform. ALL trades MUST close before market close.
 * NO SWING TRADES. NO MULTI-DAY POSITIONS. EVER.
 *
 * STYLE NAMING CONVENTION:
 * - Internal names (database): 'scalper', 'micro', 'intraday'
 * - Display names (UI/logs): 'SCALP', 'MICRO_INTRADAY', 'INTRADAY'
 *
 * Use getDisplayNameFromStyle() and getStyleFromDisplayName() for conversions.
 *
 * RISK CALCULATION PHILOSOPHY:
 * - All risk amounts are PURE PERCENTAGES of account balance
 * - NO hardcoded minimum dollar amounts per trade
 * - Minimum account balance: $50 (enforced at UI level)
 * - Trust the percentage system completely for all account sizes
 */

import { TRADING_CONSTANTS } from './trading-constants';

// SSOT: Minimum account balance required to trade
export const MINIMUM_ACCOUNT_BALANCE = 50;

export type TradeStyle = 'scalper' | 'micro' | 'intraday';

export type StyleDisplayName = 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';

export const STYLE_DISPLAY_NAMES: Record<TradeStyle, StyleDisplayName> = {
  scalper: 'SCALP',
  micro: 'MICRO_INTRADAY',
  intraday: 'INTRADAY',
} as const;

export const STYLE_FROM_DISPLAY_NAME: Record<StyleDisplayName, TradeStyle> = {
  SCALP: 'scalper',
  MICRO_INTRADAY: 'micro',
  INTRADAY: 'intraday',
} as const;

export function getDisplayNameFromStyle(style: TradeStyle): StyleDisplayName {
  return STYLE_DISPLAY_NAMES[style];
}

export function getStyleFromDisplayName(displayName: StyleDisplayName): TradeStyle {
  return STYLE_FROM_DISPLAY_NAME[displayName];
}

export function isValidDisplayName(name: string): name is StyleDisplayName {
  return name === 'SCALP' || name === 'MICRO_INTRADAY' || name === 'INTRADAY';
}

export function isValidTradeStyle(style: string): style is TradeStyle {
  return style === 'scalper' || style === 'micro' || style === 'intraday';
}

export interface TradeStyleConfig {
  name: string;
  displayName: string;
  icon: string;
  description: string;
  durationMin: number; // minutes
  durationMax: number; // minutes
  suggestedMultipliers: [number, number, number]; // [low, medium, high] as decimal percentages (e.g., 0.01 = 1%)
  maxDollarAmount: number; // cap for maximum percentage validation
}

export const TRADE_STYLES: Record<TradeStyle, TradeStyleConfig> = {
  scalper: {
    name: 'scalper',
    displayName: 'Scalper',
    icon: 'Zap',
    description: 'Fast trades, estimate 2min-15min',
    durationMin: 2,
    durationMax: 15,
    suggestedMultipliers: [0.01, 0.02, 0.05], // 1%, 2%, 5%
    maxDollarAmount: 5000, // Cap for 5% max
  },
  micro: {
    name: 'micro',
    displayName: 'Micro',
    icon: 'Target',
    description: 'Medium trades, estimate 15min-1.5hr',
    durationMin: 15,
    durationMax: 90,
    suggestedMultipliers: [0.02, 0.05, 0.07], // 2%, 5%, 7%
    maxDollarAmount: 7000, // Cap for 7% max
  },
  intraday: {
    name: 'intraday',
    displayName: 'Intraday',
    icon: 'Clock',
    description: 'Longer intraday, estimate 1hr-4hr',
    durationMin: 60,
    durationMax: 240,
    suggestedMultipliers: [0.03, 0.07, 0.10], // 3%, 7%, 10%
    maxDollarAmount: 10000, // Cap for 10% max
  },
};

export interface SuggestedDollarAmounts {
  low: number;
  medium: number;
  high: number;
}

/**
 * Calculate suggested dollar amounts as PURE PERCENTAGES of account balance
 *
 * SSOT PRINCIPLE: Trust the percentage system completely
 * - NO artificial minimum dollar amounts
 * - Account balance validation ($50 minimum) happens at UI level
 * - Results scale naturally from $50 accounts to $100,000+ accounts
 *
 * Examples:
 * - $50 account, Scalper: $0.50 (1%), $1 (2%), $2.50 (5%)
 * - $500 account, Scalper: $5 (1%), $10 (2%), $25 (5%)
 * - $5,000 account, Scalper: $50 (1%), $100 (2%), $250 (5%)
 */
export function calculateSuggestedAmounts(
  accountBalance: number,
  style: TradeStyle
): SuggestedDollarAmounts {
  const config = TRADE_STYLES[style];
  const [lowMult, medMult, highMult] = config.suggestedMultipliers;

  // Pure percentage calculation - no artificial floors
  // Round to 2 decimal places for cents precision
  const low = Math.min(
    Math.round(accountBalance * lowMult * 100) / 100,
    config.maxDollarAmount
  );
  const medium = Math.min(
    Math.round(accountBalance * medMult * 100) / 100,
    config.maxDollarAmount
  );
  const high = Math.min(
    Math.round(accountBalance * highMult * 100) / 100,
    config.maxDollarAmount
  );

  return { low, medium, high };
}

/**
 * Validate dollar amount against percentage-based risk limits
 *
 * SSOT PRINCIPLE: Pure percentage validation only
 * - NO hardcoded minimum dollar amounts
 * - Validates against 1-10% risk range from TRADING_CONSTANTS
 * - Account balance minimum ($50) is enforced separately at UI level
 *
 * FLOATING-POINT TOLERANCE:
 * - Uses epsilon (0.01%) to handle rounding errors
 * - Prevents false rejections when dollar amounts are rounded to cents
 * - Example: $55.29 = 0.999982% rounds to ~1%, should pass validation
 * - Example: $552.95 = 10.000326% rounds to ~10%, should pass validation
 */
export function validateDollarAmount(
  amount: number,
  accountBalance: number
): { valid: boolean; error?: string } {
  // Basic sanity checks
  if (amount <= 0) {
    return { valid: false, error: 'Risk amount must be greater than $0' };
  }

  if (accountBalance <= 0) {
    return { valid: false, error: 'Invalid account balance' };
  }

  // Percentage-based validation (SSOT from trading-constants)
  const percentOfAccount = (amount / accountBalance) * 100;
  const maxRiskPercent = TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_PER_TRADE * 100;
  const minRiskPercent = TRADING_CONSTANTS.RISK_PERCENTAGES.MIN_PER_TRADE * 100;

  // FLOATING-POINT TOLERANCE: Allow 0.01% epsilon for rounding errors
  // This prevents false rejections when dollar amounts are rounded to cents
  const EPSILON = 0.01; // 0.01% tolerance

  if (percentOfAccount > maxRiskPercent + EPSILON) {
    return {
      valid: false,
      error: `Risk amount cannot exceed ${maxRiskPercent}% of account balance`,
    };
  }

  if (percentOfAccount < minRiskPercent - EPSILON) {
    return {
      valid: false,
      error: `Risk amount must be at least ${minRiskPercent}% of account balance`,
    };
  }

  return { valid: true };
}

export function mapLegacyRiskModeToStyle(riskMode: string): TradeStyle {
  switch (riskMode.toLowerCase()) {
    case 'high':
      return 'scalper';
    case 'medium':
      return 'micro';
    case 'low':
      return 'intraday';
    default:
      return 'micro';
  }
}

export function getStyleFromDuration(durationMinutes: number): TradeStyle {
  // INTRADAY ONLY: All durations max at 10 hours (600 minutes)
  if (durationMinutes > 240) {
    throw new Error('SWING TRADES NOT ALLOWED: Pipnosis is intraday-only. Max duration is 4 hours.');
  }

  if (durationMinutes <= 15) {
    return 'scalper';
  } else if (durationMinutes <= 90) {
    return 'micro';
  } else {
    return 'intraday';
  }
}

// SSOT: Import risk limits from trading-constants.ts
export const SINGLE_TRADE_RISK_RANGE = {
  min: TRADING_CONSTANTS.RISK_PERCENTAGES.MIN_PER_TRADE,
  max: TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_PER_TRADE,
} as const;

export const MAX_TOTAL_EXPOSURE = TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_TOTAL_EXPOSURE;
