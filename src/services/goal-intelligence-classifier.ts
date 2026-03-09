/**
 * GOAL INTELLIGENCE CLASSIFIER
 *
 * CCIP-2026-03-09: GOVERNANCE REFACTOR
 * - Growth mode removed entirely. Alpha executes for ALL goal sizes.
 * - shouldBlockExecution removed from contract — Alpha is never blocked by goal ratio.
 * - minConfidenceThreshold normalized to ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE (60)
 *   for all modes. best-symbol-selector.ts is the single confidence gate authority.
 * - alternativeApproach removed — Alpha does not refuse to trade.
 * - Modes remain as psychological execution frameworks only (no blocking power).
 *
 * Philosophy:
 * - Capital survival and efficiency always override goal urgency
 * - Alpha does not chase goals — Alpha engineers outcomes
 * - Confidence affects whether to trade, not how tight the stops are
 * - Goal classification determines execution psychology, not execution permission
 */

import { logger, LogCategory } from '@/lib/logger';
import { ALPHA_IDENTITY } from '../config/alpha-identity';

export type GoalMode = 'precision' | 'execution' | 'campaign';

export interface GoalClassification {
  mode: GoalMode;
  goalRatioPercent: number;
  isFeasible: boolean;
  reasoning: string;

  // Mode-specific parameters
  maxRiskPerTradePct: number;
  expectedTradeCount: number;
  targetRiskRewardRange: [number, number];

  // CCIP-2026-03-09: minConfidenceThreshold is always MINIMUM_TRADE_CONFIDENCE (60).
  // best-symbol-selector.ts is the single confidence gate authority.
  minConfidenceThreshold: number;

  // Execution guidance
  executionPsychology: string;
  userMessage: string;
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
  PRECISION_MAX: 2.0,   // ≤ 2%: Precision Mode
  EXECUTION_MAX: 10.0,  // 2-10%: Execution Mode
  // > 10%: Campaign Mode (no upper limit — Alpha always executes)
} as const;

// ============================================================
// MODE CONFIGURATIONS
// ============================================================

const MODE_CONFIGS = {
  precision: {
    maxRiskPerTradePct: 0.8,
    expectedTradeCount: 1,
    targetRiskRewardRange: [1.5, 2.0] as [number, number],
    executionPsychology: 'surgical',
    description: 'One clean trade. No ego. Precision beats power.'
  },

  execution: {
    maxRiskPerTradePct: 1.5,
    expectedTradeCount: 3,
    targetRiskRewardRange: [2.0, 2.5] as [number, number],
    executionPsychology: 'disciplined',
    description: 'Professional execution through sequenced wins. 2-4 quality trades.'
  },

  campaign: {
    maxRiskPerTradePct: 1.0,
    expectedTradeCount: 8,
    targetRiskRewardRange: [2.0, 3.0] as [number, number],
    executionPsychology: 'patient',
    description: 'Multi-session campaign. Consistency over speed.'
  },
} as const;

// ============================================================
// GOAL INTELLIGENCE CLASSIFIER
// ============================================================

class GoalIntelligenceClassifier {

  /**
   * Main classification function - evaluates goal BEFORE any trade planning.
   * CCIP-2026-03-09: Never blocks execution. Returns execution psychology only.
   */
  classify(context: GoalContext): GoalClassification {
    const { goalAmount, accountBalance } = context;

    const goalRatioPercent = (goalAmount / accountBalance) * 100;
    const mode = this.determineMode(goalRatioPercent);
    const config = MODE_CONFIGS[mode];

    const classification: GoalClassification = {
      mode,
      goalRatioPercent,
      isFeasible: true, // CCIP-2026-03-09: All goals are feasible — Alpha always executes
      reasoning: this.buildReasoning(mode, goalRatioPercent, goalAmount, accountBalance),

      maxRiskPerTradePct: config.maxRiskPerTradePct,
      expectedTradeCount: config.expectedTradeCount,
      targetRiskRewardRange: config.targetRiskRewardRange,

      // SSOT: Confidence gate lives in best-symbol-selector.ts via ALPHA_IDENTITY.
      // This value is informational for planning prompts only — never enforced here.
      minConfidenceThreshold: ALPHA_IDENTITY.MINIMUM_TRADE_CONFIDENCE,

      executionPsychology: config.executionPsychology,
      userMessage: this.buildUserMessage(mode, goalAmount, accountBalance, goalRatioPercent),
    };

    logger.info(LogCategory.AI_TRADING,
      `[Goal Intelligence] Classified $${goalAmount} goal on $${accountBalance} balance as ${mode.toUpperCase()} (${goalRatioPercent.toFixed(1)}%)`
    );

    return classification;
  }

  /**
   * Determine goal mode based on goal ratio.
   * CCIP-2026-03-09: Campaign mode has no upper cap — replaces removed growth mode.
   */
  private determineMode(goalRatioPercent: number): GoalMode {
    if (goalRatioPercent <= MODE_THRESHOLDS.PRECISION_MAX) {
      return 'precision';
    }

    if (goalRatioPercent <= MODE_THRESHOLDS.EXECUTION_MAX) {
      return 'execution';
    }

    return 'campaign';
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
    }
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

    if (goalRatioPercent <= MODE_THRESHOLDS.PRECISION_MAX) {
      const efficiencyMultiplier = 1.5;
      const goalEfficientRiskDollars = goalAmount * efficiencyMultiplier;
      const goalEfficientRiskPercent = (goalEfficientRiskDollars / accountBalance) * 100;

      return {
        goalEfficientRiskDollars,
        goalEfficientRiskPercent,
        reasoning: `Goal is only ${goalRatioPercent.toFixed(1)}% of balance. ` +
                   `Risk capped to ${efficiencyMultiplier}x goal for capital efficiency (precision mode).`
      };
    }

    const standardRiskDollars = goalAmount / targetRiskReward;
    const standardRiskPercent = (standardRiskDollars / accountBalance) * 100;

    return {
      goalEfficientRiskDollars: standardRiskDollars,
      goalEfficientRiskPercent: standardRiskPercent,
      reasoning: `Standard risk calculation: $${goalAmount.toFixed(2)} goal / ${targetRiskReward}:1 R:R = $${standardRiskDollars.toFixed(2)} risk`
    };
  }

  /**
   * Validate if a proposed trade respects goal classification.
   * CCIP-2026-03-09: Confidence threshold check removed — not enforced here.
   * Confidence gate is solely the responsibility of best-symbol-selector.ts.
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

    if (proposedTrade.riskPercent > classification.maxRiskPerTradePct) {
      violations.push(
        `Risk ${proposedTrade.riskPercent.toFixed(1)}% exceeds ${classification.mode} mode maximum ` +
        `(${classification.maxRiskPerTradePct.toFixed(1)}%)`
      );
    }

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

    return {
      isValid: violations.length === 0,
      violations,
      warnings
    };
  }
}

export const goalIntelligenceClassifier = new GoalIntelligenceClassifier();
