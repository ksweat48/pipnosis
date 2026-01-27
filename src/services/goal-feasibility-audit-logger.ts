import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

export interface FeasibilityAuditLog {
  userId: string;
  sessionId: string;
  symbol: string;
  goalRequested: number;
  goalRecommended: number;
  goalUserChoice?: number;

  mechanismsEvaluated: string[];
  mechanismsSuppressed: string[];
  mechanismsApplied: string[];

  atrValue: number;
  atrTypical: number;
  atrMultiplier: number;
  sessionLiquidity: 'high' | 'medium' | 'low';
  currentSpread: number;
  accountBalance: number;

  minGoalRetentionMet: boolean;
  meaningfulTradeFloorDetails: Record<string, any>;
  volatilityAdvisoryApplied: boolean;
  goalSizeAdvisoryApplied: boolean;

  userChoice: 'accept_recommended' | 'accept_full' | 'accept_custom' | 'wait';
  userChoiceValue?: number;

  suppressedMechanismsReason: Record<string, string>;
  reductionBreakdown: Record<string, any>;
  governanceNotes?: string;
}

export class GoalFeasibilityAuditLogger {
  static async logDecision(audit: FeasibilityAuditLog): Promise<boolean> {
    try {
      // SSOT: Calculate required audit fields explicitly
      const originalAmount = audit.goalRequested;
      const newAmount = audit.goalUserChoice ?? audit.goalRecommended ?? audit.goalRequested;
      const reductionPercentage = originalAmount > 0
        ? Math.round(((originalAmount - newAmount) / originalAmount) * 100 * 100) / 100
        : 0;

      // Determine degradation type
      let degradationType: 'user_adjustment' | 'market_capacity' | 'risk_constraint' | 'intelligent_reduction';
      if (audit.userChoice === 'accept_custom' && audit.userChoiceValue) {
        degradationType = 'user_adjustment';
      } else if (reductionPercentage > 0) {
        degradationType = 'intelligent_reduction';
      } else {
        degradationType = 'market_capacity';
      }

      // Authority: This logger represents the Feasibility Engine
      const authority = 'feasibility_engine';

      // Reason: Use governance notes or default explanation
      const reason = audit.governanceNotes ||
        (reductionPercentage > 0
          ? `Market feasibility analysis reduced goal by ${reductionPercentage}% to maintain execution quality`
          : 'Goal feasibility validated - no reduction required');

      const { data, error } = await supabase
        .from('goal_target_audit')
        .insert({
          user_id: audit.userId,
          goal_session_id: audit.sessionId,
          symbol: audit.symbol,

          // SSOT: Required audit trail fields (schema contract)
          original_amount: originalAmount,
          new_amount: newAmount,
          reduction_percentage: reductionPercentage,
          reason,
          authority,
          degradation_type: degradationType,

          // Legacy fields (for backward compatibility and additional detail)
          goal_requested: audit.goalRequested,
          goal_recommended: audit.goalRecommended,
          goal_user_choice: audit.goalUserChoice,

          mechanisms_evaluated: audit.mechanismsEvaluated,
          mechanisms_suppressed: audit.mechanismsSuppressed,
          mechanisms_applied: audit.mechanismsApplied,

          atr_value: audit.atrValue,
          atr_typical: audit.atrTypical,
          atr_multiplier_from_typical: audit.atrMultiplier,
          session_liquidity: audit.sessionLiquidity,
          current_spread: audit.currentSpread,
          account_balance: audit.accountBalance,

          min_goal_retention_met: audit.minGoalRetentionMet,
          meaningful_trade_floor_details: audit.meaningfulTradeFloorDetails,
          volatility_advisory_applied: audit.volatilityAdvisoryApplied,
          goal_size_advisory_applied: audit.goalSizeAdvisoryApplied,

          user_choice: audit.userChoice,
          user_choice_value: audit.userChoiceValue,

          suppressed_mechanisms_reason: audit.suppressedMechanismsReason,
          reduction_breakdown: audit.reductionBreakdown,
          governance_notes: audit.governanceNotes,
        });

      if (error) {
        logger.error('Failed to log goal feasibility decision', {
          error: error.message,
          userId: audit.userId,
          symbol: audit.symbol,
        });
        return false;
      }

      logger.info('Goal feasibility decision logged to audit trail', {
        userId: audit.userId,
        sessionId: audit.sessionId,
        symbol: audit.symbol,
        goalRequested: audit.goalRequested,
        goalRecommended: audit.goalRecommended,
        userChoice: audit.userChoice,
      });

      return true;
    } catch (error) {
      logger.error('Exception logging goal feasibility decision', { error });
      return false;
    }
  }

  static async logMechanismDetail(
    auditId: string,
    mechanismName: string,
    mechanismType: 'FLOOR' | 'ADVISORY' | 'MULTIPLIER' | 'SIZE_CHECK',
    evaluated: boolean,
    passed: boolean,
    thresholdValue: number,
    actualValue: number,
    unit: string,
    appliedReason?: string,
    suppressedReason?: string,
    impactFactor?: number,
    impactDollarAmount?: number
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('feasibility_mechanism_detail')
        .insert({
          audit_id: auditId,
          mechanism_name: mechanismName,
          mechanism_type: mechanismType,
          evaluated,
          passed,
          threshold_value: thresholdValue,
          actual_value: actualValue,
          unit,
          applied_reason: appliedReason,
          suppressed_reason: suppressedReason,
          impact_factor: impactFactor,
          impact_dollar_amount: impactDollarAmount,
        });

      if (error) {
        logger.error('Failed to log mechanism detail', {
          error: error.message,
          mechanismName,
          auditId,
        });
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Exception logging mechanism detail', { error });
      return false;
    }
  }
}
