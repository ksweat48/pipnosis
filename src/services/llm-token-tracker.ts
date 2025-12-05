/**
 * LLM Token Usage Tracker
 *
 * Centralized service for logging OpenAI API token usage across all 11 LLM brains.
 * Calculates costs and stores usage data for monitoring and optimization.
 *
 * Pricing (as of 2024):
 * - GPT-4o: $2.50/1M input tokens, $10.00/1M output tokens
 * - GPT-4o-mini: $0.15/1M input tokens, $0.60/1M output tokens
 */

import { supabase } from '../lib/supabase';

type BrainName =
  | 'Alpha'
  | 'Omega-1' | 'Omega-2' | 'Omega-3' | 'Omega-4' | 'Omega-5'
  | 'Omega-6' | 'Omega-7' | 'Omega-8' | 'Omega-9' | 'Omega-10';

type Model = 'gpt-4o' | 'gpt-4o-mini';

type ContextType =
  | 'vote'
  | 'fusion'
  | 'sentiment'
  | 'meta_reasoning'
  | 'mid_trade'
  | 'strategy_planning'
  | 'execution';

interface TokenUsageParams {
  brainName: BrainName;
  model: Model;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  contextType: ContextType;
  userId?: string;
  sessionId?: string;
}

interface UsageStats {
  totalCalls: number;
  totalTokens: number;
  totalCost: number;
  avgTokensPerCall: number;
  firstCall: Date | null;
  lastCall: Date | null;
}

interface DailySummary {
  date: string;
  brainName: string;
  totalCalls: number;
  totalTokens: number;
  totalCost: number;
  avgTokensPerCall: number;
}

class LLMTokenTracker {
  // Pricing per 1M tokens
  private readonly PRICING = {
    'gpt-4o': {
      input: 2.50,
      output: 10.00
    },
    'gpt-4o-mini': {
      input: 0.15,
      output: 0.60
    }
  };

  /**
   * Log a single LLM API call
   */
  async logUsage(params: TokenUsageParams): Promise<void> {
    try {
      const cost = this.calculateCost(
        params.model,
        params.promptTokens,
        params.completionTokens
      );

      // Get current user ID if not provided
      let userId = params.userId;
      if (!userId) {
        const { data: { user } } = await supabase.auth.getUser();
        userId = user?.id || null;
      }

      // Skip logging if no user context available
      if (!userId) {
        console.warn('[TokenTracker] No user context available, skipping token log');
        return;
      }

      const { error } = await supabase
        .from('llm_token_usage')
        .insert({
          brain_name: params.brainName,
          model: params.model,
          prompt_tokens: params.promptTokens,
          completion_tokens: params.completionTokens,
          total_tokens: params.totalTokens,
          estimated_cost_usd: cost,
          context_type: params.contextType,
          user_id: userId,
          session_id: params.sessionId || null,
          timestamp: new Date().toISOString()
        });

      if (error) {
        console.error('[TokenTracker] Failed to log usage:', error);
      }
    } catch (error) {
      console.error('[TokenTracker] Error logging usage:', error);
    }
  }

  /**
   * Calculate cost in USD for an API call
   */
  private calculateCost(
    model: Model,
    promptTokens: number,
    completionTokens: number
  ): number {
    const pricing = this.PRICING[model];

    const inputCost = (promptTokens / 1_000_000) * pricing.input;
    const outputCost = (completionTokens / 1_000_000) * pricing.output;

    return inputCost + outputCost;
  }

  /**
   * Get usage stats for a specific brain over the last N days
   */
  async getBrainUsage(brainName: BrainName, days: number = 30): Promise<UsageStats | null> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data, error } = await supabase
        .from('llm_token_usage')
        .select('total_tokens, estimated_cost_usd, timestamp')
        .eq('brain_name', brainName)
        .gte('timestamp', startDate.toISOString());

      if (error) {
        console.error('[TokenTracker] Failed to get brain usage:', error);
        return null;
      }

      if (!data || data.length === 0) {
        return {
          totalCalls: 0,
          totalTokens: 0,
          totalCost: 0,
          avgTokensPerCall: 0,
          firstCall: null,
          lastCall: null
        };
      }

      const totalCalls = data.length;
      const totalTokens = data.reduce((sum, row) => sum + row.total_tokens, 0);
      const totalCost = data.reduce((sum, row) => sum + parseFloat(row.estimated_cost_usd), 0);
      const timestamps = data.map(row => new Date(row.timestamp));

      return {
        totalCalls,
        totalTokens,
        totalCost,
        avgTokensPerCall: Math.round(totalTokens / totalCalls),
        firstCall: new Date(Math.min(...timestamps.map(d => d.getTime()))),
        lastCall: new Date(Math.max(...timestamps.map(d => d.getTime())))
      };
    } catch (error) {
      console.error('[TokenTracker] Error getting brain usage:', error);
      return null;
    }
  }

  /**
   * Get total cost for a date range
   */
  async getTotalCost(startDate: Date, endDate: Date): Promise<number> {
    try {
      const { data, error } = await supabase
        .from('llm_token_usage')
        .select('estimated_cost_usd')
        .gte('timestamp', startDate.toISOString())
        .lte('timestamp', endDate.toISOString());

      if (error) {
        console.error('[TokenTracker] Failed to get total cost:', error);
        return 0;
      }

      if (!data || data.length === 0) {
        return 0;
      }

      return data.reduce((sum, row) => sum + parseFloat(row.estimated_cost_usd), 0);
    } catch (error) {
      console.error('[TokenTracker] Error getting total cost:', error);
      return 0;
    }
  }

  /**
   * Get daily summary for the last N days
   */
  async getDailySummary(days: number = 7): Promise<DailySummary[]> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data, error } = await supabase
        .from('llm_daily_token_summary')
        .select('*')
        .gte('date', startDate.toISOString().split('T')[0])
        .order('date', { ascending: false });

      if (error) {
        console.error('[TokenTracker] Failed to get daily summary:', error);
        return [];
      }

      if (!data) {
        return [];
      }

      return data.map(row => ({
        date: row.date,
        brainName: row.brain_name,
        totalCalls: row.total_calls,
        totalTokens: row.total_tokens,
        totalCost: parseFloat(row.total_cost_usd),
        avgTokensPerCall: row.avg_tokens_per_call
      }));
    } catch (error) {
      console.error('[TokenTracker] Error getting daily summary:', error);
      return [];
    }
  }

  /**
   * Get cost breakdown by brain for the last N days
   */
  async getCostByBrain(days: number = 30): Promise<Array<{
    brainName: string;
    totalCalls: number;
    totalTokens: number;
    totalCost: number;
    percentage: number;
  }>> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const { data, error } = await supabase
        .from('llm_token_usage')
        .select('brain_name, total_tokens, estimated_cost_usd')
        .gte('timestamp', startDate.toISOString());

      if (error) {
        console.error('[TokenTracker] Failed to get cost by brain:', error);
        return [];
      }

      if (!data || data.length === 0) {
        return [];
      }

      // Group by brain
      const brainMap = new Map<string, { calls: number; tokens: number; cost: number }>();

      for (const row of data) {
        const existing = brainMap.get(row.brain_name) || { calls: 0, tokens: 0, cost: 0 };
        brainMap.set(row.brain_name, {
          calls: existing.calls + 1,
          tokens: existing.tokens + row.total_tokens,
          cost: existing.cost + parseFloat(row.estimated_cost_usd)
        });
      }

      // Calculate total cost
      const totalCost = Array.from(brainMap.values()).reduce((sum, b) => sum + b.cost, 0);

      // Convert to array with percentages
      return Array.from(brainMap.entries())
        .map(([brainName, stats]) => ({
          brainName,
          totalCalls: stats.calls,
          totalTokens: stats.tokens,
          totalCost: stats.cost,
          percentage: totalCost > 0 ? (stats.cost / totalCost) * 100 : 0
        }))
        .sort((a, b) => b.totalCost - a.totalCost);
    } catch (error) {
      console.error('[TokenTracker] Error getting cost by brain:', error);
      return [];
    }
  }

  /**
   * Update daily summary (call this periodically)
   */
  async updateDailySummary(): Promise<void> {
    try {
      const { error } = await supabase.rpc('update_daily_token_summary');

      if (error) {
        console.error('[TokenTracker] Failed to update daily summary:', error);
      }
    } catch (error) {
      console.error('[TokenTracker] Error updating daily summary:', error);
    }
  }

  /**
   * Get cost per trade (if session_id is provided)
   */
  async getCostPerTrade(sessionId: string): Promise<number> {
    try {
      const { data, error } = await supabase
        .from('llm_token_usage')
        .select('estimated_cost_usd')
        .eq('session_id', sessionId);

      if (error) {
        console.error('[TokenTracker] Failed to get cost per trade:', error);
        return 0;
      }

      if (!data || data.length === 0) {
        return 0;
      }

      return data.reduce((sum, row) => sum + parseFloat(row.estimated_cost_usd), 0);
    } catch (error) {
      console.error('[TokenTracker] Error getting cost per trade:', error);
      return 0;
    }
  }
}

export const llmTokenTracker = new LLMTokenTracker();
export type { BrainName, Model, ContextType, TokenUsageParams, UsageStats, DailySummary };
