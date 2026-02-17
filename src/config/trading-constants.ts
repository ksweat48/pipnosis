/**
 * TRADING CONSTANTS - Single Source of Truth
 *
 * All trading-related thresholds and constants MUST be defined here.
 * DO NOT hardcode these values elsewhere in the codebase.
 *
 * SSOT GOVERNANCE (2026-02-02):
 * - Alpha-specific behavior → alpha-identity.ts (minimum confidence, advisory penalties)
 * - Platform constants → THIS FILE (risk percentages, lot sizes, R:R ratios)
 * - See GOVERNANCE_DECISIONS.md for conflict resolution decisions
 *
 * Usage: import { TRADING_CONSTANTS } from '@/config/trading-constants';
 */

export const TRADING_CONSTANTS = {
  RISK_REWARD_RATIOS: {
    CATASTROPHIC_THRESHOLD: 0.5,
    MINIMUM: 1.5,
    MINIMUM_SCALP: 1.3,
    MINIMUM_MICRO_INTRADAY: 2.0,
    MINIMUM_INTRADAY: 2.0,
    TARGET: 2.0,
    GOOD: 2.0,
    EXCELLENT: 2.5,
    EXCEPTIONAL: 3.0,
  },

  ATR_MULTIPLIERS: {
    STOP_LOSS_DEFAULT: 1.5,
    STOP_LOSS_TIGHT: 1.0,
    STOP_LOSS_WIDE: 2.0,
    TAKE_PROFIT_DEFAULT: 2.0,
    TAKE_PROFIT_EXTENDED: 3.0,
    MIN_SL_DISTANCE: 0.5,
  },

  /**
   * ATR Minimum Thresholds - Prevents impossibly low ATR values
   *
   * These are instrument-specific minimums based on typical market volatility.
   * If calculated ATR falls below these thresholds, it indicates bad data
   * (e.g., flat placeholder candles from MetaAPI) rather than real low volatility.
   */
  ATR_MINIMUMS: {
    // Major Forex Pairs (in price units, ~2-5 pips minimum per M5 candle)
    EURUSD: 0.00015,  // 1.5 pips
    GBPUSD: 0.00015,  // 1.5 pips
    USDJPY: 0.015,    // 1.5 pips (JPY pairs)
    USDCHF: 0.00015,  // 1.5 pips
    AUDUSD: 0.00015,  // 1.5 pips
    NZDUSD: 0.00015,  // 1.5 pips
    USDCAD: 0.00015,  // 1.5 pips

    // Metals
    XAUUSD: 0.20,     // Gold: $0.20 minimum
    // Crypto
    BTCUSD: 20.0,     // Bitcoin: $20 minimum
    ETHUSD: 1.0,      // Ethereum: $1 minimum

    // Default fallback (in percentage terms)
    DEFAULT_PERCENT: 0.0002,  // 0.02% of price
  },

  RISK_PERCENTAGES: {
    /**
     * ✅ PHASE 2 FIX (2026-02-02): Consolidated DEFAULT_BASE_RISK
     * Was scattered across 2 files (unified-risk-authority.ts, professional-risk-manager.ts)
     * DEFAULT_BASE_RISK = Conservative baseline when no preference specified
     * DEFAULT_PER_TRADE = Standard/recommended risk level
     */
    DEFAULT_BASE_RISK: 0.01,      // 1% - Conservative baseline (SSOT)
    MIN_PER_TRADE: 0.01,          // 1% - Minimum allowed
    DEFAULT_PER_TRADE: 0.02,      // 2% - Recommended baseline
    MAX_PER_TRADE: 0.10,          // 10% - Maximum allowed
    MAX_TOTAL_EXPOSURE: 0.20,     // 20% - Total portfolio risk cap
    MAX_DAILY_DRAWDOWN: 0.08,     // 8% - Daily loss limit
    DRAWDOWN_RISK_REDUCTION_THRESHOLD: 0.03,
    DRAWDOWN_RISK_REDUCTION_FACTOR: 0.5,
    DAILY_LOSS_CRITICAL_REMAINING: 0.02,
  },

  LOT_SIZES: {
    MIN: 0.01,
    MAX_FOREX: 5.0,
    MAX_METAL: 10.0,
    MAX_INDEX: 1.0,
    MAX_CRYPTO: 10.0,
    PRECISION: 2,
  },

  POSITION_LIMITS: {
    MAX_OPEN_TRADES: 3,
    MAX_CORRELATION_RISK: 0.7,
  },

  KELLY_CRITERION: {
    FRACTIONAL_KELLY: 0.25,
    MIN_WIN_RATE: 0.35,
    MIN_EDGE: 0.01,
    MAX_RISK_AGGRESSIVE: 0.05,
  },

  EV_THRESHOLDS: {
    MIN_EV: 0,
    MIN_EV_COMFORTABLE: 5,
    MIN_EV_EXCELLENT: 10,
  },

  PRICE_MOVEMENT: {
    MAX_VELOCITY_PERCENT_PER_SECOND: 0.01,
    MAX_VELOCITY_CRYPTO_PER_SECOND: 0.005,
    SUSPICIOUS_CHANGE_THRESHOLD: 0.5,
  },

  REFERRAL_REWARDS: {
    REFERRER_CREDITS: 5.0,          // Credits given to user who referred
    REFERRED_USER_CREDITS: 5.0,     // Credits given to new referred user
    MINIMUM_REFERRAL_AGE_HOURS: 24, // Must be active 24h before earning rewards
  },

  CREDIT_SYSTEM: {
    INITIAL_CREDITS: 50.0,
    TEST_DEDUCTION_AMOUNT: 0.01,
    BALANCE_TOLERANCE: 0.02,        // For reconciliation testing
  },
} as const;

/**
 * CONFIDENCE THRESHOLDS
 *
 * ⚠️ SSOT GOVERNANCE NOTE (2026-02-02):
 * MINIMUM_TO_TRADE has been DEPRECATED and removed.
 *
 * AUTHORITATIVE SOURCE for minimum trade confidence:
 * → alpha-identity.ts: ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE = 60%
 *
 * REASON: Alpha-specific behavioral parameters belong in alpha-identity.ts
 * See GOVERNANCE_DECISIONS.md for full rationale.
 *
 * These thresholds are for LABELING confidence bands only, not enforcement.
 */
export const CONFIDENCE_THRESHOLDS = {
  // MINIMUM_TO_TRADE: DEPRECATED - Use ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE instead
  GOOD: 75,
  HIGH: 80,
  VERY_HIGH: 85,
  EXCELLENT: 90,
  A_GRADE_ONLY_AT_GOAL_PERCENT: 90,
} as const;

export const SESSION_LIMITS = {
  MAX_DURATION_MINUTES: {
    AGGRESSIVE: 90,
    MODERATE: 120,
    CONSERVATIVE: 120,
    ABSOLUTE_MAX: 240,
  },
  WARNING_THRESHOLDS_MINUTES: {
    AGGRESSIVE: 60,
    MODERATE: 90,
    CONSERVATIVE: 90,
  },
  TIMEOUT_MINUTES: 15,
} as const;

export const SCALING_MULTIPLIERS = {
  STREAK: {
    MAX_SCALE_UP: 1.5,
    MAX_SCALE_DOWN: 0.5,
    WINNING_THRESHOLD: 3,
    LOSING_THRESHOLD: 2,
    PER_WIN_INCREASE: 0.1,
    PER_LOSS_DECREASE: 0.15,
  },
  VOLATILITY: {
    VERY_LOW: 1.3,
    LOW: 1.1,
    NORMAL: 1.0,
    HIGH: 0.75,
    VERY_HIGH: 0.5,
  },
  RANK: {
    BRONZE: 0.4,
    SILVER: 0.6,
    GOLD: 0.8,
    ALPHA: 0.95,
    OMEGA: 1.0,
  },
  EXPOSURE_CAPS: {
    CONSERVATIVE: 0.01,
    MODERATE: 0.02,
    AGGRESSIVE: 0.05,
  },
} as const;

export type RiskRewardRatio = typeof TRADING_CONSTANTS.RISK_REWARD_RATIOS[keyof typeof TRADING_CONSTANTS.RISK_REWARD_RATIOS];
export type ConfidenceThreshold = typeof CONFIDENCE_THRESHOLDS[keyof typeof CONFIDENCE_THRESHOLDS];

export function getMinRRForStyle(style?: string): number {
  switch (style) {
    case 'SCALP':
      return TRADING_CONSTANTS.RISK_REWARD_RATIOS.MINIMUM_SCALP;
    case 'MICRO_INTRADAY':
      return TRADING_CONSTANTS.RISK_REWARD_RATIOS.MINIMUM_MICRO_INTRADAY;
    case 'INTRADAY':
      return TRADING_CONSTANTS.RISK_REWARD_RATIOS.MINIMUM_INTRADAY;
    default:
      return TRADING_CONSTANTS.RISK_REWARD_RATIOS.MINIMUM;
  }
}
