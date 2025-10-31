import { supabase } from '../lib/supabase';
import { goalNotificationSystem } from './goal-notifications';

export interface SessionSummary {
  sessionId: string;
  userId: string;
  goalAchieved: boolean;
  finalProfit: number;
  finalProgressPercentage: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  bestTrade: any;
  worstTrade: any;
  strongestPattern: string;
  lessonsLearned: string[];
  recommendations: string[];
  sessionDurationHours: number;
}

class GoalSessionAnalytics {
  async generateSessionSummary(sessionId: string): Promise<SessionSummary | null> {
    try {
      const { data: session, error: sessionError } = await supabase
        .from('goal_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (sessionError || !session) {
        console.error('Session not found:', sessionError);
        return null;
      }

      const { data: trades } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('goal_session_id', sessionId)
        .eq('status', 'closed');

      const allTrades = trades || [];
      const winningTrades = allTrades.filter(t => t.profit_loss > 0);
      const losingTrades = allTrades.filter(t => t.profit_loss < 0);

      const totalProfit = allTrades.reduce((sum, t) => sum + (t.profit_loss || 0), 0);
      const winRate = allTrades.length > 0 ? (winningTrades.length / allTrades.length) * 100 : 0;

      const bestTrade = allTrades.length > 0
        ? allTrades.reduce((best, t) => (t.profit_loss > (best?.profit_loss || -Infinity) ? t : best))
        : null;

      const worstTrade = allTrades.length > 0
        ? allTrades.reduce((worst, t) => (t.profit_loss < (worst?.profit_loss || Infinity) ? t : worst))
        : null;

      const strongestPattern = this.identifyStrongestPattern(winningTrades);
      const lessonsLearned = this.generateLessons(allTrades, winningTrades, losingTrades);
      const recommendations = this.generateRecommendations(session, allTrades, winRate);

      const startTime = new Date(session.start_time).getTime();
      const endTime = session.end_time ? new Date(session.end_time).getTime() : Date.now();
      const sessionDurationHours = (endTime - startTime) / (1000 * 60 * 60);

      const goalAchieved = session.current_progress >= session.target_value;
      const finalProgressPercentage = (session.current_progress / session.target_value) * 100;

      const summary: SessionSummary = {
        sessionId,
        userId: session.user_id,
        goalAchieved,
        finalProfit: totalProfit,
        finalProgressPercentage,
        totalTrades: allTrades.length,
        winningTrades: winningTrades.length,
        losingTrades: losingTrades.length,
        winRate,
        bestTrade: bestTrade ? {
          symbol: bestTrade.symbol,
          profit: bestTrade.profit_loss,
          direction: bestTrade.direction,
          entry: bestTrade.entry_price,
          exit: bestTrade.exit_price,
        } : null,
        worstTrade: worstTrade ? {
          symbol: worstTrade.symbol,
          profit: worstTrade.profit_loss,
          direction: worstTrade.direction,
          entry: worstTrade.entry_price,
          exit: worstTrade.exit_price,
        } : null,
        strongestPattern,
        lessonsLearned,
        recommendations,
        sessionDurationHours,
      };

      await this.saveSummary(summary);

      await goalNotificationSystem.sendCompletionNotification(
        sessionId,
        session.user_id,
        {
          goal_achieved: goalAchieved,
          final_profit: totalProfit,
          final_progress_percentage: finalProgressPercentage,
          total_trades: allTrades.length,
          win_rate: winRate,
          best_trade: summary.bestTrade,
          strongest_pattern: strongestPattern,
          recommendations,
        }
      );

      return summary;
    } catch (error) {
      console.error('Error generating session summary:', error);
      return null;
    }
  }

  identifyStrongestPattern(winningTrades: any[]): string {
    if (winningTrades.length === 0) return 'No patterns identified';

    const patterns: { [key: string]: { count: number; totalProfit: number } } = {};

    for (const trade of winningTrades) {
      const pattern = this.inferPatternFromTrade(trade);
      if (!patterns[pattern]) {
        patterns[pattern] = { count: 0, totalProfit: 0 };
      }
      patterns[pattern].count++;
      patterns[pattern].totalProfit += trade.profit_loss;
    }

    let strongestPattern = 'Mixed patterns';
    let maxScore = 0;

    for (const [pattern, stats] of Object.entries(patterns)) {
      const score = stats.count * stats.totalProfit;
      if (score > maxScore) {
        maxScore = score;
        strongestPattern = pattern;
      }
    }

    return strongestPattern;
  }

  inferPatternFromTrade(trade: any): string {
    const symbols = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD'];

    if (trade.symbol === 'XAUUSD') return 'Gold momentum trades';
    if (trade.symbol === 'US30') return 'US30 index breakout strategy';
    if (trade.symbol === 'EURUSD') return 'EUR/USD trend following';
    if (trade.symbol === 'GBPUSD') return 'GBP/USD volatility plays';

    return 'VWAP reversal strategy';
  }

  generateLessons(allTrades: any[], winningTrades: any[], losingTrades: any[]): string[] {
    const lessons: string[] = [];

    if (allTrades.length === 0) {
      lessons.push('No trades executed - consider adjusting risk parameters for more opportunities');
      return lessons;
    }

    const winRate = (winningTrades.length / allTrades.length) * 100;

    if (winRate >= 70) {
      lessons.push('Excellent trade selection - your setups had high accuracy');
    } else if (winRate >= 50) {
      lessons.push('Good trade management - maintain your current approach');
    } else if (winRate < 50) {
      lessons.push('Review entry criteria - consider tightening setup requirements');
    }

    const avgWin = winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + t.profit_loss, 0) / winningTrades.length
      : 0;
    const avgLoss = losingTrades.length > 0
      ? Math.abs(losingTrades.reduce((sum, t) => sum + t.profit_loss, 0) / losingTrades.length)
      : 0;

    if (avgWin > avgLoss * 1.5) {
      lessons.push('Strong risk/reward ratio - winners significantly larger than losers');
    } else if (avgLoss > avgWin) {
      lessons.push('Work on risk management - losses averaging larger than wins');
    }

    const tradeSymbols = new Set(allTrades.map(t => t.symbol));
    if (tradeSymbols.size === 1) {
      lessons.push('Consider diversifying across more symbols for better opportunities');
    }

    return lessons;
  }

  generateRecommendations(session: any, allTrades: any[], winRate: number): string[] {
    const recommendations: string[] = [];

    if (session.current_progress >= session.target_value) {
      recommendations.push('Consider setting a higher profit target for your next session');
      recommendations.push('Your current risk mode worked well - maintain or increase slightly');
    } else if (session.current_progress >= session.target_value * 0.75) {
      recommendations.push('You were close! Consider extending timeframe or adjusting targets');
      recommendations.push('Your strategy shows promise - stay consistent');
    } else {
      recommendations.push('Review risk parameters - consider starting with more conservative targets');
      recommendations.push('Focus on quality over quantity - wait for high-confidence setups');
    }

    if (allTrades.length < 3) {
      recommendations.push('More trading opportunities needed - consider lower confidence thresholds or longer timeframes');
    } else if (allTrades.length > 10 && winRate < 50) {
      recommendations.push('High trade frequency with low win rate - consider more selective entries');
    }

    if (winRate < 40) {
      recommendations.push('Refine your entry criteria - backtest patterns before live trading');
    } else if (winRate > 70) {
      recommendations.push('Excellent performance! Consider slightly more aggressive position sizing');
    }

    const endTime = session.end_time ? new Date(session.end_time) : new Date();
    const sessionHours = (endTime.getTime() - new Date(session.start_time).getTime()) / (1000 * 60 * 60);

    if (sessionHours < session.timeframe_hours * 0.5) {
      recommendations.push('Session ended early - ensure adequate time for market opportunities');
    }

    return recommendations;
  }

  async saveSummary(summary: SessionSummary): Promise<void> {
    try {
      const { error } = await supabase
        .from('goal_session_summaries')
        .insert({
          goal_session_id: summary.sessionId,
          user_id: summary.userId,
          goal_achieved: summary.goalAchieved,
          final_profit: summary.finalProfit,
          final_progress_percentage: summary.finalProgressPercentage,
          total_trades: summary.totalTrades,
          winning_trades: summary.winningTrades,
          losing_trades: summary.losingTrades,
          win_rate: summary.winRate,
          best_trade: summary.bestTrade || {},
          worst_trade: summary.worstTrade || {},
          strongest_pattern: summary.strongestPattern,
          lessons_learned: summary.lessonsLearned,
          recommendations: summary.recommendations,
          session_duration_hours: summary.sessionDurationHours,
        });

      if (error) {
        console.error('Error saving summary:', error);
      }
    } catch (error) {
      console.error('Error in saveSummary:', error);
    }
  }

  async getSessionSummary(sessionId: string): Promise<any | null> {
    try {
      const { data, error } = await supabase
        .from('goal_session_summaries')
        .select('*')
        .eq('goal_session_id', sessionId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching summary:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error in getSessionSummary:', error);
      return null;
    }
  }

  async getUserSummaries(userId: string, limit: number = 10): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('goal_session_summaries')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error fetching user summaries:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error in getUserSummaries:', error);
      return [];
    }
  }

  async comparePerformance(userId: string, sessions: string[]): Promise<any> {
    try {
      const { data: summaries, error } = await supabase
        .from('goal_session_summaries')
        .select('*')
        .eq('user_id', userId)
        .in('goal_session_id', sessions);

      if (error || !summaries) {
        return null;
      }

      const avgWinRate = summaries.reduce((sum, s) => sum + s.win_rate, 0) / summaries.length;
      const totalProfit = summaries.reduce((sum, s) => sum + s.final_profit, 0);
      const goalsAchieved = summaries.filter(s => s.goal_achieved).length;

      return {
        sessionsAnalyzed: summaries.length,
        averageWinRate: avgWinRate,
        totalProfit,
        goalsAchieved,
        successRate: (goalsAchieved / summaries.length) * 100,
      };
    } catch (error) {
      console.error('Error in comparePerformance:', error);
      return null;
    }
  }
}

export const goalSessionAnalytics = new GoalSessionAnalytics();
