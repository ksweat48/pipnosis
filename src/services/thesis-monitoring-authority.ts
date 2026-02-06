/**
 * THESIS MONITORING AUTHORITY - Single Source of Truth (SSOT)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * AUTHORITY: This is the SOLE authority for evaluating thesis conditions
 * during trade life. MID-TRADE MONITOR delegates ALL thesis logic here.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * RESPONSIBILITIES:
 * 1. Check invalidation conditions (thesis breaker triggers)
 * 2. Evaluate confirmation conditions (thesis validator)
 * 3. Monitor key price levels and their meaning
 * 4. Track thesis status changes (intact → deteriorating → broken)
 * 5. Calculate thesis confidence erosion over time
 * 6. Log all thesis evaluations for audit trail
 *
 * DOES NOT:
 * - Create thesis plans (TradeThesisPlanGenerator does this)
 * - Execute closures (TradeClosureCoordinator does this)
 * - Make trading decisions (MidTradeMonitor does this)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CCIP COMPLIANCE:
 * ═══════════════════════════════════════════════════════════════════════════
 * - All thesis evaluation logic centralized here
 * - Database used for storage, not business logic
 * - Audit trail via immutable monitoring logs
 * - Clear decision contract for monitoring authority
 */

import { supabase } from '@/lib/supabase';
import type { TradeThersisPlan } from './trade-thesis-plan-generator';

/**
 * Thesis status
 */
export type ThesisStatus = 'new' | 'intact' | 'strengthening' | 'deteriorating' | 'partially_valid' | 'broken' | 'momentum_loss';

/**
 * Condition evaluation result
 */
export interface ConditionEvaluationResult {
  condition_type: 'invalidation' | 'confirmation' | 'key_level' | 'momentum' | 'time_decay';
  condition_description: string;
  condition_status: 'met' | 'violated' | 'triggered' | 'cleared' | 'monitored';
  current_price: number;
  market_spread?: number;
  reasoning: string;
  confidence_impact: number; // Range -1 to 1
}

/**
 * Thesis evaluation result
 */
export interface ThesisEvaluationResult {
  thesis_status: ThesisStatus;
  confidence_before: number;
  confidence_after: number;
  conditions_evaluated: ConditionEvaluationResult[];
  invalidations_triggered: boolean;
  confirmations_valid: boolean;
  guidance: string;
  should_close: boolean;
  close_reason?: string;
}

/**
 * Fetched thesis plan with trade context
 */
export interface ThesisPlanContext {
  id: string;
  thesis_plan_id: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entry_price: number;
  current_price: number;
  thesis: TradeThersisPlan;
  thesis_status: ThesisStatus;
  thesis_confidence_current: number;
  opened_at: string;
  created_at?: string;
}

class ThesisMonitoringAuthority {
  /**
   * Fetch thesis plan with full context for a trade
   *
   * AUTHORITY: Only way to get thesis context for monitoring
   *
   * @param tradeId - Trade ID to get thesis for
   * @param userId - User ownership check
   */
  async getThesisContext(tradeId: string, userId: string): Promise<ThesisPlanContext | null> {
    try {
      const { data, error } = await supabase
        .from('goal_session_trades')
        .select(
          `
          id,
          symbol,
          direction,
          entry_price,
          current_price,
          opened_at,
          thesis_status,
          thesis_confidence_current,
          trade_thesis_plans (
            id,
            thesis_narrative,
            regime_snapshot,
            setup_type,
            invalidation_conditions,
            confirmation_conditions,
            key_levels,
            expected_duration_minutes,
            expected_direction,
            expected_volatility,
            alpha_confidence_at_entry,
            confidence_band_upper,
            confidence_band_lower,
            thesis_risk_reward,
            thesis_expected_holding_time_minutes,
            created_at
          )
        `
        )
        .eq('id', tradeId)
        .eq('user_id', userId)
        .single();

      if (error || !data) {
        console.error(`[ThesisMonitoringAuthority] Failed to fetch thesis context for trade ${tradeId}:`, error?.message);
        return null;
      }

      const thesisPlanData = (data as any).trade_thesis_plans;
      if (!thesisPlanData) {
        return null;
      }

      return {
        id: data.id,
        thesis_plan_id: thesisPlanData.id,
        symbol: data.symbol,
        direction: data.direction,
        entry_price: data.entry_price,
        current_price: data.current_price,
        thesis_status: data.thesis_status,
        thesis_confidence_current: data.thesis_confidence_current,
        opened_at: data.opened_at,
        created_at: thesisPlanData.created_at,
        thesis: thesisPlanData as unknown as TradeThersisPlan,
      };
    } catch (error) {
      console.error(`[ThesisMonitoringAuthority] Error fetching thesis context:`, error);
      return null;
    }
  }

  /**
   * Evaluate thesis status based on current market conditions
   *
   * AUTHORITY: This is the ONLY place thesis evaluation happens
   *
   * Returns detailed evaluation with guidance
   */
  async evaluateThesisStatus(
    context: ThesisPlanContext,
    currentPrice: number,
    marketSpread: number = 0
  ): Promise<ThesisEvaluationResult> {
    const conditions: ConditionEvaluationResult[] = [];
    let confidenceChanges = 0;
    let invalidationsTriggered = false;
    let confirmationsValid = true;

    // 1. Evaluate invalidation conditions (CRITICAL)
    for (const invalidation of context.thesis.invalidation_conditions || []) {
      const result = this.evaluateInvalidationCondition(invalidation, context, currentPrice);
      if (result) {
        conditions.push(result);
        if (result.condition_status === 'triggered') {
          invalidationsTriggered = true;
          confidenceChanges += result.confidence_impact;
        }
      }
    }

    // 2. Evaluate confirmation conditions (VALIDATES)
    for (const confirmation of context.thesis.confirmation_conditions || []) {
      const result = this.evaluateConfirmationCondition(confirmation, context, currentPrice);
      if (result) {
        conditions.push(result);
        confidenceChanges += result.confidence_impact;
        if (result.condition_status === 'violated') {
          confirmationsValid = false;
        }
      }
    }

    // 3. Monitor key levels
    const keyLevelResults = this.evaluateKeyLevels(context, currentPrice);
    conditions.push(...keyLevelResults);
    for (const kl of keyLevelResults) {
      confidenceChanges += kl.confidence_impact;
    }

    // 4. Check time decay
    const timeDecayResult = this.evaluateTimeDecay(context);
    if (timeDecayResult) {
      conditions.push(timeDecayResult);
      confidenceChanges += timeDecayResult.confidence_impact;
    }

    // 5. Determine thesis status
    const newConfidence = Math.max(0, Math.min(1, context.thesis_confidence_current + confidenceChanges));
    const newStatus = this.determineThesisStatus(invalidationsTriggered, confirmationsValid, newConfidence);

    // 6. Generate guidance
    const guidance = this.generateThesisGuidance(newStatus, conditions, invalidationsTriggered, context);

    // 7. Determine if position should close
    const { shouldClose, closeReason } = this.determineClosureDecision(newStatus, invalidationsTriggered);

    // 8. Log evaluation
    await this.logThesisEvaluation(context, newStatus, context.thesis_confidence_current, newConfidence, conditions);

    return {
      thesis_status: newStatus,
      confidence_before: context.thesis_confidence_current,
      confidence_after: newConfidence,
      conditions_evaluated: conditions,
      invalidations_triggered: invalidationsTriggered,
      confirmations_valid: confirmationsValid,
      guidance,
      should_close: shouldClose,
      close_reason: closeReason,
    };
  }

  /**
   * Evaluate a single invalidation condition
   */
  private evaluateInvalidationCondition(
    invalidation: any,
    context: ThesisPlanContext,
    currentPrice: number
  ): ConditionEvaluationResult | null {
    const isLong = context.direction === 'buy';

    switch (invalidation.condition) {
      case 'price_breaks_below':
        if (isLong && currentPrice < invalidation.level) {
          return {
            condition_type: 'invalidation',
            condition_description: invalidation.reason,
            condition_status: 'triggered',
            current_price: currentPrice,
            reasoning: `Price ${currentPrice.toFixed(5)} broke below invalidation level ${invalidation.level.toFixed(5)}`,
            confidence_impact: invalidation.severity === 'critical' ? -1 : invalidation.severity === 'hard' ? -0.5 : -0.2,
          };
        }
        return null;

      case 'price_breaks_above':
        if (!isLong && currentPrice > invalidation.level) {
          return {
            condition_type: 'invalidation',
            condition_description: invalidation.reason,
            condition_status: 'triggered',
            current_price: currentPrice,
            reasoning: `Price ${currentPrice.toFixed(5)} broke above invalidation level ${invalidation.level.toFixed(5)}`,
            confidence_impact: invalidation.severity === 'critical' ? -1 : invalidation.severity === 'hard' ? -0.5 : -0.2,
          };
        }
        return null;

      default:
        return null;
    }
  }

  /**
   * Evaluate a single confirmation condition
   */
  private evaluateConfirmationCondition(
    confirmation: any,
    context: ThesisPlanContext,
    currentPrice: number
  ): ConditionEvaluationResult | null {
    const isLong = context.direction === 'buy';

    switch (confirmation.condition) {
      case 'holds_above_level':
        if (currentPrice >= (confirmation.level || 0)) {
          return {
            condition_type: 'confirmation',
            condition_description: `Holds above ${(confirmation.level || 0).toFixed(5)}`,
            condition_status: 'met',
            current_price: currentPrice,
            reasoning: `Price ${currentPrice.toFixed(5)} holding above confirmation level`,
            confidence_impact: 0.1,
          };
        }
        return {
          condition_type: 'confirmation',
          condition_description: `Holds above ${(confirmation.level || 0).toFixed(5)}`,
          condition_status: 'violated',
          current_price: currentPrice,
          reasoning: `Price dropped below confirmation level`,
          confidence_impact: -0.15,
        };

      case 'holds_below_level':
        if (currentPrice <= (confirmation.level || Infinity)) {
          return {
            condition_type: 'confirmation',
            condition_description: `Holds below ${(confirmation.level || Infinity).toFixed(5)}`,
            condition_status: 'met',
            current_price: currentPrice,
            reasoning: `Price ${currentPrice.toFixed(5)} holding below confirmation level`,
            confidence_impact: 0.1,
          };
        }
        return {
          condition_type: 'confirmation',
          condition_description: `Holds below ${(confirmation.level || Infinity).toFixed(5)}`,
          condition_status: 'violated',
          current_price: currentPrice,
          reasoning: `Price broke above confirmation level`,
          confidence_impact: -0.15,
        };

      default:
        return null;
    }
  }

  /**
   * Evaluate key price levels
   */
  private evaluateKeyLevels(context: ThesisPlanContext, currentPrice: number): ConditionEvaluationResult[] {
    const results: ConditionEvaluationResult[] = [];

    for (const level of context.thesis.key_levels || []) {
      const proximity = Math.abs(currentPrice - level.price) / level.price;

      if (proximity < 0.001) {
        // Very close to level
        results.push({
          condition_type: 'key_level',
          condition_description: `${level.type} at ${level.price.toFixed(5)}: ${level.description}`,
          condition_status: 'triggered',
          current_price: currentPrice,
          reasoning: `Price near ${level.type} level - ${level.action_if_broken || 'Monitor closely'}`,
          confidence_impact: level.significance === 'primary' ? -0.1 : -0.05,
        });
      } else if (proximity < 0.005) {
        // Within 0.5% of level
        results.push({
          condition_type: 'key_level',
          condition_description: `${level.type} at ${level.price.toFixed(5)}`,
          condition_status: 'monitored',
          current_price: currentPrice,
          reasoning: `Approaching ${level.type} level`,
          confidence_impact: 0,
        });
      }
    }

    return results;
  }

  /**
   * Evaluate time decay
   */
  private evaluateTimeDecay(context: ThesisPlanContext): ConditionEvaluationResult | null {
    const openedTime = new Date(context.opened_at).getTime();
    const elapsedMinutes = (Date.now() - openedTime) / 1000 / 60;
    const expectedMinutes = context.thesis.expected_duration_minutes || 120;

    if (elapsedMinutes > expectedMinutes * 1.5) {
      return {
        condition_type: 'time_decay',
        condition_description: `Trade held ${elapsedMinutes.toFixed(0)} minutes vs expected ${expectedMinutes}`,
        condition_status: 'violated',
        current_price: 0,
        reasoning: `Trade exceeded expected duration by ${((elapsedMinutes / expectedMinutes - 1) * 100).toFixed(0)}%`,
        confidence_impact: -0.2,
      };
    }

    if (elapsedMinutes > expectedMinutes) {
      return {
        condition_type: 'time_decay',
        condition_description: `Trade held ${elapsedMinutes.toFixed(0)} minutes vs expected ${expectedMinutes}`,
        condition_status: 'monitored',
        current_price: 0,
        reasoning: `Trade exceeded expected duration but still within tolerance`,
        confidence_impact: -0.05,
      };
    }

    return null;
  }

  /**
   * Determine thesis status based on evaluation
   */
  private determineThesisStatus(
    invalidationsTriggered: boolean,
    confirmationsValid: boolean,
    confidence: number
  ): ThesisStatus {
    if (invalidationsTriggered) {
      return 'broken';
    }

    if (!confirmationsValid) {
      return 'deteriorating';
    }

    if (confidence > 0.7) {
      return 'intact';
    }

    if (confidence > 0.4) {
      return 'partially_valid';
    }

    return 'deteriorating';
  }

  /**
   * Determine if position should close based on thesis
   */
  private determineClosureDecision(status: ThesisStatus, invalidationsTriggered: boolean): { shouldClose: boolean; closeReason?: string } {
    if (invalidationsTriggered || status === 'broken') {
      return {
        shouldClose: true,
        closeReason: 'thesis_broken',
      };
    }

    return {
      shouldClose: false,
    };
  }

  /**
   * Generate guidance based on thesis evaluation
   */
  private generateThesisGuidance(
    status: ThesisStatus,
    conditions: ConditionEvaluationResult[],
    invalidationsTriggered: boolean,
    context: ThesisPlanContext
  ): string {
    switch (status) {
      case 'intact':
        return `Thesis intact. ${context.symbol} ${context.direction === 'buy' ? 'long' : 'short'} thesis remains valid with all key confirmations holding.`;

      case 'strengthening':
        return `Thesis strengthening. Market conditions favor your ${context.direction === 'buy' ? 'long' : 'short'} position.`;

      case 'partially_valid':
        return `Thesis partially valid. Some confirmation conditions are weakening. Monitor key levels closely.`;

      case 'deteriorating':
        const triggeredConditions = conditions.filter((c) => c.condition_status === 'violated');
        const description = triggeredConditions.length > 0 ? triggeredConditions.map((c) => c.condition_description).join(', ') : 'Key confirmations weakening';
        return `Thesis deteriorating. ${description}. Consider exit if momentum is lost.`;

      case 'broken':
        return `Thesis broken. An invalidation condition has been triggered. Position should be closed to protect capital.`;

      case 'momentum_loss':
        return `Momentum loss detected. Expected market direction not confirmed. Position at risk if trend reverses.`;

      default:
        return `Thesis status: ${status}. Monitor closely.`;
    }
  }

  /**
   * Log thesis evaluation to audit trail
   */
  private async logThesisEvaluation(
    context: ThesisPlanContext,
    newStatus: ThesisStatus,
    oldConfidence: number,
    newConfidence: number,
    conditions: ConditionEvaluationResult[]
  ): Promise<void> {
    try {
      // Get user ID from context (use a method or store separately)
      // This is simplified - in production you'd have proper user context
      const conditionSummary = conditions.map((c) => `${c.condition_type}:${c.condition_status}`).join('; ');

      await supabase.rpc('log_thesis_monitoring_event', {
        p_user_id: context.id, // TODO: Get actual user_id
        p_trade_id: context.id,
        p_thesis_plan_id: context.thesis_plan_id,
        p_condition_type: 'thesis_evaluation',
        p_condition_description: conditionSummary,
        p_condition_status: 'met',
        p_current_price: 0,
        p_market_spread: 0,
        p_thesis_status_before: context.thesis_status,
        p_thesis_status_after: newStatus,
        p_confidence_change: newConfidence - oldConfidence,
        p_reasoning: `Evaluated ${conditions.length} conditions, status changed to ${newStatus}`,
        p_metadata: conditions as any,
      });
    } catch (error) {
      console.error('[ThesisMonitoringAuthority] Failed to log thesis evaluation:', error);
      // Non-fatal - continue even if logging fails
    }
  }
}

export const thesisMonitoringAuthority = new ThesisMonitoringAuthority();
