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
 * INTEGRATED WITH 3-TIER CACHE SYSTEM:
 * - Uses omega_market_intelligence table (brain_name: 'market_context')
 * - Per-symbol cache sharing across all users
 * - 15-minute TTL for market context data
 */

import { supabase } from '@/lib/supabase';
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

    if (this.isMemoryCacheValid(cacheKey)) {
      this.cacheStats.hits++;
      const cached = this.cachedContext.get(cacheKey)!;
      console.log(`[MarketContext] ⚡ Memory cache HIT for ${symbol} (${this.cacheStats.hits} hits)`);
      return cached.context;
    }

    const dbCached = await this.getFromThreeTierCache(symbol, marketState.atr);
    if (dbCached) {
      this.cacheStats.hits++;
      this.cachedContext.set(cacheKey, {
        context: dbCached.context,
        expiry: new Date(Date.now() + this.CACHE_DURATION_MINUTES * 60 * 1000)
      });
      console.log(`[MarketContext] ⚡ 3-Tier cache HIT for ${symbol} (age: ${dbCached.ageSeconds}s)`);
      await this.logCacheStat('hit', dbCached.ageSeconds, symbol);
      return dbCached.context;
    }

    this.cacheStats.misses++;
    console.log(`[MarketContext] 🔄 Cache MISS for ${symbol} - Generating fresh analysis...`);
    await this.logCacheStat('miss', 0, symbol);

    const context = this.generateFreshContext(symbol, candles, marketState, timestamp);

    this.cachedContext.set(cacheKey, {
      context,
      expiry: new Date(Date.now() + this.CACHE_DURATION_MINUTES * 60 * 1000)
    });

    await this.saveToThreeTierCache(symbol, context, marketState.atr);

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
   * Get market context from 3-tier omega_market_intelligence cache
   * Platform-wide per-symbol cache (users share context for same symbol+ATR)
   */
  private async getFromThreeTierCache(
    symbol: string,
    atr: number
  ): Promise<{ context: AggregatedSentiment; ageSeconds: number } | null> {
    try {
      const atrBucket = Math.floor(atr * 1000) / 1000;
      const marketStateHash = `MC_${symbol}_ATR${atrBucket}`;

      const { data, error } = await supabase
        .rpc('get_omega_intelligence', {
          p_symbol: symbol,
          p_timeframe: 'M15',
          p_brain_name: 'market_context',
          p_market_state_hash: marketStateHash
        });

      if (error || !data || data.length === 0) {
        return null;
      }

      const cached = data[0];
      const rawSnapshot = cached.raw_snapshot;

      if (!rawSnapshot || !rawSnapshot.sentiment) {
        return null;
      }

      const context: AggregatedSentiment = {
        sentiment: rawSnapshot.sentiment,
        usd_strength: rawSnapshot.usd_strength,
        volatility: rawSnapshot.volatility,
        bias: rawSnapshot.bias || 'neutral',
        confidence: cached.confidence,
        warnings: rawSnapshot.warnings || [],
        summary: cached.reasoning || '',
        timestamp: new Date(cached.created_at),
        sources_used: rawSnapshot.sources_used || []
      };

      return {
        context,
        ageSeconds: cached.cache_age_seconds
      };
    } catch (error) {
      console.warn('[MarketContext] 3-tier cache lookup failed:', error);
      return null;
    }
  }

  /**
   * Save market context to 3-tier omega_market_intelligence cache
   */
  private async saveToThreeTierCache(
    symbol: string,
    context: AggregatedSentiment,
    atr: number
  ): Promise<void> {
    try {
      // CRITICAL FIX: Validate ATR before saving to prevent NULL constraint violations
      if (!atr || isNaN(atr) || atr <= 0) {
        console.error(`[MarketContext] ❌ Cannot save cache - invalid ATR for ${symbol}: ${atr}`);
        return; // Fail silently - don't try to save invalid data
      }

      const ttlMinutes = this.CACHE_DURATION_MINUTES;
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

      const atrBucket = Math.floor(atr * 1000);

      // Additional validation: atrBucket must be a valid integer
      if (!Number.isFinite(atrBucket) || isNaN(atrBucket)) {
        console.error(`[MarketContext] ❌ Cannot save cache - invalid atrBucket for ${symbol}: ${atrBucket} (from ATR: ${atr})`);
        return;
      }

      const marketStateHash = `MC_${symbol}_ATR${Math.floor(atr * 1000) / 1000}`;

      const voteMapping: Record<string, string> = {
        'risk_on': 'BUY',
        'risk_off': 'SELL',
        'mixed': 'NEUTRAL'
      };

      const { error } = await supabase.from('omega_market_intelligence').upsert({
        symbol: symbol,
        timeframe: 'M15',
        brain_name: 'market_context',
        atr_price_bucket: atrBucket,
        market_state_hash: marketStateHash,
        vote: voteMapping[context.sentiment] || 'NEUTRAL',
        confidence: context.confidence,
        reasoning: context.summary,
        key_factors: context.warnings,
        raw_snapshot: {
          sentiment: context.sentiment,
          usd_strength: context.usd_strength,
          volatility: context.volatility,
          bias: context.bias,
          warnings: context.warnings,
          sources_used: context.sources_used
        },
        expires_at: expiresAt.toISOString()
      }, {
        onConflict: 'symbol,timeframe,brain_name,market_state_hash'
      });

      if (error) {
        console.error('[MarketContext] ❌ Cache save failed:', error.message);
        console.error('[MarketContext] Error details:', JSON.stringify(error, null, 2));
      } else {
        console.log(`[MarketContext] ✅ Saved to 3-tier cache for ${symbol} (TTL: ${ttlMinutes}min)`);
      }
    } catch (error) {
      console.error('[MarketContext] ❌ Cache save exception:', error);
    }
  }

  /**
   * Log cache statistics to cache_stats_log
   */
  private async logCacheStat(hitOrMiss: 'hit' | 'miss', cacheAgeSeconds: number, symbol: string): Promise<void> {
    try {
      await supabase.from('cache_stats_log').insert({
        cache_tier: 'omega',
        symbol: symbol,
        timeframe: 'M15',
        event_type: 'lookup',
        hit_or_miss: hitOrMiss,
        cache_age_seconds: cacheAgeSeconds,
        llm_calls_saved: 0
      });
    } catch {
    }
  }

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
   * Get market context trend for specific symbol (compare current vs previous)
   */
  async getSentimentTrend(symbol: string): Promise<{
    current: AggregatedSentiment | null;
    previous: AggregatedSentiment | null;
    direction: 'improving' | 'worsening' | 'stable' | 'unknown';
  }> {
    try {
      const { data, error } = await supabase
        .from('omega_market_intelligence')
        .select('raw_snapshot, created_at, confidence, reasoning')
        .eq('symbol', symbol)
        .eq('brain_name', 'market_context')
        .order('created_at', { ascending: false })
        .limit(2);

      if (error || !data || data.length === 0) {
        return { current: null, previous: null, direction: 'unknown' };
      }

      const current = this.extractSentimentFromCache(data[0]);
      const previous = data.length > 1 ? this.extractSentimentFromCache(data[1]) : null;

      let direction: 'improving' | 'worsening' | 'stable' | 'unknown' = 'unknown';

      if (previous && current) {
        const currentScore = this.sentimentToScore(current.sentiment);
        const previousScore = this.sentimentToScore(previous.sentiment);

        if (currentScore > previousScore) {
          direction = 'improving';
        } else if (currentScore < previousScore) {
          direction = 'worsening';
        } else {
          direction = 'stable';
        }
      }

      return { current, previous, direction };

    } catch (error) {
      console.error('[MarketContext] Failed to get trend:', error);
      return { current: null, previous: null, direction: 'unknown' };
    }
  }

  /**
   * Extract AggregatedSentiment from cache record
   */
  private extractSentimentFromCache(record: any): AggregatedSentiment {
    const rawSnapshot = record.raw_snapshot;
    return {
      sentiment: rawSnapshot.sentiment,
      usd_strength: rawSnapshot.usd_strength,
      volatility: rawSnapshot.volatility,
      bias: rawSnapshot.bias || 'neutral',
      confidence: record.confidence,
      warnings: rawSnapshot.warnings || [],
      summary: record.reasoning || '',
      timestamp: new Date(record.created_at),
      sources_used: rawSnapshot.sources_used || []
    };
  }

  /**
   * Convert sentiment enum to numeric score for trend comparison
   */
  private sentimentToScore(sentiment: 'risk_on' | 'risk_off' | 'mixed'): number {
    switch (sentiment) {
      case 'risk_on':
        return 1;
      case 'mixed':
        return 0;
      case 'risk_off':
        return -1;
    }
  }
}

export const sentimentAggregator = new MarketContextAggregator();
export type { AggregatedSentiment };
