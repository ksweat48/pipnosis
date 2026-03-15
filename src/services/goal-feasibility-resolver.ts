import { GOAL_FEASIBILITY_CONFIG } from '../config/goal-feasibility-config';
import {
  DownshiftProposal,
  FeasibilityResult,
  VolatilityContext,
  AdjustedTradeParameters,
  GoalFeasibilityAnalysis,
} from '../types/goal-feasibility';
import { MeaningfulTradeCalculator } from './meaningful-trade-calculator';
import { GoalFeasibilityAuditLogger } from './goal-feasibility-audit-logger';
import { logger } from '../lib/logger';
import { supabase } from '../lib/supabase';
import { TRADING_CONSTANTS } from '../config/trading-constants';
import { getCurrencyPipInfo } from '../utils/currencyHelpers';
import { logSSOTCorruption } from '../types/ssot-diagnostics';
import { estimationRiskCalculator } from './estimation-risk-calculator';

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
      // GOVERNANCE COMPLIANCE: No compound reductions
      // Use growthModeThreshold directly, not *0.8
      // This is a SIZE advisory, not a capacity issue

      const proposedGoal = growthModeThreshold; // Use threshold as proposed goal

      logger.warn('Large goal detected - applying governance framework', {
        requestedGoal: remainingGoal,
        proposedGoal,
        threshold: growthModeThreshold,
        reason: 'Goal size recommendation - not a technical blocker'
      });

      return {
        feasible: true,
        tier: 'EXECUTE_REDUCED',
        proposal: {
          reducedGoal: proposedGoal,
          retentionPercent: proposedGoal / remainingGoal,
          reason: `Goal ($${remainingGoal.toFixed(2)}) recommendation: Consider $${proposedGoal.toFixed(2)} (${((proposedGoal / remainingGoal) * 100).toFixed(0)}% of requested) to align with account sizing best practices. Not a blocker.`,
          advisoryMessage: `ADVISORY: Large goal suggestion. Alpha retains authority to accept full goal or propose reduction. No forced reduction.`,
          governanceNote: 'Goal size tracked for risk management learning'
        },
        alternativeSuggestions: [
          `Accept suggested reduction to $${proposedGoal.toFixed(2)}`,
          `Proceed with full $${remainingGoal.toFixed(2)} goal (Alpha authority)`,
          `Break into multiple staged sessions`,
        ],
      };
    }

    const maxProfitPossible = this.calculateMaxDeliverableProfit(
      currentATR,
      safeSpread,
      accountBalance,
      currentPrice,
      symbol,
      dollarRisk // Pass user's Trade Style risk selection
    );

    logger.debug('Max deliverable profit calculated', {
      currentATR,
      currentSpread: safeSpread,
      maxProfitPossible,
      remainingGoal,
    });

    if (!maxProfitPossible || isNaN(maxProfitPossible) || maxProfitPossible <= 0) {
      logger.error('Invalid maxProfitPossible in feasibility analysis', {
        maxProfitPossible,
        adjustedATR,
        safeSpread,
        symbol
      });
      return {
        feasible: false,
        tier: 'BLOCK_WITH_ALTERNATIVES',
        proposal: undefined,
        alternativeSuggestions: ['Unable to calculate profit potential - market data may be invalid. Please refresh and try again.'],
      };
    }

    const retentionPercent = maxProfitPossible / remainingGoal;

    if (!retentionPercent || isNaN(retentionPercent)) {
      logger.error('Invalid retentionPercent calculated', {
        maxProfitPossible,
        remainingGoal,
        retentionPercent
      });
      return {
        feasible: false,
        tier: 'BLOCK_WITH_ALTERNATIVES',
        proposal: undefined,
        alternativeSuggestions: ['Unable to assess goal feasibility. Please try again.'],
      };
    }

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
        // GOVERNANCE COMPLIANCE: No compound reductions
        // Do not apply *0.8 - use maxProfitPossible directly
        // Volatility context is logged but not used as excuse for aggressive reduction

        logger.warn('Low volatility detected - proceeding with governance logging', {
          atrMultiplier,
          maxProfitPossible,
          volatilityContext: `${(atrMultiplier * 100).toFixed(0)}% of typical`
        });

        return {
          feasible: true,
          tier: 'EXECUTE_REDUCED',
          proposal: {
            reducedGoal: maxProfitPossible,
            retentionPercent: maxProfitPossible / remainingGoal,
            reason: `Market volatility is ${(atrMultiplier * 100).toFixed(0)}% of typical. Goal will be $${maxProfitPossible.toFixed(2)} with intelligent monitoring. Alpha approves execution or rejects.`,
            advisoryMessage: `ADVISORY: Low volatility period (${(atrMultiplier * 100).toFixed(0)}% of typical). Proceeding with logged degradation. No silent mutations.`,
            governanceNote: 'Volatility context tracked for post-trade learning'
          },
          alternativeSuggestions: [
            `Accept trade with governance monitoring`,
            `Wait for higher volatility (ATR > ${(safeTypicalATR).toFixed(2)})`,
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

      // GOVERNANCE COMPLIANCE: CCIP - Do NOT compound reductions
      // Use maxProfitPossible directly instead of *0.9 which causes cascading pessimism
      // Trade degradation should be INTELLIGENT and LOGGED, not silent
      // Alpha has final authority to approve or reject this proposal

      const proposedReducedGoal = maxProfitPossible; // SSOT: Use actual max, not reduced max

      return {
        feasible: true, // Changed from false to true (advisory)
        tier: 'EXECUTE_REDUCED',
        proposal: {
          reducedGoal: proposedReducedGoal,
          retentionPercent: proposedReducedGoal / remainingGoal,
          reason: `Market conditions can realistically deliver $${proposedReducedGoal.toFixed(2)} per trade (${(retentionPercent * 100).toFixed(0)}% of requested $${remainingGoal.toFixed(2)}). This is achievable with proper position sizing.`,
          advisoryMessage: `ADVISORY: Goal will be intelligently tracked and logged. No silent mutations. Alpha validates final execution.`,
          governanceNote: 'Goal degradation will be logged to goal_target_audit with reason and severity for governance review'
        },
        alternativeSuggestions: [
          `Accept reduced goal: $${proposedReducedGoal.toFixed(2)} per trade`,
          `Request new session when volatility increases`,
          `Consider splitting across multiple trades`,
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

    // Trade frequency is logged for learning but never applies a penalty
    // Philosophy: Users can trade as often as they want. Frequency is informational.
    const recentTradeCount = await this.getRecentTradeCount(userId, sessionId);

    logger.info('Trade frequency context (informational only)', {
      recentTradeCount,
      sessionId,
      userId,
      message: 'No penalty applied - frequency is learning signal only'
    });

    const adjustedTrade: AdjustedTradeParameters = {
      targetProfit: adjustedGoal,
      stopLoss: this.calculateStopLoss(currentATR, currentPrice),
      riskReward: this.calculateRiskReward(adjustedGoal, currentATR),
      // CCIP-2026-03-15: Alpha owns duration. Placeholder 120 min for downshift display only.
      timeToFillMinutes: 120,
      positionSize: this.calculatePositionSize(
        adjustedGoal,
        currentATR,
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

    const atrMultiplier = safeTypicalATR > 0 ? currentATR / safeTypicalATR : 1;
    const mechanismsEvaluated = [
      'MARKET_CAPACITY',
      'MEANINGFUL_TRADE_FLOORS',
      'GOAL_SIZE_CHECK',
    ];
    const mechanismsApplied = [];
    if (retentionPercent < 1) {
      mechanismsApplied.push('GOAL_CAPACITY_RECOMMENDATION');
    }

    (async () => {
      await GoalFeasibilityAuditLogger.logDecision({
        userId,
        sessionId,
        symbol,
        goalRequested: remainingGoal,
        goalRecommended: adjustedGoal,
        mechanismsEvaluated,
        mechanismsSuppressed: [],
        mechanismsApplied,
        atrValue: currentATR,
        atrTypical: safeTypicalATR,
        atrMultiplier,
        sessionLiquidity,
        currentSpread: safeSpread,
        accountBalance,
        minGoalRetentionMet: retentionPercent >= GOAL_FEASIBILITY_CONFIG.downshift.minGoalRetentionPercent,
        meaningfulTradeFloorDetails: meaningfulnessChecks,
        volatilityAdvisoryApplied: atrMultiplier < GOAL_FEASIBILITY_CONFIG.waitConditions.minATRMultiplierRequired,
        goalSizeAdvisoryApplied: remainingGoal > growthModeThreshold,
        userChoice: 'accept_recommended',
        suppressedMechanismsReason: {},
        reductionBreakdown: {
          originalGoal: remainingGoal,
          recommendedGoal: adjustedGoal,
          retentionPercent: retentionPercent * 100,
        },
        governanceNotes: 'CCIP-compliant decision with transparent mechanisms',
      });
    })();

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
    // ✅ ARCHITECTURE NOTE: This is ADVISORY position calculation for feasibility testing
    // NOT execution position sizing (which is handled by ProfessionalRiskManager)
    // This function calculates "what's theoretically achievable in market" for advisory only
    // Alpha Execution Planner and Trade Execution Engine must use ProfessionalRiskManager

    // ✅ CRITICAL FIX: ATR Unit Conversion + SSOT Dollar-Per-Pip Usage
    // BUG 1: adjustedATR is in PRICE UNITS, must convert to PIPS
    // BUG 2: pipInfo.pipSize doesn't exist, must use pipInfo.dollarPerPipPerLot
    //
    // Example - ETHUSD:
    // - adjustedATR = 4.039 (price units)
    // - pipValue = 0.1 (1 pip = 0.1 price units)
    // - atrInPips = 4.039 / 0.1 = 40.39 pips ✅
    //
    // CORRECT: Convert ATR to pips, then use SSOT dollarPerPipPerLot

    const pipInfo = getCurrencyPipInfo(symbol);

    // Convert ATR from price units to pips (SSOT: use pipValue from currency helpers)
    const atrInPips = adjustedATR / pipInfo.pipValue;
    const slPips = atrInPips * 2; // Standard SL: 2x ATR in pips
    const tpPips = atrInPips * 3; // Conservative TP: 3x ATR in pips

    // Validate pip conversion produced reasonable values
    if (isNaN(atrInPips) || atrInPips <= 0 || atrInPips > 1000) {
      logSSOTCorruption({
        type: 'INVALID_ATR_CONVERSION',
        severity: 'ERROR',
        symbol,
        adjustedATR,
        pipValue: pipInfo.pipValue,
        atrInPips,
        callsite: 'goal-feasibility-resolver.ts:420',
        message: 'ATR to pip conversion produced invalid result'
      });
      return 0; // Cannot calculate profit with invalid ATR
    }

    // Calculate ACTUAL lot size using proper formula
    let actualLotSize: number;
    let riskPercentUsed: number;

    if (dollarRisk && accountBalance > 0) {
      // CORRECT FORMULA: lotSize = dollarRisk / (slPips × dollarPerPipPerLot)
      // SSOT: Use dollarPerPipPerLot from currency helpers (NOT pipValue * pipSize)
      const dollarPerPipPerLot = pipInfo.dollarPerPipPerLot;
      actualLotSize = dollarRisk / (slPips * dollarPerPipPerLot);
      riskPercentUsed = (dollarRisk / accountBalance) * 100;

      // SSOT_MATH_CORRUPTION diagnostic
      if (actualLotSize < 0.01 || isNaN(actualLotSize)) {
        logSSOTCorruption({
          type: 'INVALID_LOT_SIZE',
          severity: 'ERROR',
          symbol,
          dollarRisk,
          slPips,
          dollarPerPipPerLot,
          actualLotSize,
          callsite: 'goal-feasibility-resolver.ts:445',
          message: 'Lot size < 0.01 or NaN - check input values'
        });
        actualLotSize = 0.01; // Safety floor
      }

      logger.debug('[Feasibility] Position sizing (ATR CONVERSION FIXED)', {
        adjustedATR,
        atrInPips: atrInPips.toFixed(2),
        dollarRisk,
        slPips: slPips.toFixed(2),
        dollarPerPipPerLot: dollarPerPipPerLot.toFixed(4),
        actualLotSize: actualLotSize.toFixed(3),
        riskPercentUsed: riskPercentUsed.toFixed(2) + '%',
        accountBalance
      });
    } else {
      // PHASE 2: Use SSOT constant for fallback risk (already imported at top)
      const defaultRiskPercent = TRADING_CONSTANTS.RISK_PERCENTAGES.DEFAULT_PER_TRADE; // 0.02 (2%)

      // LEGACY: Fallback to default risk
      const dollarPerPipPerLot = pipInfo.dollarPerPipPerLot;
      actualLotSize = (accountBalance * defaultRiskPercent) / (slPips * dollarPerPipPerLot);
      riskPercentUsed = defaultRiskPercent * 100;

      logger.warn('[Feasibility] Using fallback 2% risk (dollarRisk not provided)', {
        accountBalance,
        atrInPips: atrInPips.toFixed(2),
        slPips: slPips.toFixed(2),
        actualLotSize: actualLotSize.toFixed(3)
      });
    }

    // Calculate profit using CORRECT formula: profit = tpPips × lotSize × dollarPerPipPerLot
    // SSOT: Use dollarPerPipPerLot directly (NOT pipValue * pipSize)
    const dollarPerPipPerLot = pipInfo.dollarPerPipPerLot;
    const grossProfit = tpPips * actualLotSize * dollarPerPipPerLot;
    const spreadCost = spread * actualLotSize * dollarPerPipPerLot;
    const netProfit = grossProfit - spreadCost;

    // SSOT_MATH_CORRUPTION diagnostic for suspiciously low profit
    if (netProfit < 1.0 && netProfit > 0) {
      logSSOTCorruption({
        type: 'LOW_PROFIT',
        severity: 'WARNING',
        symbol,
        atrInPips: atrInPips.toFixed(2),
        tpPips: tpPips.toFixed(2),
        actualLotSize: actualLotSize.toFixed(3),
        grossProfit: grossProfit.toFixed(2),
        spreadCost: spreadCost.toFixed(2),
        netProfit: netProfit.toFixed(2),
        callsite: 'goal-feasibility-resolver.ts:492',
        message: 'Net profit < $1 - verify TP distance and lot size are reasonable'
      });
    }

    logger.debug('[Feasibility] Max deliverable profit (ATR CONVERSION FIXED)', {
      adjustedATR,
      atrInPips: atrInPips.toFixed(2),
      slPips: slPips.toFixed(2),
      tpPips: tpPips.toFixed(2),
      actualLotSize: actualLotSize.toFixed(3),
      riskPercentUsed: riskPercentUsed.toFixed(2) + '%',
      dollarPerPipPerLot: dollarPerPipPerLot.toFixed(4),
      grossProfit: grossProfit.toFixed(2),
      spreadCost: spreadCost.toFixed(2),
      netProfit: netProfit.toFixed(2),
      symbol
    });

    return Math.max(0, netProfit);
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

  // ✅ PHASE 3.1 SECTION 3: Use EstimationRiskCalculator (SSOT for estimations)
  // Replaces local position sizing logic with centralized estimation service
  private static calculatePositionSize(
    targetProfit: number,
    adjustedATR: number,
    currentPrice: number
  ): number {
    return estimationRiskCalculator.estimateFromATR(targetProfit, adjustedATR, currentPrice);
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
