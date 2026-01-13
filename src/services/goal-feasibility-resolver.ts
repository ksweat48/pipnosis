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
import { TRADING_CONSTANTS } from '../config/trading-constants';
import { getCurrencyPipInfo } from '../utils/currencyHelpers';
import { logSSOTCorruption } from '../types/ssot-diagnostics';

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
  // NEW: User's selected dollar risk from Trade Style system
  // Used to calculate dynamic risk percentage instead of hardcoded 2%
  dollarRisk?: number;
  tradeStyle?: string; // For validation and logging context
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
      dollarRisk,
      tradeStyle,
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

    // Validate risk amount if provided
    if (dollarRisk && accountBalance > 0) {
      const validation = this.validateRiskAgainstStyleLimits(dollarRisk, accountBalance, tradeStyle);
      if (!validation.valid) {
        logger.error('[Feasibility] Invalid risk amount', {
          dollarRisk,
          accountBalance,
          tradeStyle,
          error: validation.warning
        });
      } else if (validation.warning) {
        logger.warn('[Feasibility] Risk validation warning', {
          dollarRisk,
          accountBalance,
          tradeStyle,
          riskPercent: validation.riskPercent.toFixed(2) + '%',
          warning: validation.warning
        });
      }
    }

    // Set safe defaults for optional/derived values
    const safeTypicalATR = typicalATR && !isNaN(typicalATR) && typicalATR > 0 ? typicalATR : currentATR;
    const safeDailyATR = dailyATR && !isNaN(dailyATR) && dailyATR > 0 ? dailyATR : currentATR * 1.5;
    const safeSpread = currentSpread && !isNaN(currentSpread) && currentSpread >= 0 ? currentSpread : currentATR * 0.1;

    const remainingGoal = goalAmount - currentProgress;

    // Calculate risk percentage from user's Trade Style selection
    const riskPercentage = dollarRisk && accountBalance > 0
      ? (dollarRisk / accountBalance) * 100
      : 2.0; // Fallback to 2% default if not provided

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
      dollarRisk,
      tradeStyle,
      calculatedRiskPercent: riskPercentage.toFixed(2) + '%',
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
      symbol,
      dollarRisk // Pass user's Trade Style risk selection
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
    symbol: string,
    dollarRisk?: number
  ): number {
    // ✅ CRITICAL FIX: Proper position sizing math using SSOT principles
    // BUG WAS: roughLotSize = dollarRisk ($255 treated as lot size!)
    // CORRECT: Calculate actual lot size from dollar risk and SL distance

    const pipInfo = this.getPipInfo(symbol);
    const slPips = adjustedATR * 2; // Standard SL: 2x ATR
    const tpPips = adjustedATR * 3; // Conservative TP: 3x ATR

    // Calculate ACTUAL lot size using proper formula
    let actualLotSize: number;
    let riskPercentUsed: number;

    if (dollarRisk && accountBalance > 0) {
      // CORRECT FORMULA: lotSize = dollarRisk / (slPips × pipValuePerLot)
      const pipValuePerLot = pipInfo.pipValue * pipInfo.pipSize;
      actualLotSize = dollarRisk / (slPips * pipValuePerLot);
      riskPercentUsed = (dollarRisk / accountBalance) * 100;

      // SSOT_MATH_CORRUPTION diagnostic
      if (actualLotSize < 0.01 || isNaN(actualLotSize)) {
        logSSOTCorruption({
          type: 'INVALID_LOT_SIZE',
          severity: 'ERROR',
          symbol,
          dollarRisk,
          slPips,
          pipValuePerLot,
          actualLotSize,
          callsite: 'goal-feasibility-resolver.ts:394',
          message: 'Lot size < 0.01 or NaN - check input values'
        });
        actualLotSize = 0.01; // Safety floor
      }

      logger.debug('[Feasibility] Position sizing (CORRECTED)', {
        dollarRisk,
        slPips: slPips.toFixed(2),
        pipValuePerLot: pipValuePerLot.toFixed(4),
        actualLotSize: actualLotSize.toFixed(3),
        riskPercentUsed: riskPercentUsed.toFixed(2) + '%',
        accountBalance
      });
    } else {
      // LEGACY: Fallback to 2% risk
      const pipValuePerLot = pipInfo.pipValue * pipInfo.pipSize;
      actualLotSize = (accountBalance * 0.02) / (slPips * pipValuePerLot);
      riskPercentUsed = 2.0;

      logger.warn('[Feasibility] Using fallback 2% risk (dollarRisk not provided)', {
        accountBalance,
        actualLotSize: actualLotSize.toFixed(3)
      });
    }

    // Calculate profit using CORRECT formula: profit = tpPips × lotSize × pipValuePerLot
    const pipValuePerLot = pipInfo.pipValue * pipInfo.pipSize;
    const grossProfit = tpPips * actualLotSize * pipValuePerLot;
    const spreadCost = spread * actualLotSize * pipValuePerLot;
    const netProfit = grossProfit - spreadCost;

    // SSOT_MATH_CORRUPTION diagnostic for suspiciously low profit
    if (netProfit < 1.0 && netProfit > 0) {
      logSSOTCorruption({
        type: 'LOW_PROFIT',
        severity: 'WARNING',
        symbol,
        tpPips: tpPips.toFixed(2),
        actualLotSize: actualLotSize.toFixed(3),
        grossProfit: grossProfit.toFixed(2),
        spreadCost: spreadCost.toFixed(2),
        netProfit: netProfit.toFixed(2),
        callsite: 'goal-feasibility-resolver.ts:438',
        message: 'Net profit < $1 - verify TP distance and lot size are reasonable'
      });
    }

    logger.debug('[Feasibility] Max deliverable profit (CORRECTED)', {
      adjustedATR,
      slPips: slPips.toFixed(2),
      tpPips: tpPips.toFixed(2),
      actualLotSize: actualLotSize.toFixed(3),
      riskPercentUsed: riskPercentUsed.toFixed(2) + '%',
      pipValuePerLot: pipValuePerLot.toFixed(4),
      grossProfit: grossProfit.toFixed(2),
      spreadCost: spreadCost.toFixed(2),
      netProfit: netProfit.toFixed(2),
      symbol
    });

    return Math.max(0, netProfit);
  }

  private static getPipInfo(symbol: string): { pipValue: number; pipSize: number } {
    // SSOT: Delegate to currency helpers
    const pipInfo = getCurrencyPipInfo(symbol);
    return {
      pipValue: pipInfo.pipValue,
      pipSize: pipInfo.pipSize
    };
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

      // Fix: .gte() filter implicitly excludes NULL values
      const { count, error } = await supabase
        .from('goal_session_trades')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('goal_session_id', sessionId)
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

  /**
   * Calculate risk percentage from dollar amount
   * Used for validation and logging
   */
  static calculateRiskPercentage(dollarRisk: number, accountBalance: number): number {
    if (accountBalance <= 0) return 0;
    return (dollarRisk / accountBalance) * 100;
  }

  /**
   * Validate risk amount against Trade Style maximums
   * Returns warning if risk exceeds expected limits for the style
   */
  static validateRiskAgainstStyleLimits(
    dollarRisk: number,
    accountBalance: number,
    tradeStyle?: string
  ): { valid: boolean; warning?: string; riskPercent: number } {
    const riskPercent = this.calculateRiskPercentage(dollarRisk, accountBalance);

    // SSOT: Platform absolute limits from trading-constants.ts
    const maxRiskPercent = TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_PER_TRADE * 100;
    if (riskPercent > maxRiskPercent) {
      return {
        valid: false,
        warning: `Risk ${riskPercent.toFixed(2)}% exceeds platform maximum of ${maxRiskPercent}%`,
        riskPercent
      };
    }

    if (riskPercent < 1) {
      return {
        valid: false,
        warning: `Risk ${riskPercent.toFixed(2)}% below platform minimum of 1%`,
        riskPercent
      };
    }

    // Trade Style specific limits
    const styleUpper = tradeStyle?.toUpperCase();
    if (styleUpper?.includes('SCALP') && riskPercent > 5) {
      return {
        valid: true,
        warning: `Risk ${riskPercent.toFixed(2)}% exceeds Scalp style maximum of 5% (aggressive)`,
        riskPercent
      };
    }

    if (styleUpper?.includes('MICRO') && riskPercent > 7) {
      return {
        valid: true,
        warning: `Risk ${riskPercent.toFixed(2)}% exceeds Micro style maximum of 7% (aggressive)`,
        riskPercent
      };
    }

    if (styleUpper?.includes('INTRADAY') && riskPercent > 10) {
      return {
        valid: true,
        warning: `Risk ${riskPercent.toFixed(2)}% exceeds Intraday style maximum of 10% (aggressive)`,
        riskPercent
      };
    }

    return { valid: true, riskPercent };
  }
}
