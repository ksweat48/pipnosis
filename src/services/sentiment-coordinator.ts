/**
 * Market Context Coordinator
 *
 * Master orchestrator for deterministic market context system.
 * Coordinates:
 * - Market regime analysis from price action
 * - Volatility and structure classification
 * - Session-aware risk assessment
 * - Trade plan modifications based on market context
 * - Mid-trade context evaluation
 */

import { sentimentAggregator, type AggregatedSentiment } from './sentiment-aggregator';
import { sentimentRiskModifiers, type TradePlan, type ModifiedTradePlan } from './sentiment-risk-modifiers';
import type { Candle, MarketState } from './regime-oracle';

class SentimentCoordinator {
  private isRunning: boolean = false;
  private lastUpdate: Date | null = null;

  /**
   * Get current market context (from cache or fresh deterministic analysis)
   */
  async getCurrentSentiment(
    symbol: string,
    candles: Candle[],
    marketState: MarketState,
    timestamp: Date = new Date()
  ): Promise<AggregatedSentiment | null> {
    try {
      const context = await sentimentAggregator.getAggregatedSentiment(
        symbol,
        candles,
        marketState,
        timestamp
      );

      this.lastUpdate = new Date();

      return context;

    } catch (error) {
      console.error('[MarketContext] Failed to get market context:', error);
      return null;
    }
  }

  /**
   * Apply market context to trade plan (called before trade execution)
   */
  async applyToTradePlan(
    plan: TradePlan,
    symbol: string,
    candles: Candle[],
    marketState: MarketState,
    timestamp?: Date
  ): Promise<ModifiedTradePlan> {
    try {
      const context = await this.getCurrentSentiment(symbol, candles, marketState, timestamp);

      if (!context) {
        console.warn('[MarketContext] No context available - using original plan');
        return {
          ...plan,
          original_risk_pct: plan.risk_pct,
          original_sl: plan.stopLoss,
          original_tp: plan.takeProfit,
          sentiment_applied: false,
          modifications: ['Market context unavailable']
        };
      }

      // Check if trade should be blocked
      const blockCheck = sentimentRiskModifiers.shouldBlockTrade(context, plan);
      if (blockCheck.block) {
        console.warn('[MarketContext] Trade blocked:', blockCheck.reason);
        return {
          ...plan,
          action: 'NO_TRADE',
          original_risk_pct: plan.risk_pct,
          original_sl: plan.stopLoss,
          original_tp: plan.takeProfit,
          sentiment_applied: true,
          modifications: [`BLOCKED: ${blockCheck.reason}`]
        };
      }

      // Apply modifiers
      const modified = sentimentRiskModifiers.applyModifiers(plan, context);

      console.log('[MarketContext] Plan modified:', {
        original_risk: plan.risk_pct.toFixed(2),
        modified_risk: modified.risk_pct.toFixed(2),
        modifications: modified.modifications.length
      });

      return modified;

    } catch (error) {
      console.error('[MarketContext] Failed to apply context:', error);

      // Return unmodified plan on error
      return {
        ...plan,
        original_risk_pct: plan.risk_pct,
        original_sl: plan.stopLoss,
        original_tp: plan.takeProfit,
        sentiment_applied: false,
        modifications: ['Error applying market context']
      };
    }
  }

  /**
   * Get market context for mid-trade evaluation
   *
   * CRITICAL FIX: Now uses the restored getSentimentTrend() method
   * Properly handles errors without masking them
   */
  async getSentimentForMidTrade(symbol: string): Promise<{
    current: AggregatedSentiment | null;
    previous: AggregatedSentiment | null;
    hasFlipped: boolean;
    direction: 'improving' | 'worsening' | 'stable' | 'unknown';
  }> {
    try {
      // Call restored getSentimentTrend() method
      const trend = await sentimentAggregator.getSentimentTrend(symbol);

      if (!trend.current) {
        console.warn('[MarketContext] No current sentiment available for mid-trade evaluation');
        return {
          current: null,
          previous: null,
          hasFlipped: false,
          direction: trend.direction
        };
      }

      const hasFlipped = this.detectSentimentFlip(trend.current, trend.previous);

      if (hasFlipped) {
        console.warn(`[MarketContext] SENTIMENT FLIP DETECTED for ${symbol}: ${trend.direction}`);
      }

      return {
        current: trend.current,
        previous: trend.previous,
        hasFlipped,
        direction: trend.direction
      };

    } catch (error) {
      console.error('[MarketContext] Failed to get mid-trade context:', error);
      return {
        current: null,
        previous: null,
        hasFlipped: false,
        direction: 'unknown'
      };
    }
  }

  /**
   * Detect if sentiment has flipped significantly
   */
  private detectSentimentFlip(
    current: AggregatedSentiment | null,
    previous: AggregatedSentiment | null
  ): boolean {
    if (!current || !previous) {
      return false;
    }

    // Flip from risk_on to risk_off (or vice versa)
    if (
      (current.sentiment === 'risk_on' && previous.sentiment === 'risk_off') ||
      (current.sentiment === 'risk_off' && previous.sentiment === 'risk_on')
    ) {
      return true;
    }

    // Volatility spike (low/medium → high)
    if (
      current.volatility === 'high' &&
      (previous.volatility === 'low' || previous.volatility === 'medium')
    ) {
      return true;
    }

    // USD strength flip
    if (
      (current.usd_strength === 'strong' && previous.usd_strength === 'weak') ||
      (current.usd_strength === 'weak' && previous.usd_strength === 'strong')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Check if sentiment system is healthy
   */
  getHealthStatus(): {
    healthy: boolean;
    lastUpdate: Date | null;
    isRunning: boolean;
  } {
    return {
      healthy: this.lastUpdate !== null,
      lastUpdate: this.lastUpdate,
      isRunning: this.isRunning
    };
  }

  /**
   * Force refresh market context (bypasses cache)
   */
  async forceRefresh(
    symbol: string,
    candles: Candle[],
    marketState: MarketState,
    timestamp?: Date
  ): Promise<AggregatedSentiment | null> {
    try {
      return await sentimentAggregator.forceRefresh(symbol, candles, marketState, timestamp);
    } catch (error) {
      console.error('[MarketContext] Force refresh failed:', error);
      return null;
    }
  }
}

export const sentimentCoordinator = new SentimentCoordinator();
