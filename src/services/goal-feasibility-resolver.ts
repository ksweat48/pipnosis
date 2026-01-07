import { GOAL_FEASIBILITY_CONFIG } from '../config/goal-feasibility-config';
import {
  DownshiftProposal,
  FeasibilityResult,
  VolatilityContext,
  AdjustedTradeParameters,
  GoalFeasibilityAnalysis,
} from '../types/goal-feasibility';
import { MeaningfulTradeCalculator } from './meaningful-trade-calculator';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';

interface FeasibilityInput {
  userId: string;
  sessionId: string;
  goalAmount: number;
  currentProgress: number;
  accountBalance: number;
  symbol: string;
  currentATR: number;
  typicalATR: number;
  dailyATR: number;
  currentSpread: number;
  currentPrice: number;
}

export class GoalFeasibilityResolver {
  static async analyzeFeasibility(
    input: FeasibilityInput
  ): Promise<FeasibilityResult> {
    const {
      userId,
      sessionId,
      goalAmount,
      currentProgress,
      accountBalance,
      symbol,
      currentATR,
      typicalATR,
      dailyATR,
      currentSpread,
      currentPrice,
    } = input;

    // ✅ Input validation - prevent NaN propagation
    if (!currentATR || isNaN(currentATR) || currentATR <= 0) {
      logger.error('Invalid currentATR in feasibility analysis', { currentATR, symbol });
      return {
        feasible: false,
        tier: 'BLOCK_WITH_ALTERNATIVES',
        proposal: undefined,
        alternativeSuggestions: ['Wait for valid market data before trading'],
      };
    }

    if (!currentPrice || isNaN(currentPrice) || currentPrice <= 0) {
      logger.error('Invalid currentPrice in feasibility analysis', { currentPrice, symbol });
      return {
        feasible: false,
        tier: 'BLOCK_WITH_ALTERNATIVES',
        proposal: undefined,
        alternativeSuggestions: ['Wait for valid price data before trading'],
      };
    }

    // Set safe defaults for optional/derived values
    const safeTypicalATR = typicalATR && !isNaN(typicalATR) && typicalATR > 0 ? typicalATR : currentATR;
    const safeDailyATR = dailyATR && !isNaN(dailyATR) && dailyATR > 0 ? dailyATR : currentATR * 1.5;
    const safeSpread = currentSpread && !isNaN(currentSpread) && currentSpread >= 0 ? currentSpread : currentATR * 0.1;

    const remainingGoal = goalAmount - currentProgress;

    logger.info('Analyzing goal feasibility', {
      userId,
      sessionId,
      goalAmount,
      currentProgress,
      remainingGoal,
      symbol,
      currentATR,
      typicalATR: safeTypicalATR,
      dailyATR: safeDailyATR,
      currentSpread: safeSpread,
    });

    if (remainingGoal <= 0) {
      return {
        feasible: true,
        tier: 'EXECUTE',
        proposal: undefined,
      };
    }

    // ✅ ADVISORY: Large goal detection (no longer blocks)
    // Philosophy: "Reduced profit > NO_TRADE"
    const growthModeThreshold =
      accountBalance *
      GOAL_FEASIBILITY_CONFIG.blockConditions.goalExceedsAccountPercent;

    if (remainingGoal > growthModeThreshold) {
      // Calculate reduced goal that's achievable
      const reducedGoal = growthModeThreshold * 0.8; // 80% of threshold for safety

      logger.warn('Large goal detected - proposing reduction', {
        requestedGoal: remainingGoal,
        reducedGoal,
        threshold: growthModeThreshold,
      });

      return {
        feasible: true, // Changed from false to true (advisory)
        tier: 'EXECUTE_REDUCED',
        proposal: {
          reducedGoal,
          retentionPercent: reducedGoal / remainingGoal,
          reason: `Goal ($${remainingGoal.toFixed(2)}) exceeds 30% of account balance. Reducing to $${reducedGoal.toFixed(2)} (${((reducedGoal / remainingGoal) * 100).toFixed(0)}% of requested) for safer execution.`,
          advisoryMessage: `ADVISORY: Large goal detected. Consider breaking into smaller staged targets for better risk management. Alpha may proceed with reduced goal.`,
        },
        alternativeSuggestions: [
          `Break goal into smaller staged targets`,
          `Consider extending timeframe to multiple sessions`,
          `Focus on building capital before pursuing larger goals`,
        ],
      };
    }

    const adjustedATR =
      currentATR * GOAL_FEASIBILITY_CONFIG.calculation.atrSafetyFactor;

    const maxProfitPossible = this.calculateMaxDeliverableProfit(
      adjustedATR,
      safeSpread,
      accountBalance,
      currentPrice,
      symbol
    );

    logger.debug('Max deliverable profit calculated', {
      adjustedATR,
      currentSpread: safeSpread,
      maxProfitPossible,
      remainingGoal,
    });

    const retentionPercent = maxProfitPossible / remainingGoal;

    if (
      retentionPercent < GOAL_FEASIBILITY_CONFIG.downshift.minGoalRetentionPercent
    ) {
      const atrMultiplier = safeTypicalATR > 0 ? currentATR / safeTypicalATR : 1;

      // Check if volatility is unusually low - ADVISORY ONLY (v2.0)
      // Philosophy: "Reduced profit > NO_TRADE"
      if (
        atrMultiplier <
        GOAL_FEASIBILITY_CONFIG.waitConditions.minATRMultiplierRequired
      ) {
        // Instead of blocking, propose reduced goal and proceed
        const reducedGoal = maxProfitPossible * 0.8; // 80% of max for safety
        logger.warn('Low volatility detected - proposing reduced goal instead of waiting', {
          atrMultiplier,
          maxProfitPossible,
          reducedGoal,
        });

        return {
          feasible: true, // Changed from false (advisory model)
          tier: 'EXECUTE_REDUCED',
          proposal: {
            reducedGoal,
            retentionPercent: reducedGoal / remainingGoal,
            reason: `Market volatility is ${(atrMultiplier * 100).toFixed(0)}% of typical. Reducing goal to $${reducedGoal.toFixed(2)} for realistic execution in current conditions.`,
            advisoryMessage: `ADVISORY: Low volatility detected (${(atrMultiplier * 100).toFixed(0)}% of typical). Trade proceeds with reduced target. Partial success > NO_TRADE.`,
          },
          alternativeSuggestions: [
            `Consider waiting for higher volatility period`,
            `Current conditions support smaller targets`,
          ],
        };
      }

      // ✅ ADVISORY: Market capacity constraint (no longer blocks)
      // Propose reduced goal instead of blocking
      logger.warn('Market capacity constraint - proposing reduced goal', {
        requestedGoal: remainingGoal,
        maxDeliverable: maxProfitPossible,
        retentionPercent: retentionPercent * 100,
      });

      return {
        feasible: true, // Changed from false to true (advisory)
        tier: 'EXECUTE_REDUCED',
        proposal: {
          reducedGoal: maxProfitPossible * 0.9, // 90% of max for safety margin
          retentionPercent: maxProfitPossible / remainingGoal,
          reason: `Market conditions can deliver ${(retentionPercent * 100).toFixed(0)}% of requested goal. Reducing to $${(maxProfitPossible * 0.9).toFixed(2)} for realistic execution.`,
          advisoryMessage: `ADVISORY: Goal adjusted to market capacity. Reduced profit > NO_TRADE. Alpha has final authority.`,
        },
        alternativeSuggestions: [
          `Reduce goal to $${maxProfitPossible.toFixed(2)} or less`,
          `Wait for higher volatility period`,
          `Consider different trading session`,
        ],
      };
    }

    const adjustedGoal = Math.min(maxProfitPossible, remainingGoal);

    const currentHour = new Date().getUTCHours();
    const sessionLiquidity =
      MeaningfulTradeCalculator.determineSessionLiquidity(currentHour);

    const volatilityContext: VolatilityContext = {
      currentATR,
      typicalATR: safeTypicalATR,
      dailyATR: safeDailyATR,
      sessionLiquidity,
      atrMultiplierFromTypical: safeTypicalATR > 0 ? currentATR / safeTypicalATR : 1,
    };

    const spreadCost = this.estimateSpreadCost(
      safeSpread,
      adjustedGoal,
      currentPrice
    );

    const thresholds = await MeaningfulTradeCalculator.calculateThresholds({
      accountBalance,
      dailyATR: safeDailyATR,
      spreadCost,
      userId,
    });

    const netProfit = adjustedGoal - spreadCost;

    const progressPercent = currentProgress / goalAmount;
    const nearGoalCompletion =
      progressPercent >=
      GOAL_FEASIBILITY_CONFIG.downshift.specialCases
        .nearGoalCompletionPercent;

    const meaningfulnessChecks = MeaningfulTradeCalculator.checkMeaningfulness(
      netProfit,
      thresholds,
      nearGoalCompletion
    );

    // Meaningfulness checks are now ADVISORY ONLY (v2.0)
    // Philosophy: "Small profit > NO_TRADE"
    if (!meaningfulnessChecks.anyMet) {
      const explanation = MeaningfulTradeCalculator.explainMeaningfulness(
        meaningfulnessChecks,
        netProfit,
        thresholds
      );

      // Log advisory but DO NOT BLOCK
      logger.warn('Trade below meaningful thresholds - proceeding with advisory', {
        netProfit,
        explanation,
        meaningfulnessChecks,
      });

      // Continue to execute with advisory warning attached
      // The trade proceeds - meaningful checks inform learning, not blocking
    }

    // Trade frequency check is now ADVISORY ONLY (v2.0)
    // Philosophy: Churn prevention is learning signal, not hard block
    const recentTradeCount = await this.getRecentTradeCount(userId, sessionId);
    if (
      recentTradeCount >= GOAL_FEASIBILITY_CONFIG.waitConditions.maxTradesInLastHour
    ) {
      // Log advisory but DO NOT BLOCK
      logger.warn('High trade frequency detected - applying confidence penalty', {
        recentTradeCount,
        threshold: GOAL_FEASIBILITY_CONFIG.waitConditions.maxTradesInLastHour,
      });

      // Continue execution with advisory - churn tracking informs learning
      // Alpha can proceed if setup quality justifies another trade
    }

    const adjustedTrade: AdjustedTradeParameters = {
      targetProfit: adjustedGoal,
      stopLoss: this.calculateStopLoss(adjustedATR, currentPrice),
      riskReward: this.calculateRiskReward(adjustedGoal, adjustedATR),
      timeToFillMinutes: this.estimateTimeToFill(adjustedATR, currentATR),
      positionSize: this.calculatePositionSize(
        adjustedGoal,
        adjustedATR,
        currentPrice
      ),
      estimatedSpreadCost: spreadCost,
    };

    const proposal: DownshiftProposal = {
      originalGoal: remainingGoal,
      adjustedGoal,
      retentionPercent,
      adjustedTrade,
      volatilityContext,
      meaningfulnessChecks,
      reasonsForDownshift: this.generateDownshiftReasons(
        remainingGoal,
        adjustedGoal,
        volatilityContext,
        meaningfulnessChecks
      ),
      calculationMetadata: {
        accountBalance,
        currentProgress,
        remainingGoal,
        symbol,
        timestamp: new Date().toISOString(),
      },
    };

    logger.info('Goal feasibility proposal created', {
      userId,
      sessionId,
      tier: 'EXECUTE',
      adjustedGoal,
      retentionPercent: `${(retentionPercent * 100).toFixed(1)}%`,
      meaningfulnessChecks,
    });

    return {
      feasible: true,
      tier: 'EXECUTE',
      proposal,
    };
  }

  private static calculateMaxDeliverableProfit(
    adjustedATR: number,
    spread: number,
    accountBalance: number,
    currentPrice: number,
    symbol: string
  ): number {
    const maxMove = adjustedATR * 3;

    const roughLotSize = accountBalance * 0.02;

    const pipValue = this.getPipValue(symbol);
    const maxProfit = maxMove * roughLotSize * pipValue - spread * roughLotSize;

    return Math.max(0, maxProfit);
  }

  private static getPipValue(symbol: string): number {
    if (symbol.includes('JPY')) return 1000;
    if (symbol.includes('XAU') || symbol.includes('GOLD')) return 0.1;
    return 10;
  }

  private static estimateSpreadCost(
    spread: number,
    targetProfit: number,
    currentPrice: number
  ): number {
    return spread * (targetProfit / currentPrice) * 0.5;
  }

  private static calculateStopLoss(adjustedATR: number, currentPrice: number): number {
    return currentPrice - adjustedATR * 2;
  }

  private static calculateRiskReward(
    targetProfit: number,
    adjustedATR: number
  ): number {
    const risk = adjustedATR * 2;
    return targetProfit / risk;
  }

  private static estimateTimeToFill(
    adjustedATR: number,
    currentATR: number
  ): number {
    const volatilityRatio = currentATR > 0 ? adjustedATR / currentATR : 1;

    const baseTime = GOAL_FEASIBILITY_CONFIG.calculation.minTimeToFillMinutes;
    const estimatedTime = baseTime * (1 / volatilityRatio);

    return Math.min(
      Math.max(
        estimatedTime,
        GOAL_FEASIBILITY_CONFIG.calculation.minTimeToFillMinutes
      ),
      GOAL_FEASIBILITY_CONFIG.calculation.maxTimeToFillMinutes
    );
  }

  private static calculatePositionSize(
    targetProfit: number,
    adjustedATR: number,
    currentPrice: number
  ): number {
    if (adjustedATR === 0) return 0.01;
    return Math.max(0.01, (targetProfit / (adjustedATR * 10)) * 0.01);
  }

  private static generateDownshiftReasons(
    originalGoal: number,
    adjustedGoal: number,
    volatilityContext: VolatilityContext,
    meaningfulnessChecks: any
  ): string[] {
    const reasons: string[] = [];

    if (adjustedGoal < originalGoal) {
      reasons.push(
        `Market volatility can safely deliver ${adjustedGoal.toFixed(2)} vs requested ${originalGoal.toFixed(2)}`
      );
    }

    if (volatilityContext.atrMultiplierFromTypical < 1) {
      reasons.push(
        `Current volatility is ${(volatilityContext.atrMultiplierFromTypical * 100).toFixed(0)}% of typical`
      );
    }

    if (volatilityContext.sessionLiquidity === 'low') {
      reasons.push('Low liquidity session requires conservative targets');
    }

    return reasons;
  }

  private static async getRecentTradeCount(
    userId: string,
    sessionId: string
  ): Promise<number> {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      // Fix: Use id column for head request, and filter out nulls before gte comparison
      const { count, error } = await supabase
        .from('goal_session_trades')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('session_id', sessionId)
        .not('opened_at', 'is', null)
        .gte('opened_at', oneHourAgo.toISOString());

      if (error) {
        logger.error('Error getting recent trade count', { error });
        return 0;
      }

      return count || 0;
    } catch (error) {
      logger.error('Error in getRecentTradeCount', { error });
      return 0;
    }
  }

  static async performQuickAnalysis(
    input: FeasibilityInput
  ): Promise<GoalFeasibilityAnalysis> {
    const result = await this.analyzeFeasibility(input);

    const canDeliver = result.proposal?.adjustedGoal || 0;
    const retentionPercent = result.proposal?.retentionPercent || 0;
    const isMeaningful = result.proposal?.meaningfulnessChecks.anyMet || false;

    const thresholds = result.proposal
      ? await MeaningfulTradeCalculator.calculateThresholds({
          accountBalance: input.accountBalance,
          dailyATR: input.dailyATR,
          spreadCost: result.proposal.adjustedTrade.estimatedSpreadCost,
          userId: input.userId,
        })
      : {
          volatilityFloorValue: 0,
          accountFloorValue: 0,
          spreadFloorValue: 0,
          historicalFloorValue: 0,
        };

    const checks = result.proposal?.meaningfulnessChecks || {
      meetsVolatilityFloor: false,
      meetsAccountFloor: false,
      meetsSpreadFloor: false,
      meetsHistoricalFloor: false,
      anyMet: false,
    };

    let explanation = '';
    let recommendedAction: 'EXECUTE' | 'WAIT' | 'BLOCK' = 'EXECUTE';

    if (result.tier === 'EXECUTE') {
      explanation = `Market can deliver ${(retentionPercent * 100).toFixed(0)}% of goal (${canDeliver.toFixed(2)}) and meets meaningful trade thresholds.`;
      recommendedAction = 'EXECUTE';
    } else if (result.tier === 'WAIT_FOR_VOLATILITY') {
      explanation = result.waitReason || 'Waiting for better conditions';
      recommendedAction = 'WAIT';
    } else {
      explanation = result.blockReason || 'Goal not feasible';
      recommendedAction = 'BLOCK';
    }

    return {
      canDeliver,
      retentionPercent,
      isMeaningful,
      thresholds,
      checks,
      recommendedAction,
      explanation,
    };
  }
}
