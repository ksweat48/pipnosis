import { supabase } from '../lib/supabase';
import { EntryPlannerService } from './entry-planner';
import { activeEntryMonitor } from './active-entry-monitor';
import type { AlphaDecision } from '../brains/coordinator-alpha';
import type { EntryIntent, EntryIntentRequest } from '../types/entry';
import { logger } from '../lib/logger';
import { globalToastManager } from './global-toast-manager';

export class EntryExecutionCoordinator {
  static async handleAlphaDecision(
    userId: string,
    sessionId: string,
    decision: AlphaDecision,
    symbol: string
  ): Promise<{ shouldExecuteImmediately: boolean; intentId?: string; waitConditionId?: string }> {
    if (decision.action === 'NO_TRADE') {
      return { shouldExecuteImmediately: false };
    }

    if (decision.action === 'WAIT' && decision.wait_condition) {
      logger.info('Alpha decided to WAIT for better entry conditions');

      const waitConditionId = await this.createWaitCondition(
        userId,
        sessionId,
        decision,
        symbol
      );

      if (!waitConditionId) {
        logger.error('Failed to create wait condition, converting to NO_TRADE');
        return { shouldExecuteImmediately: false };
      }

      logger.info(`Wait condition created: ${waitConditionId} - monitoring for zone entry`);
      return { shouldExecuteImmediately: false, waitConditionId };
    }

    if (!decision.entry_intent) {
      logger.info('No entry intent specified, executing immediately');
      return { shouldExecuteImmediately: true };
    }

    const entryIntent = decision.entry_intent;

    if (entryIntent.should_execute_immediately) {
      logger.info(`Price already in zone - EXECUTING IMMEDIATELY (no monitoring needed)`);
      return { shouldExecuteImmediately: true };
    }

    const request: EntryIntentRequest = {
      session_id: sessionId,
      symbol,
      intent_type: entryIntent.intent_type,
      urgency: entryIntent.urgency,
      direction: decision.action === 'BUY' ? 'long' : 'short',
      entry_zone_min: entryIntent.entry_zone_min,
      entry_zone_max: entryIntent.entry_zone_max,
      timeout_minutes: entryIntent.timeout_minutes || Math.ceil(entryIntent.max_wait_seconds / 60),
      max_wait_seconds: entryIntent.max_wait_seconds,
      timeout_action: entryIntent.timeout_action,
      invalidation_price: entryIntent.invalidation_price,
      alpha_reasoning: decision.reasoning,
      market_context: {
        confidence: decision.confidence,
        stop_loss: decision.stopLoss,
        take_profit: decision.takeProfit,
        omega_summary: decision.omega_summary
      }
    };

    logger.info(
      `Creating entry intent: ${entryIntent.intent_type} (${entryIntent.urgency}) | ` +
      `Max wait: ${entryIntent.max_wait_seconds}s | Timeout action: ${entryIntent.timeout_action}`
    );

    const intent = await EntryPlannerService.createEntryIntent(userId, request);

    if (!intent) {
      logger.error('Failed to create entry intent, executing immediately');
      return { shouldExecuteImmediately: true };
    }

    await activeEntryMonitor.startMonitoring(intent.id, userId);

    return { shouldExecuteImmediately: false, intentId: intent.id };
  }

  static async executeFromIntent(
    intentId: string,
    actualEntryPrice: number
  ): Promise<{ success: boolean; tradeId?: string }> {
    try {
      const { getEntryIntentWithSession } = await import('./entry-intent-monitor-mode');
      const intent = await getEntryIntentWithSession(intentId);

      if (!intent) {
        logger.error('Failed to fetch intent for execution: intent not found');
        return { success: false };
      }

      const marketContext = intent.market_context as any;
      const idealEntryPrice = (intent.entry_zone_min + intent.entry_zone_max) / 2;

      // CRITICAL: Adjust SL/TP when entry price slips to maintain original R:R ratio
      let adjustedStopLoss = marketContext?.stop_loss;
      let adjustedTakeProfit = marketContext?.take_profit;

      if (marketContext?.stop_loss && marketContext?.take_profit && actualEntryPrice !== idealEntryPrice) {
        const originalStopDistance = Math.abs(idealEntryPrice - marketContext.stop_loss);
        const originalTPDistance = Math.abs(marketContext.take_profit - idealEntryPrice);
        const originalRR = originalTPDistance / originalStopDistance;

        // Recalculate SL and TP based on actual entry
        if (intent.direction === 'long') {
          adjustedStopLoss = actualEntryPrice - originalStopDistance;
          adjustedTakeProfit = actualEntryPrice + (originalStopDistance * originalRR);
        } else {
          adjustedStopLoss = actualEntryPrice + originalStopDistance;
          adjustedTakeProfit = actualEntryPrice - (originalStopDistance * originalRR);
        }

        const slippagePips = Math.abs(actualEntryPrice - idealEntryPrice) * 10000;
        logger.info(`Entry slipped ${slippagePips.toFixed(2)} pips. Adjusted SL/TP to maintain ${originalRR.toFixed(2)}:1 R:R`);
        logger.info(`Original: SL=${marketContext.stop_loss.toFixed(5)}, TP=${marketContext.take_profit.toFixed(5)}`);
        logger.info(`Adjusted: SL=${adjustedStopLoss.toFixed(5)}, TP=${adjustedTakeProfit.toFixed(5)}`);
      }

      // Extract TP1/TP2 values from Alpha decision (if available)
      const tp1Price = marketContext?.tp1Price || null;
      const tp1Confidence = marketContext?.tp1Confidence || null;
      const tp1Reasoning = marketContext?.tp1Reasoning || null;
      const tp2Price = marketContext?.tp2Price || adjustedTakeProfit;
      const tp2Reasoning = marketContext?.tp2Reasoning || null;

      // Get EQS data from intent (calculated by active-entry-monitor)
      const eqsScore = (intent as any).eqs_score || null;
      const eqsGrade = eqsScore ? this.calculateEQSGrade(eqsScore) : null;

      const tradeData = {
        user_id: intent.user_id,
        session_id: intent.session_id,
        symbol: intent.symbol,
        direction: intent.direction,
        entry_price: actualEntryPrice,
        stop_loss: adjustedStopLoss,
        take_profit: adjustedTakeProfit, // Legacy field for backward compatibility
        tp1_price: tp1Price,
        tp1_confidence: tp1Confidence,
        tp1_reasoning: tp1Reasoning,
        tp2_price: tp2Price,
        tp2_reasoning: tp2Reasoning,
        status: 'open',
        confidence: marketContext?.confidence || 70,
        reasoning: intent.alpha_reasoning,
        entry_intent_type: intent.intent_type,
        entry_urgency: intent.urgency,
        ideal_entry_price: idealEntryPrice,
        time_to_entry_seconds: Math.floor((new Date().getTime() - new Date(intent.created_at).getTime()) / 1000),
        eqs_score: eqsScore,
        eqs_grade: eqsGrade
      };

      const { data: trade, error: tradeError } = await supabase
        .from('goal_session_trades')
        .insert(tradeData)
        .select()
        .single();

      if (tradeError || !trade) {
        logger.error('Failed to create trade from intent:', tradeError);
        return { success: false };
      }

      await this.calculateAndSaveEntryQuality(
        trade.id,
        intentId,
        (intent.entry_zone_min + intent.entry_zone_max) / 2,
        actualEntryPrice,
        intent.direction,
        intent.intent_type,
        intent.urgency,
        Math.floor((new Date().getTime() - new Date(intent.created_at).getTime()) / 1000)
      );

      logger.info(`Trade executed from intent ${intentId}: ${trade.id}`);
      return { success: true, tradeId: trade.id };
    } catch (error) {
      logger.error('Error executing from intent:', error);
      return { success: false };
    }
  }

  private static async calculateAndSaveEntryQuality(
    tradeId: string,
    intentId: string,
    idealEntry: number,
    actualEntry: number,
    direction: string,
    intentType: string,
    urgency: string,
    monitoringDuration: number
  ): Promise<void> {
    try {
      const slippagePips = Math.abs(actualEntry - idealEntry) * 10000;

      const { data: qualityScore } = await supabase.rpc('calculate_entry_quality_score', {
        p_ideal_price: idealEntry,
        p_actual_price: actualEntry,
        p_direction: direction
      });

      await supabase.from('entry_quality_scores').insert({
        trade_id: tradeId,
        intent_id: intentId,
        ideal_entry_price: idealEntry,
        actual_entry_price: actualEntry,
        entry_quality_score: qualityScore || 50,
        slippage_pips: slippagePips,
        intent_type: intentType,
        urgency: urgency,
        monitoring_duration_seconds: monitoringDuration
      });

      await supabase
        .from('goal_session_trades')
        .update({ entry_quality_score: qualityScore || 50 })
        .eq('id', tradeId);

      logger.info(`Entry quality saved: ${qualityScore} (slippage: ${slippagePips.toFixed(2)} pips)`);
    } catch (error) {
      logger.error('Error calculating entry quality:', error);
    }
  }

  private static getIntentTypeName(intentType: string): string {
    const names: Record<string, string> = {
      immediate_momentum: 'momentum',
      pullback_to_vwap: 'VWAP pullback',
      pullback_to_support: 'support pullback',
      break_and_retest: 'breakout retest',
      range_extreme: 'range boundary',
      retest_structure: 'structure retest'
    };

    return names[intentType] || intentType;
  }

  static async cancelIntent(intentId: string, reason: string): Promise<boolean> {
    try {
      await EntryPlannerService.updateIntentStatus(intentId, 'canceled', reason);
      await activeEntryMonitor.stopMonitoring(intentId);
      return true;
    } catch (error) {
      logger.error('Error canceling intent:', error);
      return false;
    }
  }

  static async getUserActiveIntents(userId: string): Promise<EntryIntent[]> {
    return EntryPlannerService.getActiveIntents(userId);
  }

  private static async createWaitCondition(
    userId: string,
    sessionId: string,
    decision: AlphaDecision,
    symbol: string
  ): Promise<string | null> {
    try {
      if (!decision.wait_condition) {
        return null;
      }

      const { data, error } = await supabase
        .from('wait_conditions')
        .insert({
          user_id: userId,
          session_id: sessionId,
          symbol,
          direction: decision.action === 'WAIT' ? (decision.reasoning.includes('BUY') ? 'BUY' : 'SELL') : 'BUY',
          current_price: decision.entry,
          target_entry_zone_min: decision.wait_condition.target_entry_zone_min,
          target_entry_zone_max: decision.wait_condition.target_entry_zone_max,
          invalidation_price: decision.wait_condition.invalidation_price,
          confidence: decision.confidence,
          wait_reasoning: decision.wait_condition.wait_reasoning,
          alpha_decision_snapshot: {
            stopLoss: decision.stopLoss,
            takeProfit: decision.takeProfit,
            reasoning: decision.reasoning,
            omega_summary: decision.omega_summary
          },
          omega_votes: decision.omega_votes,
          status: 'active'
        })
        .select('id')
        .single();

      if (error || !data) {
        logger.error('Failed to create wait condition:', error);
        return null;
      }

      globalToastManager.show(
        `⏳ Waiting for ${symbol} to enter zone ${decision.wait_condition.target_entry_zone_min.toFixed(5)}-${decision.wait_condition.target_entry_zone_max.toFixed(5)}`,
        'info'
      );

      return data.id;
    } catch (error) {
      logger.error('Error creating wait condition:', error);
      return null;
    }
  }

  /**
   * Convert EQS score to letter grade
   */
  private static calculateEQSGrade(score: number): string {
    if (score >= 80) return 'A+';
    if (score >= 72) return 'A';
    if (score >= 65) return 'B';
    if (score >= 50) return 'C';
    return 'D';
  }
}
