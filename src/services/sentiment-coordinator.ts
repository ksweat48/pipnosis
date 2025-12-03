/**
 * Sentiment Coordinator
 *
 * Master orchestrator for Omega-7 sentiment system.
 * Coordinates:
 * - Scraping from 5 free sources
 * - Sentiment aggregation and weighting
 * - LLM analysis via Omega-7
 * - Trade plan modifications
 * - Mid-trade sentiment override
 */

import { sentimentScrapers } from './sentiment-scrapers';
import { sentimentAggregator, AggregatedSentiment } from './sentiment-aggregator';
import { sentimentRiskModifiers, TradePlan, ModifiedTradePlan } from './sentiment-risk-modifiers';

class SentimentCoordinator {
  private isRunning: boolean = false;
  private lastUpdate: Date | null = null;

  /**
   * Get current sentiment (from cache or fresh)
   */
  async getCurrentSentiment(): Promise<AggregatedSentiment | null> {
    try {
      // Scrape all sources
      const scrapedData = await sentimentScrapers.scrapeAll();

      // Aggregate and analyze
      const sentiment = await sentimentAggregator.getAggregatedSentiment(scrapedData);

      this.lastUpdate = new Date();

      return sentiment;

    } catch (error) {
      console.error('[SentimentCoord] Failed to get sentiment:', error);
      return null;
    }
  }

  /**
   * Apply sentiment to trade plan (called before trade execution)
   */
  async applyToTradePlan(plan: TradePlan): Promise<ModifiedTradePlan> {
    try {
      const sentiment = await this.getCurrentSentiment();

      if (!sentiment) {
        console.warn('[SentimentCoord] No sentiment available - using original plan');
        return {
          ...plan,
          original_risk_pct: plan.risk_pct,
          original_sl: plan.stopLoss,
          original_tp: plan.takeProfit,
          sentiment_applied: false,
          modifications: ['Sentiment unavailable']
        };
      }

      // Check if trade should be blocked
      const blockCheck = sentimentRiskModifiers.shouldBlockTrade(sentiment, plan);
      if (blockCheck.block) {
        console.warn('[SentimentCoord] Trade blocked:', blockCheck.reason);
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
      const modified = sentimentRiskModifiers.applyModifiers(plan, sentiment);

      console.log('[SentimentCoord] Plan modified:', {
        original_risk: plan.risk_pct.toFixed(2),
        modified_risk: modified.risk_pct.toFixed(2),
        modifications: modified.modifications.length
      });

      return modified;

    } catch (error) {
      console.error('[SentimentCoord] Failed to apply sentiment:', error);

      // Return unmodified plan on error
      return {
        ...plan,
        original_risk_pct: plan.risk_pct,
        original_sl: plan.stopLoss,
        original_tp: plan.takeProfit,
        sentiment_applied: false,
        modifications: ['Error applying sentiment']
      };
    }
  }

  /**
   * Get sentiment for mid-trade evaluation
   */
  async getSentimentForMidTrade(): Promise<{
    current: AggregatedSentiment | null;
    previous: AggregatedSentiment | null;
    hasFlipped: boolean;
    direction: 'improving' | 'worsening' | 'stable' | 'unknown';
  }> {
    try {
      const trend = await sentimentAggregator.getSentimentTrend();

      const hasFlipped = this.detectSentimentFlip(trend.current, trend.previous);

      return {
        current: trend.current,
        previous: trend.previous,
        hasFlipped,
        direction: trend.direction
      };

    } catch (error) {
      console.error('[SentimentCoord] Failed to get mid-trade sentiment:', error);
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
   * Force refresh sentiment (bypasses cache)
   */
  async forceRefresh(): Promise<AggregatedSentiment | null> {
    try {
      sentimentAggregator.clearCache();
      return await this.getCurrentSentiment();
    } catch (error) {
      console.error('[SentimentCoord] Force refresh failed:', error);
      return null;
    }
  }
}

export const sentimentCoordinator = new SentimentCoordinator();
