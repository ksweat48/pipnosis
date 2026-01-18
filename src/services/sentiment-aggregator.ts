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
import type { Candle, MarketState } from '@/services/regime-oracle';

export interface AggregatedSentiment {
  sentiment: 'risk_on' | 'risk_off' | 'mixed';
  usd_strength: 'strong' | 'weak' | 'neutral';
  volatility: 'high' | 'medium' | 'low';
  bias: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  warnings: string[];
  summary: string;
  timestamp: Date;
  sources_used: string[];
}

class MarketContextAggregator {
  private readonly CACHE_DURATION_MINUTES = 15;
  private cachedContext: Map<string, { context: AggregatedSentiment; expiry: Date }> = new Map();

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

    // Store in memory cache
    this.cachedContext.set(cacheKey, {
      context,
      expiry: new Date(Date.now() + this.CACHE_DURATION_MINUTES * 60 * 1000)
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
   * REMOVED: getSentimentTrend()
   *
   * This method relied on omega_market_intelligence table which was
   * intentionally dropped per SSOT architecture. Trend analysis should
   * be implemented using real-time price action, not historical cache data.
   *
   * If trend analysis is needed:
   * - Use regime-oracle for momentum analysis
   * - Compare current vs previous candle structures
   * - Use volatility expansion/compression metrics
   */
}

export const sentimentAggregator = new MarketContextAggregator();
export type { AggregatedSentiment };
