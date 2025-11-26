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
      // Query session intelligence or daily session results
      const { data: sessions, error } = await supabase
        .from('daily_session_results')
        .select('*')
        .eq('user_id', userId)
        .order('session_date', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[Session Memory] Error loading sessions:', error);
        // Try alternative table
        return await this.loadFromAlternativeSource(userId, limit);
      }

      if (!sessions || sessions.length === 0) {
        console.log('[Session Memory] No historical sessions found');
        return null;
      }

      console.log(`[Session Memory] ✅ Loaded ${sessions.length} historical sessions`);

      // Transform to SessionLearning format
      const recentSessions: SessionLearning[] = sessions.map(session => ({
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
   * Try loading from alternative sources if primary table fails
   */
  private async loadFromAlternativeSource(
    userId: string,
    limit: number
  ): Promise<SessionMemorySummary | null> {
    try {
      // Try loading from synthetic_backtest_sessions
      const { data: sessions, error } = await supabase
        .from('synthetic_backtest_sessions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(limit);

      if (error || !sessions || sessions.length === 0) {
        console.log('[Session Memory] No alternative sessions found');
        return null;
      }

      console.log(`[Session Memory] ✅ Loaded ${sessions.length} sessions from alternative source`);

      // Transform backtest sessions
      const recentSessions: SessionLearning[] = sessions.map(session => ({
        sessionId: session.id,
        sessionDate: new Date(session.completed_at),
        sessionType: 'synthetic_backtest',
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
