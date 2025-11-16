import { supabase } from '../lib/supabase';

/**
 * Trade Sequence Analyzer
 *
 * Analyzes patterns across consecutive trades to identify:
 * - Win streaks and loss streaks
 * - Pattern degradation (when winning patterns start failing)
 * - Post-win and post-loss behavior
 * - Recovery patterns after drawdowns
 * - Optimal trade spacing
 * - Momentum persistence (when winners predict more winners)
 */

export interface TradeSequence {
  sequenceId: string;
  sequenceType: 'win_streak' | 'loss_streak' | 'alternating' | 'recovery' | 'breakdown';
  sequenceLength: number;
  tradeIds: string[];
  totalPnl: number;
  avgTradePnl: number;
  sequenceWinRate: number;
  patternDetected: string;
  confidence: number;
  startedAt: Date;
  endedAt: Date;
  sessionType?: string;
  marketRegime?: string;
  keyInsight: string;
  recommendation: string;
  shouldContinueTrading: boolean;
  suggestedPositionSizeAdjustment: number; // Multiplier
}

export interface SequenceAnalysis {
  currentStreak: TradeSequence | null;
  historicalStreaks: TradeSequence[];
  postWinPerformance: {
    avgWinRate: number;
    avgPnl: number;
    sampleSize: number;
    recommendation: string;
  };
  postLossPerformance: {
    avgWinRate: number;
    avgPnl: number;
    sampleSize: number;
    recommendation: string;
  };
  optimalTradeSpacing: {
    avgMinutesBetweenWinners: number;
    avgMinutesBetweenLosers: number;
    recommendation: string;
  };
}

class TradeSequenceAnalyzer {
  /**
   * Analyze current trading sequence for a user
   */
  async analyzeCurrentSequence(userId: string): Promise<SequenceAnalysis> {
    console.log('[Sequence Analyzer] Analyzing current trading sequence...');

    // Fetch recent trades (last 50)
    const recentTrades = await this.fetchRecentTrades(userId, 50);

    if (recentTrades.length < 2) {
      console.log('[Sequence Analyzer] Insufficient trades for sequence analysis');
      return this.createEmptyAnalysis();
    }

    // Detect current streak
    const currentStreak = this.detectCurrentStreak(recentTrades);

    // Get historical streaks
    const historicalStreaks = await this.getHistoricalStreaks(userId);

    // Analyze post-win performance
    const postWinPerformance = this.analyzePostTradePerformance(recentTrades, 'win');

    // Analyze post-loss performance
    const postLossPerformance = this.analyzePostTradePerformance(recentTrades, 'loss');

    // Calculate optimal trade spacing
    const optimalTradeSpacing = this.calculateOptimalSpacing(recentTrades);

    // Save current streak if significant
    if (currentStreak && currentStreak.sequenceLength >= 2) {
      await this.saveSequence(userId, currentStreak);
    }

    return {
      currentStreak,
      historicalStreaks,
      postWinPerformance,
      postLossPerformance,
      optimalTradeSpacing
    };
  }

  /**
   * Detect pattern degradation (winning pattern starts failing)
   */
  async detectPatternDegradation(
    userId: string,
    patternName: string,
    lookbackTrades: number = 30
  ): Promise<{
    isDegrading: boolean;
    recentWinRate: number;
    historicalWinRate: number;
    degradationPercent: number;
    recommendation: string;
  }> {
    console.log(`[Sequence Analyzer] Checking degradation for pattern: ${patternName}`);

    const { data: allTrades, error } = await supabase
      .from('ai_trade_analysis')
      .select('*')
      .eq('user_id', userId)
      .contains('matching_historical_patterns', [patternName])
      .order('entry_time', { ascending: false })
      .limit(lookbackTrades * 2);

    if (error || !allTrades || allTrades.length < 20) {
      return {
        isDegrading: false,
        recentWinRate: 0,
        historicalWinRate: 0,
        degradationPercent: 0,
        recommendation: 'Insufficient data for degradation analysis'
      };
    }

    // Split into recent and historical
    const recentTrades = allTrades.slice(0, lookbackTrades);
    const historicalTrades = allTrades.slice(lookbackTrades);

    const recentWins = recentTrades.filter(t => t.outcome === 'win').length;
    const recentWinRate = (recentWins / recentTrades.length) * 100;

    const historicalWins = historicalTrades.filter(t => t.outcome === 'win').length;
    const historicalWinRate = historicalTrades.length > 0
      ? (historicalWins / historicalTrades.length) * 100
      : recentWinRate;

    const degradationPercent = ((recentWinRate - historicalWinRate) / historicalWinRate) * 100;
    const isDegrading = degradationPercent < -20; // 20% drop = degradation

    let recommendation = '';
    if (isDegrading) {
      recommendation = `⚠️ Pattern degradation detected! Win rate dropped from ${historicalWinRate.toFixed(1)}% to ${recentWinRate.toFixed(1)}%. Consider pausing this pattern or reducing position size.`;
    } else if (degradationPercent > 20) {
      recommendation = `🚀 Pattern improving! Win rate increased from ${historicalWinRate.toFixed(1)}% to ${recentWinRate.toFixed(1)}%. Consider increasing position size.`;
    } else {
      recommendation = `✅ Pattern stable. Win rate: ${recentWinRate.toFixed(1)}% (historical: ${historicalWinRate.toFixed(1)}%)`;
    }

    return {
      isDegrading,
      recentWinRate,
      historicalWinRate,
      degradationPercent,
      recommendation
    };
  }

  /**
   * Check if user is overtrading (too many trades too quickly)
   */
  async detectOvertrading(userId: string, hours: number = 24): Promise<{
    isOvertrading: boolean;
    tradesInPeriod: number;
    avgTradesPerDay: number;
    recommendation: string;
  }> {
    const startTime = new Date();
    startTime.setHours(startTime.getHours() - hours);

    const { data: trades, error } = await supabase
      .from('ai_trade_analysis')
      .select('*')
      .eq('user_id', userId)
      .gte('entry_time', startTime.toISOString());

    if (error || !trades) {
      return {
        isOvertrading: false,
        tradesInPeriod: 0,
        avgTradesPerDay: 0,
        recommendation: 'Unable to analyze overtrading'
      };
    }

    const tradesInPeriod = trades.length;
    const avgTradesPerDay = (tradesInPeriod / hours) * 24;

    // Overtrading thresholds
    const isOvertrading = avgTradesPerDay > 15 || tradesInPeriod > 10;

    let recommendation = '';
    if (isOvertrading) {
      recommendation = `⚠️ OVERTRADING DETECTED! ${tradesInPeriod} trades in ${hours}h (${avgTradesPerDay.toFixed(1)} per day). Take a break and reassess.`;
    } else if (avgTradesPerDay > 10) {
      recommendation = `⚡ High trading frequency: ${avgTradesPerDay.toFixed(1)} trades/day. Monitor for quality over quantity.`;
    } else {
      recommendation = `✅ Trading frequency is healthy: ${avgTradesPerDay.toFixed(1)} trades/day`;
    }

    return {
      isOvertrading,
      tradesInPeriod,
      avgTradesPerDay,
      recommendation
    };
  }

  /**
   * Detect momentum persistence (winners clustering together)
   */
  async detectMomentumPersistence(
    userId: string,
    symbol: string
  ): Promise<{
    hasMomentum: boolean;
    consecutiveWins: number;
    nextTradeWinProbability: number;
    recommendation: string;
  }> {
    const trades = await this.fetchRecentTrades(userId, 20, symbol);

    if (trades.length < 5) {
      return {
        hasMomentum: false,
        consecutiveWins: 0,
        nextTradeWinProbability: 50,
        recommendation: 'Insufficient data for momentum analysis'
      };
    }

    // Count consecutive wins from most recent
    let consecutiveWins = 0;
    for (let i = 0; i < trades.length; i++) {
      if (trades[i].outcome === 'win') {
        consecutiveWins++;
      } else {
        break;
      }
    }

    // Calculate win probability after N consecutive wins
    const sequences = this.findWinSequences(trades);
    const afterStreakWins = sequences.filter(seq =>
      seq.length >= 2 && seq.nextTrade === 'win'
    ).length;
    const afterStreakTotal = sequences.filter(seq => seq.length >= 2).length;

    const nextTradeWinProbability = afterStreakTotal > 0
      ? (afterStreakWins / afterStreakTotal) * 100
      : 50;

    const hasMomentum = consecutiveWins >= 2 && nextTradeWinProbability > 60;

    let recommendation = '';
    if (hasMomentum) {
      recommendation = `🚀 MOMENTUM DETECTED! ${consecutiveWins} consecutive wins. Next trade has ${nextTradeWinProbability.toFixed(0)}% win probability. Consider increasing position size.`;
    } else if (consecutiveWins >= 2) {
      recommendation = `✅ ${consecutiveWins} wins, but momentum uncertain. Maintain standard position size.`;
    } else {
      recommendation = `⚡ No current momentum. Trade with caution.`;
    }

    return {
      hasMomentum,
      consecutiveWins,
      nextTradeWinProbability,
      recommendation
    };
  }

  /**
   * Fetch recent trades
   */
  private async fetchRecentTrades(
    userId: string,
    limit: number,
    symbol?: string
  ): Promise<any[]> {
    let query = supabase
      .from('ai_trade_analysis')
      .select('*')
      .eq('user_id', userId)
      .in('outcome', ['win', 'loss'])
      .order('entry_time', { ascending: false })
      .limit(limit);

    if (symbol) {
      query = query.eq('symbol', symbol);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Sequence Analyzer] Error fetching trades:', error);
      return [];
    }

    return (data || []).reverse(); // Oldest first
  }

  /**
   * Detect current streak
   */
  private detectCurrentStreak(trades: any[]): TradeSequence | null {
    if (trades.length < 2) return null;

    const mostRecent = trades[trades.length - 1];
    let streakType: 'win_streak' | 'loss_streak' | 'alternating' =
      mostRecent.outcome === 'win' ? 'win_streak' : 'loss_streak';

    const streakTrades = [mostRecent];
    let totalPnl = parseFloat(mostRecent.pnl.toString());

    // Walk backwards to find streak
    for (let i = trades.length - 2; i >= 0; i--) {
      if (trades[i].outcome === mostRecent.outcome) {
        streakTrades.unshift(trades[i]);
        totalPnl += parseFloat(trades[i].pnl.toString());
      } else {
        break;
      }
    }

    if (streakTrades.length < 2) return null;

    const avgPnl = totalPnl / streakTrades.length;
    const winRate = streakType === 'win_streak' ? 100 : 0;

    // Generate insights
    let keyInsight = '';
    let recommendation = '';
    let shouldContinueTrading = true;
    let positionSizeAdjustment = 1.0;

    if (streakType === 'win_streak') {
      keyInsight = `${streakTrades.length} consecutive wins. Momentum is strong.`;
      recommendation = `Continue trading with confidence. Consider 1.25x position size on high-confidence setups.`;
      positionSizeAdjustment = 1.25;
    } else {
      keyInsight = `${streakTrades.length} consecutive losses. Potential drawdown phase.`;

      if (streakTrades.length >= 5) {
        recommendation = `STOP TRADING. Take a break, review losses, and reset mentally.`;
        shouldContinueTrading = false;
        positionSizeAdjustment = 0;
      } else if (streakTrades.length >= 3) {
        recommendation = `Reduce position size to 0.5x. Be highly selective.`;
        positionSizeAdjustment = 0.5;
      } else {
        recommendation = `Reduce position size to 0.75x. Focus on quality setups.`;
        positionSizeAdjustment = 0.75;
      }
    }

    return {
      sequenceId: `seq_${Date.now()}`,
      sequenceType: streakType,
      sequenceLength: streakTrades.length,
      tradeIds: streakTrades.map(t => t.id),
      totalPnl,
      avgTradePnl: avgPnl,
      sequenceWinRate: winRate,
      patternDetected: `${streakType}_${streakTrades.length}`,
      confidence: Math.min(95, streakTrades.length * 15),
      startedAt: new Date(streakTrades[0].entry_time),
      endedAt: new Date(streakTrades[streakTrades.length - 1].entry_time),
      keyInsight,
      recommendation,
      shouldContinueTrading,
      suggestedPositionSizeAdjustment: positionSizeAdjustment
    };
  }

  /**
   * Analyze post-trade performance
   */
  private analyzePostTradePerformance(
    trades: any[],
    afterOutcome: 'win' | 'loss'
  ): { avgWinRate: number; avgPnl: number; sampleSize: number; recommendation: string } {
    const postTrades = [];

    for (let i = 0; i < trades.length - 1; i++) {
      if (trades[i].outcome === afterOutcome) {
        postTrades.push(trades[i + 1]);
      }
    }

    if (postTrades.length === 0) {
      return {
        avgWinRate: 0,
        avgPnl: 0,
        sampleSize: 0,
        recommendation: 'Insufficient data'
      };
    }

    const wins = postTrades.filter(t => t.outcome === 'win').length;
    const avgWinRate = (wins / postTrades.length) * 100;
    const avgPnl = postTrades.reduce((sum, t) => sum + parseFloat(t.pnl.toString()), 0) / postTrades.length;

    let recommendation = '';
    if (afterOutcome === 'win') {
      if (avgWinRate > 65) {
        recommendation = `Momentum trader! Your post-win trades have ${avgWinRate.toFixed(1)}% win rate. Capitalize on hot streaks.`;
      } else if (avgWinRate < 45) {
        recommendation = `Overtrading after wins. Post-win trades only ${avgWinRate.toFixed(1)}% win rate. Be more selective.`;
      } else {
        recommendation = `Post-win performance is neutral at ${avgWinRate.toFixed(1)}% win rate.`;
      }
    } else {
      if (avgWinRate > 60) {
        recommendation = `Strong recovery! Post-loss trades have ${avgWinRate.toFixed(1)}% win rate. Good mental resilience.`;
      } else if (avgWinRate < 40) {
        recommendation = `Revenge trading detected. Post-loss trades only ${avgWinRate.toFixed(1)}% win rate. Take breaks after losses.`;
      } else {
        recommendation = `Post-loss performance is neutral at ${avgWinRate.toFixed(1)}% win rate.`;
      }
    }

    return {
      avgWinRate,
      avgPnl,
      sampleSize: postTrades.length,
      recommendation
    };
  }

  /**
   * Calculate optimal trade spacing
   */
  private calculateOptimalSpacing(trades: any[]): {
    avgMinutesBetweenWinners: number;
    avgMinutesBetweenLosers: number;
    recommendation: string;
  } {
    const winners = trades.filter(t => t.outcome === 'win');
    const losers = trades.filter(t => t.outcome === 'loss');

    const winnerSpacing = this.calculateAvgSpacing(winners);
    const loserSpacing = this.calculateAvgSpacing(losers);

    let recommendation = '';
    if (loserSpacing < 30 && loserSpacing > 0) {
      recommendation = `⚠️ Losses are clustered (avg ${loserSpacing.toFixed(0)} min apart). Wait longer between trades.`;
    } else if (winnerSpacing > 120) {
      recommendation = `✅ Winners are well-spaced (avg ${(winnerSpacing / 60).toFixed(1)}h apart). Patience is paying off.`;
    } else {
      recommendation = `Trade spacing is reasonable.`;
    }

    return {
      avgMinutesBetweenWinners: winnerSpacing,
      avgMinutesBetweenLosers: loserSpacing,
      recommendation
    };
  }

  /**
   * Calculate average spacing between trades
   */
  private calculateAvgSpacing(trades: any[]): number {
    if (trades.length < 2) return 0;

    let totalMinutes = 0;
    let count = 0;

    for (let i = 1; i < trades.length; i++) {
      const time1 = new Date(trades[i - 1].entry_time).getTime();
      const time2 = new Date(trades[i].entry_time).getTime();
      totalMinutes += (time2 - time1) / 60000;
      count++;
    }

    return count > 0 ? totalMinutes / count : 0;
  }

  /**
   * Find win sequences
   */
  private findWinSequences(trades: any[]): Array<{ length: number; nextTrade?: string }> {
    const sequences = [];
    let currentSequence = 0;

    for (let i = 0; i < trades.length; i++) {
      if (trades[i].outcome === 'win') {
        currentSequence++;
      } else {
        if (currentSequence > 0) {
          sequences.push({
            length: currentSequence,
            nextTrade: 'loss'
          });
        }
        currentSequence = 0;
      }
    }

    return sequences;
  }

  /**
   * Get historical streaks
   */
  private async getHistoricalStreaks(userId: string): Promise<TradeSequence[]> {
    const { data, error } = await supabase
      .from('trade_sequence_analysis')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false })
      .limit(20);

    if (error || !data) {
      return [];
    }

    return data.map(row => ({
      sequenceId: row.sequence_id,
      sequenceType: row.sequence_type,
      sequenceLength: row.sequence_length,
      tradeIds: row.trade_ids,
      totalPnl: parseFloat(row.total_pnl.toString()),
      avgTradePnl: parseFloat(row.avg_trade_pnl.toString()),
      sequenceWinRate: parseFloat(row.sequence_win_rate?.toString() || '0'),
      patternDetected: row.pattern_detected,
      confidence: parseFloat(row.confidence?.toString() || '0'),
      startedAt: new Date(row.started_at),
      endedAt: new Date(row.ended_at),
      sessionType: row.session_type,
      marketRegime: row.market_regime,
      keyInsight: row.key_insight,
      recommendation: row.recommendation,
      shouldContinueTrading: row.should_continue_trading,
      suggestedPositionSizeAdjustment: parseFloat(row.suggested_position_size_adjustment?.toString() || '1')
    }));
  }

  /**
   * Save sequence to database
   */
  private async saveSequence(userId: string, sequence: TradeSequence): Promise<void> {
    const { error } = await supabase
      .from('trade_sequence_analysis')
      .insert({
        user_id: userId,
        sequence_id: sequence.sequenceId,
        sequence_type: sequence.sequenceType,
        sequence_length: sequence.sequenceLength,
        trade_ids: sequence.tradeIds,
        total_pnl: sequence.totalPnl,
        avg_trade_pnl: sequence.avgTradePnl,
        sequence_win_rate: sequence.sequenceWinRate,
        pattern_detected: sequence.patternDetected,
        confidence: sequence.confidence,
        started_at: sequence.startedAt.toISOString(),
        ended_at: sequence.endedAt.toISOString(),
        session_type: sequence.sessionType,
        market_regime: sequence.marketRegime,
        key_insight: sequence.keyInsight,
        recommendation: sequence.recommendation,
        should_continue_trading: sequence.shouldContinueTrading,
        suggested_position_size_adjustment: sequence.suggestedPositionSizeAdjustment
      });

    if (error) {
      console.error('[Sequence Analyzer] Error saving sequence:', error);
    }
  }

  /**
   * Create empty analysis
   */
  private createEmptyAnalysis(): SequenceAnalysis {
    return {
      currentStreak: null,
      historicalStreaks: [],
      postWinPerformance: {
        avgWinRate: 0,
        avgPnl: 0,
        sampleSize: 0,
        recommendation: 'Insufficient data'
      },
      postLossPerformance: {
        avgWinRate: 0,
        avgPnl: 0,
        sampleSize: 0,
        recommendation: 'Insufficient data'
      },
      optimalTradeSpacing: {
        avgMinutesBetweenWinners: 0,
        avgMinutesBetweenLosers: 0,
        recommendation: 'Insufficient data'
      }
    };
  }
}

export const tradeSequenceAnalyzer = new TradeSequenceAnalyzer();
