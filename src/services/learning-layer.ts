import { supabase } from '../lib/supabase';

export interface LearningPattern {
  strategyName: string;
  symbol: string;
  timeframe: string;
  featureVector: {
    h1Bias: string;
    m5HalfTrend: string;
    m5StochRSI: number;
    m1HAFlip: string;
    m1RSI: number;
    volatility: number;
    trend: string;
    timeOfDay: string;
    dayOfWeek: string;
  };
  outcome: 'win' | 'loss';
  riskReward: number;
  mae: number;
  mfe: number;
  durationMinutes: number;
  confidenceAtEntry: number;
}

class LearningLayer {
  async recordTradeOutcome(
    userId: string,
    trade: any,
    signal: any,
    marketConditions: any
  ): Promise<void> {
    try {
      const outcome: 'win' | 'loss' = trade.profit_loss > 0 ? 'win' : 'loss';
      const riskReward = trade.profit_loss / Math.abs(trade.entry_price - trade.stop_loss);

      const openedAt = new Date(trade.opened_at);
      const closedAt = new Date(trade.closed_at);
      const durationMinutes = Math.floor((closedAt.getTime() - openedAt.getTime()) / 60000);

      const timeOfDay = this.getTimeOfDay(openedAt);
      const dayOfWeek = openedAt.toLocaleDateString('en-US', { weekday: 'long' });

      const featureVector = {
        h1Bias: signal?.h1Bias || 'unknown',
        m5HalfTrend: signal?.m5FilterPassed ? 'passed' : 'failed',
        m5StochRSI: marketConditions?.stochRSI || 50,
        m1HAFlip: signal?.m1ExecutionReady ? 'confirmed' : 'unconfirmed',
        m1RSI: marketConditions?.rsi || 50,
        volatility: marketConditions?.volatility || 'medium',
        trend: marketConditions?.trend || 'sideways',
        timeOfDay,
        dayOfWeek
      };

      await supabase.from('learning_patterns').insert({
        user_id: userId,
        strategy_name: trade.strategy_used || 'flow_v2',
        symbol: trade.symbol,
        timeframe: '1m',
        feature_vector: featureVector,
        outcome,
        win: outcome === 'win',
        risk_reward: riskReward,
        mae: trade.mae || 0,
        mfe: trade.mfe || 0,
        duration_minutes: durationMinutes,
        weight: 1.0,
        confidence_at_entry: signal?.confidence || 75,
        market_regime: marketConditions?.regime || 'unknown',
        time_of_day: timeOfDay
      });

      await this.updateStrategyPerformance(userId, trade, outcome, riskReward, durationMinutes);

      console.log(`[Learning Layer] Recorded ${outcome} for ${trade.symbol} trade`);

    } catch (error) {
      console.error('[Learning Layer] Error recording trade outcome:', error);
    }
  }

  private async updateStrategyPerformance(
    userId: string,
    trade: any,
    outcome: 'win' | 'loss',
    riskReward: number,
    durationMinutes: number
  ): Promise<void> {
    try {
      const strategyName = trade.strategy_used || 'flow_v2';
      const symbol = trade.symbol;
      const timeframe = '1m';

      const { data: existing } = await supabase
        .from('strategy_performance')
        .select('*')
        .eq('user_id', userId)
        .eq('strategy_name', strategyName)
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .maybeSingle();

      if (existing) {
        const totalTrades = existing.total_trades + 1;
        const winningTrades = outcome === 'win' ? existing.winning_trades + 1 : existing.winning_trades;
        const losingTrades = outcome === 'loss' ? existing.losing_trades + 1 : existing.losing_trades;
        const winRate = (winningTrades / totalTrades) * 100;

        const avgRR = ((existing.avg_risk_reward * existing.total_trades) + riskReward) / totalTrades;
        const totalProfit = existing.total_profit + trade.profit_loss;

        const expectancy = (winRate / 100) * avgRR - ((100 - winRate) / 100);

        const avgDuration = Math.floor(
          ((existing.avg_duration_minutes * existing.total_trades) + durationMinutes) / totalTrades
        );

        let confidenceThreshold = existing.confidence_threshold;
        if (winRate < 70) {
          confidenceThreshold = Math.min(95, confidenceThreshold + 2);
        } else if (winRate > 85) {
          confidenceThreshold = Math.max(65, confidenceThreshold - 1);
        }

        await supabase
          .from('strategy_performance')
          .update({
            total_trades: totalTrades,
            winning_trades: winningTrades,
            losing_trades: losingTrades,
            win_rate: winRate,
            avg_risk_reward: avgRR,
            expectancy,
            total_profit: totalProfit,
            avg_duration_minutes: avgDuration,
            confidence_threshold: confidenceThreshold,
            last_adjusted_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);

        console.log(`[Learning Layer] Updated ${strategyName} performance: ${winRate.toFixed(1)}% win rate, ${expectancy.toFixed(2)} expectancy`);

      } else {
        await supabase.from('strategy_performance').insert({
          user_id: userId,
          strategy_name: strategyName,
          symbol,
          timeframe,
          total_trades: 1,
          winning_trades: outcome === 'win' ? 1 : 0,
          losing_trades: outcome === 'loss' ? 1 : 0,
          win_rate: outcome === 'win' ? 100 : 0,
          avg_risk_reward: riskReward,
          expectancy: outcome === 'win' ? riskReward : -1,
          total_profit: trade.profit_loss,
          avg_duration_minutes: durationMinutes,
          confidence_threshold: 75
        });
      }

    } catch (error) {
      console.error('[Learning Layer] Error updating strategy performance:', error);
    }
  }

  async getStrategyPerformance(
    userId: string,
    strategyName: string,
    symbol: string
  ): Promise<any | null> {
    try {
      const { data, error } = await supabase
        .from('strategy_performance')
        .select('*')
        .eq('user_id', userId)
        .eq('strategy_name', strategyName)
        .eq('symbol', symbol)
        .maybeSingle();

      if (error) {
        console.error('[Learning Layer] Error fetching strategy performance:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('[Learning Layer] Error in getStrategyPerformance:', error);
      return null;
    }
  }

  async getConfidenceThreshold(
    userId: string,
    strategyName: string,
    symbol: string
  ): Promise<number> {
    const performance = await this.getStrategyPerformance(userId, strategyName, symbol);
    return performance?.confidence_threshold || 75;
  }

  async analyzeLearningPatterns(userId: string, symbol: string): Promise<{
    bestTimeOfDay: string;
    bestDayOfWeek: string;
    bestSetupType: string;
    avgWinDuration: number;
    avgLossDuration: number;
    insights: string[];
  }> {
    try {
      const { data: patterns } = await supabase
        .from('learning_patterns')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .order('created_at', { ascending: false })
        .limit(100);

      if (!patterns || patterns.length < 10) {
        return {
          bestTimeOfDay: 'unknown',
          bestDayOfWeek: 'unknown',
          bestSetupType: 'unknown',
          avgWinDuration: 0,
          avgLossDuration: 0,
          insights: ['Collecting more data to provide meaningful insights...']
        };
      }

      const wins = patterns.filter(p => p.win);
      const losses = patterns.filter(p => !p.win);

      const timeOfDayWins: Record<string, number> = {};
      const dayOfWeekWins: Record<string, number> = {};

      wins.forEach(w => {
        const tod = w.time_of_day || 'unknown';
        const dow = (w.feature_vector as any)?.dayOfWeek || 'unknown';

        timeOfDayWins[tod] = (timeOfDayWins[tod] || 0) + 1;
        dayOfWeekWins[dow] = (dayOfWeekWins[dow] || 0) + 1;
      });

      const bestTimeOfDay = Object.keys(timeOfDayWins).reduce((a, b) =>
        timeOfDayWins[a] > timeOfDayWins[b] ? a : b, 'unknown'
      );

      const bestDayOfWeek = Object.keys(dayOfWeekWins).reduce((a, b) =>
        dayOfWeekWins[a] > dayOfWeekWins[b] ? a : b, 'unknown'
      );

      const avgWinDuration = wins.length > 0
        ? wins.reduce((sum, w) => sum + (w.duration_minutes || 0), 0) / wins.length
        : 0;

      const avgLossDuration = losses.length > 0
        ? losses.reduce((sum, l) => sum + (l.duration_minutes || 0), 0) / losses.length
        : 0;

      const insights: string[] = [];
      const winRate = (wins.length / patterns.length) * 100;

      insights.push(`${symbol} win rate: ${winRate.toFixed(1)}% over last ${patterns.length} trades`);

      if (bestTimeOfDay !== 'unknown') {
        insights.push(`Best performance during ${bestTimeOfDay} trading hours`);
      }

      if (avgWinDuration < avgLossDuration) {
        insights.push(`Winning trades close ${((avgLossDuration - avgWinDuration) / avgWinDuration * 100).toFixed(0)}% faster than losing trades`);
      }

      if (winRate > 80) {
        insights.push(`Exceptional performance on ${symbol}. Current strategy working well.`);
      } else if (winRate < 60) {
        insights.push(`${symbol} performance below target. Consider adjusting entry criteria.`);
      }

      return {
        bestTimeOfDay,
        bestDayOfWeek,
        bestSetupType: 'flow_v2',
        avgWinDuration,
        avgLossDuration,
        insights
      };

    } catch (error) {
      console.error('[Learning Layer] Error analyzing patterns:', error);
      return {
        bestTimeOfDay: 'unknown',
        bestDayOfWeek: 'unknown',
        bestSetupType: 'unknown',
        avgWinDuration: 0,
        avgLossDuration: 0,
        insights: ['Error analyzing learning patterns']
      };
    }
  }

  async generateDailySummary(userId: string, sessionId: string): Promise<string> {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data: patterns } = await supabase
        .from('learning_patterns')
        .select('*')
        .eq('user_id', userId)
        .gte('created_at', today.toISOString());

      if (!patterns || patterns.length === 0) {
        return 'No trades today to analyze.';
      }

      const wins = patterns.filter(p => p.win).length;
      const losses = patterns.length - wins;
      const winRate = (wins / patterns.length) * 100;

      const bestPerformingSymbol = this.findBestPerformingSymbol(patterns);

      let summary = `Today's Learning Summary:\n\n`;
      summary += `📊 Trades: ${patterns.length} (${wins} wins, ${losses} losses)\n`;
      summary += `✅ Win Rate: ${winRate.toFixed(1)}%\n\n`;

      if (bestPerformingSymbol) {
        summary += `🌟 Best: ${bestPerformingSymbol}\n\n`;
      }

      summary += `💡 Key Learnings:\n`;

      if (winRate >= 80) {
        summary += `- Excellent execution today. Strategy alignment is strong.\n`;
      } else if (winRate >= 70) {
        summary += `- Good performance. Minor adjustments may improve consistency.\n`;
      } else {
        summary += `- Below target. Reviewing patterns to identify improvements.\n`;
      }

      const avgRR = patterns.reduce((sum, p) => sum + (p.risk_reward || 0), 0) / patterns.length;
      summary += `- Average Risk:Reward: 1:${avgRR.toFixed(2)}\n`;

      return summary;

    } catch (error) {
      console.error('[Learning Layer] Error generating daily summary:', error);
      return 'Error generating learning summary.';
    }
  }

  private findBestPerformingSymbol(patterns: any[]): string | null {
    const symbolStats: Record<string, { wins: number; total: number }> = {};

    patterns.forEach(p => {
      if (!symbolStats[p.symbol]) {
        symbolStats[p.symbol] = { wins: 0, total: 0 };
      }

      symbolStats[p.symbol].total++;
      if (p.win) symbolStats[p.symbol].wins++;
    });

    let bestSymbol = null;
    let bestWinRate = 0;

    Object.entries(symbolStats).forEach(([symbol, stats]) => {
      if (stats.total >= 2) {
        const winRate = (stats.wins / stats.total) * 100;
        if (winRate > bestWinRate) {
          bestWinRate = winRate;
          bestSymbol = symbol;
        }
      }
    });

    return bestSymbol ? `${bestSymbol} (${bestWinRate.toFixed(0)}%)` : null;
  }

  private getTimeOfDay(date: Date): string {
    const hour = date.getHours();

    if (hour >= 0 && hour < 6) return 'late_night';
    if (hour >= 6 && hour < 9) return 'early_morning';
    if (hour >= 9 && hour < 12) return 'morning';
    if (hour >= 12 && hour < 15) return 'afternoon';
    if (hour >= 15 && hour < 18) return 'late_afternoon';
    if (hour >= 18 && hour < 21) return 'evening';
    return 'night';
  }
}

export const learningLayer = new LearningLayer();
