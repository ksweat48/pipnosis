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

// CCIP-2026-0427E-STYLE-CONSOLIDATION: Single-style platform.
export type TradeStyle = 'micro';

export type StyleDisplayName = 'MICRO_INTRADAY';

export const STYLE_DISPLAY_NAMES: Record<TradeStyle, StyleDisplayName> = {
  micro: 'MICRO_INTRADAY',
} as const;

export const STYLE_FROM_DISPLAY_NAME: Record<StyleDisplayName, TradeStyle> = {
  MICRO_INTRADAY: 'micro',
} as const;

export function getDisplayNameFromStyle(_style: TradeStyle): StyleDisplayName {
  return 'MICRO_INTRADAY';
}

export function getStyleFromDisplayName(_displayName: StyleDisplayName): TradeStyle {
  return 'micro';
}

export function isValidDisplayName(name: string): name is StyleDisplayName {
  return name === 'MICRO_INTRADAY';
}

export function isValidTradeStyle(style: string): style is TradeStyle {
  return style === 'micro';
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
  micro: {
    name: 'micro',
    displayName: 'Micro Intraday',
    icon: 'Target',
    description: 'Intraday trades. TP1 captures fast partial; TP2 captures full target.',
    durationMin: 5,
    durationMax: 240,
    suggestedMultipliers: [0.02, 0.05, 0.07],
    maxDollarAmount: 7000,
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

export function mapLegacyRiskModeToStyle(_riskMode: string): TradeStyle {
  return 'micro';
}

export function getStyleFromDuration(durationMinutes: number): TradeStyle {
  if (durationMinutes > 240) {
    throw new Error('SWING TRADES NOT ALLOWED: Pipnosis is intraday-only. Max duration is 4 hours.');
  }
  return 'micro';
}

// SSOT: Import risk limits from trading-constants.ts
export const SINGLE_TRADE_RISK_RANGE = {
  min: TRADING_CONSTANTS.RISK_PERCENTAGES.MIN_PER_TRADE,
  max: TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_PER_TRADE,
} as const;

export const MAX_TOTAL_EXPOSURE = TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_TOTAL_EXPOSURE;
