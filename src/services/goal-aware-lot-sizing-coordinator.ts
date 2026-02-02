/**
 * Goal-Aware Lot Sizing Coordinator
 *
 * SSOT (Single Source of Truth) for goal-aware position sizing decisions
 *
 * CRITICAL ARCHITECTURE:
 * This is the ONLY place where lot size decisions are made when a goal is active.
 * It orchestrates between:
 * 1. Goal requirements (what lot size reaches the goal?)
 * 2. Risk constraints (what's the maximum safe lot size?)
 * 3. Market reality (can the market deliver the goal?)
 *
 * CCIP COMPLIANCE:
 * - Every decision logged to audit trail
 * - Reasoning transparent and immutable
 * - Three lot sizes tracked: required_for_goal, safe_from_risk, chosen
 *
 * GOVERNANCE:
 * - All decisions recorded in goal_aware_lot_sizing_decisions table
 * - Post-trade learning: compare expected vs actual
 * - Feedback loop for improving goal projections
 */

import { supabase } from '../lib/supabase';
import { logger, LogCategory } from '../lib/logger';
import {
  calculateGoalAwareLotSize,
  getCurrencyPipInfo,
  calculateDollarPerPip,
} from '../utils/currencyHelpers';
import { percentageToRiskMode, getRiskModeDescription } from '../config/risk-percentage-mapping';
import { TradeContext } from '../types/trade-context';

export interface GoalAwareLotSizingInput {
  userId: string;
  goalSessionId: string;
  symbol: string;
  direction: 'long' | 'short';
  accountBalance: number;
  goalAmount: number;
  currentProgress: number;
  riskPercentageAllowed: number; // e.g., 5 for 5%
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  tradeContext: TradeContext;
}

export interface GoalAwareLotSizingDecision {
  chosenLotSize: number; // The lot size to use
  requiredLotForGoal: number; // What's needed for goal
  safeLotFromRisk: number; // What risk constraints allow
  decisionReason:
    | 'goal_achievable_within_risk'
    | 'goal_requires_more_risk'
    | 'market_cannot_deliver_goal'
    | 'fallback_risk_constraint'
    | 'degraded_to_safe_lot';
  expectedProfitAtTP: number;
  expectedLossAtSL: number;
  expectedRiskDollars: number;
  auditRecordId?: string;
  reasoning: string;
}

class GoalAwareLotSizingCoordinator {
  /**
   * Calculate lot size considering both goal requirements and risk constraints
   *
   * ALGORITHM:
   * 1. Calculate required lot to reach goal
   * 2. Calculate safe lot from risk constraints
   * 3. Choose the maximum safe lot that doesn't violate risk
   * 4. If required lot <= safe lot: AFFIRM (achieve goal)
   * 5. If required lot > safe lot: DEGRADE (achieve safe lot amount instead)
   * 6. Log decision to audit trail
   *
   * RETURNS: Decision with chosen lot size and full reasoning
   */
  static async makeDecision(input: GoalAwareLotSizingInput): Promise<GoalAwareLotSizingDecision> {
    const {
      userId,
      goalSessionId,
      symbol,
      direction,
      accountBalance,
      goalAmount,
      currentProgress,
      riskPercentageAllowed,
      entryPrice,
      stopLossPrice,
      takeProfitPrice,
      tradeContext,
    } = input;

    // GOVERNANCE: Input validation - prevent cascading errors from invalid balance
    if (!Number.isFinite(accountBalance) || accountBalance <= 0) {
      logger.error(
        LogCategory.RISK_MANAGEMENT,
        '[Goal-Aware Lot Sizing] Invalid account balance - cannot proceed',
        {
          userId,
          goalSessionId,
          symbol,
          accountBalance,
          type: typeof accountBalance,
        }
      );
      // Return degraded decision with minimum safe lot size
      return {
        chosenLotSize: 0.01, // Minimum safe lot size
        requiredLotForGoal: 0,
        safeLotFromRisk: 0.01,
        decisionReason: 'fallback_risk_constraint',
        expectedProfitAtTP: 0,
        expectedLossAtSL: 0,
        expectedRiskDollars: 0,
        reasoning: 'Account balance is invalid. Reverting to minimum safe lot size (0.01 lots).',
      };
    }

    if (!Number.isFinite(riskPercentageAllowed) || riskPercentageAllowed <= 0) {
      logger.error(
        LogCategory.RISK_MANAGEMENT,
        '[Goal-Aware Lot Sizing] Invalid risk percentage',
        {
          userId,
          goalSessionId,
          riskPercentageAllowed,
        }
      );
      return {
        chosenLotSize: 0.01,
        requiredLotForGoal: 0,
        safeLotFromRisk: 0.01,
        decisionReason: 'fallback_risk_constraint',
        expectedProfitAtTP: 0,
        expectedLossAtSL: 0,
        expectedRiskDollars: 0,
        reasoning: 'Risk percentage is invalid. Reverting to minimum safe lot size (0.01 lots).',
      };
    }

    logger.info(
      LogCategory.RISK_MANAGEMENT,
      '[Goal-Aware Lot Sizing] Making lot size decision',
      {
        symbol,
        accountBalance: accountBalance.toFixed(2),
        goalAmount: goalAmount.toFixed(2),
        currentProgress: currentProgress.toFixed(2),
        riskPercentageAllowed,
      }
    );

    // STEP 1: Get required lot for goal using goal-aware calculator
    // SSOT: Use canonical percentageToRiskMode mapping (CCIP compliant)
    const riskMode = percentageToRiskMode(riskPercentageAllowed);
    logger.info(
      LogCategory.RISK_MANAGEMENT,
      '[Goal-Aware Lot Sizing] Risk Mode Mapping',
      {
        percentage: riskPercentageAllowed,
        mode: riskMode,
        description: getRiskModeDescription(riskMode),
      }
    );

    const goalAwareResult = calculateGoalAwareLotSize(
      symbol,
      direction,
      accountBalance,
      entryPrice,
      stopLossPrice,
      currentProgress,
      goalAmount,
      riskMode  // Now using proper enum type
    );

    const requiredLotForGoal = goalAwareResult.lotSize;

    // STEP 2: Calculate safe lot from risk constraints
    // Risk formula: lotSize = riskDollars / (slPips × dollarPerPipPerLot)
    const pipInfo = getCurrencyPipInfo(symbol);
    const dollarPerPipPerLot = pipInfo.dollarPerPipPerLot;

    // Calculate SL distance in pips
    const slDistancePips = Math.abs(stopLossPrice - entryPrice) / pipInfo.pipValue;
    const tpDistancePips = Math.abs(takeProfitPrice - entryPrice) / pipInfo.pipValue;

    // Risk budget from trade style
    const riskDollars = (riskPercentageAllowed / 100) * accountBalance;

    // Safe lot is what risk constraints allow
    const safeLotFromRisk = riskDollars / (slDistancePips * dollarPerPipPerLot);

    // STEP 3: Determine which lot size to use
    let chosenLotSize: number;
    let decisionReason: GoalAwareLotSizingDecision['decisionReason'];
    let reasoning: string;

    // Validate required lot is positive
    if (requiredLotForGoal <= 0 || isNaN(requiredLotForGoal)) {
      chosenLotSize = safeLotFromRisk;
      decisionReason = 'fallback_risk_constraint';
      reasoning = `Goal calculation failed (invalid required lot: ${requiredLotForGoal}). Using risk constraint only: ${chosenLotSize.toFixed(3)} lots`;
    }
    // Can goal be achieved within risk limits?
    else if (requiredLotForGoal <= safeLotFromRisk) {
      chosenLotSize = requiredLotForGoal;
      decisionReason = 'goal_achievable_within_risk';
      reasoning = `Goal IS achievable within ${riskPercentageAllowed}% risk. Using ${chosenLotSize.toFixed(3)} lots to target $${(goalAmount - currentProgress).toFixed(2)}`;
    }
    // Goal requires more than safe risk allows
    else {
      chosenLotSize = safeLotFromRisk;
      decisionReason = 'goal_requires_more_risk';
      reasoning = `Goal requires ${requiredLotForGoal.toFixed(3)} lots (risk: ${((requiredLotForGoal * slDistancePips * dollarPerPipPerLot) / accountBalance * 100).toFixed(1)}%) but limited by ${riskPercentageAllowed}% risk. Degrading to ${chosenLotSize.toFixed(3)} lots.`;
    }

    // STEP 4: Calculate expected outcomes
    const expectedProfitAtTP = chosenLotSize * tpDistancePips * dollarPerPipPerLot;
    const expectedLossAtSL = chosenLotSize * slDistancePips * dollarPerPipPerLot;
    const expectedRiskDollars = chosenLotSize * slDistancePips * dollarPerPipPerLot;

    logger.info(
      LogCategory.RISK_MANAGEMENT,
      '[Goal-Aware Lot Sizing] Decision made',
      {
        decisionReason,
        requiredLotForGoal: requiredLotForGoal.toFixed(3),
        safeLotFromRisk: safeLotFromRisk.toFixed(3),
        chosenLotSize: chosenLotSize.toFixed(3),
        expectedProfit: expectedProfitAtTP.toFixed(2),
        expectedLoss: expectedLossAtSL.toFixed(2),
      }
    );

    // STEP 5: Log to audit trail
    const auditRecordId = await this.logDecision({
      userId,
      goalSessionId,
      symbol,
      direction,
      accountBalance,
      goalAmount,
      currentProgress,
      riskPercentageAllowed,
      entryPrice,
      stopLossPrice,
      takeProfitPrice,
      requiredLotForGoal,
      safeLotFromRisk,
      chosenLotSize,
      decisionReason,
      expectedProfitAtTP,
      expectedLossAtSL,
      expectedRiskDollars,
    });

    return {
      chosenLotSize,
      requiredLotForGoal,
      safeLotFromRisk,
      decisionReason,
      expectedProfitAtTP,
      expectedLossAtSL,
      expectedRiskDollars,
      auditRecordId,
      reasoning,
    };
  }

  /**
   * Log the lot sizing decision to governance audit trail
   * SSOT: Only called from makeDecision (no duplicates)
   */
  private static async logDecision(params: {
    userId: string;
    goalSessionId: string;
    symbol: string;
    direction: 'long' | 'short';
    accountBalance: number;
    goalAmount: number;
    currentProgress: number;
    riskPercentageAllowed: number;
    entryPrice: number;
    stopLossPrice: number;
    takeProfitPrice: number;
    requiredLotForGoal: number;
    safeLotFromRisk: number;
    chosenLotSize: number;
    decisionReason: GoalAwareLotSizingDecision['decisionReason'];
    expectedProfitAtTP: number;
    expectedLossAtSL: number;
    expectedRiskDollars: number;
  }): Promise<string | undefined> {
    try {
      const { data, error } = await supabase
        .from('goal_aware_lot_sizing_decisions')
        .insert({
          user_id: params.userId,
          goal_session_id: params.goalSessionId,
          symbol: params.symbol,
          direction: params.direction,
          account_balance: params.accountBalance,
          goal_amount: params.goalAmount,
          current_progress: params.currentProgress,
          remaining_goal: params.goalAmount - params.currentProgress,
          risk_percentage_allowed: params.riskPercentageAllowed,
          entry_price: params.entryPrice,
          stop_loss_price: params.stopLossPrice,
          take_profit_price: params.takeProfitPrice,
          required_lot_for_goal: params.requiredLotForGoal,
          safe_lot_from_risk: params.safeLotFromRisk,
          chosen_lot_size: params.chosenLotSize,
          decision_reason: params.decisionReason,
          expected_profit_at_tp: params.expectedProfitAtTP,
          expected_loss_at_sl: params.expectedLossAtSL,
          expected_risk_dollars: params.expectedRiskDollars,
        })
        .select('id')
        .single();

      if (error) {
        logger.error(
          LogCategory.GOVERNANCE,
          '[Goal-Aware Lot Sizing] Failed to log decision',
          { error }
        );
        return undefined;
      }

      return data?.id;
    } catch (err) {
      logger.error(
        LogCategory.GOVERNANCE,
        '[Goal-Aware Lot Sizing] Audit logging exception',
        { error: err }
      );
      return undefined;
    }
  }

  /**
   * Link executed trade to its lot sizing decision (for post-trade learning)
   * GOVERNANCE: Updates audit trail with actual trade result
   */
  static async linkTradeToDecision(
    decisionId: string,
    tradeId: string,
    userId: string
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('goal_aware_lot_sizing_decisions')
        .update({ trade_id: tradeId })
        .eq('id', decisionId)
        .eq('user_id', userId);

      if (error) {
        logger.error(
          LogCategory.GOVERNANCE,
          '[Goal-Aware Lot Sizing] Failed to link trade',
          { error, decisionId, tradeId }
        );
        return false;
      }

      return true;
    } catch (err) {
      logger.error(
        LogCategory.GOVERNANCE,
        '[Goal-Aware Lot Sizing] Trade linking exception',
        { error: err }
      );
      return false;
    }
  }
}

export const goalAwareLotSizingCoordinator = GoalAwareLotSizingCoordinator;
