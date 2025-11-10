import { supabase } from '@/lib/supabase';
import { evCalculator } from './ev-calculator';
import { cssCalculator } from './css-calculator';

/**
 * Session Learning Generator
 *
 * Generates daily "What I Learned Today" summaries with:
 * - Best/worst performing setups with EV metrics
 * - Confidence adjustments made
 * - Filter and threshold adjustments
 * - Pattern discoveries and degradations
 * - Actionable recommendations for next session
 */

interface SessionLearningData {
  sessionDate: Date;
  sessionType: 'live_trading' | 'backtest' | 'synthetic';
  bestSetup: {
    name: string;
    ev: number;
    winRate: number;
    tradesCount: number;
    profitFactor: number;
  } | null;
  worstSetup: {
    name: string;
    ev: number;
    winRate: number;
    tradesCount: number;
    profitFactor: number;
  } | null;
  confidenceAdjustments: Array<{
    pattern: string;
    oldConfidence: number;
    newConfidence: number;
    reason: string;
  }>;
  filterAdjustments: Array<{
    filterName: string;
    oldValue: number;
    newValue: number;
    reason: string;
  }>;
  patternsDiscovered: string[];
  patternsDegraded: string[];
  keyLearnings: string[];
  sessionCSS: number;
  sessionEV: number;
  tradesTaken: number;
  tradesAvoided: number;
  recommendations: string[];
}

class SessionLearningGenerator {
  /**
   * Generate daily learning summary
   */
  async generateDailyLearning(
    userId: string,
    date: Date = new Date()
  ): Promise<SessionLearningData | null> {
    console.log(`\n[Session Learning] 📚 Generating learning summary for ${date.toISOString().split('T')[0]}`);

    try {
      const startOfDay = new Date(date);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(date);
      endOfDay.setHours(23, 59, 59, 999);

      // Fetch all trades for the day
      const trades = await this.fetchDayTrades(userId, startOfDay, endOfDay);

      if (trades.length === 0) {
        console.log('[Session Learning] No trades for this day');
        return null;
      }

      // Analyze best and worst setups
      const { bestSetup, worstSetup } = await this.analyzeBestWorstSetups(userId, trades);

      // Identify confidence adjustments needed
      const confidenceAdjustments = await this.identifyConfidenceAdjustments(userId, trades);

      // Identify filter adjustments needed
      const filterAdjustments = await this.identifyFilterAdjustments(userId, trades);

      // Detect new patterns discovered
      const patternsDiscovered = await this.detectNewPatterns(userId, trades);

      // Detect degraded patterns
      const patternsDegraded = await this.detectDegradedPatterns(userId, trades);

      // Extract key learnings
      const keyLearnings = this.extractKeyLearnings(trades, bestSetup, worstSetup);

      // Calculate session metrics
      const sessionCSS = await this.calculateSessionCSS(trades);
      const sessionEV = this.calculateSessionEV(trades);

      // Generate recommendations
      const recommendations = this.generateRecommendations(
        bestSetup,
        worstSetup,
        patternsDegraded,
        sessionCSS
      );

      const learningData: SessionLearningData = {
        sessionDate: date,
        sessionType: 'live_trading',
        bestSetup,
        worstSetup,
        confidenceAdjustments,
        filterAdjustments,
        patternsDiscovered,
        patternsDegraded,
        keyLearnings,
        sessionCSS,
        sessionEV,
        tradesTaken: trades.length,
        tradesAvoided: 0, // Would need to track rejected signals
        recommendations
      };

      // Save to database
      await this.saveLearningToDatabase(userId, learningData);

      console.log('[Session Learning] ✅ Daily learning summary generated');
      return learningData;
    } catch (error) {
      console.error('[Session Learning] Error generating daily learning:', error);
      return null;
    }
  }

  /**
   * Fetch all trades for a specific day
   */
  private async fetchDayTrades(
    userId: string,
    startOfDay: Date,
    endOfDay: Date
  ): Promise<any[]> {
    const { data: trades, error } = await supabase
      .from('trade_history')
      .select('*')
      .eq('user_id', userId)
      .gte('closed_at', startOfDay.toISOString())
      .lte('closed_at', endOfDay.toISOString())
      .order('closed_at', { ascending: true });

    if (error) {
      console.error('[Session Learning] Error fetching trades:', error);
      return [];
    }

    return trades || [];
  }

  /**
   * Analyze best and worst performing setups
   */
  private async analyzeBestWorstSetups(
    userId: string,
    trades: any[]
  ): Promise<{ bestSetup: any; worstSetup: any }> {
    // Group trades by setup type
    const setupGroups: Record<string, any[]> = {};

    for (const trade of trades) {
      const setupType = trade.setup_type || 'Unknown';
      if (!setupGroups[setupType]) {
        setupGroups[setupType] = [];
      }
      setupGroups[setupType].push(trade);
    }

    let bestSetup: any = null;
    let worstSetup: any = null;
    let bestEV = -Infinity;
    let worstEV = Infinity;

    // Calculate EV for each setup
    for (const [setupName, setupTrades] of Object.entries(setupGroups)) {
      if (setupTrades.length < 2) continue; // Need at least 2 trades

      const wins = setupTrades.filter(t => parseFloat(t.profit_loss) > 0);
      const losses = setupTrades.filter(t => parseFloat(t.profit_loss) < 0);

      const winRate = (wins.length / setupTrades.length) * 100;
      const totalWins = wins.reduce((sum, t) => sum + parseFloat(t.profit_loss), 0);
      const totalLosses = Math.abs(losses.reduce((sum, t) => sum + parseFloat(t.profit_loss), 0));
      const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;

      const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
      const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;

      const ev = (winRate / 100 * avgWin) - ((1 - winRate / 100) * avgLoss);

      const setupData = {
        name: setupName,
        ev,
        winRate,
        tradesCount: setupTrades.length,
        profitFactor
      };

      if (ev > bestEV) {
        bestEV = ev;
        bestSetup = setupData;
      }

      if (ev < worstEV) {
        worstEV = ev;
        worstSetup = setupData;
      }
    }

    return { bestSetup, worstSetup };
  }

  /**
   * Identify confidence adjustments that should be made
   */
  private async identifyConfidenceAdjustments(
    userId: string,
    trades: any[]
  ): Promise<Array<{ pattern: string; oldConfidence: number; newConfidence: number; reason: string }>> {
    const adjustments: Array<{ pattern: string; oldConfidence: number; newConfidence: number; reason: string }> = [];

    // Group by pattern
    const patternGroups: Record<string, any[]> = {};
    for (const trade of trades) {
      const pattern = trade.setup_type || 'Unknown';
      if (!patternGroups[pattern]) patternGroups[pattern] = [];
      patternGroups[pattern].push(trade);
    }

    for (const [pattern, patternTrades] of Object.entries(patternGroups)) {
      if (patternTrades.length < 3) continue;

      const wins = patternTrades.filter(t => parseFloat(t.profit_loss) > 0);
      const winRate = (wins.length / patternTrades.length) * 100;
      const avgConfidence = patternTrades.reduce((sum, t) => sum + (parseFloat(t.confidence_score) || 75), 0) / patternTrades.length;

      // Adjust confidence based on actual win rate
      if (winRate >= 75 && avgConfidence < 85) {
        adjustments.push({
          pattern,
          oldConfidence: avgConfidence,
          newConfidence: Math.min(95, avgConfidence + 10),
          reason: `High win rate (${winRate.toFixed(1)}%) justifies increased confidence`
        });
      } else if (winRate < 45 && avgConfidence > 65) {
        adjustments.push({
          pattern,
          oldConfidence: avgConfidence,
          newConfidence: Math.max(50, avgConfidence - 15),
          reason: `Low win rate (${winRate.toFixed(1)}%) requires reduced confidence`
        });
      }
    }

    return adjustments;
  }

  /**
   * Identify filter adjustments needed
   */
  private async identifyFilterAdjustments(
    userId: string,
    trades: any[]
  ): Promise<Array<{ filterName: string; oldValue: number; newValue: number; reason: string }>> {
    const adjustments: Array<{ filterName: string; oldValue: number; newValue: number; reason: string }> = [];

    const losses = trades.filter(t => parseFloat(t.profit_loss) < 0);
    const lowConfidenceLosses = losses.filter(t => (parseFloat(t.confidence_score) || 75) < 70);

    if (lowConfidenceLosses.length >= 2) {
      adjustments.push({
        filterName: 'Min Confidence Threshold',
        oldValue: 70,
        newValue: 75,
        reason: `${lowConfidenceLosses.length} losses with confidence < 70%`
      });
    }

    return adjustments;
  }

  /**
   * Detect newly discovered patterns
   */
  private async detectNewPatterns(
    userId: string,
    trades: any[]
  ): Promise<string[]> {
    const discovered: string[] = [];

    // Check for patterns that just became statistically significant
    const patterns = await evCalculator.getPositiveEVPatterns(userId);

    for (const pattern of patterns) {
      // Pattern is "new" if it recently crossed minimum sample size threshold
      if (pattern.sample_size >= 20 && pattern.sample_size <= 25) {
        if (pattern.expected_value > 5) {
          discovered.push(`${pattern.pattern_name} on ${pattern.symbol} (EV: ${pattern.expected_value.toFixed(2)})`);
        }
      }
    }

    return discovered;
  }

  /**
   * Detect patterns that have degraded
   */
  private async detectDegradedPatterns(
    userId: string,
    trades: any[]
  ): Promise<string[]> {
    const degraded: string[] = [];

    // Check for patterns with negative EV
    const patterns = await evCalculator.getDegradedPatterns(userId);

    for (const pattern of patterns) {
      if (pattern.pattern_status === 'degraded' || pattern.expected_value < 0) {
        degraded.push(`${pattern.pattern_name} on ${pattern.symbol} (EV: ${pattern.expected_value.toFixed(2)})`);
      }
    }

    return degraded;
  }

  /**
   * Extract key learnings from the session
   */
  private extractKeyLearnings(
    trades: any[],
    bestSetup: any,
    worstSetup: any
  ): string[] {
    const learnings: string[] = [];

    const wins = trades.filter(t => parseFloat(t.profit_loss) > 0);
    const winRate = (wins.length / trades.length) * 100;

    learnings.push(`Session win rate: ${winRate.toFixed(1)}% (${wins.length}/${trades.length} trades)`);

    if (bestSetup) {
      learnings.push(`Best setup: ${bestSetup.name} with EV of ${bestSetup.ev.toFixed(2)} (${bestSetup.winRate.toFixed(1)}% WR)`);
    }

    if (worstSetup && worstSetup.ev < 0) {
      learnings.push(`⚠️ ${worstSetup.name} showing negative EV: ${worstSetup.ev.toFixed(2)} - consider avoiding`);
    }

    // Analyze consecutive wins/losses
    let maxConsecutiveWins = 0;
    let maxConsecutiveLosses = 0;
    let currentStreak = 0;
    let lastOutcome = '';

    for (const trade of trades) {
      const outcome = parseFloat(trade.profit_loss) > 0 ? 'win' : 'loss';

      if (outcome === lastOutcome) {
        currentStreak++;
      } else {
        if (lastOutcome === 'win') {
          maxConsecutiveWins = Math.max(maxConsecutiveWins, currentStreak);
        } else if (lastOutcome === 'loss') {
          maxConsecutiveLosses = Math.max(maxConsecutiveLosses, currentStreak);
        }
        currentStreak = 1;
      }
      lastOutcome = outcome;
    }

    if (maxConsecutiveWins >= 3) {
      learnings.push(`✨ Strong momentum: ${maxConsecutiveWins} consecutive wins`);
    }

    if (maxConsecutiveLosses >= 2) {
      learnings.push(`⚠️ Drawdown period: ${maxConsecutiveLosses} consecutive losses - defensive mode may activate`);
    }

    return learnings;
  }

  /**
   * Calculate session CSS
   */
  private async calculateSessionCSS(trades: any[]): Promise<number> {
    if (trades.length === 0) return 0;

    const tradeData = trades.map(t => ({
      outcome: parseFloat(t.profit_loss) > 0 ? 'win' : (parseFloat(t.profit_loss) < 0 ? 'loss' : 'breakeven'),
      pnl: parseFloat(t.profit_loss),
      entryPrice: parseFloat(t.entry_price),
      exitPrice: parseFloat(t.exit_price),
      stopLoss: parseFloat(t.stop_loss),
      takeProfit: parseFloat(t.take_profit)
    })) as any[];

    const cssResult = cssCalculator.calculateCSSFromTrades(tradeData);
    return cssResult.compositeSuccessScore;
  }

  /**
   * Calculate session EV
   */
  private calculateSessionEV(trades: any[]): number {
    if (trades.length === 0) return 0;

    const wins = trades.filter(t => parseFloat(t.profit_loss) > 0);
    const losses = trades.filter(t => parseFloat(t.profit_loss) < 0);

    const winRate = wins.length / trades.length;
    const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + parseFloat(t.profit_loss), 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + parseFloat(t.profit_loss), 0) / losses.length) : 0;

    return (winRate * avgWin) - ((1 - winRate) * avgLoss);
  }

  /**
   * Generate actionable recommendations
   */
  private generateRecommendations(
    bestSetup: any,
    worstSetup: any,
    degraded: string[],
    css: number
  ): string[] {
    const recommendations: string[] = [];

    if (bestSetup && bestSetup.ev > 10) {
      recommendations.push(`🎯 Focus on ${bestSetup.name} - strong positive EV (${bestSetup.ev.toFixed(2)})`);
    }

    if (worstSetup && worstSetup.ev < -5) {
      recommendations.push(`🚫 Avoid ${worstSetup.name} - negative EV (${worstSetup.ev.toFixed(2)})`);
    }

    if (degraded.length > 0) {
      recommendations.push(`⚠️ Review these degraded patterns: ${degraded.slice(0, 2).join(', ')}`);
    }

    if (css < 70) {
      recommendations.push('📊 CSS below Pro level (70) - focus on improving profit factor and R:R');
    } else if (css >= 85) {
      recommendations.push('⭐ Excellent CSS - maintain current approach and standards');
    }

    recommendations.push('📈 Continue learning from each trade to refine pattern recognition');

    return recommendations;
  }

  /**
   * Save learning summary to database
   */
  private async saveLearningToDatabase(
    userId: string,
    learning: SessionLearningData
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('ai_session_learnings')
        .upsert({
          user_id: userId,
          session_date: learning.sessionDate.toISOString().split('T')[0],
          session_type: learning.sessionType,
          best_setup_name: learning.bestSetup?.name,
          best_setup_ev: learning.bestSetup?.ev,
          best_setup_win_rate: learning.bestSetup?.winRate,
          best_setup_trades_count: learning.bestSetup?.tradesCount,
          worst_setup_name: learning.worstSetup?.name,
          worst_setup_ev: learning.worstSetup?.ev,
          worst_setup_win_rate: learning.worstSetup?.winRate,
          worst_setup_trades_count: learning.worstSetup?.tradesCount,
          confidence_adjustments: learning.confidenceAdjustments,
          net_confidence_shift: learning.confidenceAdjustments.reduce((sum, adj) => sum + (adj.newConfidence - adj.oldConfidence), 0),
          filter_adjustments: learning.filterAdjustments,
          threshold_adjustments: [],
          patterns_discovered: learning.patternsDiscovered,
          patterns_degraded: learning.patternsDegraded,
          key_learnings: learning.keyLearnings,
          session_css: learning.sessionCSS,
          session_ev: learning.sessionEV,
          trades_taken: learning.tradesTaken,
          trades_avoided: learning.tradesAvoided,
          actionable_recommendations: learning.recommendations
        }, {
          onConflict: 'user_id,session_date,session_type'
        });

      if (error) {
        console.error('[Session Learning] Error saving to database:', error);
      } else {
        console.log('[Session Learning] ✅ Saved to database');
      }
    } catch (error) {
      console.error('[Session Learning] Exception saving to database:', error);
    }
  }

  /**
   * Get recent learning summaries
   */
  async getRecentLearnings(
    userId: string,
    limit: number = 7
  ): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('ai_session_learnings')
        .select('*')
        .eq('user_id', userId)
        .order('session_date', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[Session Learning] Error fetching recent learnings:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[Session Learning] Exception fetching learnings:', error);
      return [];
    }
  }

  /**
   * Get learning summary for specific date
   */
  async getLearningForDate(
    userId: string,
    date: Date
  ): Promise<any | null> {
    try {
      const dateStr = date.toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('ai_session_learnings')
        .select('*')
        .eq('user_id', userId)
        .eq('session_date', dateStr)
        .maybeSingle();

      if (error) {
        console.error('[Session Learning] Error fetching learning:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('[Session Learning] Exception fetching learning:', error);
      return null;
    }
  }
}

export const sessionLearningGenerator = new SessionLearningGenerator();
export type { SessionLearningData };
