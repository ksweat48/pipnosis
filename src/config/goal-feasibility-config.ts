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
    minTimeToFillMinutes: 15,
    maxTimeToFillMinutes: 180,

    volatility: {
      useCurrentATR: true,
      lookbackPeriodsForTypical: 20,
      minATRForConsideration: 0.0001,
    },
  },

  waitConditions: {
    minATRMultiplierRequired: 1.5,
    minSessionLiquidity: 'medium' as const,

    preferWaitDuring: {
      lowLiquidity: true,
      extremeSpread: true,
      newsEvents: true,
    },
  },

  blockConditions: {
    goalExceedsAccountPercent: 0.30,
    noForeseeablePathToGoal: true,

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
    showMeaningfulnessBreakdown: true,
    showCalculationDetails: false,
  },

  limits: {
    maxConsecutiveWaits: 3,
    maxWaitTimeMinutes: 60,
    fallbackToBlockAfterMaxWaits: true,
  },

  advisoryMaxStackDepth: 2,
  requireUserConfirmationForReduction: true,
} as const;

export const GUIDING_PRINCIPLE = `
GUIDING PRINCIPLE:

If the market can offer something MEANINGFUL, adapt and trade.
If it can only offer NOISE, wait — don't churn.

"Possible" ≠ "Worth Trading"
`;
