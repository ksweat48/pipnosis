/**
 * SYSTEM TABLE RPC WRAPPER - Single Authority for System Table Writes
 *
 * ALL writes to system-generated tables MUST go through these RPC functions.
 * Direct table inserts are FORBIDDEN.
 *
 * AUTHORITY: This service is the SOLE authority for system table writes.
 * PATTERN: Every function uses SECURITY DEFINER RPC, logs to governance.
 * SSOT: Single source of truth for how system data is created.
 */

import { supabase } from '../lib/supabase';

export class SystemTableRPCWrapper {
  /**
   * Create a goal notification via SECURITY DEFINER RPC
   * DO NOT call .from('goal_notifications').insert() directly
   */
  static async createGoalNotification(
    userId: string,
    type: string,
    title: string,
    message?: string,
    metadata?: Record<string, any>,
    priority: string = 'normal'
  ): Promise<{ id: string; error?: string }> {
    try {
      const { data, error } = await supabase.rpc('create_goal_notification', {
        p_user_id: userId,
        p_type: type,
        p_title: title,
        p_message: message || null,
        p_metadata: metadata || null,
        p_priority: priority,
      });

      if (error) {
        console.error('[SystemTableRPC] create_goal_notification error:', error);
        return { id: '', error: error.message };
      }

      return { id: data };
    } catch (err: any) {
      console.error('[SystemTableRPC] create_goal_notification exception:', err.message);
      return { id: '', error: err.message };
    }
  }

  /**
   * Create an AI trader score via SECURITY DEFINER RPC
   * SSOT: ai_trader_score table does NOT have session_id column
   * EMERGENCY FIX: Removed session_id parameter to match database schema
   */
  static async createAITraderScore(
    userId: string,
    tradeCount: number = 0,
    winRate: number = 0,
    avgRR: number = 0,
    consistencyScore: number = 0
  ): Promise<{ id: string; error?: string }> {
    try {
      const { data, error } = await supabase.rpc('create_ai_trader_score', {
        p_user_id: userId,
        p_trade_count: tradeCount,
        p_win_rate: winRate,
        p_avg_rr: avgRR,
        p_consistency_score: consistencyScore,
      });

      if (error) {
        console.error('[SystemTableRPC] create_ai_trader_score error:', error);
        return { id: '', error: error.message };
      }

      return { id: data };
    } catch (err: any) {
      console.error('[SystemTableRPC] create_ai_trader_score exception:', err.message);
      return { id: '', error: err.message };
    }
  }

  /**
   * Create an AI counterfactual via SECURITY DEFINER RPC
   */
  static async createAICounterfactual(
    userId: string,
    tradeId: string,
    symbol: string,
    timeframe: string,
    variantType: string,
    variantSetting: number,
    variantDescription: string,
    counterfactualPnL: number,
    actualPnL: number,
    wouldHitTP: boolean,
    wouldHitSL: boolean,
    wouldReverseLater: boolean,
    timeToResolutionMinutes: number,
    candlesHeld: number,
    marketRegime?: string,
    volatilityRegime?: string
  ): Promise<{ id: string; error?: string }> {
    try {
      const { data, error } = await supabase.rpc('create_ai_counterfactual', {
        p_user_id: userId,
        p_trade_id: tradeId,
        p_symbol: symbol,
        p_timeframe: timeframe,
        p_variant_type: variantType,
        p_variant_setting: variantSetting,
        p_variant_description: variantDescription,
        p_counterfactual_pnl: counterfactualPnL,
        p_actual_pnl: actualPnL,
        p_would_hit_tp: wouldHitTP,
        p_would_hit_sl: wouldHitSL,
        p_would_reverse_later: wouldReverseLater,
        p_time_to_resolution_minutes: timeToResolutionMinutes,
        p_candles_held: candlesHeld,
        p_market_regime: marketRegime || null,
        p_volatility_regime: volatilityRegime || null,
      });

      if (error) {
        console.error('[SystemTableRPC] create_ai_counterfactual error:', error);
        return { id: '', error: error.message };
      }

      return { id: data };
    } catch (err: any) {
      console.error('[SystemTableRPC] create_ai_counterfactual exception:', err.message);
      return { id: '', error: err.message };
    }
  }

  /**
   * Create a goal AI conversation via SECURITY DEFINER RPC
   */
  static async createGoalAIConversation(
    userId: string,
    goalSessionId: string,
    role: string,
    content: string,
    tokensUsed: number = 0,
    model: string = 'gpt-4',
    metadata?: Record<string, any>
  ): Promise<{ id: string; error?: string }> {
    try {
      const { data, error } = await supabase.rpc('create_goal_ai_conversation', {
        p_user_id: userId,
        p_goal_session_id: goalSessionId,
        p_role: role,
        p_content: content,
        p_tokens_used: tokensUsed,
        p_model: model,
        p_metadata: metadata || null,
      });

      if (error) {
        console.error('[SystemTableRPC] create_goal_ai_conversation error:', error);
        return { id: '', error: error.message };
      }

      return { id: data };
    } catch (err: any) {
      console.error('[SystemTableRPC] create_goal_ai_conversation exception:', err.message);
      return { id: '', error: err.message };
    }
  }

  /**
   * Batch create goal notifications
   * AUTHORITY: This is the ONLY way to create multiple notifications
   */
  static async createMultipleGoalNotifications(
    notifications: Array<{
      userId: string;
      type: string;
      title: string;
      message?: string;
      metadata?: Record<string, any>;
      priority?: string;
    }>
  ): Promise<{ ids: string[]; errors: string[] }> {
    const results = await Promise.all(
      notifications.map(n =>
        this.createGoalNotification(
          n.userId,
          n.type,
          n.title,
          n.message,
          n.metadata,
          n.priority
        )
      )
    );

    return {
      ids: results.filter(r => r.id).map(r => r.id),
      errors: results.filter(r => r.error).map(r => r.error || ''),
    };
  }
}

export default SystemTableRPCWrapper;
