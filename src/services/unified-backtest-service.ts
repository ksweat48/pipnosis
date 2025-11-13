/**
 * Unified Backtest Results Service
 *
 * This service provides a single source of truth for backtest results across all pages.
 * It handles queries for:
 * - Auto-Backtest Dashboard (shows auto-backtest progress and completed results)
 * - AI Learning Progress Dashboard (shows AI learning from all sources)
 * - Run New Backtest Page (shows manual backtest results separately from auto-backtests)
 *
 * Data Sources:
 * - synthetic_backtest_sessions (auto-backtests and manual synthetic backtests)
 * - ai_learning_insights (learnings extracted from all backtests)
 * - ai_trade_analysis (individual trade analysis from all sources)
 * - ai_performance_evolution (performance tracking over time)
 */

import { supabase } from '../lib/supabase';

export interface UnifiedBacktestResult {
  id: string;
  sessionName: string;
  source: 'auto_backtest' | 'manual_backtest' | 'live_trading';
  status: string;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnL: number;
  profitFactor: number;
  createdAt: string;
  completedAt?: string;
  hasAILearning: boolean;
  aiInsightsCount: number;
  aiTradeAnalysesCount: number;
}

export interface AutoBacktestSummary {
  totalCompleted: number;
  totalInsightsGenerated: number;
  totalTradesAnalyzed: number;
  avgWinRate: number;
  recentResults: UnifiedBacktestResult[];
}

export interface AILearningStats {
  totalInsights: number;
  insightsFromAutoBacktests: number;
  insightsFromManualBacktests: number;
  insightsFromLiveTrading: number;
  totalTradeAnalyses: number;
  performanceEvolutionRecords: number;
  lastLearningUpdate?: string;
}

class UnifiedBacktestService {
  /**
   * Get completed auto-backtest results for Auto-Backtest Dashboard
   */
  async getAutoBacktestResults(userId: string, limit: number = 20): Promise<UnifiedBacktestResult[]> {
    try {
      console.log('[Unified Service] Fetching auto-backtest results for user:', userId);

      // Query synthetic backtest sessions
      // Note: We need to distinguish auto-backtests from manual ones
      // Auto-backtests typically have session names starting with "Auto-BT-"
      const { data: sessions, error } = await supabase
        .from('synthetic_backtest_sessions')
        .select(`
          id,
          session_name,
          status,
          total_trades,
          winning_trades,
          losing_trades,
          win_rate,
          total_pnl,
          profit_factor,
          created_at,
          completed_at
        `)
        .eq('user_id', userId)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[Unified Service] Error fetching auto-backtest results:', error);
        return [];
      }

      if (!sessions || sessions.length === 0) {
        console.log('[Unified Service] No completed backtests found');
        return [];
      }

      console.log(`[Unified Service] Found ${sessions.length} completed backtests`);

      // For each session, get AI learning data
      const results = await Promise.all(
        sessions.map(async (session) => {
          // Count AI insights for this session
          const { data: insights } = await supabase
            .from('ai_learning_insights')
            .select('id', { count: 'exact', head: true })
            .eq('synthetic_session_id', session.id);

          // Count trade analyses
          const { data: analyses } = await supabase
            .from('ai_trade_analysis')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .not('synthetic_trade_id', 'is', null);

          const insightsCount = insights ? (insights as any).count || 0 : 0;
          const analysesCount = analyses ? (analyses as any).count || 0 : 0;

          // Determine if this is an auto-backtest or manual backtest
          const isAutoBacktest = session.session_name?.startsWith('Auto-BT-') ||
                                 session.session_name?.includes('Auto Backtest');

          return {
            id: session.id,
            sessionName: session.session_name || 'Unnamed Session',
            source: isAutoBacktest ? 'auto_backtest' as const : 'manual_backtest' as const,
            status: session.status,
            totalTrades: session.total_trades || 0,
            winningTrades: session.winning_trades || 0,
            losingTrades: session.losing_trades || 0,
            winRate: parseFloat(session.win_rate?.toString() || '0'),
            totalPnL: parseFloat(session.total_pnl?.toString() || '0'),
            profitFactor: parseFloat(session.profit_factor?.toString() || '0'),
            createdAt: session.created_at,
            completedAt: session.completed_at,
            hasAILearning: insightsCount > 0 || analysesCount > 0,
            aiInsightsCount: insightsCount,
            aiTradeAnalysesCount: analysesCount
          };
        })
      );

      return results;
    } catch (error) {
      console.error('[Unified Service] Exception fetching auto-backtest results:', error);
      return [];
    }
  }

  /**
   * Get auto-backtest summary statistics
   */
  async getAutoBacktestSummary(userId: string): Promise<AutoBacktestSummary> {
    try {
      const results = await this.getAutoBacktestResults(userId, 50);
      const autoBacktests = results.filter(r => r.source === 'auto_backtest');

      const totalInsights = autoBacktests.reduce((sum, r) => sum + r.aiInsightsCount, 0);
      const totalAnalyses = autoBacktests.reduce((sum, r) => sum + r.aiTradeAnalysesCount, 0);
      const avgWinRate = autoBacktests.length > 0
        ? autoBacktests.reduce((sum, r) => sum + r.winRate, 0) / autoBacktests.length
        : 0;

      return {
        totalCompleted: autoBacktests.length,
        totalInsightsGenerated: totalInsights,
        totalTradesAnalyzed: totalAnalyses,
        avgWinRate,
        recentResults: autoBacktests.slice(0, 10)
      };
    } catch (error) {
      console.error('[Unified Service] Error getting auto-backtest summary:', error);
      return {
        totalCompleted: 0,
        totalInsightsGenerated: 0,
        totalTradesAnalyzed: 0,
        avgWinRate: 0,
        recentResults: []
      };
    }
  }

  /**
   * Get AI learning statistics from all sources
   */
  async getAILearningStats(userId: string): Promise<AILearningStats> {
    try {
      console.log('[Unified Service] Fetching AI learning stats for user:', userId);

      // Get all insights
      const { data: allInsights, error: insightsError } = await supabase
        .from('ai_learning_insights')
        .select('id, synthetic_session_id, backtest_session_id, is_from_live_trading, created_at')
        .eq('user_id', userId);

      if (insightsError) {
        console.error('[Unified Service] Error fetching insights:', insightsError);
      }

      // Get all trade analyses
      const { data: analyses, error: analysesError } = await supabase
        .from('ai_trade_analysis')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (analysesError) {
        console.error('[Unified Service] Error fetching analyses:', analysesError);
      }

      // Get performance evolution records
      const { data: evolution, error: evolutionError } = await supabase
        .from('ai_performance_evolution')
        .select('id, updated_at', { count: 'exact', head: false })
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (evolutionError) {
        console.error('[Unified Service] Error fetching evolution:', evolutionError);
      }

      const insights = allInsights || [];
      const insightsFromAutoBacktests = insights.filter(i => i.synthetic_session_id !== null).length;
      const insightsFromManualBacktests = insights.filter(i => i.backtest_session_id !== null).length;
      const insightsFromLiveTrading = insights.filter(i => i.is_from_live_trading).length;

      const lastUpdate = evolution && evolution.length > 0 ? evolution[0].updated_at : undefined;

      return {
        totalInsights: insights.length,
        insightsFromAutoBacktests,
        insightsFromManualBacktests,
        insightsFromLiveTrading,
        totalTradeAnalyses: analyses ? (analyses as any).count || 0 : 0,
        performanceEvolutionRecords: evolution ? evolution.length : 0,
        lastLearningUpdate: lastUpdate
      };
    } catch (error) {
      console.error('[Unified Service] Exception getting AI learning stats:', error);
      return {
        totalInsights: 0,
        insightsFromAutoBacktests: 0,
        insightsFromManualBacktests: 0,
        insightsFromLiveTrading: 0,
        totalTradeAnalyses: 0,
        performanceEvolutionRecords: 0
      };
    }
  }

  /**
   * Get manual backtest results (separate from auto-backtests)
   */
  async getManualBacktestResults(userId: string, limit: number = 20): Promise<UnifiedBacktestResult[]> {
    const allResults = await this.getAutoBacktestResults(userId, limit);
    return allResults.filter(r => r.source === 'manual_backtest');
  }

  /**
   * Get backtest result details by ID
   */
  async getBacktestDetails(sessionId: string): Promise<UnifiedBacktestResult | null> {
    try {
      const { data: session, error } = await supabase
        .from('synthetic_backtest_sessions')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle();

      if (error || !session) {
        return null;
      }

      const { data: insights } = await supabase
        .from('ai_learning_insights')
        .select('id', { count: 'exact', head: true })
        .eq('synthetic_session_id', sessionId);

      const { data: analyses } = await supabase
        .from('ai_trade_analysis')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', session.user_id)
        .not('synthetic_trade_id', 'is', null);

      const insightsCount = insights ? (insights as any).count || 0 : 0;
      const analysesCount = analyses ? (analyses as any).count || 0 : 0;

      const isAutoBacktest = session.session_name?.startsWith('Auto-BT-') ||
                             session.session_name?.includes('Auto Backtest');

      return {
        id: session.id,
        sessionName: session.session_name || 'Unnamed Session',
        source: isAutoBacktest ? 'auto_backtest' : 'manual_backtest',
        status: session.status,
        totalTrades: session.total_trades || 0,
        winningTrades: session.winning_trades || 0,
        losingTrades: session.losing_trades || 0,
        winRate: parseFloat(session.win_rate?.toString() || '0'),
        totalPnL: parseFloat(session.total_pnl?.toString() || '0'),
        profitFactor: parseFloat(session.profit_factor?.toString() || '0'),
        createdAt: session.created_at,
        completedAt: session.completed_at,
        hasAILearning: insightsCount > 0 || analysesCount > 0,
        aiInsightsCount: insightsCount,
        aiTradeAnalysesCount: analysesCount
      };
    } catch (error) {
      console.error('[Unified Service] Error getting backtest details:', error);
      return null;
    }
  }
}

export const unifiedBacktestService = new UnifiedBacktestService();
