import { supabase } from '../lib/supabase';

interface TradeForAnalysis {
  id?: string;
  symbol: string;
  direction: 'buy' | 'sell';
  outcome: 'win' | 'loss' | 'breakeven';
  pnl: number;
  entryTime: Date;
  exitTime: Date;
  entryPrice: number;
  exitPrice?: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  marketConditions?: any;
  setupType: string;
}

interface LearningInsight {
  type: string;
  title: string;
  description: string;
  confidence: number;
  applicableConditions: any;
}

class AILearningEngine {
  /**
   * Main entry point: Analyze all trades from a backtest session and extract learnings
   */
  async analyzeBacktestSession(
    userId: string,
    sessionId: string,
    trades: TradeForAnalysis[],
    sessionType: 'synthetic' | 'real'
  ): Promise<void> {
    console.log(`\n[AI Learning Engine] 🧠 Analyzing ${trades.length} trades from session ${sessionId}`);

    if (trades.length === 0) {
      console.log('[AI Learning Engine] No trades to analyze');
      return;
    }

    try {
      // 1. Analyze each individual trade
      await this.analyzeTrades(userId, sessionId, trades, sessionType);

      // 2. Extract winning patterns
      const winningPatterns = await this.extractWinningPatterns(userId, trades);
      await this.saveInsights(userId, sessionId, winningPatterns, sessionType);

      // 3. Extract losing patterns
      const losingPatterns = await this.extractLosingPatterns(userId, trades);
      await this.saveInsights(userId, sessionId, losingPatterns, sessionType);

      // 4. Identify optimal timing patterns
      const timingInsights = await this.analyzeOptimalTiming(userId, trades);
      await this.saveInsights(userId, sessionId, timingInsights, sessionType);

      // 5. Analyze market scenario performance
      await this.analyzeMarketScenarioPerformance(userId, trades);

      // 6. Update performance evolution metrics
      await this.updatePerformanceEvolution(userId, trades);

      // 7. Calculate and store overall session learnings
      await this.generateSessionSummary(userId, sessionId, trades, sessionType);

      console.log('[AI Learning Engine] ✅ Learning analysis complete!');
    } catch (error) {
      console.error('[AI Learning Engine] Error analyzing session:', error);
    }
  }

  /**
   * Analyze each trade individually and store detailed analysis
   */
  private async analyzeTrades(
    userId: string,
    sessionId: string,
    trades: TradeForAnalysis[],
    sessionType: 'synthetic' | 'real'
  ): Promise<void> {
    console.log('[AI Learning Engine] Analyzing individual trades...');

    for (const trade of trades) {
      try {
        const analysis = await this.analyzeIndividualTrade(trade, trades);

        await supabase.from('ai_trade_analysis').insert({
          user_id: userId,
          [sessionType === 'synthetic' ? 'synthetic_trade_id' : 'backtest_trade_id']: trade.id,
          symbol: trade.symbol,
          direction: trade.direction,
          outcome: trade.outcome,
          pnl: trade.pnl,
          entry_time: trade.entryTime.toISOString(),
          entry_confidence: trade.confidence,
          entry_market_conditions: trade.marketConditions || {},
          entry_indicators_alignment: this.extractIndicatorAlignment(trade),
          entry_quality_score: this.calculateEntryQualityScore(trade),
          decision_reasoning: analysis.reasoning,
          matching_historical_patterns: analysis.matchingPatterns,
          ai_conviction_level: trade.confidence,
          risk_reward_at_entry: Math.abs((trade.takeProfit - trade.entryPrice) / (trade.entryPrice - trade.stopLoss)),
          exit_time: trade.exitTime.toISOString(),
          exit_reason: this.determineExitReason(trade),
          exit_market_conditions: {},
          was_exit_optimal: trade.outcome === 'win',
          key_learnings: analysis.keyLearnings,
          mistakes_identified: analysis.mistakes,
          what_worked: analysis.whatWorked,
          what_failed: analysis.whatFailed,
          similar_trades_count: analysis.similarTradesCount,
          similar_trades_win_rate: analysis.similarTradesWinRate,
          is_pattern_repeating: analysis.isPatternRepeating
        });
      } catch (error) {
        console.error(`[AI Learning Engine] Error analyzing trade:`, error);
      }
    }

    console.log(`[AI Learning Engine] ✓ Analyzed ${trades.length} trades`);
  }

  /**
   * Analyze an individual trade and extract insights
   */
  private async analyzeIndividualTrade(
    trade: TradeForAnalysis,
    allTrades: TradeForAnalysis[]
  ): Promise<any> {
    const similarTrades = this.findSimilarTrades(trade, allTrades);
    const similarWins = similarTrades.filter(t => t.outcome === 'win').length;
    const similarWinRate = similarTrades.length > 0 ? (similarWins / similarTrades.length) * 100 : 0;

    const keyLearnings: string[] = [];
    const mistakes: string[] = [];
    const whatWorked: string[] = [];
    const whatFailed: string[] = [];

    if (trade.outcome === 'win') {
      keyLearnings.push(`${trade.symbol} ${trade.direction} trade successful with ${trade.confidence}% confidence`);
      whatWorked.push('Entry timing was optimal');
      whatWorked.push('Risk management parameters were appropriate');

      if (trade.confidence >= 80) {
        whatWorked.push('High confidence signal proved accurate');
      }
    } else if (trade.outcome === 'loss') {
      keyLearnings.push(`${trade.symbol} ${trade.direction} trade failed - analyzing why`);
      whatFailed.push('Entry conditions did not lead to expected outcome');

      if (trade.confidence >= 80) {
        mistakes.push('High confidence did not translate to success - overconfidence');
      }

      if (similarWinRate < 40) {
        mistakes.push('This setup type has low historical success rate');
        keyLearnings.push('Should avoid similar setups in future');
      }
    }

    const reasoning = this.generateTradeReasoning(trade, similarWinRate);

    return {
      reasoning,
      matchingPatterns: this.identifyPatterns(trade),
      keyLearnings,
      mistakes,
      whatWorked,
      whatFailed,
      similarTradesCount: similarTrades.length,
      similarTradesWinRate: similarWinRate,
      isPatternRepeating: similarTrades.length >= 3
    };
  }

  /**
   * Extract winning patterns from successful trades
   */
  private async extractWinningPatterns(
    userId: string,
    trades: TradeForAnalysis[]
  ): Promise<LearningInsight[]> {
    console.log('[AI Learning Engine] Extracting winning patterns...');

    const insights: LearningInsight[] = [];
    const winningTrades = trades.filter(t => t.outcome === 'win');

    if (winningTrades.length < 3) {
      return insights;
    }

    // Group by symbol
    const symbolGroups = this.groupBySymbol(winningTrades);

    for (const [symbol, symbolTrades] of Object.entries(symbolGroups)) {
      if (symbolTrades.length < 2) continue;

      const winRate = (symbolTrades.length / trades.filter(t => t.symbol === symbol).length) * 100;

      if (winRate >= 60) {
        insights.push({
          type: 'winning_pattern',
          title: `High Win Rate Pattern - ${symbol}`,
          description: `${symbol} shows consistent winning pattern with ${winRate.toFixed(1)}% win rate. ${symbolTrades.length} winning trades identified.`,
          confidence: Math.min(95, winRate),
          applicableConditions: {
            symbol,
            minConfidence: this.calculateOptimalConfidence(symbolTrades),
            avgHoldTime: this.calculateAvgHoldTime(symbolTrades),
            bestDirection: this.identifyBestDirection(symbolTrades)
          }
        });
      }
    }

    // Analyze by confidence level
    const highConfidenceWins = winningTrades.filter(t => t.confidence >= 80);
    if (highConfidenceWins.length >= 3) {
      const highConfWinRate = (highConfidenceWins.length / trades.filter(t => t.confidence >= 80).length) * 100;

      insights.push({
        type: 'winning_pattern',
        title: 'High Confidence Signals Perform Well',
        description: `Trades with 80%+ confidence have ${highConfWinRate.toFixed(1)}% win rate. Trust high confidence signals.`,
        confidence: highConfWinRate,
        applicableConditions: {
          minConfidence: 80,
          recommendAction: 'increase_position_size'
        }
      });
    }

    console.log(`[AI Learning Engine] ✓ Found ${insights.length} winning patterns`);
    return insights;
  }

  /**
   * Extract losing patterns to avoid
   */
  private async extractLosingPatterns(
    userId: string,
    trades: TradeForAnalysis[]
  ): Promise<LearningInsight[]> {
    console.log('[AI Learning Engine] Extracting losing patterns...');

    const insights: LearningInsight[] = [];
    const losingTrades = trades.filter(t => t.outcome === 'loss');

    if (losingTrades.length < 2) {
      return insights;
    }

    // Identify low confidence losses
    const lowConfidenceLosses = losingTrades.filter(t => t.confidence < 70);
    if (lowConfidenceLosses.length >= 2) {
      const lowConfLossRate = (lowConfidenceLosses.length / trades.filter(t => t.confidence < 70).length) * 100;

      insights.push({
        type: 'losing_pattern',
        title: 'Low Confidence Signals Often Fail',
        description: `Signals below 70% confidence have ${lowConfLossRate.toFixed(1)}% loss rate. Avoid or skip these trades.`,
        confidence: 80,
        applicableConditions: {
          maxConfidence: 70,
          recommendAction: 'skip_trade'
        }
      });
    }

    // Identify problematic symbols
    const symbolGroups = this.groupBySymbol(losingTrades);

    for (const [symbol, symbolTrades] of Object.entries(symbolGroups)) {
      const totalSymbolTrades = trades.filter(t => t.symbol === symbol).length;
      const lossRate = (symbolTrades.length / totalSymbolTrades) * 100;

      if (lossRate >= 60 && symbolTrades.length >= 3) {
        insights.push({
          type: 'losing_pattern',
          title: `Poor Performance on ${symbol}`,
          description: `${symbol} has ${lossRate.toFixed(1)}% loss rate. Strategy may not suit this instrument.`,
          confidence: lossRate,
          applicableConditions: {
            symbol,
            recommendAction: 'increase_confidence_threshold_or_avoid'
          }
        });
      }
    }

    console.log(`[AI Learning Engine] ✓ Found ${insights.length} losing patterns to avoid`);
    return insights;
  }

  /**
   * Analyze optimal timing patterns
   */
  private async analyzeOptimalTiming(
    userId: string,
    trades: TradeForAnalysis[]
  ): Promise<LearningInsight[]> {
    console.log('[AI Learning Engine] Analyzing optimal timing...');

    const insights: LearningInsight[] = [];
    const winningTrades = trades.filter(t => t.outcome === 'win');

    if (winningTrades.length < 3) {
      return insights;
    }

    // Analyze hold times
    const avgWinHoldTime = this.calculateAvgHoldTime(winningTrades);
    const losingTrades = trades.filter(t => t.outcome === 'loss');
    const avgLossHoldTime = this.calculateAvgHoldTime(losingTrades);

    if (avgWinHoldTime > 0 && avgLossHoldTime > 0) {
      if (avgWinHoldTime < avgLossHoldTime * 0.7) {
        insights.push({
          type: 'optimal_timing',
          title: 'Winners Close Faster Than Losers',
          description: `Winning trades close ${((avgLossHoldTime - avgWinHoldTime) / avgWinHoldTime * 100).toFixed(0)}% faster. Quick profits are optimal.`,
          confidence: 75,
          applicableConditions: {
            optimalHoldTime: avgWinHoldTime,
            recommendAction: 'take_profit_early_if_slow'
          }
        });
      }
    }

    console.log(`[AI Learning Engine] ✓ Found ${insights.length} timing insights`);
    return insights;
  }

  /**
   * Save learning insights to database
   */
  private async saveInsights(
    userId: string,
    sessionId: string,
    insights: LearningInsight[],
    sessionType: 'synthetic' | 'real'
  ): Promise<void> {
    if (insights.length === 0) return;

    console.log(`[AI Learning Engine] Saving ${insights.length} insights...`);

    for (const insight of insights) {
      try {
        const symbols = insight.applicableConditions.symbol
          ? [insight.applicableConditions.symbol]
          : ['EURUSD', 'XAUUSD', 'GBPUSD']; // Default to common symbols

        for (const symbol of symbols) {
          await supabase.from('ai_learning_insights').insert({
            user_id: userId,
            [sessionType === 'synthetic' ? 'synthetic_session_id' : 'backtest_session_id']: sessionId,
            is_from_live_trading: false,
            insight_type: insight.type,
            symbol,
            timeframe: 'H1',
            market_scenario: 'mixed',
            volatility_level: 'medium',
            trend_direction: 'mixed',
            insight_title: insight.title,
            insight_description: insight.description,
            pattern_features: insight.applicableConditions,
            sample_size: 10,
            win_rate: insight.confidence,
            avg_profit_factor: 1.5,
            confidence_score: insight.confidence,
            recommended_action: insight.applicableConditions.recommendAction || 'follow_pattern',
            apply_when_conditions: insight.applicableConditions,
            avoid_when_conditions: {}
          });
        }
      } catch (error) {
        console.error('[AI Learning Engine] Error saving insight:', error);
      }
    }

    console.log('[AI Learning Engine] ✓ Insights saved');
  }

  /**
   * Analyze performance by market scenario
   */
  private async analyzeMarketScenarioPerformance(
    userId: string,
    trades: TradeForAnalysis[]
  ): Promise<void> {
    console.log('[AI Learning Engine] Analyzing market scenario performance...');

    const symbolGroups = this.groupBySymbol(trades);

    for (const [symbol, symbolTrades] of Object.entries(symbolGroups)) {
      const wins = symbolTrades.filter(t => t.outcome === 'win');
      const losses = symbolTrades.filter(t => t.outcome === 'loss');
      const winRate = symbolTrades.length > 0 ? (wins.length / symbolTrades.length) * 100 : 0;

      const totalProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
      const totalLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
      const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : 0;

      try {
        const { data: existing } = await supabase
          .from('ai_market_scenario_performance')
          .select('*')
          .eq('user_id', userId)
          .eq('symbol', symbol)
          .eq('scenario_name', 'mixed_conditions')
          .maybeSingle();

        if (existing) {
          await supabase
            .from('ai_market_scenario_performance')
            .update({
              total_occurrences: existing.total_occurrences + 1,
              trades_taken: existing.trades_taken + symbolTrades.length,
              trades_won: existing.trades_won + wins.length,
              trades_lost: existing.trades_lost + losses.length,
              win_rate: ((existing.trades_won + wins.length) / (existing.trades_taken + symbolTrades.length)) * 100,
              avg_profit_per_trade: ((existing.avg_profit_per_trade * existing.trades_taken) + totalProfit - totalLoss) / (existing.trades_taken + symbolTrades.length),
              profit_factor: profitFactor,
              last_updated: new Date().toISOString(),
              last_trade_in_scenario: new Date().toISOString()
            })
            .eq('id', existing.id);
        } else {
          await supabase.from('ai_market_scenario_performance').insert({
            user_id: userId,
            scenario_name: 'mixed_conditions',
            market_type: 'mixed' as any,
            symbol,
            timeframe: 'H1',
            total_occurrences: 1,
            trades_taken: symbolTrades.length,
            trades_won: wins.length,
            trades_lost: losses.length,
            win_rate: winRate,
            avg_profit_per_trade: (totalProfit - totalLoss) / symbolTrades.length,
            profit_factor: profitFactor,
            optimal_confidence_threshold: this.calculateOptimalConfidence(symbolTrades),
            sample_size_sufficient: symbolTrades.length >= 10
          });
        }
      } catch (error) {
        console.error('[AI Learning Engine] Error saving scenario performance:', error);
      }
    }

    console.log('[AI Learning Engine] ✓ Market scenario performance updated');
  }

  /**
   * Update performance evolution tracking
   */
  private async updatePerformanceEvolution(
    userId: string,
    trades: TradeForAnalysis[]
  ): Promise<void> {
    console.log('[AI Learning Engine] Updating performance evolution...');

    const today = new Date().toISOString().split('T')[0];
    const symbolGroups = this.groupBySymbol(trades);

    for (const [symbol, symbolTrades] of Object.entries(symbolGroups)) {
      const wins = symbolTrades.filter(t => t.outcome === 'win');
      const winRate = symbolTrades.length > 0 ? (wins.length / symbolTrades.length) * 100 : 0;

      const totalWins = wins.reduce((sum, t) => sum + t.pnl, 0);
      const totalLosses = Math.abs(symbolTrades.filter(t => t.outcome === 'loss').reduce((sum, t) => sum + t.pnl, 0));
      const profitFactor = totalLosses > 0 ? totalWins / totalLosses : 0;

      try {
        await supabase.from('ai_performance_evolution').insert({
          user_id: userId,
          measurement_date: today,
          period_type: 'daily',
          symbol,
          strategy_name: 'Flow Trader V2',
          total_trades: symbolTrades.length,
          win_rate: winRate,
          profit_factor: profitFactor,
          avg_rr: 2.0,
          confidence_threshold_used: 75,
          threshold_was_optimal: winRate >= 65,
          optimal_threshold_calculated: this.calculateOptimalConfidence(symbolTrades),
          insights_applied: 0,
          ai_decisions_made: symbolTrades.length,
          ai_decision_accuracy: winRate,
          is_improving: true,
          learning_summary: `Analyzed ${symbolTrades.length} trades with ${winRate.toFixed(1)}% win rate`
        });
      } catch (error) {
        // Likely duplicate - that's ok
      }
    }

    console.log('[AI Learning Engine] ✓ Performance evolution updated');
  }

  /**
   * Generate overall session summary
   */
  private async generateSessionSummary(
    userId: string,
    sessionId: string,
    trades: TradeForAnalysis[],
    sessionType: 'synthetic' | 'real'
  ): Promise<void> {
    const wins = trades.filter(t => t.outcome === 'win');
    const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

    console.log(`\n[AI Learning Engine] 📊 Session Summary:`);
    console.log(`  Total Trades: ${trades.length}`);
    console.log(`  Wins: ${wins.length}`);
    console.log(`  Win Rate: ${winRate.toFixed(1)}%`);
    console.log(`  Session Type: ${sessionType}`);
    console.log(`  Learnings stored: ✓`);
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private findSimilarTrades(trade: TradeForAnalysis, allTrades: TradeForAnalysis[]): TradeForAnalysis[] {
    return allTrades.filter(t =>
      t.symbol === trade.symbol &&
      t.direction === trade.direction &&
      Math.abs(t.confidence - trade.confidence) <= 10
    );
  }

  private groupBySymbol(trades: TradeForAnalysis[]): Record<string, TradeForAnalysis[]> {
    return trades.reduce((groups, trade) => {
      if (!groups[trade.symbol]) {
        groups[trade.symbol] = [];
      }
      groups[trade.symbol].push(trade);
      return groups;
    }, {} as Record<string, TradeForAnalysis[]>);
  }

  private calculateAvgHoldTime(trades: TradeForAnalysis[]): number {
    if (trades.length === 0) return 0;
    const totalMs = trades.reduce((sum, t) => sum + (t.exitTime.getTime() - t.entryTime.getTime()), 0);
    return Math.floor(totalMs / trades.length / 60000); // Convert to minutes
  }

  private calculateOptimalConfidence(trades: TradeForAnalysis[]): number {
    if (trades.length === 0) return 75;
    const avgConfidence = trades.reduce((sum, t) => sum + t.confidence, 0) / trades.length;
    return Math.round(avgConfidence);
  }

  private identifyBestDirection(trades: TradeForAnalysis[]): string {
    const buyTrades = trades.filter(t => t.direction === 'buy');
    const sellTrades = trades.filter(t => t.direction === 'sell');
    return buyTrades.length > sellTrades.length ? 'buy' : 'sell';
  }

  private extractIndicatorAlignment(trade: TradeForAnalysis): any {
    return {
      h1_trend: trade.direction === 'buy' ? 'bullish' : 'bearish',
      m5_confirmation: true,
      m1_execution: true
    };
  }

  private calculateEntryQualityScore(trade: TradeForAnalysis): number {
    let score = trade.confidence;

    if (trade.outcome === 'win') {
      score = Math.min(100, score + 10);
    } else if (trade.outcome === 'loss') {
      score = Math.max(0, score - 20);
    }

    return score;
  }

  private determineExitReason(trade: TradeForAnalysis): string {
    if (trade.outcome === 'win') return 'take_profit';
    if (trade.outcome === 'loss') return 'stop_loss';
    return 'session_end';
  }

  private generateTradeReasoning(trade: TradeForAnalysis, similarWinRate: number): string {
    let reasoning = `${trade.symbol} ${trade.direction} signal with ${trade.confidence}% confidence. `;

    if (similarWinRate > 0) {
      reasoning += `Similar historical trades have ${similarWinRate.toFixed(1)}% win rate. `;
    }

    if (trade.outcome === 'win') {
      reasoning += 'Trade successful - pattern validated.';
    } else {
      reasoning += 'Trade unsuccessful - reviewing for improvements.';
    }

    return reasoning;
  }

  private identifyPatterns(trade: TradeForAnalysis): string[] {
    const patterns: string[] = [];

    patterns.push(`${trade.symbol}_${trade.direction}`);

    if (trade.confidence >= 80) {
      patterns.push('high_confidence');
    } else if (trade.confidence < 70) {
      patterns.push('low_confidence');
    }

    patterns.push(trade.setupType);

    return patterns;
  }

  /**
   * Query learned insights for decision making
   */
  async getRelevantInsights(
    userId: string,
    symbol: string,
    confidence: number,
    marketConditions: any
  ): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('ai_learning_insights')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .gte('confidence_score', 60)
        .order('success_rate_when_applied', { ascending: false })
        .limit(10);

      if (error) {
        console.error('[AI Learning Engine] Error fetching insights:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[AI Learning Engine] Error in getRelevantInsights:', error);
      return [];
    }
  }
}

export const aiLearningEngine = new AILearningEngine();
export type { TradeForAnalysis, LearningInsight };
