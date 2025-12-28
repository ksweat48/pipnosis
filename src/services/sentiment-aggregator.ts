/**
 * Sentiment Aggregator + Weighting Engine
 *
 * Combines sentiment from multiple reliable API sources:
 * - Finnhub: 30% (professional financial news, no CORS issues)
 * - FMP: 30% (financial market headlines, 250 calls/day)
 * - Reddit: 20% (retail sentiment, no key required)
 * - Fear & Greed: 15% (sentiment gauge, no key required)
 * - CoinGecko: 5% (risk appetite indicator, 30 calls/min)
 *
 * All sources use proper APIs to avoid CORS issues.
 * 10-minute cache = ~144 calls/day maximum.
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
    finnhub: 0.30,
    fmp: 0.30,
    reddit: 0.20,
    feargreed: 0.15,
    coingecko: 0.05
  };

  private readonly CACHE_DURATION_MINUTES = 10;
  private cachedSentiment: AggregatedSentiment | null = null;
  private cacheExpiry: Date | null = null;

  /**
   * Get aggregated sentiment (from cache or fresh)
   */
  async getAggregatedSentiment(input: SentimentInput): Promise<AggregatedSentiment> {
    // Check cache first
    if (this.isCacheValid()) {
      console.log('[SentimentAgg] Using cached sentiment');
      return this.cachedSentiment!;
    }

    // Check database cache
    const dbCached = await this.getFromDatabase();
    if (dbCached) {
      console.log('[SentimentAgg] Using database cached sentiment');
      this.cachedSentiment = dbCached;
      this.cacheExpiry = new Date(Date.now() + this.CACHE_DURATION_MINUTES * 60 * 1000);
      return dbCached;
    }

    // Generate fresh sentiment
    console.log('[SentimentAgg] Generating fresh sentiment analysis...');
    const sentiment = await this.generateFreshSentiment(input);

    // Cache in memory and database
    this.cachedSentiment = sentiment;
    this.cacheExpiry = new Date(Date.now() + this.CACHE_DURATION_MINUTES * 60 * 1000);
    await this.saveToDatabase(sentiment);

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
   * - All 5 sources (100%): confidence unchanged
   * - Finnhub + FMP only (60%): confidence * 0.6
   * - Fear & Greed + CoinGecko only (20%): confidence * 0.2
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
   * Save sentiment to database
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
