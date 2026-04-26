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
    // CCIP-2026-03-06: Unified floor — MICRO_INTRADAY and INTRADAY share 1.0:1 minimum.
    // CCIP-2026-0422I: SCALP minimum removed — Alpha decides TP based on M5 structural
    // exhaustion. No R:R floor enforced. Omega-9 hard block disabled for SCALP.
    MINIMUM: 1.0,
    // Per-style floors — 0 means no floor (Omega-9 block disabled for that style)
    MINIMUM_SCALP: 0,
    MINIMUM_MICRO_INTRADAY: 1.0,
    MINIMUM_INTRADAY: 1.0,
    // Per-style ceilings — Alpha cannot set TP beyond these R:R multiples
    // CCIP-2026-03-10: MAXIMUM_SCALP raised from 1.5 to 2.0.
    // Root cause: During Asian session low-volatility, ATR-derived SL is small
    // (~8-10 pips for NAS100/US30 at those ATR levels). With MAXIMUM_SCALP=1.5,
    // the TP ceiling = SL × 1.5 = ~12-15 pips. The TP_FLOOR_RATIO calibration
    // (Option A) reduces the envelope floor but the ceiling also needs more
    // headroom so Alpha can place a structural TP at a real swing level (20+ pips).
    // At 2.0, TP = 2× SL, which is still a tight scalp (one M5 swing with
    // full ATR extension), preserves SCALP identity, and unlocks structural
    // targets Alpha correctly identifies (e.g., 20.8 pips above entry for NAS100).
    // Combined with TP_FLOOR_RATIO calibration this ensures the corridor is non-zero
    // AND the ceiling is wide enough for Alpha's structural analysis.
    //
    // CCIP-2026-03-21: All three style ceilings calibrated against actual pip ranges
    // defined in style-personalities.ts referenceRanges:
    //   SCALP natural band: 10-25 pips TP / 10-18 pips SL → 1.4x-2.0x natural range.
    //     Ceiling 2.0 sits at the upper edge of natural output — correct.
    //   MICRO_INTRADAY natural band: 50-120 pips TP / 20-35 pips SL → 2.0x-3.4x natural range.
    //     Previous ceiling 2.0 clipped half the style's natural range. Raised to 3.0.
    //   INTRADAY natural band: 100-200 pips TP / 35-60 pips SL → 2.0x-4.0x natural range.
    //     Previous ceiling 3.0 clipped the upper structural targets. Raised to 4.0.
    // These ceilings are emergency walls against style drift, not execution constraints.
    // SSOT: omega9-constraint-provider.ts uses getMaxRRForStyle() from this file.
    MAXIMUM_SCALP: 2.0,
    MAXIMUM_MICRO_INTRADAY: 3.0,
    MAXIMUM_INTRADAY: 4.0,
    TARGET: 1.5,
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

/**
 * SPREAD_ESTIMATES — Single Source of Truth for symbol spread estimates (in pips)
 *
 * SSOT GOVERNANCE (CCIP-2026-0407-SPREAD):
 * These values are the canonical spread estimates used system-wide:
 *   1. Omega-9 hard-block gate  (minimum SL distance enforcement)
 *   2. Alpha's prompt context   (injected so Alpha can correctly size SL)
 *
 * PREVIOUS BUG: Omega-9 had a private estimateSpread() method with hardcoded values.
 * Alpha's prompt received NO spread number — only the abstract rule.
 * This caused Alpha to propose SLs that failed the Omega-9 check because Alpha had
 * no concrete number to work against when sizing its stop.
 *
 * FIX: Both consumers now call getEstimatedSpreadPips() from this SSOT.
 * Alpha receives the exact minimum SL distance in pips before deciding.
 *
 * Values are conservative estimates covering typical broker spreads at normal liquidity.
 * They are deliberately NOT session-adjusted to avoid false confidence during low-volume hours.
 */
export const SPREAD_ESTIMATES: Record<string, number> = {
  EURUSD: 1.5,
  GBPUSD: 1.5,
  EURGBP: 2.0,
  EURJPY: 2.0,
  GBPJPY: 2.5,
  USDJPY: 2.0,
  USDCHF: 2.0,
  AUDUSD: 1.5,
  NZDUSD: 2.0,
  USDCAD: 2.0,
  XAUUSD: 1.5,  // 1 pip = 1 price point. Real spread $0.20–$0.60 — 1.5 is conservative.
  XAGUSD: 4.0,
  US30:   3.0,
  NAS100: 2.0,
  US100:  2.0,
  SPX500: 1.0,
  US500:  1.0,
  BTCUSD: 5.0,
  ETHUSD: 1.0,  // 1 pip = $1. Real spread $0.50–$2.00 — 1.0 reflects the low-end baseline for scalp geometry. CCIP-2026-0426C.
} as const;

/**
 * Returns the estimated spread in pips for a given symbol.
 * Falls back to 3.0 pips for unknown symbols (conservative).
 */
export function getEstimatedSpreadPips(symbol: string): number {
  if (SPREAD_ESTIMATES[symbol] !== undefined) return SPREAD_ESTIMATES[symbol];
  if (symbol.startsWith('EUR') || symbol.startsWith('GBP')) return 1.5;
  if (symbol.includes('JPY')) return 2.0;
  if (symbol.startsWith('USD')) return 2.0;
  return 3.0;
}

/**
 * Returns the minimum SL distance in pips for a given symbol.
 * SL must be at least 1.5× the spread to survive the fill.
 * This is the Omega-9 hard-block threshold — Alpha must beat this.
 */
export function getMinSlDistancePips(symbol: string): number {
  return getEstimatedSpreadPips(symbol) * 1.5;
}

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

export function getMaxRRForStyle(style?: string): number {
  switch (style) {
    case 'SCALP':
      return TRADING_CONSTANTS.RISK_REWARD_RATIOS.MAXIMUM_SCALP;
    case 'MICRO_INTRADAY':
      return TRADING_CONSTANTS.RISK_REWARD_RATIOS.MAXIMUM_MICRO_INTRADAY;
    case 'INTRADAY':
      return TRADING_CONSTANTS.RISK_REWARD_RATIOS.MAXIMUM_INTRADAY;
    default:
      return TRADING_CONSTANTS.RISK_REWARD_RATIOS.MAXIMUM_INTRADAY;
  }
}

export function getMinTP1RRForStyle(style?: string): number | null {
  switch (style) {
    case 'MICRO_INTRADAY':
      return TRADING_CONSTANTS.RISK_REWARD_RATIOS.MINIMUM_MICRO_INTRADAY;
    case 'INTRADAY':
      return TRADING_CONSTANTS.RISK_REWARD_RATIOS.MINIMUM_INTRADAY;
    default:
      return null;
  }
}
