/**
 * Execution Eligibility Configuration
 *
 * SINGLE SOURCE OF TRUTH for all execution blocking thresholds.
 * This module defines what can HARD BLOCK trade execution vs what is ADVISORY only.
 *
 * GUIDING PRINCIPLE:
 * If the trade is bad → BLOCK
 * If the trade is good but entry is bad → WAIT (CONVERT_TO_ENTRY_INTENT)
 * If the trade is good and entry is good → EXECUTE
 *
 * PIPNOSIS PHILOSOPHY:
 * Pipnosis is an INTRADAY-ONLY platform. SWING trades are not supported.
 * Intraday constraints are adaptive within safe bounds but never promote to swing.
 */

export type TradingMode = 'INTRADAY';

export interface ModeThresholds {
  timeToFill: {
    hardBlockMinutes: number;
    warningMinutes: number;
    description: string;
    toleranceBySession?: {
      asian: number;
      london: number;
      nyse: number;
    };
  };
  maxTradesRequired: number;
  slAtrCapMultiplier: number;
  slAtrAdaptiveMultiplier?: number;
}

export interface MinProfitConfig {
  absoluteMinUSD: number;
  balancePercentMin: number;
  spreadSafetyMultiplier: number;
}

export interface SlAtrCaps {
  forex: number;
  crypto: number;
  index: number;
  metal: number;
  energy: number;
}

export interface ExecutionEligibilityConfig {
  modes: {
    INTRADAY: ModeThresholds;
  };
  minProfit: MinProfitConfig;
  slAtrCaps: SlAtrCaps;
  entryQualityThreshold: {
    rrImprovementPercent: number;
  };
  advisoryThresholds: {
    goalContributionWarningPercent: number;
    smallProfitWarningUSD: number;
  };
}

export const EXECUTION_ELIGIBILITY_CONFIG: ExecutionEligibilityConfig = {
  modes: {
    INTRADAY: {
      timeToFill: {
        hardBlockMinutes: 9999,     // DISABLED - time is scoring signal only, not block
        warningMinutes: 120,        // Advisory threshold only
        description: 'Time-to-fill is advisory only - trades execute with style upgrades',
        toleranceBySession: {
          asian: 1.1,   // 10% more time allowed (lower volatility) - for scoring
          london: 1.0,  // Standard - for scoring
          nyse: 0.9     // 10% less time required (higher volatility) - for scoring
        }
      },
      maxTradesRequired: 75,
      slAtrCapMultiplier: 1.0,
      slAtrAdaptiveMultiplier: 1.15  // Can stretch to 1.15x in high volatility
    }
  },

  minProfit: {
    absoluteMinUSD: 3,
    balancePercentMin: 0.0003,
    spreadSafetyMultiplier: 2.0
  },

  slAtrCaps: {
    forex: 2.5,
    crypto: 3.0,
    index: 2.0,
    metal: 2.5,
    energy: 2.5
  },

  entryQualityThreshold: {
    rrImprovementPercent: 15
  },

  advisoryThresholds: {
    goalContributionWarningPercent: 5,
    smallProfitWarningUSD: 10
  }
};

export function getModeLimits(mode: TradingMode): ModeThresholds {
  return EXECUTION_ELIGIBILITY_CONFIG.modes[mode];
}

export function getMinExpectedProfit(accountBalance: number): number {
  const { absoluteMinUSD, balancePercentMin } = EXECUTION_ELIGIBILITY_CONFIG.minProfit;
  return Math.max(absoluteMinUSD, accountBalance * balancePercentMin);
}

export function getSlAtrCap(
  assetClass: 'forex' | 'crypto' | 'index' | 'metal' | 'energy',
  mode: TradingMode
): number {
  const baseCap = EXECUTION_ELIGIBILITY_CONFIG.slAtrCaps[assetClass];
  const modeMultiplier = EXECUTION_ELIGIBILITY_CONFIG.modes[mode].slAtrCapMultiplier;
  return baseCap * modeMultiplier;
}

export function getSpreadSafetyMultiplier(): number {
  return EXECUTION_ELIGIBILITY_CONFIG.minProfit.spreadSafetyMultiplier;
}

export function getEntryQualityThreshold(): number {
  return EXECUTION_ELIGIBILITY_CONFIG.entryQualityThreshold.rrImprovementPercent;
}

export function formatConfigForLogging(): string {
  const config = EXECUTION_ELIGIBILITY_CONFIG;
  return `
[Execution Eligibility Config - Intraday Only]
INTRADAY: TTF hard block ${config.modes.INTRADAY.timeToFill.hardBlockMinutes}min (adaptive by session), max ${config.modes.INTRADAY.maxTradesRequired} trades
SL/ATR Caps: Base ${config.modes.INTRADAY.slAtrCapMultiplier}x, adaptive up to ${config.modes.INTRADAY.slAtrAdaptiveMultiplier}x in high volatility
Min Profit: max($${config.minProfit.absoluteMinUSD}, ${(config.minProfit.balancePercentMin * 100).toFixed(2)}% of balance)
Spread Safety: profit must exceed ${config.minProfit.spreadSafetyMultiplier}x spread cost
Note: Pipnosis is intraday-only. SWING trades are not supported.
`.trim();
}
