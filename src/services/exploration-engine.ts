import { supabase } from '../lib/supabase';

/**
 * Exploration Engine
 *
 * Implements Exploration vs Exploitation strategy to prevent the AI from
 * getting stuck in local minima. Occasionally takes lower-confidence trades
 * to discover new profitable patterns.
 *
 * Strategy: 1 in 10 trades should be "exploratory" (60-75% confidence range)
 * This ensures the AI:
 * - Discovers new patterns that might be profitable
 * - Doesn't over-optimize on existing data
 * - Maintains diversity in learning samples
 * - Adapts to changing market conditions
 */

interface ExplorationConfig {
  explorationRate: number; // 0-1, default 0.1 (10%)
  minExploratoryConfidence: number; // Minimum confidence for exploration
  maxExploratoryConfidence: number; // Maximum confidence for exploration
  totalTrades: number;
  exploratoryTrades: number;
  lastExploratoryTrade: Date | null;
}

interface ExplorationDecision {
  shouldExplore: boolean;
  reasoning: string;
  adjustedConfidenceThreshold: number;
  originalThreshold: number;
}

class ExplorationEngine {
  private readonly DEFAULT_EXPLORATION_RATE = 0.1; // 10% of trades
  private readonly MIN_EXPLORATORY_CONFIDENCE = 60;
  private readonly MAX_EXPLORATORY_CONFIDENCE = 75;
  private readonly NORMAL_CONFIDENCE_THRESHOLD = 75;

  /**
   * Get exploration configuration for a user
   */
  async getExplorationConfig(userId: string): Promise<ExplorationConfig> {
    try {
      // Get trade statistics
      const { data: trades, error } = await supabase
        .from('trade_history')
        .select('id, confidence_score, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        console.error('[Exploration] Error fetching trades:', error);
        return this.getDefaultConfig();
      }

      const totalTrades = trades?.length || 0;
      const exploratoryTrades = trades?.filter(
        t => t.confidence_score >= this.MIN_EXPLORATORY_CONFIDENCE &&
             t.confidence_score <= this.MAX_EXPLORATORY_CONFIDENCE
      ).length || 0;

      const lastExploratory = trades?.find(
        t => t.confidence_score >= this.MIN_EXPLORATORY_CONFIDENCE &&
             t.confidence_score <= this.MAX_EXPLORATORY_CONFIDENCE
      );

      return {
        explorationRate: this.DEFAULT_EXPLORATION_RATE,
        minExploratoryConfidence: this.MIN_EXPLORATORY_CONFIDENCE,
        maxExploratoryConfidence: this.MAX_EXPLORATORY_CONFIDENCE,
        totalTrades,
        exploratoryTrades,
        lastExploratoryTrade: lastExploratory ? new Date(lastExploratory.created_at) : null
      };
    } catch (error) {
      console.error('[Exploration] Error in getExplorationConfig:', error);
      return this.getDefaultConfig();
    }
  }

  /**
   * Decide if this trade should be exploratory
   * Returns true approximately 1 in 10 times (10% exploration rate)
   */
  async shouldExploreThisTrade(
    userId: string,
    currentConfidence: number
  ): Promise<ExplorationDecision> {
    try {
      const config = await this.getExplorationConfig(userId);

      // Calculate current exploration ratio
      const currentRatio = config.totalTrades > 0
        ? config.exploratoryTrades / config.totalTrades
        : 0;

      // If we're below target exploration rate, we should explore more
      const shouldIncreasExploration = currentRatio < config.explorationRate;

      // Use deterministic approach: Every ~10th trade should be exploratory
      const shouldExplore = config.totalTrades > 0 &&
                           config.totalTrades % 10 === 0 &&
                           currentConfidence >= this.MIN_EXPLORATORY_CONFIDENCE &&
                           currentConfidence < this.NORMAL_CONFIDENCE_THRESHOLD;

      // Or probabilistic: If we're way behind on exploration, increase probability
      const needsMoreExploration = shouldIncreasExploration && Math.random() < 0.15;

      const finalDecision = shouldExplore || needsMoreExploration;

      let reasoning = '';
      let adjustedThreshold = this.NORMAL_CONFIDENCE_THRESHOLD;

      if (finalDecision) {
        if (shouldExplore) {
          reasoning = `Exploratory trade (1 in 10 rule). Current exploration: ${(currentRatio * 100).toFixed(1)}%`;
        } else if (needsMoreExploration) {
          reasoning = `Increased exploration probability. Below target (${(currentRatio * 100).toFixed(1)}% < ${(config.explorationRate * 100)}%)`;
        }

        // Lower the confidence threshold for exploratory trades
        adjustedThreshold = this.MIN_EXPLORATORY_CONFIDENCE;

        console.log(`[Exploration] 🔍 EXPLORATORY MODE: ${reasoning}`);
      }

      return {
        shouldExplore: finalDecision,
        reasoning,
        adjustedConfidenceThreshold: adjustedThreshold,
        originalThreshold: this.NORMAL_CONFIDENCE_THRESHOLD
      };
    } catch (error) {
      console.error('[Exploration] Error in shouldExploreThisTrade:', error);
      return {
        shouldExplore: false,
        reasoning: 'Error determining exploration',
        adjustedConfidenceThreshold: this.NORMAL_CONFIDENCE_THRESHOLD,
        originalThreshold: this.NORMAL_CONFIDENCE_THRESHOLD
      };
    }
  }

  /**
   * Mark a trade as exploratory for tracking purposes
   */
  async markTradeAsExploratory(
    userId: string,
    tradeId: string,
    confidence: number
  ): Promise<void> {
    try {
      // Update trade notes to indicate it was exploratory
      const { error } = await supabase
        .from('trade_history')
        .update({
          notes: `🔍 EXPLORATORY TRADE (conf: ${confidence}%)`
        })
        .eq('id', tradeId)
        .eq('user_id', userId);

      if (error) {
        console.error('[Exploration] Error marking trade:', error);
      }
    } catch (error) {
      console.error('[Exploration] Error in markTradeAsExploratory:', error);
    }
  }

  /**
   * Get exploration performance metrics
   */
  async getExplorationPerformance(userId: string): Promise<any> {
    try {
      const config = await this.getExplorationConfig(userId);

      // Get performance of exploratory vs exploitation trades
      const { data: trades } = await supabase
        .from('trade_history')
        .select('confidence_score, profit_loss')
        .eq('user_id', userId)
        .not('profit_loss', 'is', null)
        .limit(200);

      if (!trades || trades.length === 0) {
        return {
          totalTrades: 0,
          exploratoryTrades: 0,
          exploitationTrades: 0,
          exploratoryWinRate: 0,
          exploitationWinRate: 0,
          message: 'No trade data available'
        };
      }

      const exploratory = trades.filter(
        t => t.confidence_score >= this.MIN_EXPLORATORY_CONFIDENCE &&
             t.confidence_score <= this.MAX_EXPLORATORY_CONFIDENCE
      );

      const exploitation = trades.filter(
        t => t.confidence_score > this.MAX_EXPLORATORY_CONFIDENCE
      );

      const exploratoryWins = exploratory.filter(t => t.profit_loss > 0).length;
      const exploitationWins = exploitation.filter(t => t.profit_loss > 0).length;

      const exploratoryWinRate = exploratory.length > 0
        ? (exploratoryWins / exploratory.length) * 100
        : 0;

      const exploitationWinRate = exploitation.length > 0
        ? (exploitationWins / exploitation.length) * 100
        : 0;

      const exploratoryPnL = exploratory.reduce((sum, t) => sum + (t.profit_loss || 0), 0);
      const exploitationPnL = exploitation.reduce((sum, t) => sum + (t.profit_loss || 0), 0);

      return {
        totalTrades: trades.length,
        exploratoryTrades: exploratory.length,
        exploitationTrades: exploitation.length,
        exploratoryWinRate: exploratoryWinRate.toFixed(1),
        exploitationWinRate: exploitationWinRate.toFixed(1),
        exploratoryPnL: exploratoryPnL.toFixed(2),
        exploitationPnL: exploitationPnL.toFixed(2),
        explorationRatio: ((exploratory.length / trades.length) * 100).toFixed(1),
        targetRatio: (this.DEFAULT_EXPLORATION_RATE * 100).toFixed(1),
        recommendation: this.getRecommendation(
          exploratory.length / trades.length,
          exploratoryWinRate,
          exploitationWinRate
        )
      };
    } catch (error) {
      console.error('[Exploration] Error in getExplorationPerformance:', error);
      return null;
    }
  }

  /**
   * Get recommendation based on exploration performance
   */
  private getRecommendation(
    currentRatio: number,
    exploratoryWinRate: number,
    exploitationWinRate: number
  ): string {
    if (currentRatio < this.DEFAULT_EXPLORATION_RATE - 0.05) {
      return 'Increase exploration - discovering new patterns is valuable';
    } else if (currentRatio > this.DEFAULT_EXPLORATION_RATE + 0.05) {
      return 'Reduce exploration - focus more on proven patterns';
    } else if (exploratoryWinRate > exploitationWinRate + 10) {
      return 'Exploratory trades performing well - consider increasing exploration';
    } else if (exploitationWinRate > exploratoryWinRate + 20) {
      return 'High-confidence trades performing much better - current exploration rate is good';
    } else {
      return 'Exploration ratio is optimal - maintain current strategy';
    }
  }

  /**
   * Get default configuration
   */
  private getDefaultConfig(): ExplorationConfig {
    return {
      explorationRate: this.DEFAULT_EXPLORATION_RATE,
      minExploratoryConfidence: this.MIN_EXPLORATORY_CONFIDENCE,
      maxExploratoryConfidence: this.MAX_EXPLORATORY_CONFIDENCE,
      totalTrades: 0,
      exploratoryTrades: 0,
      lastExploratoryTrade: null
    };
  }

  /**
   * Get exploration statistics for dashboard
   */
  async getExplorationStats(userId: string): Promise<any> {
    try {
      const config = await this.getExplorationConfig(userId);
      const performance = await this.getExplorationPerformance(userId);

      return {
        config,
        performance,
        isActive: true,
        strategy: 'Epsilon-greedy with 10% exploration rate'
      };
    } catch (error) {
      console.error('[Exploration] Error in getExplorationStats:', error);
      return null;
    }
  }
}

export const explorationEngine = new ExplorationEngine();
export type { ExplorationConfig, ExplorationDecision };
