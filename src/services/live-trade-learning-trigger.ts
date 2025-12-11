import { supabase } from '@/lib/supabase';
import { aiLearningEngine } from './ai-learning-engine';
import { aiSkillTracker } from './ai-skill-tracker';

/**
 * Live Trade Learning Trigger Service
 * Monitors trade_history for new closed trades and automatically triggers AI learning analysis
 */
class LiveTradeLearningTrigger {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private pollInterval = 30000; // Check every 30 seconds
  private lastCheckTime: Date = new Date();

  /**
   * Start monitoring for new closed trades
   */
  start(userId: string) {
    if (this.isRunning) {
      console.log('[LiveTradeLearningTrigger] Already running');
      return;
    }

    console.log('[LiveTradeLearningTrigger] 🚀 Starting live trade learning monitor');
    this.isRunning = true;
    this.lastCheckTime = new Date();

    // Run initial check immediately
    this.checkForNewTrades(userId);

    // Set up periodic checking
    this.intervalId = setInterval(() => {
      this.checkForNewTrades(userId);
    }, this.pollInterval);
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('[LiveTradeLearningTrigger] Stopped live trade learning monitor');
  }

  /**
   * Check for new unanalyzed trades and trigger learning
   */
  private async checkForNewTrades(userId: string) {
    try {
      const { data: unanalyzedTrades, error } = await supabase
        .from('goal_session_trades')
        .select('id, symbol, closed_at, risk_weight')
        .eq('user_id', userId)
        .eq('status', 'closed')
        .eq('ai_analyzed', false)
        .gte('closed_at', this.lastCheckTime.toISOString())
        .order('closed_at', { ascending: true })
        .limit(10);

      if (error) {
        console.error('[LiveTradeLearningTrigger] Error fetching unanalyzed trades:', error);
        return;
      }

      if (!unanalyzedTrades || unanalyzedTrades.length === 0) {
        return;
      }

      console.log(`[LiveTradeLearningTrigger] 🎯 Found ${unanalyzedTrades.length} new trades to analyze`);

      // Analyze each trade
      for (const trade of unanalyzedTrades) {
        await this.analyzeTrade(userId, trade.id, trade.symbol, trade.risk_weight || 1.0);
      }

      // Update last check time
      this.lastCheckTime = new Date();
    } catch (error) {
      console.error('[LiveTradeLearningTrigger] Error in checkForNewTrades:', error);
    }
  }

  /**
   * Analyze a single trade and update skill progression
   */
  private async analyzeTrade(userId: string, tradeId: string, symbol: string, riskWeight: number = 1.0) {
    try {
      console.log(`[LiveTradeLearningTrigger] Analyzing trade ${tradeId} (${symbol}) with ${riskWeight}x risk weight`);

      // Trigger AI learning analysis
      const learningResult = await aiLearningEngine.analyzeLiveTrade(userId, tradeId);

      if (learningResult.success) {
        console.log(`[LiveTradeLearningTrigger] ✅ Analysis complete: ${learningResult.learningsExtracted} insights extracted (2x weighted * ${riskWeight}x risk)`);

        // Fetch the trade details for skill tracker
        const { data: trade } = await supabase
          .from('goal_session_trades')
          .select('*')
          .eq('id', tradeId)
          .maybeSingle();

        if (trade) {
          // Calculate metrics
          const profitLoss = parseFloat(trade.profit_loss.toString());
          const isWinningTrade = profitLoss > 0;

          // Get recent trades to calculate rolling profit factor
          const { data: recentTrades } = await supabase
            .from('goal_session_trades')
            .select('profit_loss')
            .eq('user_id', userId)
            .eq('status', 'closed')
            .order('closed_at', { ascending: false })
            .limit(20);

          // Calculate profit factor from recent trades
          let profitFactor = 1.0; // Default
          if (recentTrades && recentTrades.length >= 5) {
            const totalWins = recentTrades
              .filter(t => parseFloat(t.profit_loss.toString()) > 0)
              .reduce((sum, t) => sum + parseFloat(t.profit_loss.toString()), 0);
            const totalLosses = Math.abs(recentTrades
              .filter(t => parseFloat(t.profit_loss.toString()) < 0)
              .reduce((sum, t) => sum + parseFloat(t.profit_loss.toString()), 0));

            profitFactor = totalLosses > 0 ? totalWins / totalLosses : (totalWins > 0 ? 5.0 : 1.0);
          }

          // Calculate win rate from recent trades
          const winRate = recentTrades && recentTrades.length > 0
            ? (recentTrades.filter(t => parseFloat(t.profit_loss.toString()) > 0).length / recentTrades.length) * 100
            : isWinningTrade ? 100 : 0;

          // ONLY update skill progression if trade was a winner
          if (isWinningTrade) {
            // Apply risk weight to the base 2.0x live trade multiplier
            const totalWeight = 2.0 * riskWeight;
            console.log(`[LiveTradeLearningTrigger] 🎯 Trade was profitable! Adding to skill progression (${totalWeight.toFixed(1)}x total weight)`);
            console.log(`[LiveTradeLearningTrigger] 📊 Rolling metrics: WR=${winRate.toFixed(1)}%, PF=${profitFactor.toFixed(2)}`);

            // Update skill progression using live trading method (2.0x * risk_weight impact)
            // Pass 1 winning trade count with adjusted weight
            await aiSkillTracker.updateAfterLiveTrading(
              userId,
              1, // 1 winning trade (with 2.0x * risk_weight multiplier applied inside)
              winRate,
              profitFactor,
              learningResult.learningsExtracted,
              riskWeight // Pass risk weight for proper weighting
            );

            console.log(`[LiveTradeLearningTrigger] 📊 Skill progression updated`);
          } else {
            console.log(`[LiveTradeLearningTrigger] ❌ Trade was a loss - no progress added (learning still recorded)`);
          }
        }
      } else {
        console.error(`[LiveTradeLearningTrigger] ❌ Failed to analyze trade ${tradeId}`);
      }
    } catch (error) {
      console.error(`[LiveTradeLearningTrigger] Error analyzing trade ${tradeId}:`, error);
    }
  }

  /**
   * Manually trigger analysis of all pending trades
   */
  async analyzePendingTrades(userId: string): Promise<{ tradesAnalyzed: number; insightsExtracted: number }> {
    console.log('[LiveTradeLearningTrigger] 🔄 Manually analyzing all pending trades...');

    try {
      const result = await aiLearningEngine.analyzePendingLiveTrades(userId);

      console.log(`[LiveTradeLearningTrigger] ✅ Manual analysis complete: ${result.tradesAnalyzed} trades, ${result.totalInsights} insights`);

      return {
        tradesAnalyzed: result.tradesAnalyzed,
        insightsExtracted: result.totalInsights
      };
    } catch (error) {
      console.error('[LiveTradeLearningTrigger] Error in manual analysis:', error);
      return { tradesAnalyzed: 0, insightsExtracted: 0 };
    }
  }

  /**
   * Get statistics about live trade learning
   */
  async getLearningStats(userId: string) {
    try {
      const { data, error } = await supabase.rpc('get_live_learning_stats', {
        p_user_id: userId
      });

      if (error) {
        console.error('[LiveTradeLearningTrigger] Error fetching stats:', error);
        return null;
      }

      return data?.[0] || null;
    } catch (error) {
      console.error('[LiveTradeLearningTrigger] Error in getLearningStats:', error);
      return null;
    }
  }

  /**
   * Check if service is running
   */
  isActive(): boolean {
    return this.isRunning;
  }
}

export const liveTradeLearningTrigger = new LiveTradeLearningTrigger();
