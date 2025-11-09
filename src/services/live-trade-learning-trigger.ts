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
        .from('trade_history')
        .select('id, symbol, closed_at')
        .eq('user_id', userId)
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
        await this.analyzeTrade(userId, trade.id, trade.symbol);
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
  private async analyzeTrade(userId: string, tradeId: string, symbol: string) {
    try {
      console.log(`[LiveTradeLearningTrigger] Analyzing trade ${tradeId} (${symbol})`);

      // Trigger AI learning analysis
      const learningResult = await aiLearningEngine.analyzeLiveTrade(userId, tradeId);

      if (learningResult.success) {
        console.log(`[LiveTradeLearningTrigger] ✅ Analysis complete: ${learningResult.learningsExtracted} insights extracted (2x weighted)`);

        // Fetch the trade details for skill tracker
        const { data: trade } = await supabase
          .from('trade_history')
          .select('*')
          .eq('id', tradeId)
          .maybeSingle();

        if (trade) {
          // Calculate metrics
          const isWinningTrade = parseFloat(trade.profit_loss.toString()) > 0;
          const winRate = isWinningTrade ? 100 : 0;
          const profitFactor = isWinningTrade ? 2.0 : 0.5;

          // ONLY update skill progression if trade was a winner
          if (isWinningTrade) {
            console.log(`[LiveTradeLearningTrigger] 🎯 Trade was profitable! Adding to skill progression (1.5x weight)`);

            // Update skill progression using live trading method (1.5x impact)
            // Pass 1 winning trade count
            await aiSkillTracker.updateAfterLiveTrading(
              userId,
              1, // 1 winning trade (with 1.5x multiplier applied inside)
              winRate,
              profitFactor,
              learningResult.learningsExtracted
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
