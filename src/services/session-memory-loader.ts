/**
 * Session Memory Loader
 *
 * Loads historical session learnings to provide LLM with memory across sessions.
 * This closes the learning loop by ensuring the LLM sees what it learned in previous sessions.
 */

import { supabase } from '../lib/supabase';

export interface SessionLearning {
  sessionId: string;
  sessionDate: Date;
  sessionType: string;
  bestSetup: {
    name: string;
    winRate: number;
    profitFactor: number;
    trades: number;
  } | null;
  worstSetup: {
    name: string;
    winRate: number;
    profitFactor: number;
    trades: number;
  } | null;
  keyLearnings: string[];
  patternsDiscovered: string[];
  patternsDegraded: string[];
  recommendations: string[];
  sessionMetrics: {
    winRate: number;
    profitFactor: number;
    totalTrades: number;
    totalPnL: number;
  };
}

export interface SessionMemorySummary {
  recentSessions: SessionLearning[];
  aggregatedLearnings: {
    mostSuccessfulSetups: string[];
    mostFailedSetups: string[];
    keyPatterns: string[];
    activeRecommendations: string[];
  };
  overallTrends: {
    winRateProgression: number;
    profitFactorProgression: number;
    improvementDirection: 'improving' | 'stable' | 'declining';
  };
}

class SessionMemoryLoader {
  /**
   * Load recent session learnings for a user
   */
  async loadRecentSessionLearnings(
    userId: string,
    limit: number = 5
  ): Promise<SessionMemorySummary | null> {
    console.log(`[Session Memory] 📚 Loading last ${limit} session learnings for user ${userId}`);

    try {
      // Load from multiple sources and combine
      const allSessions: SessionLearning[] = [];

      // 1. Query daily_session_results
      const { data: dailySessions } = await supabase
        .from('daily_session_results')
        .select('*')
        .eq('user_id', userId)
        .order('session_date', { ascending: false })
        .limit(limit);

      if (dailySessions && dailySessions.length > 0) {
        console.log(`[Session Memory] Found ${dailySessions.length} daily sessions`);
        allSessions.push(...this.transformDailySessionResults(dailySessions));
      }

      // 2. Query goal_session_summaries for completed goal sessions
      const { data: goalSessions } = await supabase
        .from('goal_session_summaries')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (goalSessions && goalSessions.length > 0) {
        console.log(`[Session Memory] Found ${goalSessions.length} goal sessions`);
        allSessions.push(...this.transformGoalSessionSummaries(goalSessions));
      }

      // If still no sessions, try alternative sources
      if (allSessions.length === 0) {
        console.log('[Session Memory] No sessions found, trying alternative sources');
        return await this.loadFromAlternativeSource(userId, limit);
      }

      // Sort all sessions by date and take most recent
      const recentSessions = allSessions
        .sort((a, b) => b.sessionDate.getTime() - a.sessionDate.getTime())
        .slice(0, limit);

      console.log(`[Session Memory] ✅ Loaded ${recentSessions.length} total historical sessions`);

      // Aggregate learnings
      const aggregatedLearnings = this.aggregateLearnings(recentSessions);

      // Calculate trends
      const overallTrends = this.calculateTrends(recentSessions);

      return {
        recentSessions,
        aggregatedLearnings,
        overallTrends
      };
    } catch (error) {
      console.error('[Session Memory] Unexpected error:', error);
      return null;
    }
  }

  /**
   * Transform daily_session_results to SessionLearning format
   */
  private transformDailySessionResults(sessions: any[]): SessionLearning[] {
    return sessions.map(session => ({
      sessionId: session.id,
      sessionDate: new Date(session.session_date),
      sessionType: session.session_type || 'live_trading',
      bestSetup: session.best_setup ? {
        name: session.best_setup.name || 'unknown',
        winRate: session.best_setup.win_rate || 0,
        profitFactor: session.best_setup.profit_factor || 0,
        trades: session.best_setup.trades || 0
      } : null,
      worstSetup: session.worst_setup ? {
        name: session.worst_setup.name || 'unknown',
        winRate: session.worst_setup.win_rate || 0,
        profitFactor: session.worst_setup.profit_factor || 0,
        trades: session.worst_setup.trades || 0
      } : null,
      keyLearnings: session.key_learnings || [],
      patternsDiscovered: session.patterns_discovered || [],
      patternsDegraded: session.patterns_degraded || [],
      recommendations: session.recommendations || [],
      sessionMetrics: {
        winRate: session.win_rate || 0,
        profitFactor: session.profit_factor || 0,
        totalTrades: session.total_trades || 0,
        totalPnL: session.total_pnl || 0
      }
    }));
  }

  /**
   * Transform goal_session_summaries to SessionLearning format
   */
  private transformGoalSessionSummaries(sessions: any[]): SessionLearning[] {
    return sessions.map(session => ({
      sessionId: session.goal_session_id,
      sessionDate: new Date(session.created_at),
      sessionType: 'goal_session',
      bestSetup: session.strongest_pattern ? {
        name: session.strongest_pattern,
        winRate: session.win_rate || 0,
        profitFactor: session.winning_trades > 0 && session.losing_trades > 0
          ? (session.final_profit / Math.abs(session.final_profit - (session.final_profit / session.win_rate * 100)))
          : 0,
        trades: session.winning_trades || 0
      } : null,
      worstSetup: null,
      keyLearnings: session.lessons_learned || [],
      patternsDiscovered: [session.strongest_pattern].filter(Boolean),
      patternsDegraded: [],
      recommendations: session.recommendations || [],
      sessionMetrics: {
        winRate: session.win_rate || 0,
        profitFactor: session.winning_trades > 0 && session.losing_trades > 0
          ? (session.winning_trades / session.losing_trades)
          : 0,
        totalTrades: session.total_trades || 0,
        totalPnL: session.final_profit || 0
      }
    }));
  }

  /**
   * Try loading from alternative sources if primary table fails
   */
  private async loadFromAlternativeSource(
    userId: string,
    limit: number
  ): Promise<SessionMemorySummary | null> {
    try {
      // Try loading from goal_sessions
      const { data: sessions, error } = await supabase
        .from('goal_sessions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'completed')
        .order('ended_at', { ascending: false })
        .limit(limit);

      if (error || !sessions || sessions.length === 0) {
        console.log('[Session Memory] No alternative sessions found');
        return null;
      }

      console.log(`[Session Memory] ✅ Loaded ${sessions.length} sessions from alternative source`);

      // Transform goal sessions
      const recentSessions: SessionLearning[] = sessions.map(session => ({
        sessionId: session.id,
        sessionDate: new Date(session.ended_at),
        sessionType: 'goal_session',
        bestSetup: null,
        worstSetup: null,
        keyLearnings: [],
        patternsDiscovered: [],
        patternsDegraded: [],
        recommendations: [],
        sessionMetrics: {
          winRate: session.win_rate || 0,
          profitFactor: session.profit_factor || 0,
          totalTrades: session.total_trades || 0,
          totalPnL: session.total_pnl || 0
        }
      }));

      const aggregatedLearnings = this.aggregateLearnings(recentSessions);
      const overallTrends = this.calculateTrends(recentSessions);

      return {
        recentSessions,
        aggregatedLearnings,
        overallTrends
      };
    } catch (error) {
      console.error('[Session Memory] Alternative source error:', error);
      return null;
    }
  }

  /**
   * Aggregate learnings from multiple sessions
   */
  private aggregateLearnings(sessions: SessionLearning[]): {
    mostSuccessfulSetups: string[];
    mostFailedSetups: string[];
    keyPatterns: string[];
    activeRecommendations: string[];
  } {
    const setupPerformance = new Map<string, { wins: number; losses: number }>();
    const allKeyLearnings: string[] = [];
    const allPatternsDiscovered: string[] = [];
    const allRecommendations: string[] = [];

    for (const session of sessions) {
      // Track setup performance
      if (session.bestSetup) {
        const current = setupPerformance.get(session.bestSetup.name) || { wins: 0, losses: 0 };
        setupPerformance.set(session.bestSetup.name, { ...current, wins: current.wins + 1 });
      }
      if (session.worstSetup) {
        const current = setupPerformance.get(session.worstSetup.name) || { wins: 0, losses: 0 };
        setupPerformance.set(session.worstSetup.name, { ...current, losses: current.losses + 1 });
      }

      // Collect learnings
      allKeyLearnings.push(...session.keyLearnings);
      allPatternsDiscovered.push(...session.patternsDiscovered);
      allRecommendations.push(...session.recommendations);
    }

    // Find most successful setups
    const sortedSetups = Array.from(setupPerformance.entries())
      .sort((a, b) => (b[1].wins - b[1].losses) - (a[1].wins - a[1].losses));

    const mostSuccessfulSetups = sortedSetups
      .filter(([_, perf]) => perf.wins > perf.losses)
      .slice(0, 3)
      .map(([name]) => name);

    const mostFailedSetups = sortedSetups
      .filter(([_, perf]) => perf.losses > perf.wins)
      .slice(0, 3)
      .map(([name]) => name);

    // Deduplicate and get most recent
    const uniquePatterns = Array.from(new Set(allPatternsDiscovered)).slice(0, 5);
    const recentRecommendations = Array.from(new Set(allRecommendations)).slice(0, 3);

    return {
      mostSuccessfulSetups,
      mostFailedSetups,
      keyPatterns: uniquePatterns,
      activeRecommendations: recentRecommendations
    };
  }

  /**
   * Calculate performance trends
   */
  private calculateTrends(sessions: SessionLearning[]): {
    winRateProgression: number;
    profitFactorProgression: number;
    improvementDirection: 'improving' | 'stable' | 'declining';
  } {
    if (sessions.length < 2) {
      return {
        winRateProgression: 0,
        profitFactorProgression: 0,
        improvementDirection: 'stable'
      };
    }

    // Compare most recent to oldest in set
    const mostRecent = sessions[0].sessionMetrics;
    const oldest = sessions[sessions.length - 1].sessionMetrics;

    const winRateProgression = mostRecent.winRate - oldest.winRate;
    const profitFactorProgression = mostRecent.profitFactor - oldest.profitFactor;

    let improvementDirection: 'improving' | 'stable' | 'declining';
    if (winRateProgression > 5 && profitFactorProgression > 0.1) {
      improvementDirection = 'improving';
    } else if (winRateProgression < -5 || profitFactorProgression < -0.1) {
      improvementDirection = 'declining';
    } else {
      improvementDirection = 'stable';
    }

    return {
      winRateProgression,
      profitFactorProgression,
      improvementDirection
    };
  }

  /**
   * Format session memory for LLM consumption
   */
  formatForLLM(memory: SessionMemorySummary): string {
    let formatted = '=== YOUR LEARNING HISTORY (Last 5 Sessions) ===\n';

    // Session breakdown
    const goalSessions = memory.recentSessions.filter(s => s.sessionType === 'goal_session').length;
    const liveSessions = memory.recentSessions.filter(s => s.sessionType === 'live_trading').length;

    formatted += `📊 Sessions: ${goalSessions} Goal Mode | ${liveSessions} Live\n\n`;

    // Overall trends
    formatted += `📈 PROGRESSION: ${memory.overallTrends.improvementDirection.toUpperCase()}\n`;
    formatted += `   Win Rate: ${memory.overallTrends.winRateProgression > 0 ? '+' : ''}${memory.overallTrends.winRateProgression.toFixed(1)}%\n`;
    formatted += `   Profit Factor: ${memory.overallTrends.profitFactorProgression > 0 ? '+' : ''}${memory.overallTrends.profitFactorProgression.toFixed(2)}\n\n`;

    // Successful patterns
    if (memory.aggregatedLearnings.mostSuccessfulSetups.length > 0) {
      formatted += `✅ WINNING SETUPS (Keep doing these):\n`;
      memory.aggregatedLearnings.mostSuccessfulSetups.forEach(setup => {
        formatted += `   • ${setup}\n`;
      });
      formatted += '\n';
    }

    // Failed patterns
    if (memory.aggregatedLearnings.mostFailedSetups.length > 0) {
      formatted += `❌ LOSING SETUPS (Avoid these):\n`;
      memory.aggregatedLearnings.mostFailedSetups.forEach(setup => {
        formatted += `   • ${setup}\n`;
      });
      formatted += '\n';
    }

    // Active recommendations
    if (memory.aggregatedLearnings.activeRecommendations.length > 0) {
      formatted += `💡 ACTIVE RECOMMENDATIONS:\n`;
      memory.aggregatedLearnings.activeRecommendations.forEach(rec => {
        formatted += `   • ${rec}\n`;
      });
      formatted += '\n';
    }

    // Recent discoveries
    if (memory.aggregatedLearnings.keyPatterns.length > 0) {
      formatted += `🔍 PATTERNS DISCOVERED:\n`;
      memory.aggregatedLearnings.keyPatterns.forEach(pattern => {
        formatted += `   • ${pattern}\n`;
      });
    }

    return formatted;
  }
}

export const sessionMemoryLoader = new SessionMemoryLoader();
