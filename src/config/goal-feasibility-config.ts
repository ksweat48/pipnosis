export const GOAL_FEASIBILITY_CONFIG = {
  downshift: {
    enabled: true,
    minGoalRetentionPercent: 0.20,
    maxDownshiftPercent: 0.80,
    requireAlphaReconfirmation: true,

    specialCases: {
      nearGoalCompletionPercent: 0.90,
      relaxFloorsWhenNearCompletion: true,
    },
  },

  meaningfulTrade: {
    volatilityFloorPercent: 0.15,
    accountFloorPercent: 0.0015,
    spreadMultiplierMin: 3.0,
    historicalFloorPercent: 0.25,

    actionOnFailure: 'WAIT_FOR_VOLATILITY' as const,

    requireAtLeastOne: true,
  },

  calculation: {
    atrSafetyFactor: 0.7,
    minTimeToFillMinutes: 15,
    maxTimeToFillMinutes: 180,

    volatility: {
      useCurrentATR: true,
      lookbackPeriodsForTypical: 20,
      minATRForConsideration: 0.0001,
    },

    sessionLiquidityMultipliers: {
      london_ny_overlap: 1.2,
      london: 1.0,
      newyork: 1.0,
      asian: 0.6,
      off_hours: 0.4,
    },
  },

  waitConditions: {
    minATRMultiplierRequired: 1.5,
    minSessionLiquidity: 'medium' as const,
    maxTradesInLastHour: 2,
    minMinutesSinceLastTrade: 20,

    preferWaitDuring: {
      lowLiquidity: true,
      extremeSpread: true,
      newsEvents: true,
    },
  },

  blockConditions: {
    goalExceedsAccountPercent: 0.30,
    noForeseeablePathToGoal: true,
    riskRewardBelowMinimum: 1.5,

    offerAlternatives: true,
    suggestStagedTargets: true,
    suggestTimeframeExtension: false,
  },

  transparency: {
    showRetentionPercent: true,
    showOriginalVsAdjusted: true,
    showMeaningfulnessChecks: true,
    explainWaitReason: true,
    showVolatilityContext: true,
    showCalculationDetails: false,
  },

  limits: {
    maxConsecutiveWaits: 3,
    maxWaitTimeMinutes: 60,
    fallbackToBlockAfterMaxWaits: true,
  },
} as const;

export const GUIDING_PRINCIPLE = `
GUIDING PRINCIPLE:

If the market can offer something MEANINGFUL, adapt and trade.
If it can only offer NOISE, wait — don't churn.

"Possible" ≠ "Worth Trading"
`;
