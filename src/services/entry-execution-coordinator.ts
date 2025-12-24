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
  ): Promise<{ shouldExecuteImmediately: boolean; intentId?: string }> {
    if (decision.action === 'NO_TRADE') {
      return { shouldExecuteImmediately: false };
    }

    if (!decision.entry_intent) {
      logger.info('No entry intent specified, executing immediately');
      return { shouldExecuteImmediately: true };
    }

    const entryIntent = decision.entry_intent;

    if (entryIntent.urgency === 'HIGH' && entryIntent.intent_type === 'immediate_momentum') {
      logger.info('High urgency momentum - executing immediately');
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
      timeout_minutes: entryIntent.timeout_minutes,
      alpha_reasoning: decision.reasoning,
      market_context: {
        confidence: decision.confidence,
        stop_loss: decision.stopLoss,
        take_profit: decision.takeProfit,
        omega_summary: decision.omega_summary
      }
    };

    const intent = await EntryPlannerService.createEntryIntent(userId, request);

    if (!intent) {
      logger.error('Failed to create entry intent, executing immediately');
      return { shouldExecuteImmediately: true };
    }

    await activeEntryMonitor.startMonitoring(intent.id, userId);

    const intentTypeName = this.getIntentTypeName(entryIntent.intent_type);
    globalToastManager.info(
      `Setup confirmed. Monitoring ${intentTypeName} entry for ${symbol}. ` +
      `Target zone: ${entryIntent.entry_zone_min.toFixed(5)}-${entryIntent.entry_zone_max.toFixed(5)}`
    );

    return { shouldExecuteImmediately: false, intentId: intent.id };
  }

  static async executeFromIntent(
    intentId: string,
    actualEntryPrice: number
  ): Promise<{ success: boolean; tradeId?: string }> {
    try {
      const { data: intent, error } = await supabase
        .from('entry_intents')
        .select('*, goal_sessions(*)')
        .eq('id', intentId)
        .single();

      if (error || !intent) {
        logger.error('Failed to fetch intent for execution:', error);
        return { success: false };
      }

      const marketContext = intent.market_context as any;

      const tradeData = {
        user_id: intent.user_id,
        session_id: intent.session_id,
        symbol: intent.symbol,
        direction: intent.direction,
        entry_price: actualEntryPrice,
        stop_loss: marketContext?.stop_loss,
        take_profit: marketContext?.take_profit,
        status: 'open',
        confidence: marketContext?.confidence || 70,
        reasoning: intent.alpha_reasoning,
        entry_intent_type: intent.intent_type,
        entry_urgency: intent.urgency,
        ideal_entry_price: (intent.entry_zone_min + intent.entry_zone_max) / 2,
        time_to_entry_seconds: Math.floor((new Date().getTime() - new Date(intent.created_at).getTime()) / 1000)
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
}
