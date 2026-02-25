/**
 * Goal-Aware Lot Sizing Coordinator
 *
 * SSOT (Single Source of Truth) for goal-aware position sizing decisions
 *
 * CRITICAL ARCHITECTURE — RISK-FIRST (INSTITUTIONAL MODEL):
 * This is the ONLY place where lot size decisions are made when a goal is active.
 *
 * SIZING PRINCIPLE (institutional standard):
 * 1. riskPercentageAllowed = the maximum % of balance the user is willing to LOSE at SL
 * 2. Lot size = (accountBalance × riskPct) / (sl_pips × $/pip_per_lot)
 * 3. Accept whatever profit the TP distance delivers at that lot size
 * 4. NEVER size to guarantee a profit outcome — that inflates risk variance
 *
 * The goal (target_value) is a soft progress target tracked across multiple trades,
 * not a per-trade sizing driver. Alpha sets the TP based on market structure;
 * the user accepts whatever R:R that delivers.
 *
 * CCIP COMPLIANCE:
 * - Every decision logged to audit trail
 * - Reasoning transparent and immutable
 * - Three lot sizes tracked: required_for_goal (informational), safe_from_risk (SSOT), chosen
 *
 * GOVERNANCE:
 * - All decisions recorded in goal_aware_lot_sizing_decisions table
 * - Post-trade learning: compare expected vs actual
 * - Feedback loop for improving goal projections
 */

import { supabase } from '../lib/supabase';
import { logger, LogCategory } from '../lib/logger';
import {
  getCurrencyPipInfo,
  checkPriceSymbolMismatch,
  roundLotSize,
} from '../utils/currencyHelpers';
import { percentageToRiskMode } from '../config/risk-percentage-mapping';
import { getSymbolConfig } from '../config/symbol-registry';
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
  requiredLotForGoal: number; // Informational: lot that would hit goal at Alpha's TP in one trade
  safeLotFromRisk: number; // SSOT: lot derived from risk tolerance applied to SL distance
  hardSafetyCapApplied: boolean; // Always false in risk-first model (kept for audit schema compat)
  impliedRR: number; // R:R ratio of the trade (tp_pips / sl_pips)
  decisionReason:
    | 'risk_first_lot_deployed'    // Primary path: lot sized from SL risk tolerance (institutional)
    | 'hard_safety_cap_applied'    // Legacy: kept for audit schema compatibility
    | 'market_cannot_deliver_goal' // Legacy: kept for audit schema compatibility
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
   * RISK-FIRST Lot Sizing (Institutional Model)
   *
   * ALGORITHM:
   * 1. Compute SL distance in pips from Alpha's stop loss price
   * 2. riskDollars = accountBalance × riskPercentageAllowed / 100
   * 3. safeLot = riskDollars / (sl_pips × $/pip_per_lot)  ← THE LOT SIZE
   * 4. Accept whatever profit the TP delivers at that lot size
   * 5. Separately compute requiredLotForGoal for informational audit only
   * 6. Log full decision to audit trail (CCIP governance)
   *
   * WHY RISK-FIRST (not profit-first):
   * - Institutional sizing defines risk tolerance, then accepts the R outcome
   * - Sizing to hit a profit target inflates risk variance
   * - When you size to hit a goal, you are borrowing from future risk budget
   * - The goal (target_value) is a session-level progress tracker, not a per-trade driver
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

    // GOVERNANCE: Input validation — prevent cascading errors from invalid balance
    if (!Number.isFinite(accountBalance) || accountBalance <= 0) {
      logger.error(
        LogCategory.RISK_MANAGEMENT,
        '[Goal-Aware Lot Sizing] Invalid account balance - cannot proceed',
        { userId, goalSessionId, symbol, accountBalance, type: typeof accountBalance }
      );
      return {
        chosenLotSize: 0.01,
        requiredLotForGoal: 0,
        safeLotFromRisk: 0.01,
        hardSafetyCapApplied: false,
        impliedRR: 0,
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
        { userId, goalSessionId, riskPercentageAllowed }
      );
      return {
        chosenLotSize: 0.01,
        requiredLotForGoal: 0,
        safeLotFromRisk: 0.01,
        hardSafetyCapApplied: false,
        impliedRR: 0,
        decisionReason: 'fallback_risk_constraint',
        expectedProfitAtTP: 0,
        expectedLossAtSL: 0,
        expectedRiskDollars: 0,
        reasoning: 'Risk percentage is invalid. Reverting to minimum safe lot size (0.01 lots).',
      };
    }

    // GOVERNANCE: Validate entry price against expected symbol range (non-blocking)
    const priceMismatch = checkPriceSymbolMismatch(symbol, entryPrice);
    if (priceMismatch) {
      logger.warn(
        LogCategory.RISK_MANAGEMENT,
        '[Goal-Aware Lot Sizing] Price/symbol range advisory (non-blocking)',
        { symbol, entryPrice, warning: priceMismatch }
      );
    }

    // STEP 1: Compute pip distances
    const pipInfo = getCurrencyPipInfo(symbol);
    const dollarPerPipPerLot = pipInfo.dollarPerPipPerLot;

    const slDistancePips = Math.abs(stopLossPrice - entryPrice) / pipInfo.pipValue;
    const tpDistancePips = Math.abs(takeProfitPrice - entryPrice) / pipInfo.pipValue;
    const impliedRR = slDistancePips > 0 ? tpDistancePips / slDistancePips : 0;

    // STEP 2: RISK-FIRST lot sizing (institutional standard)
    // riskPercentageAllowed = maximum % of balance the user is willing to LOSE at SL
    // This is the authoritative sizing formula — never bypass it to chase a profit target
    const riskDollars = (riskPercentageAllowed / 100) * accountBalance;
    const safeLotFromRisk = slDistancePips > 0
      ? riskDollars / (slDistancePips * dollarPerPipPerLot)
      : 0.01; // Fallback to minimum — geometry gate will reject zero-SL trades

    // STEP 3: Clamp to broker limits
    const symbolConfig = getSymbolConfig(symbol);
    const minLot = symbolConfig?.minLotSize ?? 0.01;
    const maxLot = symbolConfig?.maxLotSize ?? 500.0;

    let chosenLotSize = roundLotSize(Math.max(minLot, Math.min(maxLot, safeLotFromRisk)));

    // STEP 4: Compute informational requiredLotForGoal (audit/learning only — NOT used for sizing)
    const remainingGoal = goalAmount - currentProgress;
    const requiredLotForGoal = (tpDistancePips > 0 && dollarPerPipPerLot > 0)
      ? remainingGoal / (tpDistancePips * dollarPerPipPerLot)
      : 0;

    const riskMode = percentageToRiskMode(riskPercentageAllowed);

    // STEP 5: Build reasoning string
    const riskDollarsActual = chosenLotSize * slDistancePips * dollarPerPipPerLot;
    const riskPctActual = (riskDollarsActual / accountBalance) * 100;
    const expectedProfitAtTP = chosenLotSize * tpDistancePips * dollarPerPipPerLot;

    const reasoning = (
      `RISK-FIRST: ${chosenLotSize.toFixed(3)} lots sized so SL risk = ` +
      `$${riskDollarsActual.toFixed(2)} (${riskPctActual.toFixed(2)}% of balance, ` +
      `declared tolerance: ${riskPercentageAllowed}%). ` +
      `Expected profit at Alpha TP: $${expectedProfitAtTP.toFixed(2)} ` +
      `(R:R ${impliedRR.toFixed(2)}:1). ` +
      `Goal progress context: $${remainingGoal.toFixed(2)} remaining toward $${goalAmount.toFixed(2)} target. ` +
      `Goal is a session progress tracker — lot sizing is driven solely by risk tolerance.`
    );

    logger.info(
      LogCategory.RISK_MANAGEMENT,
      '[Goal-Aware Lot Sizing] RISK-FIRST decision made',
      {
        symbol,
        riskMode,
        riskPercentageAllowed,
        riskDollars: riskDollars.toFixed(2),
        slDistancePips: slDistancePips.toFixed(2),
        tpDistancePips: tpDistancePips.toFixed(2),
        impliedRR: impliedRR.toFixed(2),
        safeLotFromRisk: safeLotFromRisk.toFixed(3),
        chosenLotSize: chosenLotSize.toFixed(3),
        expectedProfitAtTP: expectedProfitAtTP.toFixed(2),
        requiredLotForGoal_informational: requiredLotForGoal.toFixed(3),
        remainingGoal: remainingGoal.toFixed(2),
      }
    );

    // STEP 6: Log to audit trail (CCIP governance)
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
      decisionReason: 'risk_first_lot_deployed',
      expectedProfitAtTP,
      expectedLossAtSL: riskDollarsActual,
      expectedRiskDollars: riskDollarsActual,
      impliedRRRatio: impliedRR,
      profitTargetDollars: remainingGoal,
      hardSafetyCapApplied: false,
    });

    return {
      chosenLotSize,
      requiredLotForGoal,
      safeLotFromRisk,
      hardSafetyCapApplied: false,
      impliedRR,
      decisionReason: 'risk_first_lot_deployed',
      expectedProfitAtTP,
      expectedLossAtSL: riskDollarsActual,
      expectedRiskDollars: riskDollarsActual,
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
