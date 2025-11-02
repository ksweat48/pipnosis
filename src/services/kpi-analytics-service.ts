import { supabase } from '@/lib/supabase';

interface TradeData {
  id: string;
  user_id: string;
  symbol: string;
  profit_loss: number;
  opened_at: string;
  closed_at: string;
  strategy_type?: string;
  entry_price?: number;
  exit_price?: number;
  lot_size?: number;
  trade_direction?: string;
  ai_confidence?: string;
  metadata?: any;
}

interface StrategyPerformanceData {
  user_id: string;
  trade_id: string;
  strategy_type: string;
  symbol: string;
  timeframe?: string;
  trade_direction?: string;
  entry_price?: number;
  exit_price?: number;
  lot_size?: number;
  profit_loss: number;
  is_win: boolean;
  ai_confidence?: string;
  market_condition?: string;
  entry_reason?: string;
  exit_reason?: string;
  trade_duration_minutes?: number;
  executed_at: string;
}

class KPIAnalyticsService {
  async collectTradePerformanceData(): Promise<void> {
    try {
      console.log('Starting KPI data collection...');

      const simulatedTrades = await this.fetchSimulatedTrades();
      const tradeHistoryRecords = await this.fetchTradeHistory();

      const allTrades = [...simulatedTrades, ...tradeHistoryRecords];

      for (const trade of allTrades) {
        await this.processTradeForKPI(trade);
      }

      await this.updateAggregatedMetrics();
      await this.updateStrategyAnalytics();
      await this.updateUserPerformanceSummaries();

      console.log('KPI data collection completed successfully');
    } catch (error) {
      console.error('Error in KPI data collection:', error);
    }
  }

  private async fetchSimulatedTrades(): Promise<TradeData[]> {
    const { data, error } = await supabase
      .from('simulated_positions')
      .select('*')
      .eq('status', 'closed')
      .not('closed_at', 'is', null);

    if (error) {
      console.error('Error fetching simulated trades:', error);
      return [];
    }

    return data || [];
  }

  private async fetchTradeHistory(): Promise<TradeData[]> {
    const { data, error } = await supabase
      .from('trade_history')
      .select('*')
      .eq('status', 'closed')
      .not('closed_at', 'is', null);

    if (error) {
      console.error('Error fetching trade history:', error);
      return [];
    }

    return data || [];
  }

  private async processTradeForKPI(trade: TradeData): Promise<void> {
    try {
      const exists = await this.checkIfTradeProcessed(trade.id);
      if (exists) {
        return;
      }

      const strategyType = this.extractStrategyType(trade);
      const aiConfidence = this.extractAIConfidence(trade);
      const marketCondition = this.extractMarketCondition(trade);
      const tradeDuration = this.calculateTradeDuration(trade.opened_at, trade.closed_at);

      const performanceData: StrategyPerformanceData = {
        user_id: trade.user_id,
        trade_id: trade.id,
        strategy_type: strategyType,
        symbol: trade.symbol,
        timeframe: trade.metadata?.timeframe || '1h',
        trade_direction: trade.trade_direction || this.inferDirection(trade),
        entry_price: trade.entry_price,
        exit_price: trade.exit_price,
        lot_size: trade.lot_size,
        profit_loss: trade.profit_loss,
        is_win: trade.profit_loss > 0,
        ai_confidence: aiConfidence,
        market_condition: marketCondition,
        entry_reason: trade.metadata?.entry_reason || 'AI signal',
        exit_reason: trade.metadata?.exit_reason || 'Target/Stop reached',
        trade_duration_minutes: tradeDuration,
        executed_at: trade.closed_at,
      };

      const { error } = await supabase
        .from('ai_strategy_performance')
        .insert(performanceData);

      if (error) {
        console.error('Error inserting strategy performance:', error);
      }
    } catch (error) {
      console.error('Error processing trade for KPI:', error);
    }
  }

  private async checkIfTradeProcessed(tradeId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('ai_strategy_performance')
      .select('id')
      .eq('trade_id', tradeId)
      .maybeSingle();

    return !error && data !== null;
  }

  private extractStrategyType(trade: TradeData): string {
    if (trade.strategy_type) return trade.strategy_type;
    if (trade.metadata?.strategy) return trade.metadata.strategy;
    if (trade.metadata?.strategy_type) return trade.metadata.strategy_type;
    return 'Unknown';
  }

  private extractAIConfidence(trade: TradeData): string {
    if (trade.ai_confidence) return trade.ai_confidence;
    if (trade.metadata?.confidence) return trade.metadata.confidence;
    if (trade.metadata?.ai_confidence) return trade.metadata.ai_confidence;
    return 'medium';
  }

  private extractMarketCondition(trade: TradeData): string {
    if (trade.metadata?.market_condition) return trade.metadata.market_condition;
    if (trade.metadata?.trend) return trade.metadata.trend;
    return 'neutral';
  }

  private inferDirection(trade: TradeData): string {
    if (trade.profit_loss > 0) {
      return trade.entry_price && trade.exit_price && trade.exit_price > trade.entry_price ? 'buy' : 'sell';
    }
    return 'buy';
  }

  private calculateTradeDuration(openedAt: string, closedAt: string): number {
    const start = new Date(openedAt).getTime();
    const end = new Date(closedAt).getTime();
    return Math.floor((end - start) / (1000 * 60));
  }

  private async updateAggregatedMetrics(): Promise<void> {
    await this.updateMetricsForPeriod('daily');
    await this.updateMetricsForPeriod('weekly');
    await this.updateMetricsForPeriod('monthly');
    await this.updateMetricsForPeriod('all_time');
  }

  private async updateMetricsForPeriod(period: string): Promise<void> {
    try {
      const { periodStart, periodEnd } = this.getPeriodDates(period);

      let query = supabase
        .from('ai_strategy_performance')
        .select('*');

      if (period !== 'all_time') {
        query = query
          .gte('executed_at', periodStart.toISOString())
          .lte('executed_at', periodEnd.toISOString());
      }

      const { data: trades, error } = await query;

      if (error || !trades) {
        console.error(`Error fetching trades for ${period}:`, error);
        return;
      }

      const metrics = this.calculateMetrics(trades);
      const previousPeriodMetrics = await this.getPreviousPeriodMetrics(period);
      const improvementPercentage = this.calculateImprovement(metrics.winRate, previousPeriodMetrics?.win_rate || 0);

      const metricsData = {
        metric_period: period,
        period_start: period === 'all_time' ? null : periodStart.toISOString().split('T')[0],
        period_end: period === 'all_time' ? null : periodEnd.toISOString().split('T')[0],
        total_trades: metrics.totalTrades,
        winning_trades: metrics.winningTrades,
        losing_trades: metrics.losingTrades,
        win_rate: metrics.winRate,
        total_profit: metrics.totalProfit,
        total_loss: metrics.totalLoss,
        net_profit: metrics.netProfit,
        average_win: metrics.averageWin,
        average_loss: metrics.averageLoss,
        profit_factor: metrics.profitFactor,
        best_strategy: metrics.bestStrategy,
        worst_strategy: metrics.worstStrategy,
        improvement_percentage: improvementPercentage,
        confidence_accuracy: metrics.confidenceAccuracy,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertError } = await supabase
        .from('ai_learning_metrics')
        .upsert(metricsData, {
          onConflict: 'metric_period,period_start,period_end'
        });

      if (upsertError) {
        console.error(`Error upserting metrics for ${period}:`, upsertError);
      }
    } catch (error) {
      console.error(`Error updating metrics for ${period}:`, error);
    }
  }

  private getPeriodDates(period: string): { periodStart: Date; periodEnd: Date } {
    const now = new Date();
    let periodEnd = new Date(now);
    let periodStart = new Date(now);

    switch (period) {
      case 'daily':
        periodStart.setHours(0, 0, 0, 0);
        periodEnd.setHours(23, 59, 59, 999);
        break;
      case 'weekly':
        const dayOfWeek = now.getDay();
        periodStart.setDate(now.getDate() - dayOfWeek);
        periodStart.setHours(0, 0, 0, 0);
        periodEnd.setHours(23, 59, 59, 999);
        break;
      case 'monthly':
        periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
        periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        break;
      case 'all_time':
        periodStart = new Date(2020, 0, 1);
        break;
    }

    return { periodStart, periodEnd };
  }

  private calculateMetrics(trades: any[]): any {
    const winningTrades = trades.filter(t => t.is_win);
    const losingTrades = trades.filter(t => !t.is_win);

    const totalProfit = winningTrades.reduce((sum, t) => sum + parseFloat(t.profit_loss || 0), 0);
    const totalLoss = Math.abs(losingTrades.reduce((sum, t) => sum + parseFloat(t.profit_loss || 0), 0));

    const winRate = trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0;
    const averageWin = winningTrades.length > 0 ? totalProfit / winningTrades.length : 0;
    const averageLoss = losingTrades.length > 0 ? totalLoss / losingTrades.length : 0;
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : 0;

    const strategyPerformance = this.groupByStrategy(trades);
    const bestStrategy = strategyPerformance.best?.strategy || 'None';
    const worstStrategy = strategyPerformance.worst?.strategy || 'None';

    const highConfidenceTrades = trades.filter(t => t.ai_confidence === 'high');
    const highConfidenceWins = highConfidenceTrades.filter(t => t.is_win).length;
    const confidenceAccuracy = highConfidenceTrades.length > 0
      ? (highConfidenceWins / highConfidenceTrades.length) * 100
      : 0;

    return {
      totalTrades: trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: parseFloat(winRate.toFixed(2)),
      totalProfit: parseFloat(totalProfit.toFixed(2)),
      totalLoss: parseFloat(totalLoss.toFixed(2)),
      netProfit: parseFloat((totalProfit - totalLoss).toFixed(2)),
      averageWin: parseFloat(averageWin.toFixed(2)),
      averageLoss: parseFloat(averageLoss.toFixed(2)),
      profitFactor: parseFloat(profitFactor.toFixed(2)),
      bestStrategy,
      worstStrategy,
      confidenceAccuracy: parseFloat(confidenceAccuracy.toFixed(2)),
    };
  }

  private groupByStrategy(trades: any[]): any {
    const strategyMap = new Map<string, { wins: number; total: number; profit: number }>();

    trades.forEach(trade => {
      const strategy = trade.strategy_type;
      if (!strategyMap.has(strategy)) {
        strategyMap.set(strategy, { wins: 0, total: 0, profit: 0 });
      }
      const stats = strategyMap.get(strategy)!;
      stats.total++;
      if (trade.is_win) stats.wins++;
      stats.profit += parseFloat(trade.profit_loss || 0);
    });

    let best = { strategy: '', winRate: 0 };
    let worst = { strategy: '', winRate: 100 };

    strategyMap.forEach((stats, strategy) => {
      const winRate = (stats.wins / stats.total) * 100;
      if (winRate > best.winRate) {
        best = { strategy, winRate };
      }
      if (winRate < worst.winRate && stats.total > 5) {
        worst = { strategy, winRate };
      }
    });

    return { best, worst };
  }

  private async getPreviousPeriodMetrics(period: string): Promise<any> {
    const { data } = await supabase
      .from('ai_learning_metrics')
      .select('*')
      .eq('metric_period', period)
      .order('created_at', { ascending: false })
      .limit(2);

    return data && data.length > 1 ? data[1] : null;
  }

  private calculateImprovement(currentWinRate: number, previousWinRate: number): number {
    if (previousWinRate === 0) return 0;
    return parseFloat((((currentWinRate - previousWinRate) / previousWinRate) * 100).toFixed(2));
  }

  private async updateStrategyAnalytics(): Promise<void> {
    try {
      const { data: trades, error } = await supabase
        .from('ai_strategy_performance')
        .select('*');

      if (error || !trades) {
        console.error('Error fetching trades for strategy analytics:', error);
        return;
      }

      const strategyMap = new Map<string, any[]>();
      trades.forEach(trade => {
        const strategy = trade.strategy_type;
        if (!strategyMap.has(strategy)) {
          strategyMap.set(strategy, []);
        }
        strategyMap.get(strategy)!.push(trade);
      });

      for (const [strategyType, strategyTrades] of strategyMap.entries()) {
        const analytics = this.calculateStrategyAnalytics(strategyType, strategyTrades);

        const { error: upsertError } = await supabase
          .from('strategy_analytics')
          .upsert(analytics, { onConflict: 'strategy_type' });

        if (upsertError) {
          console.error(`Error upserting analytics for ${strategyType}:`, upsertError);
        }
      }
    } catch (error) {
      console.error('Error updating strategy analytics:', error);
    }
  }

  private calculateStrategyAnalytics(strategyType: string, trades: any[]): any {
    const wins = trades.filter(t => t.is_win);
    const losses = trades.filter(t => !t.is_win);

    const totalProfit = wins.reduce((sum, t) => sum + parseFloat(t.profit_loss || 0), 0);
    const totalLoss = Math.abs(losses.reduce((sum, t) => sum + parseFloat(t.profit_loss || 0), 0));

    const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
    const averageWinSize = wins.length > 0 ? totalProfit / wins.length : 0;
    const averageLossSize = losses.length > 0 ? totalLoss / losses.length : 0;

    const largestWin = wins.length > 0 ? Math.max(...wins.map(t => parseFloat(t.profit_loss))) : 0;
    const largestLoss = losses.length > 0 ? Math.abs(Math.min(...losses.map(t => parseFloat(t.profit_loss)))) : 0;

    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : 0;
    const riskRewardRatio = averageLossSize > 0 ? averageWinSize / averageLossSize : 0;

    const avgDuration = trades.length > 0
      ? trades.reduce((sum, t) => sum + (t.trade_duration_minutes || 0), 0) / trades.length
      : 0;

    const symbolPerformance = this.findBestSymbol(trades);
    const timeframePerformance = this.findBestTimeframe(trades);

    return {
      strategy_type: strategyType,
      total_trades: trades.length,
      win_count: wins.length,
      loss_count: losses.length,
      win_rate: parseFloat(winRate.toFixed(2)),
      total_profit: parseFloat(totalProfit.toFixed(2)),
      total_loss: parseFloat(totalLoss.toFixed(2)),
      net_profit: parseFloat((totalProfit - totalLoss).toFixed(2)),
      average_win_size: parseFloat(averageWinSize.toFixed(2)),
      average_loss_size: parseFloat(averageLossSize.toFixed(2)),
      largest_win: parseFloat(largestWin.toFixed(2)),
      largest_loss: parseFloat(largestLoss.toFixed(2)),
      profit_factor: parseFloat(profitFactor.toFixed(2)),
      risk_reward_ratio: parseFloat(riskRewardRatio.toFixed(2)),
      average_trade_duration: Math.floor(avgDuration),
      best_symbol: symbolPerformance.symbol,
      best_timeframe: timeframePerformance.timeframe,
      last_updated: new Date().toISOString(),
    };
  }

  private findBestSymbol(trades: any[]): { symbol: string } {
    const symbolMap = new Map<string, { wins: number; total: number }>();

    trades.forEach(trade => {
      const symbol = trade.symbol;
      if (!symbolMap.has(symbol)) {
        symbolMap.set(symbol, { wins: 0, total: 0 });
      }
      const stats = symbolMap.get(symbol)!;
      stats.total++;
      if (trade.is_win) stats.wins++;
    });

    let bestSymbol = { symbol: 'None', winRate: 0 };
    symbolMap.forEach((stats, symbol) => {
      const winRate = (stats.wins / stats.total) * 100;
      if (winRate > bestSymbol.winRate && stats.total >= 3) {
        bestSymbol = { symbol, winRate };
      }
    });

    return bestSymbol;
  }

  private findBestTimeframe(trades: any[]): { timeframe: string } {
    const timeframeMap = new Map<string, { wins: number; total: number }>();

    trades.forEach(trade => {
      const timeframe = trade.timeframe || '1h';
      if (!timeframeMap.has(timeframe)) {
        timeframeMap.set(timeframe, { wins: 0, total: 0 });
      }
      const stats = timeframeMap.get(timeframe)!;
      stats.total++;
      if (trade.is_win) stats.wins++;
    });

    let bestTimeframe = { timeframe: 'None', winRate: 0 };
    timeframeMap.forEach((stats, timeframe) => {
      const winRate = (stats.wins / stats.total) * 100;
      if (winRate > bestTimeframe.winRate && stats.total >= 3) {
        bestTimeframe = { timeframe, winRate };
      }
    });

    return bestTimeframe;
  }

  private async updateUserPerformanceSummaries(): Promise<void> {
    try {
      const { data: users, error } = await supabase
        .from('user_profiles')
        .select('id');

      if (error || !users) {
        console.error('Error fetching users:', error);
        return;
      }

      for (const user of users) {
        await this.updateUserPerformance(user.id);
      }
    } catch (error) {
      console.error('Error updating user performance summaries:', error);
    }
  }

  private async updateUserPerformance(userId: string): Promise<void> {
    const { data: trades, error } = await supabase
      .from('ai_strategy_performance')
      .select('*')
      .eq('user_id', userId);

    if (error || !trades || trades.length === 0) {
      return;
    }

    const wins = trades.filter(t => t.is_win);
    const losses = trades.filter(t => !t.is_win);

    const totalProfit = wins.reduce((sum, t) => sum + parseFloat(t.profit_loss || 0), 0);
    const totalLoss = Math.abs(losses.reduce((sum, t) => sum + parseFloat(t.profit_loss || 0), 0));
    const winRate = (wins.length / trades.length) * 100;

    const strategyPerformance = this.groupByStrategy(trades);
    const symbolCounts = this.countByField(trades, 'symbol');

    const avgDuration = trades.reduce((sum, t) => sum + (t.trade_duration_minutes || 0), 0) / trades.length;
    const lastTrade = trades.reduce((latest, trade) =>
      new Date(trade.executed_at) > new Date(latest.executed_at) ? trade : latest
    );

    const summary = {
      user_id: userId,
      total_trades: trades.length,
      winning_trades: wins.length,
      losing_trades: losses.length,
      win_rate: parseFloat(winRate.toFixed(2)),
      total_profit: parseFloat(totalProfit.toFixed(2)),
      total_loss: parseFloat(totalLoss.toFixed(2)),
      net_profit: parseFloat((totalProfit - totalLoss).toFixed(2)),
      best_strategy: strategyPerformance.best?.strategy || 'None',
      favorite_symbol: symbolCounts[0]?.field || 'None',
      average_trade_duration: Math.floor(avgDuration),
      last_trade_at: lastTrade.executed_at,
      updated_at: new Date().toISOString(),
    };

    await supabase
      .from('user_performance_summary')
      .upsert(summary, { onConflict: 'user_id' });
  }

  private countByField(trades: any[], field: string): Array<{ field: string; count: number }> {
    const countMap = new Map<string, number>();

    trades.forEach(trade => {
      const value = trade[field];
      countMap.set(value, (countMap.get(value) || 0) + 1);
    });

    return Array.from(countMap.entries())
      .map(([field, count]) => ({ field, count }))
      .sort((a, b) => b.count - a.count);
  }

  async refreshKPIData(): Promise<void> {
    console.log('Manual KPI refresh triggered');
    await this.collectTradePerformanceData();
  }
}

export const kpiAnalyticsService = new KPIAnalyticsService();
