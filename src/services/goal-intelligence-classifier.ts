/**
 * GOAL INTELLIGENCE CLASSIFIER
 *
 * Elite trading psychology system that classifies goals into operational modes
 * BEFORE any trade planning begins. Transforms Alpha from "risk-aware bot"
 * into an intelligent capital manager that thinks like a professional trader.
 *
 * Philosophy:
 * - Capital survival and efficiency always override goal urgency
 * - Alpha does not chase goals — Alpha engineers outcomes
 * - Confidence affects whether to trade, not how tight the stops are
 * - Goal classification determines execution psychology, not just risk %
 */

import { logger, LogCategory } from '@/lib/logger';

export type GoalMode = 'precision' | 'execution' | 'campaign' | 'growth';

export interface GoalClassification {
  mode: GoalMode;
  goalRatioPercent: number;
  isFeasible: boolean;
  reasoning: string;

  // Mode-specific parameters
  maxRiskPerTradePct: number;
  expectedTradeCount: number;
  targetRiskRewardRange: [number, number];
  minConfidenceThreshold: number;

  // Execution guidance
  executionPsychology: string;
  userMessage: string;
  shouldBlockExecution: boolean;

  // Alternative recommendations (for blocked goals)
  alternativeApproach?: {
    stagedTargets: number[];
    timeframe: string;
    reasoning: string;
  };
}

export interface GoalContext {
  goalAmount: number;
  accountBalance: number;
  timeframe?: string;
}

// ============================================================
// MODE THRESHOLDS
// ============================================================

const MODE_THRESHOLDS = {
  PRECISION_MAX: 2.0,      // ≤ 2%: Precision Mode
  EXECUTION_MAX: 10.0,     // 2-10%: Execution Mode
  CAMPAIGN_MAX: 30.0,      // 10-30%: Campaign Mode
  // > 30%: Growth Mode (blocked)
} as const;

// ============================================================
// MODE CONFIGURATIONS
// ============================================================

const MODE_CONFIGS = {
  precision: {
    maxRiskPerTradePct: 0.8,
    expectedTradeCount: 1,
    targetRiskRewardRange: [1.5, 2.0] as [number, number],
    minConfidenceThreshold: 80,
    executionPsychology: 'surgical',
    description: 'One clean trade. No ego. Precision beats power.'
  },

  execution: {
    maxRiskPerTradePct: 1.5,
    expectedTradeCount: 3,
    targetRiskRewardRange: [2.0, 2.5] as [number, number],
    minConfidenceThreshold: 75,
    executionPsychology: 'disciplined',
    description: 'Professional execution through sequenced wins. 2-4 quality trades.'
  },

  campaign: {
    maxRiskPerTradePct: 1.0,
    expectedTradeCount: 8,
    targetRiskRewardRange: [2.0, 3.0] as [number, number],
    minConfidenceThreshold: 80,
    executionPsychology: 'patient',
    description: 'Multi-session campaign. Consistency over speed.'
  },

  growth: {
    maxRiskPerTradePct: 0,
    expectedTradeCount: 0,
    targetRiskRewardRange: [0, 0] as [number, number],
    minConfidenceThreshold: 100,
    executionPsychology: 'blocked',
    description: 'Capital growth problem, not a trading problem.'
  }
} as const;

// ============================================================
// GOAL INTELLIGENCE CLASSIFIER
// ============================================================

class GoalIntelligenceClassifier {

  /**
   * Main classification function - evaluates goal BEFORE any trade planning
   */
  classify(context: GoalContext): GoalClassification {
    const { goalAmount, accountBalance } = context;

    // Calculate goal ratio
    const goalRatioPercent = (goalAmount / accountBalance) * 100;

    // Determine mode based on thresholds
    const mode = this.determineMode(goalRatioPercent);

    // Get mode configuration
    const config = MODE_CONFIGS[mode];

    // Build classification
    const classification: GoalClassification = {
      mode,
      goalRatioPercent,
      isFeasible: mode !== 'growth',
      reasoning: this.buildReasoning(mode, goalRatioPercent, goalAmount, accountBalance),

      maxRiskPerTradePct: config.maxRiskPerTradePct,
      expectedTradeCount: config.expectedTradeCount,
      targetRiskRewardRange: config.targetRiskRewardRange,
      minConfidenceThreshold: config.minConfidenceThreshold,

      executionPsychology: config.executionPsychology,
      userMessage: this.buildUserMessage(mode, goalAmount, accountBalance, goalRatioPercent),
      shouldBlockExecution: mode === 'growth'
    };

    // Add alternative approach for blocked goals
    if (mode === 'growth') {
      classification.alternativeApproach = this.buildAlternativeApproach(
        goalAmount,
        accountBalance
      );
    }

    logger.info(LogCategory.AI_TRADING,
      `[Goal Intelligence] Classified $${goalAmount} goal on $${accountBalance} balance as ${mode.toUpperCase()} (${goalRatioPercent.toFixed(1)}%)`
    );

    return classification;
  }

  /**
   * Determine goal mode based on goal ratio
   */
  private determineMode(goalRatioPercent: number): GoalMode {
    if (goalRatioPercent <= MODE_THRESHOLDS.PRECISION_MAX) {
      return 'precision';
    }

    if (goalRatioPercent <= MODE_THRESHOLDS.EXECUTION_MAX) {
      return 'execution';
    }

    if (goalRatioPercent <= MODE_THRESHOLDS.CAMPAIGN_MAX) {
      return 'campaign';
    }

    return 'growth';
  }

  /**
   * Build reasoning for classification
   */
  private buildReasoning(
    mode: GoalMode,
    goalRatioPercent: number,
    goalAmount: number,
    accountBalance: number
  ): string {
    switch (mode) {
      case 'precision':
        return `Goal is ${goalRatioPercent.toFixed(1)}% of balance. This is a precision job, not a power play. ` +
               `Optimize for high probability with minimal exposure. One surgical trade is sufficient.`;

      case 'execution':
        return `Goal is ${goalRatioPercent.toFixed(1)}% of balance. This requires professional execution through ` +
               `2-4 disciplined trades. Focus on quality setups, not speed.`;

      case 'campaign':
        return `Goal is ${goalRatioPercent.toFixed(1)}% of balance. This requires a multi-session campaign. ` +
               `Large goals need time and consistency, not aggression. Expect staged progress over multiple sessions.`;

      case 'growth':
        return `Goal is ${goalRatioPercent.toFixed(1)}% of balance. This exceeds safe execution limits. ` +
               `This is not a trading problem — it's a capital growth problem. ` +
               `Attempting this goal would require excessive risk that violates professional trading standards.`;
    }
  }

  /**
   * Build user-facing message
   */
  private buildUserMessage(
    mode: GoalMode,
    goalAmount: number,
    accountBalance: number,
    goalRatioPercent: number
  ): string {
    const formattedGoal = `$${goalAmount.toFixed(2)}`;
    const formattedBalance = `$${accountBalance.toFixed(2)}`;

    switch (mode) {
      case 'precision':
        return `Your ${formattedGoal} goal is ${goalRatioPercent.toFixed(1)}% of your ${formattedBalance} balance. ` +
               `Alpha will execute one precise, high-probability trade to achieve this efficiently.`;

      case 'execution':
        return `Your ${formattedGoal} goal is ${goalRatioPercent.toFixed(1)}% of your ${formattedBalance} balance. ` +
               `Alpha will execute 2-4 disciplined trades focusing on quality over speed.`;

      case 'campaign':
        return `Your ${formattedGoal} goal is ${goalRatioPercent.toFixed(1)}% of your ${formattedBalance} balance. ` +
               `This requires a multi-session campaign. Alpha will take a patient, consistent approach over time.`;

      case 'growth':
        return `Your ${formattedGoal} goal is ${goalRatioPercent.toFixed(1)}% of your ${formattedBalance} balance. ` +
               `This goal exceeds safe execution limits and cannot be attempted in a single session. ` +
               `See the recommended growth path below.`;
    }
  }

  /**
   * Build alternative approach for unrealistic goals
   */
  private buildAlternativeApproach(
    goalAmount: number,
    accountBalance: number
  ): {
    stagedTargets: number[];
    timeframe: string;
    reasoning: string;
  } {
    // Calculate realistic daily targets (2-5% growth per day)
    const conservativeDailyTarget = accountBalance * 0.02;
    const aggressiveDailyTarget = accountBalance * 0.05;

    // Calculate number of days needed
    const daysNeeded = Math.ceil(goalAmount / aggressiveDailyTarget);

    // Build staged targets
    const stagedTargets: number[] = [];
    let currentTarget = conservativeDailyTarget;

    while (stagedTargets.reduce((sum, t) => sum + t, 0) < goalAmount) {
      stagedTargets.push(Math.min(currentTarget, goalAmount - stagedTargets.reduce((sum, t) => sum + t, 0)));
      currentTarget = Math.min(currentTarget * 1.1, aggressiveDailyTarget); // Progressive scaling
    }

    return {
      stagedTargets: stagedTargets.map(t => parseFloat(t.toFixed(2))),
      timeframe: `${daysNeeded} sessions`,
      reasoning: `To reach $${goalAmount.toFixed(2)}, start with $${conservativeDailyTarget.toFixed(2)}/session ` +
                 `and progressively scale to $${aggressiveDailyTarget.toFixed(2)}/session. ` +
                 `This allows capital to compound safely while maintaining professional risk standards.`
    };
  }

  /**
   * Calculate goal-efficient risk (capital efficiency constraint)
   * When goal < 1.5% of balance, risk should scale DOWN to prevent ego trading
   */
  calculateGoalEfficientRisk(
    goalAmount: number,
    accountBalance: number,
    targetRiskReward: number
  ): {
    goalEfficientRiskDollars: number;
    goalEfficientRiskPercent: number;
    reasoning: string;
  } {
    const goalRatioPercent = (goalAmount / accountBalance) * 100;

    // For very small goals, cap risk to goal × efficiency multiplier
    if (goalRatioPercent <= MODE_THRESHOLDS.PRECISION_MAX) {
      const efficiencyMultiplier = 1.5; // Risk no more than 1.5x the goal
      const goalEfficientRiskDollars = goalAmount * efficiencyMultiplier;
      const goalEfficientRiskPercent = (goalEfficientRiskDollars / accountBalance) * 100;

      return {
        goalEfficientRiskDollars,
        goalEfficientRiskPercent,
        reasoning: `Goal is only ${goalRatioPercent.toFixed(1)}% of balance. ` +
                   `Risk capped to ${efficiencyMultiplier}x goal for capital efficiency (precision mode).`
      };
    }

    // For execution and campaign modes, use standard risk calculation
    // Risk needed to achieve goal = goal / risk-reward ratio
    const standardRiskDollars = goalAmount / targetRiskReward;
    const standardRiskPercent = (standardRiskDollars / accountBalance) * 100;

    return {
      goalEfficientRiskDollars: standardRiskDollars,
      goalEfficientRiskPercent: standardRiskPercent,
      reasoning: `Standard risk calculation: $${goalAmount.toFixed(2)} goal / ${targetRiskReward}:1 R:R = $${standardRiskDollars.toFixed(2)} risk`
    };
  }

  /**
   * Validate if a proposed trade respects goal classification
   */
  validateTradeAgainstGoalMode(
    classification: GoalClassification,
    proposedTrade: {
      riskPercent: number;
      riskReward: number;
      confidence: number;
    }
  ): {
    isValid: boolean;
    violations: string[];
    warnings: string[];
  } {
    const violations: string[] = [];
    const warnings: string[] = [];

    // Check risk limits
    if (proposedTrade.riskPercent > classification.maxRiskPerTradePct) {
      violations.push(
        `Risk ${proposedTrade.riskPercent.toFixed(1)}% exceeds ${classification.mode} mode maximum ` +
        `(${classification.maxRiskPerTradePct.toFixed(1)}%)`
      );
    }

    // Check R:R range
    const [minRR, maxRR] = classification.targetRiskRewardRange;
    if (proposedTrade.riskReward < minRR) {
      violations.push(
        `R:R ${proposedTrade.riskReward.toFixed(1)} below ${classification.mode} mode minimum (${minRR})`
      );
    }

    if (proposedTrade.riskReward > maxRR) {
      warnings.push(
        `R:R ${proposedTrade.riskReward.toFixed(1)} exceeds typical range for ${classification.mode} mode. ` +
        `Verify setup quality.`
      );
    }

    // Check confidence threshold
    if (proposedTrade.confidence < classification.minConfidenceThreshold) {
      violations.push(
        `Confidence ${proposedTrade.confidence}% below ${classification.mode} mode threshold ` +
        `(${classification.minConfidenceThreshold}%)`
      );
    }

    return {
      isValid: violations.length === 0,
      violations,
      warnings
    };
  }
}

export const goalIntelligenceClassifier = new GoalIntelligenceClassifier();
