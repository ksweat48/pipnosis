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
  checkPriceSymbolMismatch,
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
  requiredLotForGoal: number; // What's needed to hit profit goal at Alpha's TP
  safeLotFromRisk: number; // Hard safety ceiling (2x declared %)
  hardSafetyCapApplied: boolean; // True if safety ceiling was hit
  impliedRR: number; // R:R ratio of the trade (tp_pips / sl_pips)
  decisionReason:
    | 'profit_target_lot_deployed' // Primary path: lot set to achieve profit goal
    | 'hard_safety_cap_applied'    // Implied SL risk > 2x declared % — capped with warning
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

    // GOVERNANCE: Validate entry price against expected symbol range
    // Warn (not throw) so that a volatile/unexpected price doesn't cascade-fail lot sizing
    const priceMismatch = checkPriceSymbolMismatch(symbol, entryPrice);
    if (priceMismatch) {
      logger.warn(
        LogCategory.RISK_MANAGEMENT,
        '[Goal-Aware Lot Sizing] Price/symbol range advisory (non-blocking)',
        { symbol, entryPrice, warning: priceMismatch }
      );
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
      riskMode,  // For strategy characteristics
      riskPercentageAllowed,  // SSOT: Pass user's actual risk selection
      takeProfitPrice  // FIX 2026-02-03: Use actual TP distance instead of commonMove average
    );

    const requiredLotForGoal = goalAwareResult.lotSize;

    // STEP 2: Compute distances and the hard safety ceiling
    // The safety ceiling is 2× the declared profit-target percentage applied to the SL.
    // This prevents genuine disasters (e.g., misconfigured SL within 1 pip of entry),
    // while never blocking a correctly-structured trade.
    //
    // Example: user declares 5% profit target → safety ceiling = 10% of balance at SL
    //   Account $96,476 × 10% = $9,647 max SL risk
    //   For US30 73pt SL: safe lot = $9,647 / (73 × $100) = 1.32 lots
    //   Required lot for $4,823 profit at 100pt TP = 0.48 lots → safely under ceiling
    //
    // SSOT: riskPercentageAllowed is the PROFIT TARGET percentage (e.g. 5%).
    //       It is NOT the per-trade SL risk budget.
    const pipInfo = getCurrencyPipInfo(symbol);
    const dollarPerPipPerLot = pipInfo.dollarPerPipPerLot;

    const slDistancePips = Math.abs(stopLossPrice - entryPrice) / pipInfo.pipValue;
    const tpDistancePips = Math.abs(takeProfitPrice - entryPrice) / pipInfo.pipValue;
    const impliedRR = slDistancePips > 0 ? tpDistancePips / slDistancePips : 0;

    // Hard safety ceiling: 2× declared % applied to SL distance
    const hardSafetyCeilingDollars = (riskPercentageAllowed * 2 / 100) * accountBalance;
    const safeLotFromRisk = slDistancePips > 0
      ? hardSafetyCeilingDollars / (slDistancePips * dollarPerPipPerLot)
      : requiredLotForGoal; // If SL distance is zero, no ceiling needed (geometry gate will catch it)

    // STEP 3: PROFIT-FIRST decision
    // Primary: use the lot that achieves the profit goal at Alpha's TP
    // Safety: cap only if implied SL risk exceeds the 2× hard ceiling
    let chosenLotSize: number;
    let hardSafetyCapApplied = false;
    let decisionReason: GoalAwareLotSizingDecision['decisionReason'];
    let reasoning: string;

    if (requiredLotForGoal <= 0 || isNaN(requiredLotForGoal)) {
      // Fallback: goal calculation failed, use ceiling lot as best available
      chosenLotSize = safeLotFromRisk;
      decisionReason = 'fallback_risk_constraint';
      reasoning = `Goal calculation returned invalid lot (${requiredLotForGoal}). Using safety ceiling: ${chosenLotSize.toFixed(3)} lots`;
    }
    else if (requiredLotForGoal <= safeLotFromRisk) {
      // PRIMARY PATH: Profit target lot is within the safety ceiling — deploy it
      chosenLotSize = requiredLotForGoal;
      decisionReason = 'profit_target_lot_deployed';
      const impliedSlRisk = chosenLotSize * slDistancePips * dollarPerPipPerLot;
      const impliedSlRiskPct = (impliedSlRisk / accountBalance) * 100;
      reasoning = (
        `PROFIT-FIRST: Deploying ${chosenLotSize.toFixed(3)} lots to target ` +
        `$${(goalAmount - currentProgress).toFixed(2)} profit at TP ` +
        `(${tpDistancePips.toFixed(1)} pts, R:R ${impliedRR.toFixed(2)}:1). ` +
        `Implied SL risk: $${impliedSlRisk.toFixed(2)} (${impliedSlRiskPct.toFixed(1)}% of balance) — ` +
        `within 2x safety ceiling of ${(riskPercentageAllowed * 2).toFixed(0)}%.`
      );
    }
    else {
      // SAFETY CAP: Profit lot exceeds 2× ceiling — log a visible warning and cap
      // This should only happen if Alpha's SL is extremely tight relative to the goal
      chosenLotSize = safeLotFromRisk;
      hardSafetyCapApplied = true;
      decisionReason = 'hard_safety_cap_applied';
      const requiredImpliedRisk = ((requiredLotForGoal * slDistancePips * dollarPerPipPerLot) / accountBalance * 100).toFixed(1);
      const ceilingPct = (riskPercentageAllowed * 2).toFixed(0);
      reasoning = (
        `SAFETY CAP APPLIED: Profit target requires ${requiredLotForGoal.toFixed(3)} lots ` +
        `(implies ${requiredImpliedRisk}% SL risk), which exceeds the ${ceilingPct}% hard ceiling. ` +
        `Capped to ${chosenLotSize.toFixed(3)} lots. ` +
        `This trade's R:R (${impliedRR.toFixed(2)}:1) may be too unfavourable for the goal size. ` +
        `Expected profit at capped lot: $${(chosenLotSize * tpDistancePips * dollarPerPipPerLot).toFixed(2)}.`
      );
      logger.warn(
        LogCategory.RISK_MANAGEMENT,
        '[Goal-Aware Lot Sizing] Hard safety cap applied — profit lot exceeds 2x ceiling',
        {
          symbol, requiredLotForGoal: requiredLotForGoal.toFixed(3),
          safeLotFromRisk: safeLotFromRisk.toFixed(3),
          impliedRR: impliedRR.toFixed(2),
          requiredImpliedRisk: requiredImpliedRisk + '%',
          ceilingPct: ceilingPct + '%',
          riskPercentageAllowed
        }
      );
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

    // STEP 5: Log to audit trail (CCIP governance)
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
      impliedRRRatio: impliedRR,
      profitTargetDollars: goalAmount - currentProgress,
      hardSafetyCapApplied,
    });

    return {
      chosenLotSize,
      requiredLotForGoal,
      safeLotFromRisk,
      hardSafetyCapApplied,
      impliedRR,
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
    impliedRRRatio: number;
    profitTargetDollars: number;
    hardSafetyCapApplied: boolean;
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
          implied_rr_ratio: params.impliedRRRatio,
          profit_target_dollars: params.profitTargetDollars,
          hard_safety_cap_applied: params.hardSafetyCapApplied,
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
