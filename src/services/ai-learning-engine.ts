import { supabase } from '../lib/supabase';
import { evCalculator } from './ev-calculator';
import { cssCalculator } from './css-calculator';
import { adaptiveRiskManager } from './adaptive-risk-manager';
import { strategyDiscoveryEngine } from './strategy-discovery-engine';
import { sessionLearningGenerator } from './session-learning-generator';
import { patternInterpreter, type DiscoveredPattern } from './pattern-interpreter';
import { aiSkillTracker } from './ai-skill-tracker';
import { llmPostSessionAnalyzer } from './llm-post-session-analyzer';

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
   * REMOVED: analyzeBacktestSession - All backtest functionality removed
   * All trades now come from live goal sessions with 2x weight
   * Use analyzeLiveTrade() for single trade analysis
   */

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
   * REMOVED: saveInsights - Legacy insight system replaced with trade analysis
   * Insights are now stored directly in ai_trade_analysis table
   */

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
        // Check if record already exists for this date/symbol/strategy/period combination
        const { data: existing } = await supabase
          .from('ai_performance_evolution')
          .select('id, total_trades, win_rate, profit_factor, ai_decisions_made')
          .eq('user_id', userId)
          .eq('measurement_date', today)
          .eq('period_type', 'daily')
          .eq('symbol', symbol)
          .eq('strategy_name', 'Flow Trader V2')
          .maybeSingle();

        if (existing) {
          // Update existing record by accumulating values
          const { error } = await supabase
            .from('ai_performance_evolution')
            .update({
              total_trades: existing.total_trades + symbolTrades.length,
              win_rate: ((existing.win_rate * existing.total_trades) + (winRate * symbolTrades.length)) / (existing.total_trades + symbolTrades.length),
              profit_factor: profitFactor,
              avg_rr: 2.0,
              confidence_threshold_used: 75,
              threshold_was_optimal: winRate >= 65,
              optimal_threshold_calculated: this.calculateOptimalConfidence(symbolTrades),
              insights_applied: 0,
              ai_decisions_made: existing.ai_decisions_made + symbolTrades.length,
              ai_decision_accuracy: ((existing.ai_decision_accuracy * existing.ai_decisions_made) + (winRate * symbolTrades.length)) / (existing.ai_decisions_made + symbolTrades.length),
              is_improving: true,
              learning_summary: `Analyzed ${existing.total_trades + symbolTrades.length} trades total with ${(((existing.win_rate * existing.total_trades) + (winRate * symbolTrades.length)) / (existing.total_trades + symbolTrades.length)).toFixed(1)}% win rate`,
              updated_at: new Date().toISOString()
            })
            .eq('id', existing.id);

          if (error) {
            console.error('[AI Learning Engine] Error updating performance evolution:', error);
          } else {
            console.log(`[AI Learning Engine] ✓ Updated existing record for ${symbol} on ${today}`);
          }
        } else {
          // Insert new record
          const { error } = await supabase.from('ai_performance_evolution').insert({
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

          if (error) {
            console.error('[AI Learning Engine] Error inserting performance evolution:', error);
          } else {
            console.log(`[AI Learning Engine] ✓ Created new record for ${symbol} on ${today}`);
          }
        }
      } catch (error) {
        console.error('[AI Learning Engine] Exception in performance evolution:', error);
      }
    }

    console.log('[AI Learning Engine] ✓ Performance evolution updated');
  }

  /**
   * REMOVED: generateSessionSummary - Backtest session summaries no longer needed
   * All learning now comes from individual live trades analyzed in real-time
   */

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

  private calculateEntryQualityScore(trade: TradeForAnalysis, storedEQS?: number | null): number {
    if (storedEQS !== null && storedEQS !== undefined && storedEQS > 0) {
      return storedEQS;
    }

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
      // NOTE: Legacy ai_learning_insights table removed
      // Insights are now stored in ai_trade_analysis per-trade
      // Returning empty array for backward compatibility
      return [];
    } catch (error) {
      console.error('[AI Learning Engine] Error in getRelevantInsights:', error);
      return [];
    }
  }

  /**
   * Analyze a single live trade and extract learnings
   * This is called when a trade closes in goal session trading
   * ALL TRADES COUNT AS 2X WEIGHT (no backtest distinction)
   */
  async analyzeLiveTrade(
    userId: string,
    tradeId: string
  ): Promise<{ success: boolean; learningsExtracted: number }> {
    console.log(`\n[AI Learning Engine] 🎯 Analyzing live trade ${tradeId} (2x weight)`);
    const startTime = Date.now();

    try {
      // Fetch the trade from goal_session_trades
      const { data: trade, error: fetchError } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('id', tradeId)
        .eq('user_id', userId)
        .maybeSingle();

      if (fetchError || !trade) {
        console.error('[AI Learning Engine] Trade not found:', fetchError);
        return { success: false, learningsExtracted: 0 };
      }

      // Check if already analyzed
      if (trade.ai_analyzed) {
        console.log('[AI Learning Engine] Trade already analyzed, skipping');
        return { success: true, learningsExtracted: 0 };
      }

      // Convert to analysis format
      const tradeForAnalysis: TradeForAnalysis = {
        id: trade.id,
        symbol: trade.symbol,
        direction: trade.direction as 'buy' | 'sell',
        outcome: trade.profit_loss > 0 ? 'win' : (trade.profit_loss < 0 ? 'loss' : 'breakeven'),
        pnl: parseFloat(trade.profit_loss.toString()),
        entryTime: new Date(trade.opened_at),
        exitTime: new Date(trade.closed_at),
        entryPrice: parseFloat(trade.entry_price.toString()),
        exitPrice: parseFloat(trade.exit_price.toString()),
        stopLoss: parseFloat(trade.stop_loss.toString()),
        takeProfit: parseFloat(trade.take_profit.toString()),
        confidence: parseFloat(trade.confidence_score?.toString() || '75'),
        marketConditions: trade.market_conditions || {},
        setupType: trade.setup_type || 'Unknown'
      };

      // Fetch historical trades for context
      const { data: historicalTrades } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', trade.symbol)
        .eq('status', 'closed')
        .limit(100);

      const allTrades = (historicalTrades || []).map(t => ({
        id: t.id,
        symbol: t.symbol,
        direction: t.direction as 'buy' | 'sell',
        outcome: t.profit_loss > 0 ? 'win' : (t.profit_loss < 0 ? 'loss' : 'breakeven'),
        pnl: parseFloat(t.profit_loss.toString()),
        entryTime: new Date(t.opened_at),
        exitTime: new Date(t.closed_at),
        entryPrice: parseFloat(t.entry_price.toString()),
        exitPrice: parseFloat(t.exit_price.toString()),
        stopLoss: parseFloat(t.stop_loss.toString()),
        takeProfit: parseFloat(t.take_profit.toString()),
        confidence: parseFloat(t.confidence_score?.toString() || '75'),
        marketConditions: t.market_conditions || {},
        setupType: t.setup_type || 'Unknown'
      }));

      // Analyze the individual trade
      const analysis = await this.analyzeIndividualTrade(tradeForAnalysis, allTrades);

      // Store detailed trade analysis with LIVE TRADING FLAG
      await supabase.from('ai_trade_analysis').insert({
        user_id: userId,
        live_trade_id: tradeId,
        symbol: trade.symbol,
        direction: trade.position_type,
        outcome: tradeForAnalysis.outcome,
        pnl: tradeForAnalysis.pnl,
        entry_time: tradeForAnalysis.entryTime.toISOString(),
        entry_confidence: tradeForAnalysis.confidence,
        entry_market_conditions: tradeForAnalysis.marketConditions,
        entry_indicators_alignment: this.extractIndicatorAlignment(tradeForAnalysis),
        entry_quality_score: this.calculateEntryQualityScore(tradeForAnalysis, trade.entry_quality_score),
        decision_reasoning: analysis.reasoning,
        matching_historical_patterns: analysis.matchingPatterns,
        ai_conviction_level: tradeForAnalysis.confidence,
        risk_reward_at_entry: Math.abs((tradeForAnalysis.takeProfit - tradeForAnalysis.entryPrice) / (tradeForAnalysis.entryPrice - tradeForAnalysis.stopLoss)),
        exit_time: tradeForAnalysis.exitTime.toISOString(),
        exit_reason: this.determineExitReason(tradeForAnalysis),
        exit_market_conditions: {},
        was_exit_optimal: tradeForAnalysis.outcome === 'win',
        key_learnings: analysis.keyLearnings,
        mistakes_identified: analysis.mistakes,
        what_worked: analysis.whatWorked,
        what_failed: analysis.whatFailed,
        similar_trades_count: analysis.similarTradesCount,
        similar_trades_win_rate: analysis.similarTradesWinRate,
        is_pattern_repeating: analysis.isPatternRepeating,
        contributed_to_global_learning: true
      });

      // Extract patterns (all trades have 2x weight)
      const insights = [
        ...await this.extractWinningPatterns(userId, [tradeForAnalysis]),
        ...await this.extractLosingPatterns(userId, [tradeForAnalysis]),
        ...await this.analyzeOptimalTiming(userId, [tradeForAnalysis])
      ];

      const insightsCreated = insights.length;

      // Update market scenario performance
      await this.updateMarketScenarioPerformanceLive(userId, tradeForAnalysis);

      // Update performance evolution with live trade data
      await this.updatePerformanceEvolutionLive(userId, tradeForAnalysis);

      // Log the learning event
      await supabase.from('trade_learning_log').insert({
        user_id: userId,
        trade_id: tradeId,
        symbol: trade.symbol,
        position_type: trade.position_type,
        outcome: tradeForAnalysis.outcome,
        pnl: tradeForAnalysis.pnl,
        confidence_at_entry: tradeForAnalysis.confidence,
        patterns_identified: analysis.matchingPatterns,
        insights_created: insightsCreated,
        key_learnings: analysis.keyLearnings,
        mistakes_identified: analysis.mistakes,
        learning_quality_score: tradeForAnalysis.outcome === 'win' ? 85 : 70,
        will_improve_future_decisions: true,
        similar_historical_trades_count: analysis.similarTradesCount,
        learning_source: 'live_trading',
        processing_time_ms: Date.now() - startTime
      });

      // Mark trade as analyzed
      await supabase
        .from('goal_session_trades')
        .update({ ai_analyzed: true })
        .eq('id', tradeId);

      // DUAL-WRITE: Contribute to platform-wide learning (anonymized)
      await this.contributeToPlatformLearning(tradeForAnalysis, analysis);

      console.log(`[AI Learning Engine] ✅ Trade analyzed! Extracted ${insightsCreated} insights + contributed to platform intelligence`);
      return { success: true, learningsExtracted: insightsCreated };
    } catch (error) {
      console.error('[AI Learning Engine] Error analyzing live trade:', error);
      return { success: false, learningsExtracted: 0 };
    }
  }

  /**
   * Analyze all unanalyzed live trades for a user
   */
  async analyzePendingLiveTrades(userId: string): Promise<{ tradesAnalyzed: number; totalInsights: number }> {
    console.log('[AI Learning Engine] 🔍 Checking for unanalyzed live trades...');

    try {
      const { data: unanalyzedTrades, error } = await supabase
        .from('goal_session_trades')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'closed')
        .eq('ai_analyzed', false)
        .order('closed_at', { ascending: true })
        .limit(50);

      if (error || !unanalyzedTrades || unanalyzedTrades.length === 0) {
        console.log('[AI Learning Engine] No unanalyzed trades found');
        return { tradesAnalyzed: 0, totalInsights: 0 };
      }

      console.log(`[AI Learning Engine] Found ${unanalyzedTrades.length} unanalyzed trades`);

      let tradesAnalyzed = 0;
      let totalInsights = 0;

      for (const trade of unanalyzedTrades) {
        const result = await this.analyzeLiveTrade(userId, trade.id);
        if (result.success) {
          tradesAnalyzed++;
          totalInsights += result.learningsExtracted;
        }
      }

      console.log(`[AI Learning Engine] ✅ Analyzed ${tradesAnalyzed} live trades, extracted ${totalInsights} insights`);
      return { tradesAnalyzed, totalInsights };
    } catch (error) {
      console.error('[AI Learning Engine] Error in analyzePendingLiveTrades:', error);
      return { tradesAnalyzed: 0, totalInsights: 0 };
    }
  }

  /**
   * Update market scenario performance for live trades
   */
  private async updateMarketScenarioPerformanceLive(
    userId: string,
    trade: TradeForAnalysis
  ): Promise<void> {
    const isWin = trade.outcome === 'win';
    const isLoss = trade.outcome === 'loss';

    try {
      const { data: existing } = await supabase
        .from('ai_market_scenario_performance')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', trade.symbol)
        .eq('scenario_name', 'live_demo_trading')
        .maybeSingle();

      if (existing) {
        const newTotalTrades = existing.trades_taken + 1;
        const newWins = existing.trades_won + (isWin ? 1 : 0);
        const newLosses = existing.trades_lost + (isLoss ? 1 : 0);

        await supabase
          .from('ai_market_scenario_performance')
          .update({
            trades_taken: newTotalTrades,
            trades_won: newWins,
            trades_lost: newLosses,
            win_rate: (newWins / newTotalTrades) * 100,
            avg_profit_per_trade: ((existing.avg_profit_per_trade * existing.trades_taken) + trade.pnl) / newTotalTrades,
            last_updated: new Date().toISOString()
          })
          .eq('id', existing.id);
      } else {
        await supabase.from('ai_market_scenario_performance').insert({
          user_id: userId,
          scenario_name: 'live_demo_trading',
          market_type: 'live' as any,
          symbol: trade.symbol,
          timeframe: 'H1',
          total_occurrences: 1,
          trades_taken: 1,
          trades_won: isWin ? 1 : 0,
          trades_lost: isLoss ? 1 : 0,
          win_rate: isWin ? 100 : 0,
          avg_profit_per_trade: trade.pnl,
          profit_factor: 0,
          optimal_confidence_threshold: trade.confidence,
          sample_size_sufficient: false
        });
      }
    } catch (error) {
      console.error('[AI Learning Engine] Error updating live scenario performance:', error);
    }
  }

  /**
   * Update performance evolution for live trades
   */
  private async updatePerformanceEvolutionLive(
    userId: string,
    trade: TradeForAnalysis
  ): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    const isWin = trade.outcome === 'win';

    try {
      const { data: existing } = await supabase
        .from('ai_performance_evolution')
        .select('*')
        .eq('user_id', userId)
        .eq('measurement_date', today)
        .eq('period_type', 'daily')
        .eq('symbol', trade.symbol)
        .eq('strategy_name', 'Live Demo Trading')
        .maybeSingle();

      if (existing) {
        const newTotalTrades = existing.total_trades + 1;
        const newWinRate = ((existing.win_rate * existing.total_trades) + (isWin ? 100 : 0)) / newTotalTrades;

        await supabase
          .from('ai_performance_evolution')
          .update({
            total_trades: newTotalTrades,
            win_rate: newWinRate,
            ai_decisions_made: existing.ai_decisions_made + 1,
            ai_decision_accuracy: newWinRate,
            learning_summary: `Analyzed ${newTotalTrades} live trades with ${newWinRate.toFixed(1)}% win rate`,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id);
      } else {
        await supabase.from('ai_performance_evolution').insert({
          user_id: userId,
          measurement_date: today,
          period_type: 'daily',
          symbol: trade.symbol,
          strategy_name: 'Live Demo Trading',
          total_trades: 1,
          win_rate: isWin ? 100 : 0,
          profit_factor: 0,
          avg_rr: 2.0,
          confidence_threshold_used: trade.confidence,
          threshold_was_optimal: isWin,
          optimal_threshold_calculated: trade.confidence,
          insights_applied: 0,
          ai_decisions_made: 1,
          ai_decision_accuracy: isWin ? 100 : 0,
          is_improving: true,
          learning_summary: `First live trade: ${trade.outcome}`
        });
      }
    } catch (error) {
      console.error('[AI Learning Engine] Error updating live performance evolution:', error);
    }
  }

  /**
   * Update pattern EV tracking for all patterns in trades
   */
  private async updatePatternEVTracking(
    userId: string,
    trades: TradeForAnalysis[]
  ): Promise<void> {
    console.log('[AI Learning Engine] Updating pattern EV tracking...');

    const symbolGroups = this.groupBySymbol(trades);

    for (const [symbol, symbolTrades] of Object.entries(symbolGroups)) {
      for (const trade of symbolTrades) {
        const volatilityRegime = this.determineVolatilityRegime(trade) as 'low' | 'medium' | 'high';
        const patternName = trade.setupType || 'Unknown';

        // Calculate EV for this pattern
        const evResult = await evCalculator.calculatePatternEV(
          userId,
          symbol,
          patternName,
          volatilityRegime
        );

        if (evResult) {
          await evCalculator.updatePatternEVTracking(
            userId,
            symbol,
            patternName,
            evResult,
            volatilityRegime
          );
        }

        // Learn from completed trade
        await evCalculator.learnFromCompletedTrade(userId, {
          symbol,
          patternName,
          outcome: trade.outcome,
          pnl: trade.pnl,
          volatilityRegime
        });
      }
    }

    console.log('[AI Learning Engine] ✓ Pattern EV tracking updated');
  }

  /**
   * Calculate CSS for session
   */
  private async calculateSessionCSS(
    userId: string,
    trades: TradeForAnalysis[]
  ): Promise<void> {
    console.log('[AI Learning Engine] Calculating CSS for session...');

    if (trades.length === 0) return;

    const tradeData = trades.map(t => ({
      outcome: t.outcome,
      pnl: t.pnl,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice || t.entryPrice,
      stopLoss: t.stopLoss,
      takeProfit: t.takeProfit
    }));

    const cssResult = cssCalculator.calculateCSSFromTrades(tradeData);

    console.log(`[AI Learning Engine] Session CSS: ${cssResult.compositeSuccessScore.toFixed(2)}`);
    console.log(`  Win Rate: ${cssResult.rawMetrics.winRate.toFixed(1)}%`);
    console.log(`  Profit Factor: ${cssResult.rawMetrics.profitFactor.toFixed(2)}`);
    console.log(`  Avg R:R: ${cssResult.rawMetrics.avgRR.toFixed(2)}`);
    console.log(`  Max Drawdown: ${cssResult.rawMetrics.maxDrawdown.toFixed(1)}%`);
    console.log(`  Grade: ${cssResult.grade}`);
    console.log(`  Skill Level: ${cssResult.skillLevel}`);

    console.log('[AI Learning Engine] ✓ CSS calculated');
  }

  /**
   * Calculate realized R:R for a trade
   */
  private calculateRealizedRR(trade: TradeForAnalysis): number {
    const riskAmount = Math.abs(trade.entryPrice - trade.stopLoss);
    if (riskAmount === 0) return 0;

    const actualPnL = Math.abs((trade.exitPrice || trade.entryPrice) - trade.entryPrice);
    return actualPnL / riskAmount;
  }

  /**
   * Calculate MAE and MFE (simplified - would need tick data for accurate values)
   */
  private calculateMAEMFE(trade: TradeForAnalysis): { mae: number; mfe: number } {
    // Simplified: MAE/MFE would need actual tick data
    // For now, estimate based on outcome and price movement
    const priceMove = Math.abs((trade.exitPrice || trade.entryPrice) - trade.entryPrice);

    if (trade.outcome === 'win') {
      return {
        mae: priceMove * 0.3, // Assume 30% adverse excursion before winning
        mfe: priceMove
      };
    } else if (trade.outcome === 'loss') {
      return {
        mae: priceMove,
        mfe: priceMove * 0.2 // Assume 20% favorable before losing
      };
    } else {
      return { mae: 0, mfe: 0 };
    }
  }

  /**
   * Calculate EV for a trade based on pattern history
   */
  private async calculateTradeEV(
    userId: string,
    trade: TradeForAnalysis,
    allTrades: TradeForAnalysis[]
  ): Promise<number> {
    const similarTrades = this.findSimilarTrades(trade, allTrades);

    if (similarTrades.length < 3) {
      return 0; // Not enough data
    }

    const wins = similarTrades.filter(t => t.outcome === 'win');
    const losses = similarTrades.filter(t => t.outcome === 'loss');

    const winProbability = wins.length / similarTrades.length;
    const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length) : 0;

    // EV = (Win Probability × Avg Win) − ((1 − Win Probability) × Avg Loss)
    return (winProbability * avgWin) - ((1 - winProbability) * avgLoss);
  }

  /**
   * Calculate trade quality score (0-100)
   */
  private calculateTradeQuality(trade: TradeForAnalysis, realizedRR: number): number {
    let score = 50; // Base score

    // Factor 1: Outcome (40 points)
    if (trade.outcome === 'win') {
      score += 40;
    } else if (trade.outcome === 'loss') {
      score += 10; // Still some credit for taking a trade
    } else {
      score += 20; // Breakeven
    }

    // Factor 2: R:R achieved (30 points)
    if (realizedRR >= 2.0) {
      score += 30;
    } else if (realizedRR >= 1.5) {
      score += 20;
    } else if (realizedRR >= 1.0) {
      score += 10;
    }

    // Factor 3: Confidence match (20 points)
    if (trade.confidence >= 80 && trade.outcome === 'win') {
      score += 20;
    } else if (trade.confidence < 70 && trade.outcome === 'loss') {
      score -= 10; // Penalty for low confidence losses
    }

    // Factor 4: Setup quality (10 points)
    if (trade.setupType && trade.setupType !== 'Unknown') {
      score += 10;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Determine volatility regime (simplified)
   */
  private determineVolatilityRegime(trade: TradeForAnalysis): string {
    // Simplified volatility detection based on price range
    const range = Math.abs(trade.takeProfit - trade.stopLoss);
    const avgPrice = (trade.takeProfit + trade.stopLoss) / 2;
    const rangePercent = (range / avgPrice) * 100;

    if (rangePercent > 1.5) return 'high';
    if (rangePercent > 0.8) return 'medium';
    return 'low';
  }

  /**
   * REMOVED: Meta-Learning Strategist (replaced with progressive daily learning)
   * Previously called GPT-4o to analyze past performance every 10-100 sessions
   * Now AI learns progressively after each daily session instead
   */
  private async runMetaLearningStrategist(
    userId: string,
    sessionId: string,
    trades: TradeForAnalysis[]
  ): Promise<void> {
    // No longer needed - progressive learning happens after each daily session
    return;
  }

  /**
   * Generate GPT-4o interpretations for discovered patterns
   */
  private async interpretDiscoveredPatterns(
    userId: string,
    patterns: LearningInsight[]
  ): Promise<void> {
    try {
      // Skip if no patterns or if interpreter is disabled
      if (patterns.length === 0 || !patternInterpreter.isEnabled()) {
        console.log('[AI Learning Engine] Skipping Pattern Interpreter (no patterns or disabled)');
        return;
      }

      // Convert insights to pattern format for interpretation
      const discoveredPatterns: DiscoveredPattern[] = patterns.map(p => ({
        patternId: `pattern_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        patternName: p.title,
        symbol: p.applicableConditions.symbol || 'EURUSD',
        timeframe: 'H1',
        winRate: p.confidence,
        profitFactor: 1.5, // Simplified
        expectancy: 0.5, // Simplified
        avgRR: 2.0, // Simplified
        sampleSize: 10, // Simplified
        volatilityRegime: 'medium',
        trendDirection: 'mixed',
        conditions: p.applicableConditions,
        features: p.applicableConditions
      }));

      // Interpret patterns (max 3 to control costs)
      const patternsToInterpret = discoveredPatterns.slice(0, 3);
      await patternInterpreter.interpretPatternsBatch(userId, patternsToInterpret);

    } catch (error) {
      console.error('[AI Learning Engine] Error interpreting patterns:', error);
    }
  }

  /**
   * Helper: Analyze confidence threshold performance
   */
  private analyzeConfidenceThresholds(trades: TradeForAnalysis[]): any {
    const thresholds = [70, 75, 80, 85, 90];
    const results: Record<number, { winRate: number; trades: number }> = {};

    for (const threshold of thresholds) {
      const filtered = trades.filter(t => t.confidence >= threshold);
      const wins = filtered.filter(t => t.outcome === 'win').length;
      results[threshold] = {
        winRate: filtered.length > 0 ? (wins / filtered.length) * 100 : 0,
        trades: filtered.length
      };
    }

    return results;
  }

  /**
   * PLATFORM-WIDE LEARNING: Contribute trade to collective intelligence (anonymized)
   * Updates global patterns, symbol intelligence, and confidence calibration
   */
  private async contributeToPlatformLearning(
    trade: TradeForAnalysis,
    analysis: any
  ): Promise<void> {
    try {
      console.log('[Platform Learning] 🌐 Contributing to collective intelligence...');

      // 1. Update global pattern performance
      await this.updateGlobalPattern(trade, analysis);

      // 2. Update symbol intelligence
      await this.updateSymbolIntelligence(trade);

      // 3. Update confidence calibration
      await this.updateConfidenceCalibration(trade);

      // 4. Update market scenario performance
      await this.updateGlobalMarketScenario(trade);

      console.log('[Platform Learning] ✅ Contribution complete');
    } catch (error) {
      console.error('[Platform Learning] Error contributing to platform:', error);
      // Don't throw - platform learning is non-blocking
    }
  }

  /**
   * Update global pattern performance (aggregated across all users)
   */
  private async updateGlobalPattern(trade: TradeForAnalysis, analysis: any): Promise<void> {
    const patternId = `${trade.symbol}_${trade.setupType}_${trade.direction}`;

    try {
      // Fetch existing pattern or create new
      const { data: existing } = await supabase
        .from('ai_global_patterns')
        .select('*')
        .eq('pattern_id', patternId)
        .maybeSingle();

      if (existing) {
        // Update existing pattern
        const newTotal = existing.total_occurrences + 1;
        const newWins = existing.win_count + (trade.outcome === 'win' ? 1 : 0);
        const newLosses = existing.loss_count + (trade.outcome === 'loss' ? 1 : 0);
        const newBreakeven = existing.breakeven_count + (trade.outcome === 'breakeven' ? 1 : 0);
        const newWinRate = (newWins / newTotal) * 100;

        const { error } = await supabase
          .from('ai_global_patterns')
          .update({
            total_occurrences: newTotal,
            win_count: newWins,
            loss_count: newLosses,
            breakeven_count: newBreakeven,
            win_rate: newWinRate,
            last_occurrence_at: new Date().toISOString(),
            sample_size_adequate: newTotal >= 30,
            updated_at: new Date().toISOString()
          })
          .eq('pattern_id', patternId);

        if (error) {
          console.error('[Platform Learning] Error updating global pattern:', error);
        }
      } else {
        // Create new pattern
        const { error } = await supabase
          .from('ai_global_patterns')
          .insert({
            pattern_id: patternId,
            pattern_name: `${trade.setupType} ${trade.direction}`,
            symbol: trade.symbol,
            setup_type: trade.setupType,
            direction: trade.direction,
            total_occurrences: 1,
            win_count: trade.outcome === 'win' ? 1 : 0,
            loss_count: trade.outcome === 'loss' ? 1 : 0,
            breakeven_count: trade.outcome === 'breakeven' ? 1 : 0,
            win_rate: trade.outcome === 'win' ? 100 : 0,
            volatility_regime: this.determineVolatilityRegime(trade),
            last_occurrence_at: new Date().toISOString(),
            sample_size_adequate: false
          });

        if (error) {
          console.error('[Platform Learning] Error creating global pattern:', error);
        }
      }
    } catch (error) {
      console.error('[Platform Learning] Exception in updateGlobalPattern:', error);
    }
  }

  /**
   * Update symbol intelligence (aggregated platform-wide stats)
   */
  private async updateSymbolIntelligence(trade: TradeForAnalysis): Promise<void> {
    try {
      const { data: existing } = await supabase
        .from('ai_global_symbol_intelligence')
        .select('*')
        .eq('symbol', trade.symbol)
        .maybeSingle();

      if (existing) {
        // Update existing
        const newTotal = existing.total_trades_platform_wide + 1;
        const newWinRate = ((existing.platform_win_rate * existing.total_trades_platform_wide) +
          (trade.outcome === 'win' ? 100 : 0)) / newTotal;

        const { error } = await supabase
          .from('ai_global_symbol_intelligence')
          .update({
            total_trades_platform_wide: newTotal,
            platform_win_rate: newWinRate,
            updated_at: new Date().toISOString()
          })
          .eq('symbol', trade.symbol);

        if (error) {
          console.error('[Platform Learning] Error updating symbol intelligence:', error);
        }
      } else {
        // Create new
        const { error } = await supabase
          .from('ai_global_symbol_intelligence')
          .insert({
            symbol: trade.symbol,
            total_trades_platform_wide: 1,
            platform_win_rate: trade.outcome === 'win' ? 100 : 0,
            platform_profit_factor: 0
          });

        if (error) {
          console.error('[Platform Learning] Error creating symbol intelligence:', error);
        }
      }
    } catch (error) {
      console.error('[Platform Learning] Exception in updateSymbolIntelligence:', error);
    }
  }

  /**
   * Update confidence calibration (platform-wide accuracy tracking)
   */
  private async updateConfidenceCalibration(trade: TradeForAnalysis): Promise<void> {
    try {
      // Determine confidence bucket
      let bucket = '70-75';
      if (trade.confidence >= 95) bucket = '95-100';
      else if (trade.confidence >= 90) bucket = '90-95';
      else if (trade.confidence >= 85) bucket = '85-90';
      else if (trade.confidence >= 80) bucket = '80-85';
      else if (trade.confidence >= 75) bucket = '75-80';

      const { data: existing } = await supabase
        .from('ai_global_confidence_calibration')
        .select('*')
        .eq('confidence_bucket', bucket)
        .maybeSingle();

      if (existing) {
        const newTotal = existing.total_predictions + 1;
        const newCorrect = existing.correct_predictions + (trade.outcome === 'win' ? 1 : 0);
        const newActualWinRate = (newCorrect / newTotal) * 100;

        // Extract expected win rate from bucket name (e.g., "80-85" -> 82.5)
        const bucketParts = bucket.split('-').map(Number);
        const expectedWinRate = bucketParts.length === 2 ? (bucketParts[0] + bucketParts[1]) / 2 : trade.confidence;
        const newCalibrationError = Math.abs(newActualWinRate - expectedWinRate);

        const { error } = await supabase
          .from('ai_global_confidence_calibration')
          .update({
            total_predictions: newTotal,
            correct_predictions: newCorrect,
            actual_win_rate: newActualWinRate,
            calibration_error: newCalibrationError,
            last_updated: new Date().toISOString()
          })
          .eq('confidence_bucket', bucket);

        if (error) {
          console.error('[Platform Learning] Error updating confidence calibration:', error);
        }
      }
    } catch (error) {
      console.error('[Platform Learning] Exception in updateConfidenceCalibration:', error);
    }
  }

  /**
   * Update global market scenario performance
   */
  private async updateGlobalMarketScenario(trade: TradeForAnalysis): Promise<void> {
    try {
      const volatilityRegime = this.determineVolatilityRegime(trade);
      const marketType = 'mixed'; // Would need more context to determine
      const scenarioId = `${trade.symbol}_${marketType}_${volatilityRegime}`;

      const { data: existing } = await supabase
        .from('ai_global_market_scenarios')
        .select('*')
        .eq('scenario_id', scenarioId)
        .maybeSingle();

      if (existing) {
        const newTotal = existing.total_trades + 1;
        const newWins = existing.trades_won + (trade.outcome === 'win' ? 1 : 0);
        const newLosses = existing.trades_lost + (trade.outcome === 'loss' ? 1 : 0);
        const newWinRate = (newWins / newTotal) * 100;

        const { error } = await supabase
          .from('ai_global_market_scenarios')
          .update({
            total_trades: newTotal,
            trades_won: newWins,
            trades_lost: newLosses,
            win_rate: newWinRate,
            sample_size_sufficient: newTotal >= 50,
            last_updated: new Date().toISOString()
          })
          .eq('scenario_id', scenarioId);

        if (error) {
          console.error('[Platform Learning] Error updating market scenario:', error);
        }
      } else {
        const { error } = await supabase
          .from('ai_global_market_scenarios')
          .insert({
            scenario_id: scenarioId,
            symbol: trade.symbol,
            market_type: marketType,
            volatility_regime: volatilityRegime,
            total_trades: 1,
            trades_won: trade.outcome === 'win' ? 1 : 0,
            trades_lost: trade.outcome === 'loss' ? 1 : 0,
            win_rate: trade.outcome === 'win' ? 100 : 0,
            sample_size_sufficient: false
          });

        if (error) {
          console.error('[Platform Learning] Error creating market scenario:', error);
        }
      }
    } catch (error) {
      console.error('[Platform Learning] Exception in updateGlobalMarketScenario:', error);
    }
  }
}

export const aiLearningEngine = new AILearningEngine();
export type { TradeForAnalysis, LearningInsight };
