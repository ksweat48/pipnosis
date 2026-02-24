/**
 * Market Context Aggregator (Deterministic)
 *
 * Provides sentiment-like market context from pure price action analysis.
 * Replaces LLM-based sentiment system with zero-cost regime analysis.
 *
 * Sources (all deterministic, zero external APIs):
 * - Regime Oracle: Session timing, volatility, structure
 * - Volatility Engine: ATR expansion/compression, wick risk
 * - Structure Analyzer: Trend strength, market bias
 *
 * CACHING ARCHITECTURE (SSOT-Compliant):
 * - Memory-only caching (deterministic data doesn't need database persistence)
 * - Per-symbol cache with 15-minute TTL
 * - Instant computation, no external API costs
 *
 * NOTE: Database caching removed per SSOT principle - only expensive LLM
 * analysis (Alpha thesis) should be cached in database. Deterministic analysis
 * is fast enough for real-time computation.
 */

import { marketContextBrain, type MarketContextInput, type MarketContextOutput } from '@/brains/omega7-market-context';
import type { Candle, MarketState, RegimeSnapshot } from '@/services/regime-oracle';
import { TIME_MS } from '@/config/time-constants';

export interface AggregatedSentiment {
  /** Raw regime snapshot - authoritative source for all downstream consumers */
  regime_snapshot?: RegimeSnapshot;
  /** @deprecated Use regime_snapshot.volatility_regime / time_regime instead */
  sentiment: 'risk_on' | 'risk_off' | 'mixed';
  /** @deprecated Use regime_snapshot.trend_regime.market_bias instead */
  usd_strength: 'strong' | 'weak' | 'neutral';
  /** @deprecated Use regime_snapshot.volatility_regime.volatility_score instead */
  volatility: 'high' | 'medium' | 'low';
  /** @deprecated Use regime_snapshot.trend_regime.market_bias instead */
  bias: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  warnings: string[];
  summary: string;
  timestamp: Date;
  sources_used: string[];
}

class MarketContextAggregator {
  // CCIP-STALENESS-FIX-2026-02-20: Reduced from 15 min to 5 min.
  // Sourced from TIME_MS.CACHE.MARKET_CONTEXT for SSOT compliance.
  // Deterministic computation — zero API cost — safe to recompute every 5 min.
  // Early invalidation also fires when candle-cache-manager detects candle close.
  private readonly CACHE_DURATION_MS = TIME_MS.CACHE.MARKET_CONTEXT; // 5 minutes
  /** @deprecated Use CACHE_DURATION_MS. Kept for expiry calculation below. */
  private readonly CACHE_DURATION_MINUTES = this.CACHE_DURATION_MS / 60_000;
  private cachedContext: Map<string, { context: AggregatedSentiment; expiry: Date }> = new Map();
  private sentimentHistory: Map<string, AggregatedSentiment[]> = new Map();
  private readonly MAX_HISTORY_SIZE = 5;

  private cacheStats = {
    hits: 0,
    misses: 0
  };

  async getAggregatedSentiment(
    symbol: string,
    candles: Candle[],
    marketState: MarketState,
    timestamp: Date = new Date()
  ): Promise<AggregatedSentiment> {
    // CRITICAL FIX: Validate ATR before using it
    if (!marketState.atr || isNaN(marketState.atr) || marketState.atr <= 0) {
      console.error(`[MarketContext] ❌ Invalid ATR for ${symbol}: ${marketState.atr}`);
      console.error(`[MarketContext] MarketState:`, {
        symbol,
        price: marketState.price,
        atr: marketState.atr,
        hasATR: 'atr' in marketState,
        atrType: typeof marketState.atr
      });
      throw new Error(`Invalid ATR value for ${symbol}: ${marketState.atr}. Cannot generate market context.`);
    }

    const cacheKey = this.buildCacheKey(symbol, marketState.atr);

    // Check memory cache
    if (this.isMemoryCacheValid(cacheKey)) {
      this.cacheStats.hits++;
      const cached = this.cachedContext.get(cacheKey)!;
      console.log(`[MarketContext] ⚡ Memory cache HIT for ${symbol} (${this.cacheStats.hits} hits)`);
      return cached.context;
    }

    // Cache miss - generate fresh context
    this.cacheStats.misses++;
    console.log(`[MarketContext] 🔄 Cache MISS for ${symbol} - Generating fresh analysis...`);

    const context = this.generateFreshContext(symbol, candles, marketState, timestamp);

    // Track sentiment history for trend analysis (CRITICAL: enables getSentimentTrend)
    this.trackSentimentHistory(symbol, context);

    // Store in memory cache
    this.cachedContext.set(cacheKey, {
      context,
      expiry: new Date(Date.now() + this.CACHE_DURATION_MS)
    });

    const hitRate = this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) * 100;
    console.log(`[MarketContext] 📊 Cache stats: ${hitRate.toFixed(0)}% hit rate (${this.cacheStats.hits}/${this.cacheStats.hits + this.cacheStats.misses})`);

    return context;
  }

  /**
   * Generate fresh market context from deterministic regime analysis
   */
  private generateFreshContext(
    symbol: string,
    candles: Candle[],
    marketState: MarketState,
    timestamp: Date
  ): AggregatedSentiment {
    const input: MarketContextInput = {
      symbol,
      candles,
      marketState,
      timestamp
    };

    const context = marketContextBrain.evaluateContext(input);

    return {
      regime_snapshot: context.regime_snapshot,
      sentiment: context.sentiment,
      usd_strength: context.usd_strength,
      volatility: context.volatility,
      bias: context.bias,
      confidence: context.confidence,
      warnings: context.warnings,
      summary: context.summary,
      timestamp: context.timestamp,
      sources_used: context.sources_used
    };
  }

  /**
   * Build cache key from symbol and ATR bucket
   */
  private buildCacheKey(symbol: string, atr: number): string {
    const atrBucket = Math.floor(atr * 1000) / 1000;
    return `${symbol}_ATR${atrBucket}`;
  }

  /**
   * Check if memory cache is still valid for this symbol
   */
  private isMemoryCacheValid(cacheKey: string): boolean {
    const cached = this.cachedContext.get(cacheKey);
    if (!cached) {
      return false;
    }

    return Date.now() < cached.expiry.getTime();
  }

  /**
   * REMOVED: Database caching methods
   *
   * Per SSOT architecture (migration 20260118032110):
   * - omega_market_intelligence table was intentionally dropped
   * - Deterministic analysis doesn't need database persistence
   * - Only expensive LLM calls (Alpha thesis) should be cached in DB
   * - Memory caching is sufficient for fast deterministic computations
   *
   * Methods removed:
   * - getFromThreeTierCache() - Used dropped table
   * - saveToThreeTierCache() - Used dropped table
   * - logCacheStat() - Used invalid cache_tier value
   */

  /**
   * Force refresh market context (bypasses cache)
   */
  async forceRefresh(
    symbol: string,
    candles: Candle[],
    marketState: MarketState,
    timestamp: Date = new Date()
  ): Promise<AggregatedSentiment> {
    const cacheKey = this.buildCacheKey(symbol, marketState.atr);
    this.cachedContext.delete(cacheKey);
    return await this.getAggregatedSentiment(symbol, candles, marketState, timestamp);
  }

  /**
   * Clear cache (useful for testing)
   */
  clearCache(): void {
    this.cachedContext.clear();
  }

  /**
   * Get sentiment trend by comparing current vs previous sentiment states
   *
   * CRITICAL: Restored method that was removed but still called by sentiment-coordinator
   * Uses in-memory history to track sentiment direction without database dependency.
   * Does NOT use the dropped omega_market_intelligence table.
   *
   * Sources for trend detection:
   * - Sentiment changes (risk_on → risk_off = worsening)
   * - Volatility expansion/compression
   * - Confidence level changes
   */
  async getSentimentTrend(symbol: string): Promise<{
    current: AggregatedSentiment | null;
    previous: AggregatedSentiment | null;
    direction: 'improving' | 'worsening' | 'stable' | 'unknown';
  }> {
    try {
      // Get history for this symbol
      const history = this.sentimentHistory.get(symbol) || [];

      if (history.length === 0) {
        console.warn(`[MarketContext] No sentiment history available for ${symbol} - returning unknown trend`);
        return {
          current: null,
          previous: null,
          direction: 'unknown'
        };
      }

      const current = history[history.length - 1]; // Latest
      const previous = history.length > 1 ? history[history.length - 2] : null;

      if (!current) {
        return {
          current: null,
          previous: null,
          direction: 'unknown'
        };
      }

      // Determine trend direction by comparing sentiment states
      let direction: 'improving' | 'worsening' | 'stable' | 'unknown' = 'unknown';

      if (previous) {
        // Risk sentiment change (primary indicator of trend)
        const riskWorsening =
          (previous.sentiment === 'risk_on' && current.sentiment === 'risk_off') ||
          (previous.sentiment === 'mixed' && current.sentiment === 'risk_off');

        const riskImproving =
          (previous.sentiment === 'risk_off' && current.sentiment === 'risk_on') ||
          (previous.sentiment === 'risk_off' && current.sentiment === 'mixed');

        // Volatility expansion (worsening)
        const volExpanding =
          current.volatility === 'high' &&
          (previous.volatility === 'medium' || previous.volatility === 'low');

        // Volatility compression (improving)
        const volCompressing =
          current.volatility === 'low' &&
          (previous.volatility === 'high' || previous.volatility === 'medium');

        // Confidence changes
        const confidenceDropping = current.confidence < previous.confidence - 10;
        const confidenceRising = current.confidence > previous.confidence + 10;

        // Composite direction assessment
        if (riskWorsening || (volExpanding && confidenceDropping)) {
          direction = 'worsening';
        } else if (riskImproving || (volCompressing && confidenceRising)) {
          direction = 'improving';
        } else if (
          current.sentiment === previous.sentiment &&
          current.volatility === previous.volatility &&
          Math.abs(current.confidence - previous.confidence) <= 10
        ) {
          direction = 'stable';
        } else {
          direction = 'stable';
        }

        console.log(`[MarketContext] Trend for ${symbol}: ${direction} (${previous.sentiment} → ${current.sentiment})`);
      } else {
        direction = 'unknown';
      }

      return {
        current,
        previous,
        direction
      };
    } catch (error) {
      console.error(`[MarketContext] Error getting sentiment trend for ${symbol}:`, error);
      return {
        current: null,
        previous: null,
        direction: 'unknown'
      };
    }
  }

  /**
   * Track sentiment history (called after each sentiment update)
   */
  private trackSentimentHistory(symbol: string, sentiment: AggregatedSentiment): void {
    let history = this.sentimentHistory.get(symbol) || [];

    // Add new sentiment to history
    history.push(sentiment);

    // Keep only last N entries to avoid memory bloat
    if (history.length > this.MAX_HISTORY_SIZE) {
      history = history.slice(history.length - this.MAX_HISTORY_SIZE);
    }

    this.sentimentHistory.set(symbol, history);
  }
}

export const sentimentAggregator = new MarketContextAggregator();
export type { AggregatedSentiment };
