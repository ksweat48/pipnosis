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
  private failedTrades: Map<string, number> = new Map(); // tradeId -> retry count
  private readonly MAX_RETRIES = 3;

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
    this.failedTrades.clear(); // Clear retry queue on stop
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
    const retryCount = this.failedTrades.get(tradeId) || 0;

    try {
      console.log(`[LiveTradeLearningTrigger] Analyzing trade ${tradeId} (${symbol}) with ${riskWeight}x risk weight (attempt ${retryCount + 1}/${this.MAX_RETRIES})`);

      // Trigger AI learning analysis with timeout
      const learningResult = await this.withTimeout(
        aiLearningEngine.analyzeLiveTrade(userId, tradeId),
        60000 // 60 second timeout
      );

      if (learningResult.success) {
        console.log(`[LiveTradeLearningTrigger] ✅ Analysis complete: ${learningResult.learningsExtracted} insights extracted (2x weighted * ${riskWeight}x risk)`);

        // Clear from failed trades map on success
        this.failedTrades.delete(tradeId);

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

          // Update skill progression for ALL trades — wins award XP, losses update calibration metrics
          // Alpha learns from every trade. Losses sharpen aim, never slow the trigger.
          const totalWeight = 2.0 * riskWeight;
          if (isWinningTrade) {
            console.log(`[LiveTradeLearningTrigger] Trade was profitable — skill progression updated (${totalWeight.toFixed(1)}x total weight)`);
          } else {
            console.log(`[LiveTradeLearningTrigger] Trade was a loss — calibration metrics updated (win rate, profit factor)`);
          }
          console.log(`[LiveTradeLearningTrigger] Rolling metrics: WR=${winRate.toFixed(1)}%, PF=${profitFactor.toFixed(2)}`);

          await aiSkillTracker.updateAfterLiveTrading(
            userId,
            isWinningTrade ? 1 : 0,
            winRate,
            profitFactor,
            learningResult.learningsExtracted,
            riskWeight,
            1
          );

          console.log(`[LiveTradeLearningTrigger] Skill tracker updated`);

        }
      } else {
        // Analysis failed - implement retry logic
        this.handleAnalysisFailure(tradeId, userId, symbol, riskWeight, 'Analysis returned failure');
      }
    } catch (error) {
      // Error during analysis - implement retry logic
      this.handleAnalysisFailure(tradeId, userId, symbol, riskWeight, error);
    }
  }

  /**
   * Handle analysis failures with retry logic
   */
  private handleAnalysisFailure(tradeId: string, userId: string, symbol: string, riskWeight: number, error: any): void {
    const retryCount = this.failedTrades.get(tradeId) || 0;

    if (retryCount < this.MAX_RETRIES) {
      this.failedTrades.set(tradeId, retryCount + 1);
      console.warn(`[LiveTradeLearningTrigger] ⚠️ Trade ${tradeId} analysis failed (${retryCount + 1}/${this.MAX_RETRIES}). Will retry on next cycle.`);
      console.warn(`[LiveTradeLearningTrigger] Error:`, error);
    } else {
      console.error(`[LiveTradeLearningTrigger] ❌ Trade ${tradeId} analysis failed after ${this.MAX_RETRIES} attempts. Giving up.`);
      console.error(`[LiveTradeLearningTrigger] Final error:`, error);
      this.failedTrades.delete(tradeId); // Remove from retry queue
    }
  }

  /**
   * Utility to run a promise with timeout
   */
  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
      )
    ]);
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

  /**
   * Get health monitoring stats
   */
  getHealthStats() {
    return {
      isRunning: this.isRunning,
      pollIntervalMs: this.pollInterval,
      lastCheckTime: this.lastCheckTime,
      failedTradesCount: this.failedTrades.size,
      failedTrades: Array.from(this.failedTrades.entries()).map(([tradeId, retryCount]) => ({
        tradeId,
        retryCount,
        maxRetries: this.MAX_RETRIES,
        willRetry: retryCount < this.MAX_RETRIES
      }))
    };
  }
}

export const liveTradeLearningTrigger = new LiveTradeLearningTrigger();
