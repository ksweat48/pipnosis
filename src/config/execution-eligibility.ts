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
 */

export type TradingMode = 'INTRADAY' | 'SWING';

export interface ModeThresholds {
  timeToFill: {
    hardBlockMinutes: number;
    warningMinutes: number;
    description: string;
  };
  maxTradesRequired: number;
  slAtrCapMultiplier: number;
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
    SWING: ModeThresholds;
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
        hardBlockMinutes: 240,
        warningMinutes: 120,
        description: 'Intraday trades must complete within 4 hours'
      },
      maxTradesRequired: 75,
      slAtrCapMultiplier: 1.0
    },
    SWING: {
      timeToFill: {
        hardBlockMinutes: 1440,
        warningMinutes: 480,
        description: 'Swing trades have 24-hour ceiling but relaxed enforcement'
      },
      maxTradesRequired: 150,
      slAtrCapMultiplier: 1.5
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
[Execution Eligibility Config]
INTRADAY: TTF hard block ${config.modes.INTRADAY.timeToFill.hardBlockMinutes}min, max ${config.modes.INTRADAY.maxTradesRequired} trades
SWING: TTF hard block ${config.modes.SWING.timeToFill.hardBlockMinutes}min, max ${config.modes.SWING.maxTradesRequired} trades
Min Profit: max($${config.minProfit.absoluteMinUSD}, ${(config.minProfit.balancePercentMin * 100).toFixed(2)}% of balance)
Spread Safety: profit must exceed ${config.minProfit.spreadSafetyMultiplier}x spread cost
`.trim();
}
