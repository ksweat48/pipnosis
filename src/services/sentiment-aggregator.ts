/**
 * Sentiment Aggregator + Weighting Engine
 *
 * Combines sentiment from multiple reliable API sources:
 * - Finnhub: 35% (professional financial news, no CORS issues)
 * - FMP: 35% (financial market headlines, 250 calls/day)
 * - Fear & Greed: 20% (sentiment gauge, no key required)
 * - CoinGecko: 10% (risk appetite indicator, 30 calls/min)
 *
 * Note: Reddit removed due to unreliable JSON feeds and rate limiting.
 * All sources use proper APIs to avoid CORS issues.
 *
 * NOW INTEGRATED WITH 3-TIER CACHE SYSTEM:
 * - Uses omega_market_intelligence table (brain_name: 'sentiment')
 * - Platform-wide cache sharing across all users
 * - 15-minute TTL for sentiment data
 */

import { supabase } from '@/lib/supabase';
import { omegaSentimentBrain, SentimentInput, SentimentOutput } from '@/brains/omega-sentiment-brain';

interface SourceWeights {
  finnhub: number;
  fmp: number;
  reddit: number;
  feargreed: number;
  coingecko: number;
}

interface AggregatedSentiment {
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

class SentimentAggregator {
  private readonly WEIGHTS: SourceWeights = {
    finnhub: 0.35,
    fmp: 0.35,
    reddit: 0.00,
    feargreed: 0.20,
    coingecko: 0.10
  };

  private readonly CACHE_DURATION_MINUTES = 15;
  private readonly SENTIMENT_CACHE_KEY = 'GLOBAL_MARKET_SENTIMENT';
  private cachedSentiment: AggregatedSentiment | null = null;
  private cacheExpiry: Date | null = null;

  private cacheStats = {
    hits: 0,
    misses: 0,
    lastCost: 0
  };

  async getAggregatedSentiment(input: SentimentInput): Promise<AggregatedSentiment> {
    if (this.isCacheValid()) {
      this.cacheStats.hits++;
      console.log(`[SentimentAgg] ⚡ Memory cache HIT (${this.cacheStats.hits} hits, saved ~$0.00014)`);
      return this.cachedSentiment!;
    }

    const dbCached = await this.getFromThreeTierCache();
    if (dbCached) {
      this.cacheStats.hits++;
      this.cachedSentiment = dbCached.sentiment;
      this.cacheExpiry = new Date(Date.now() + this.CACHE_DURATION_MINUTES * 60 * 1000);
      console.log(`[SentimentAgg] ⚡ 3-Tier cache HIT (age: ${dbCached.ageSeconds}s, saved ~$0.00014)`);
      await this.logCacheStat('hit', dbCached.ageSeconds);
      return dbCached.sentiment;
    }

    this.cacheStats.misses++;
    console.log(`[SentimentAgg] 🔄 Cache MISS - Generating fresh analysis...`);
    await this.logCacheStat('miss', 0);

    const sentiment = await this.generateFreshSentiment(input);
    this.cachedSentiment = sentiment;
    this.cacheExpiry = new Date(Date.now() + this.CACHE_DURATION_MINUTES * 60 * 1000);
    await this.saveToThreeTierCache(sentiment);
    await this.saveToDatabase(sentiment);

    const hitRate = this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) * 100;
    console.log(`[SentimentAgg] 📊 Cache stats: ${hitRate.toFixed(0)}% hit rate (${this.cacheStats.hits}/${this.cacheStats.hits + this.cacheStats.misses})`);

    return sentiment;
  }

  /**
   * Generate fresh sentiment from Omega-7
   */
  private async generateFreshSentiment(input: SentimentInput): Promise<AggregatedSentiment> {
    const sourcesUsed: string[] = [];

    if (input.finnhubNews.length > 0) sourcesUsed.push('finnhub');
    if (input.fmpNews.length > 0) sourcesUsed.push('fmp');
    if (input.redditSignals.length > 0) sourcesUsed.push('reddit');
    if (input.fearGreedSignals.length > 0) sourcesUsed.push('feargreed');
    if (input.coinGeckoTrending.length > 0) sourcesUsed.push('coingecko');

    // Call Omega-7 for analysis
    const rawSentiment = await omegaSentimentBrain.evaluateSentiment(input);

    // Apply source weighting to confidence
    const weightedConfidence = this.calculateWeightedConfidence(rawSentiment.confidence, sourcesUsed);

    return {
      sentiment: rawSentiment.sentiment,
      usd_strength: rawSentiment.usd_strength,
      volatility: rawSentiment.volatility,
      bias: rawSentiment.bias,
      confidence: weightedConfidence,
      warnings: rawSentiment.warnings,
      summary: rawSentiment.summary,
      timestamp: new Date(),
      sources_used: sourcesUsed
    };
  }

  /**
   * Calculate weighted confidence based on sources available
   *
   * Examples:
   * - All 4 sources (100%): confidence unchanged
   * - Finnhub + FMP only (70%): confidence * 0.7
   * - Fear & Greed + CoinGecko only (30%): confidence * 0.3
   */
  private calculateWeightedConfidence(baseConfidence: number, sourcesUsed: string[]): number {
    let totalWeight = 0;

    sourcesUsed.forEach(source => {
      switch (source) {
        case 'finnhub':
          totalWeight += this.WEIGHTS.finnhub;
          break;
        case 'fmp':
          totalWeight += this.WEIGHTS.fmp;
          break;
        case 'reddit':
          totalWeight += this.WEIGHTS.reddit;
          break;
        case 'feargreed':
          totalWeight += this.WEIGHTS.feargreed;
          break;
        case 'coingecko':
          totalWeight += this.WEIGHTS.coingecko;
          break;
      }
    });

    // Adjust confidence by available source weight
    // If all sources available (totalWeight = 1.0), no adjustment
    // If only some sources (e.g., 0.7), reduce confidence proportionally
    const adjustedConfidence = Math.round(baseConfidence * totalWeight);

    // Log warning if confidence significantly reduced
    if (totalWeight < 0.5) {
      console.warn(`[SentimentAgg] ⚠️ LOW DATA QUALITY: Only ${(totalWeight * 100).toFixed(0)}% of sentiment sources available. Confidence reduced to ${adjustedConfidence}%`);
    } else if (totalWeight < 0.8) {
      console.log(`[SentimentAgg] ⚡ Degraded sentiment data: ${(totalWeight * 100).toFixed(0)}% of sources available`);
    }

    return Math.max(1, Math.min(100, adjustedConfidence));
  }

  /**
   * Check if memory cache is still valid
   */
  private isCacheValid(): boolean {
    if (!this.cachedSentiment || !this.cacheExpiry) {
      return false;
    }

    return Date.now() < this.cacheExpiry.getTime();
  }

  /**
   * Get cached sentiment from database
   */
  private async getFromDatabase(): Promise<AggregatedSentiment | null> {
    try {
      const cutoff = new Date(Date.now() - this.CACHE_DURATION_MINUTES * 60 * 1000);

      const { data, error } = await supabase
        .from('market_sentiment_cache')
        .select('sentiment_json, created_at')
        .gte('created_at', cutoff.toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      const sentiment = data.sentiment_json as AggregatedSentiment;
      sentiment.timestamp = new Date(data.created_at);

      return sentiment;

    } catch (error) {
      console.error('[SentimentAgg] Failed to get from database:', error);
      return null;
    }
  }

  /**
   * Save sentiment to database (legacy table)
   */
  private async saveToDatabase(sentiment: AggregatedSentiment): Promise<void> {
    try {
      const { error } = await supabase
        .from('market_sentiment_cache')
        .insert({
          sentiment_json: sentiment,
          created_at: sentiment.timestamp.toISOString()
        });

      if (error) {
        console.error('[SentimentAgg] Failed to save to database:', error);
      }

    } catch (error) {
      console.error('[SentimentAgg] Database save error:', error);
    }
  }

  /**
   * Get sentiment from 3-tier omega_market_intelligence cache
   * This is platform-wide (all users share the same sentiment analysis)
   */
  private async getFromThreeTierCache(): Promise<{ sentiment: AggregatedSentiment; ageSeconds: number } | null> {
    try {
      const { data, error } = await supabase
        .rpc('get_omega_intelligence', {
          p_symbol: 'GLOBAL',
          p_timeframe: 'SENTIMENT',
          p_brain_name: 'sentiment',
          p_market_state_hash: this.SENTIMENT_CACHE_KEY
        });

      if (error || !data || data.length === 0) {
        return null;
      }

      const cached = data[0];
      const rawSnapshot = cached.raw_snapshot;

      if (!rawSnapshot || !rawSnapshot.sentiment) {
        return null;
      }

      const sentiment: AggregatedSentiment = {
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
        sentiment,
        ageSeconds: cached.cache_age_seconds
      };
    } catch (error) {
      console.warn('[SentimentAgg] 3-tier cache lookup failed:', error);
      return null;
    }
  }

  /**
   * Save sentiment to 3-tier omega_market_intelligence cache
   */
  private async saveToThreeTierCache(sentiment: AggregatedSentiment): Promise<void> {
    try {
      const ttlMinutes = this.CACHE_DURATION_MINUTES;
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

      const voteMapping: Record<string, string> = {
        'risk_on': 'BUY',
        'risk_off': 'SELL',
        'mixed': 'NEUTRAL'
      };

      await supabase.from('omega_market_intelligence').upsert({
        symbol: 'GLOBAL',
        timeframe: 'SENTIMENT',
        brain_name: 'sentiment',
        atr_price_bucket: 0,
        market_state_hash: this.SENTIMENT_CACHE_KEY,
        vote: voteMapping[sentiment.sentiment] || 'NEUTRAL',
        confidence: sentiment.confidence,
        reasoning: sentiment.summary,
        key_factors: sentiment.warnings,
        raw_snapshot: {
          sentiment: sentiment.sentiment,
          usd_strength: sentiment.usd_strength,
          volatility: sentiment.volatility,
          bias: sentiment.bias,
          warnings: sentiment.warnings,
          sources_used: sentiment.sources_used
        },
        expires_at: expiresAt.toISOString()
      }, {
        onConflict: 'symbol,timeframe,brain_name,market_state_hash'
      });

      console.log(`[SentimentAgg] ✅ Saved to 3-tier cache (TTL: ${ttlMinutes}min)`);
    } catch (error) {
      console.warn('[SentimentAgg] Failed to save to 3-tier cache:', error);
    }
  }

  /**
   * Log cache statistics to cache_stats_log
   */
  private async logCacheStat(hitOrMiss: 'hit' | 'miss', cacheAgeSeconds: number): Promise<void> {
    try {
      await supabase.from('cache_stats_log').insert({
        cache_tier: 'omega',
        symbol: 'GLOBAL',
        timeframe: 'SENTIMENT',
        event_type: 'lookup',
        hit_or_miss: hitOrMiss,
        cache_age_seconds: cacheAgeSeconds,
        llm_calls_saved: hitOrMiss === 'hit' ? 1 : 0
      });
    } catch {
    }
  }

  /**
   * Force refresh sentiment (bypasses cache)
   */
  async forceRefresh(input: SentimentInput): Promise<AggregatedSentiment> {
    this.cachedSentiment = null;
    this.cacheExpiry = null;
    return await this.getAggregatedSentiment(input);
  }

  /**
   * Clear cache (useful for testing)
   */
  clearCache(): void {
    this.cachedSentiment = null;
    this.cacheExpiry = null;
  }

  /**
   * Get sentiment trend (compare current vs previous)
   */
  async getSentimentTrend(): Promise<{
    current: AggregatedSentiment | null;
    previous: AggregatedSentiment | null;
    direction: 'improving' | 'worsening' | 'stable' | 'unknown';
  }> {
    try {
      const { data, error } = await supabase
        .from('market_sentiment_cache')
        .select('sentiment_json, created_at')
        .order('created_at', { ascending: false })
        .limit(2);

      if (error || !data || data.length === 0) {
        return { current: null, previous: null, direction: 'unknown' };
      }

      const current = data[0].sentiment_json as AggregatedSentiment;
      const previous = data.length > 1 ? (data[1].sentiment_json as AggregatedSentiment) : null;

      let direction: 'improving' | 'worsening' | 'stable' | 'unknown' = 'unknown';

      if (previous) {
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
      console.error('[SentimentAgg] Failed to get trend:', error);
      return { current: null, previous: null, direction: 'unknown' };
    }
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

export const sentimentAggregator = new SentimentAggregator();
export type { AggregatedSentiment };
