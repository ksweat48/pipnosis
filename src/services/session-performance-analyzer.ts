import { supabase } from '../lib/supabase';

/**
 * Session Performance Analyzer
 *
 * Analyzes trading performance by:
 * - Trading session (Asian/London/NY/Overlap)
 * - Hour of day (0-23 UTC)
 * - Day of week (Monday-Friday)
 * - Market regime during each session
 *
 * Creates heatmaps and actionable insights like:
 * "Pattern X has 78% win rate during London session but only 45% during Asian session"
 */

export interface SessionPerformance {
  sessionType: 'asian' | 'london' | 'newyork' | 'overlap';
  hourOfDay: number;
  dayOfWeek: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  totalPnl: number;
  bestPatterns: Array<{ name: string; winRate: number }>;
  worstPatterns: Array<{ name: string; winRate: number }>;
}

export interface HourlyPerformance {
  hour: number;
  performance: SessionPerformance;
}

export interface PatternSessionPerformance {
  patternName: string;
  sessions: Record<string, {
    winRate: number;
    sampleSize: number;
    profitFactor: number;
    recommendation: 'take' | 'avoid' | 'cautious';
  }>;
  bestSession: string;
  worstSession: string;
}

class SessionPerformanceAnalyzer {
  /**
   * Analyze performance by trading session
   */
  async analyzeBySession(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<SessionPerformance[]> {
    console.log('[Session Performance] Analyzing by trading session...');

    const trades = await this.fetchTrades(userId, startDate, endDate);

    if (trades.length === 0) {
      console.log('[Session Performance] No trades found');
      return [];
    }

    // Group trades by session
    const sessionGroups: Record<string, any[]> = {
      asian: [],
      london: [],
      newyork: [],
      overlap: []
    };

    trades.forEach(trade => {
      const session = this.detectSession(new Date(trade.entry_time));
      sessionGroups[session].push(trade);
    });

    // Calculate performance for each session
    const results: SessionPerformance[] = [];

    for (const [sessionType, sessionTrades] of Object.entries(sessionGroups)) {
      if (sessionTrades.length > 0) {
        const performance = this.calculatePerformanceMetrics(
          sessionTrades,
          sessionType as any,
          0, // Will average hour
          0  // Will average day
        );
        results.push(performance);
      }
    }

    console.log(`[Session Performance] Analysis complete: ${results.length} sessions analyzed`);
    return results;
  }

  /**
   * Analyze performance by hour of day (creates 24-hour heatmap)
   */
  async analyzeByHour(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<HourlyPerformance[]> {
    console.log('[Session Performance] Analyzing by hour of day...');

    const trades = await this.fetchTrades(userId, startDate, endDate);

    if (trades.length === 0) {
      return [];
    }

    // Group trades by hour
    const hourlyGroups: Record<number, any[]> = {};

    for (let hour = 0; hour < 24; hour++) {
      hourlyGroups[hour] = [];
    }

    trades.forEach(trade => {
      const hour = new Date(trade.entry_time).getUTCHours();
      hourlyGroups[hour].push(trade);
    });

    // Calculate performance for each hour
    const results: HourlyPerformance[] = [];

    for (let hour = 0; hour < 24; hour++) {
      const hourTrades = hourlyGroups[hour];
      if (hourTrades.length > 0) {
        const session = this.detectSession(new Date().setUTCHours(hour, 0, 0, 0));
        const performance = this.calculatePerformanceMetrics(
          hourTrades,
          session as any,
          hour,
          0
        );

        results.push({ hour, performance });
      }
    }

    console.log(`[Session Performance] Hourly analysis complete`);
    return results;
  }

  /**
   * Analyze performance by day of week
   */
  async analyzeByDayOfWeek(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<Array<{ dayOfWeek: number; dayName: string; performance: SessionPerformance }>> {
    console.log('[Session Performance] Analyzing by day of week...');

    const trades = await this.fetchTrades(userId, startDate, endDate);

    if (trades.length === 0) {
      return [];
    }

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // Group by day of week
    const dayGroups: Record<number, any[]> = {};

    for (let day = 0; day < 7; day++) {
      dayGroups[day] = [];
    }

    trades.forEach(trade => {
      const day = new Date(trade.entry_time).getUTCDay();
      dayGroups[day].push(trade);
    });

    // Calculate performance
    const results = [];

    for (let day = 0; day < 7; day++) {
      const dayTrades = dayGroups[day];
      if (dayTrades.length > 0) {
        const session = this.detectSession(new Date(dayTrades[0].entry_time));
        const performance = this.calculatePerformanceMetrics(
          dayTrades,
          session as any,
          0,
          day
        );

        results.push({
          dayOfWeek: day,
          dayName: dayNames[day],
          performance
        });
      }
    }

    console.log(`[Session Performance] Day-of-week analysis complete`);
    return results;
  }

  /**
   * Analyze specific pattern performance across sessions
   */
  async analyzePatternBySession(
    userId: string,
    patternName: string,
    startDate: Date,
    endDate: Date
  ): Promise<PatternSessionPerformance | null> {
    console.log(`[Session Performance] Analyzing "${patternName}" by session...`);

    const { data, error } = await supabase
      .from('ai_trade_analysis')
      .select('*')
      .eq('user_id', userId)
      .contains('matching_historical_patterns', [patternName])
      .gte('entry_time', startDate.toISOString())
      .lte('entry_time', endDate.toISOString());

    if (error || !data || data.length === 0) {
      console.log(`[Session Performance] No data for pattern "${patternName}"`);
      return null;
    }

    // Group by session
    const sessionGroups: Record<string, any[]> = {
      asian: [],
      london: [],
      newyork: [],
      overlap: []
    };

    data.forEach(trade => {
      const session = this.detectSession(new Date(trade.entry_time));
      sessionGroups[session].push(trade);
    });

    // Calculate metrics for each session
    const sessions: Record<string, any> = {};
    let bestSession = '';
    let bestWinRate = 0;
    let worstSession = '';
    let worstWinRate = 100;

    for (const [sessionType, trades] of Object.entries(sessionGroups)) {
      if (trades.length >= 5) { // Minimum sample size
        const wins = trades.filter(t => t.outcome === 'win').length;
        const losses = trades.filter(t => t.outcome === 'loss').length;
        const winRate = trades.length > 0 ? (wins / trades.length) * 100 : 0;

        const totalWins = trades.filter(t => t.outcome === 'win')
          .reduce((sum, t) => sum + parseFloat(t.pnl.toString()), 0);
        const totalLosses = Math.abs(trades.filter(t => t.outcome === 'loss')
          .reduce((sum, t) => sum + parseFloat(t.pnl.toString()), 0));

        const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;

        const recommendation = this.getRecommendation(winRate, profitFactor, trades.length);

        sessions[sessionType] = {
          winRate,
          sampleSize: trades.length,
          profitFactor,
          recommendation
        };

        if (winRate > bestWinRate) {
          bestWinRate = winRate;
          bestSession = sessionType;
        }

        if (winRate < worstWinRate) {
          worstWinRate = winRate;
          worstSession = sessionType;
        }
      }
    }

    return {
      patternName,
      sessions,
      bestSession,
      worstSession
    };
  }

  /**
   * Get actionable insights for a user
   */
  async getActionableInsights(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<string[]> {
    const insights: string[] = [];

    // Session analysis
    const sessionPerf = await this.analyzeBySession(userId, startDate, endDate);

    if (sessionPerf.length > 0) {
      const bestSession = sessionPerf.reduce((best, curr) =>
        curr.winRate > best.winRate ? curr : best
      );

      const worstSession = sessionPerf.reduce((worst, curr) =>
        curr.winRate < worst.winRate ? curr : worst
      );

      if (bestSession.winRate > worstSession.winRate + 15) {
        insights.push(
          `🎯 Your ${bestSession.sessionType.toUpperCase()} session performance is exceptional (${bestSession.winRate.toFixed(1)}% win rate). ` +
          `Consider focusing more trades during this session.`
        );
      }

      if (worstSession.winRate < 45 && worstSession.totalTrades >= 10) {
        insights.push(
          `⚠️ Your ${worstSession.sessionType.toUpperCase()} session performance is weak (${worstSession.winRate.toFixed(1)}% win rate). ` +
          `Consider avoiding or being more selective during this session.`
        );
      }
    }

    // Hour analysis
    const hourlyPerf = await this.analyzeByHour(userId, startDate, endDate);

    if (hourlyPerf.length > 0) {
      const bestHours = hourlyPerf
        .filter(h => h.performance.totalTrades >= 5)
        .sort((a, b) => b.performance.winRate - a.performance.winRate)
        .slice(0, 3);

      if (bestHours.length > 0 && bestHours[0].performance.winRate > 65) {
        const hours = bestHours.map(h => `${h.hour}:00 UTC`).join(', ');
        insights.push(
          `⏰ Your best trading hours are ${hours}. ` +
          `Win rates: ${bestHours.map(h => h.performance.winRate.toFixed(1) + '%').join(', ')}`
        );
      }
    }

    // Day of week analysis
    const dayPerf = await this.analyzeByDayOfWeek(userId, startDate, endDate);

    if (dayPerf.length > 0) {
      const bestDay = dayPerf.reduce((best, curr) =>
        curr.performance.winRate > best.performance.winRate ? curr : best
      );

      if (bestDay.performance.winRate > 65 && bestDay.performance.totalTrades >= 10) {
        insights.push(
          `📅 ${bestDay.dayName} is your strongest day with ${bestDay.performance.winRate.toFixed(1)}% win rate. ` +
          `Plan your week to take advantage of this.`
        );
      }
    }

    return insights;
  }

  /**
   * Fetch trades from database
   */
  private async fetchTrades(
    userId: string,
    startDate: Date,
    endDate: Date
  ): Promise<any[]> {
    const { data, error } = await supabase
      .from('ai_trade_analysis')
      .select('*')
      .eq('user_id', userId)
      .gte('entry_time', startDate.toISOString())
      .lte('entry_time', endDate.toISOString())
      .in('outcome', ['win', 'loss']);

    if (error) {
      console.error('[Session Performance] Error fetching trades:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Detect session from timestamp
   */
  private detectSession(date: Date | number): 'asian' | 'london' | 'newyork' | 'overlap' {
    const timestamp = typeof date === 'number' ? new Date(date) : date;
    const hour = timestamp.getUTCHours();

    if (hour >= 0 && hour < 7) return 'asian';
    if (hour >= 13 && hour < 16) return 'overlap';
    if (hour >= 7 && hour < 16) return 'london';
    if (hour >= 13 && hour < 22) return 'newyork';

    return 'asian';
  }

  /**
   * Calculate performance metrics
   */
  private calculatePerformanceMetrics(
    trades: any[],
    sessionType: 'asian' | 'london' | 'newyork' | 'overlap',
    hourOfDay: number,
    dayOfWeek: number
  ): SessionPerformance {
    const wins = trades.filter(t => t.outcome === 'win');
    const losses = trades.filter(t => t.outcome === 'loss');

    const totalWins = wins.reduce((sum, t) => sum + parseFloat(t.pnl.toString()), 0);
    const totalLosses = Math.abs(losses.reduce((sum, t) => sum + parseFloat(t.pnl.toString()), 0));

    const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
    const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;
    const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
    const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;
    const totalPnl = totalWins - totalLosses;

    // Find best and worst patterns
    const patternGroups: Record<string, any[]> = {};

    trades.forEach(trade => {
      const patterns = trade.matching_historical_patterns || [];
      patterns.forEach((pattern: string) => {
        if (!patternGroups[pattern]) {
          patternGroups[pattern] = [];
        }
        patternGroups[pattern].push(trade);
      });
    });

    const patternPerformances = Object.entries(patternGroups)
      .map(([name, patternTrades]) => {
        const patternWins = patternTrades.filter(t => t.outcome === 'win').length;
        const patternWinRate = patternTrades.length > 0
          ? (patternWins / patternTrades.length) * 100
          : 0;

        return { name, winRate: patternWinRate, sampleSize: patternTrades.length };
      })
      .filter(p => p.sampleSize >= 3)
      .sort((a, b) => b.winRate - a.winRate);

    const bestPatterns = patternPerformances.slice(0, 3);
    const worstPatterns = patternPerformances.slice(-3).reverse();

    return {
      sessionType,
      hourOfDay,
      dayOfWeek,
      totalTrades: trades.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      totalPnl,
      bestPatterns,
      worstPatterns
    };
  }

  /**
   * Get recommendation based on metrics
   */
  private getRecommendation(
    winRate: number,
    profitFactor: number,
    sampleSize: number
  ): 'take' | 'avoid' | 'cautious' {
    if (sampleSize < 10) return 'cautious';

    if (winRate >= 60 && profitFactor >= 1.5) return 'take';
    if (winRate < 45 || profitFactor < 1.0) return 'avoid';

    return 'cautious';
  }
}

export const sessionPerformanceAnalyzer = new SessionPerformanceAnalyzer();
