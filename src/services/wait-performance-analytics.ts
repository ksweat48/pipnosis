/**
 * WAIT Performance Analytics Service
 *
 * Tracks and analyzes the performance of Alpha's WAIT decisions:
 * - WAIT→EXECUTE conversion rate
 * - Confidence band performance
 * - Optimal entry timing patterns
 * - Edge frequency curves
 *
 * This enables Alpha to learn when to WAIT vs execute immediately.
 */

import { supabase } from '../lib/supabase';
import { logger, LogCategory } from '../lib/logger';

export interface WaitPerformanceMetrics {
  totalWaitDecisions: number;
  executedCount: number;
  invalidatedCount: number;
  timeoutCount: number;
  conversionRate: number; // % of WAITs that converted to trades
  avgWaitDuration: number; // minutes
  successRate: number; // % of executed WAITs that won
  confidenceBands: {
    band: string;
    range: string;
    count: number;
    conversionRate: number;
    avgWinRate: number;
  }[];
}

export interface WaitConditionSummary {
  id: string;
  symbol: string;
  direction: string;
  targetZoneMin: number;
  targetZoneMax: number;
  confidence: number;
  status: string;
  resolutionType: string | null;
  waitDuration: number | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

class WaitPerformanceAnalytics {
  /**
   * Get comprehensive WAIT performance metrics for a user
   */
  async getPerformanceMetrics(userId: string): Promise<WaitPerformanceMetrics> {
    try {
      // Use the database function we created in the migration
      const { data: metrics, error } = await supabase
        .rpc('calculate_wait_performance', { p_user_id: userId });

      if (error) {
        logger.error(LogCategory.AI_TRADING, 'Error fetching wait performance:', error);
        return this.getEmptyMetrics();
      }

      // Get confidence band breakdown
      const confidenceBands = await this.getConfidenceBandPerformance(userId);

      return {
        totalWaitDecisions: metrics.total_waits || 0,
        executedCount: metrics.executed || 0,
        invalidatedCount: metrics.invalidated || 0,
        timeoutCount: metrics.timeout || 0,
        conversionRate: metrics.success_rate || 0,
        avgWaitDuration: metrics.avg_wait_duration_minutes || 0,
        successRate: await this.calculateWaitTradeWinRate(userId),
        confidenceBands
      };
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, 'Error calculating wait performance:', error);
      return this.getEmptyMetrics();
    }
  }

  /**
   * Get performance breakdown by confidence bands
   */
  private async getConfidenceBandPerformance(userId: string): Promise<{
    band: string;
    range: string;
    count: number;
    conversionRate: number;
    avgWinRate: number;
  }[]> {
    try {
      const { data: waitConditions, error } = await supabase
        .from('wait_conditions')
        .select('confidence, resolution_type, resulting_trade_id')
        .eq('user_id', userId);

      if (error || !waitConditions) {
        return [];
      }

      // Define confidence bands
      const bands = [
        { name: 'Excellent (85-100)', min: 85, max: 100 },
        { name: 'Strong (70-84)', min: 70, max: 84 },
        { name: 'Solid (55-69)', min: 55, max: 69 },
        { name: 'Marginal (40-54)', min: 40, max: 54 },
        { name: 'Weak (<40)', min: 0, max: 39 }
      ];

      const bandPerformance = await Promise.all(
        bands.map(async (band) => {
          const bandWaits = waitConditions.filter(
            (w) => w.confidence >= band.min && w.confidence <= band.max
          );

          const executed = bandWaits.filter((w) => w.resolution_type === 'executed');
          const conversionRate = bandWaits.length > 0
            ? (executed.length / bandWaits.length) * 100
            : 0;

          // Get win rate for executed trades from this band
          const tradeIds = executed
            .filter((w) => w.resulting_trade_id)
            .map((w) => w.resulting_trade_id);

          let avgWinRate = 0;
          if (tradeIds.length > 0) {
            const { data: trades } = await supabase
              .from('goal_session_trades')
              .select('pnl_result')
              .in('id', tradeIds)
              .not('pnl_result', 'is', null);

            if (trades && trades.length > 0) {
              const wins = trades.filter((t) => t.pnl_result > 0).length;
              avgWinRate = (wins / trades.length) * 100;
            }
          }

          return {
            band: band.name,
            range: `${band.min}-${band.max}`,
            count: bandWaits.length,
            conversionRate,
            avgWinRate
          };
        })
      );

      return bandPerformance.filter((b) => b.count > 0);
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, 'Error calculating confidence band performance:', error);
      return [];
    }
  }

  /**
   * Calculate win rate of trades that came from WAIT decisions
   */
  private async calculateWaitTradeWinRate(userId: string): Promise<number> {
    try {
      const { data: waitConditions, error } = await supabase
        .from('wait_conditions')
        .select('resulting_trade_id')
        .eq('user_id', userId)
        .eq('resolution_type', 'executed')
        .not('resulting_trade_id', 'is', null);

      if (error || !waitConditions || waitConditions.length === 0) {
        return 0;
      }

      const tradeIds = waitConditions.map((w) => w.resulting_trade_id);

      const { data: trades, error: tradesError } = await supabase
        .from('goal_session_trades')
        .select('pnl_result')
        .in('id', tradeIds)
        .not('pnl_result', 'is', null);

      if (tradesError || !trades || trades.length === 0) {
        return 0;
      }

      const wins = trades.filter((t) => t.pnl_result > 0).length;
      return (wins / trades.length) * 100;
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, 'Error calculating wait trade win rate:', error);
      return 0;
    }
  }

  /**
   * Get active WAIT conditions for a user
   */
  async getActiveWaitConditions(userId: string): Promise<WaitConditionSummary[]> {
    try {
      const { data, error } = await supabase
        .from('wait_conditions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('created_at', { ascending: false });

      if (error || !data) {
        logger.error(LogCategory.AI_TRADING, 'Error fetching active wait conditions:', error);
        return [];
      }

      return data.map((w) => ({
        id: w.id,
        symbol: w.symbol,
        direction: w.direction,
        targetZoneMin: parseFloat(w.target_entry_zone_min),
        targetZoneMax: parseFloat(w.target_entry_zone_max),
        confidence: w.confidence,
        status: w.status,
        resolutionType: w.resolution_type,
        waitDuration: w.wait_duration_minutes,
        createdAt: new Date(w.created_at),
        resolvedAt: w.resolved_at ? new Date(w.resolved_at) : null
      }));
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, 'Error fetching active wait conditions:', error);
      return [];
    }
  }

  /**
   * Get recent WAIT history for a user
   */
  async getWaitHistory(userId: string, limit: number = 10): Promise<WaitConditionSummary[]> {
    try {
      const { data, error } = await supabase
        .from('wait_conditions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error || !data) {
        logger.error(LogCategory.AI_TRADING, 'Error fetching wait history:', error);
        return [];
      }

      return data.map((w) => ({
        id: w.id,
        symbol: w.symbol,
        direction: w.direction,
        targetZoneMin: parseFloat(w.target_entry_zone_min),
        targetZoneMax: parseFloat(w.target_entry_zone_max),
        confidence: w.confidence,
        status: w.status,
        resolutionType: w.resolution_type,
        waitDuration: w.wait_duration_minutes,
        createdAt: new Date(w.created_at),
        resolvedAt: w.resolved_at ? new Date(w.resolved_at) : null
      }));
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, 'Error fetching wait history:', error);
      return [];
    }
  }

  /**
   * Get empty metrics template
   */
  private getEmptyMetrics(): WaitPerformanceMetrics {
    return {
      totalWaitDecisions: 0,
      executedCount: 0,
      invalidatedCount: 0,
      timeoutCount: 0,
      conversionRate: 0,
      avgWaitDuration: 0,
      successRate: 0,
      confidenceBands: []
    };
  }

  /**
   * Log WAIT decision for future analytics
   */
  async logWaitDecisionContext(
    waitConditionId: string,
    additionalContext: {
      marketRegime?: string;
      volatilityState?: string;
      sessionTime?: string;
      omegaConsensus?: string;
    }
  ): Promise<void> {
    try {
      await supabase
        .from('wait_conditions')
        .update({
          alpha_decision_snapshot: {
            ...additionalContext,
            logged_at: new Date().toISOString()
          }
        })
        .eq('id', waitConditionId);

      logger.info(LogCategory.AI_TRADING, `WAIT context logged for ${waitConditionId}`);
    } catch (error) {
      logger.error(LogCategory.AI_TRADING, 'Error logging wait context:', error);
    }
  }
}

export const waitPerformanceAnalytics = new WaitPerformanceAnalytics();
