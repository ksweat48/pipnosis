import { supabase } from '../lib/supabase';
import {
  generateMarketStateHash,
  generateOmegaVotesHash,
  buildMarketStateSnapshot,
  getTTLForTimeframe,
  getTTLForAlphaCache,
  getTTLForScoutCache,
  MarketStateSnapshot
} from './cache-key-generator';
import type { CandleData } from '../types';

export interface OmegaVote {
  vote: 'BUY' | 'SELL' | 'NO_TRADE' | 'WAIT' | 'NEUTRAL';
  confidence: number;
  reasoning: string;
  keyFactors?: string[];
}

export interface CachedOmegaIntelligence {
  brainName: string;
  vote: OmegaVote;
  cacheAgeSeconds: number;
  fromCache: boolean;
}

export interface AlphaStrategicInsight {
  marketBias: 'bullish' | 'bearish' | 'neutral' | 'mixed';
  conviction: number;
  suggestedDirection: 'buy' | 'sell' | 'wait' | 'no_trade';
  rrRangeMin: number;
  rrRangeMax: number;
  waitRecommended: boolean;
  keyReasoning: string;
  omegaSummary: Record<string, unknown>;
  cacheAgeSeconds: number;
  fromCache: boolean;
}

export interface ScoutState {
  improvementScore: number;
  shouldReconvene: boolean;
  keyChanges: string[];
  marketSummary: string;
  volatilityState: string;
  trendState: string;
  priceAtScan: number;
  cacheAgeSeconds: number;
}

export interface PersonalizedExecution {
  shouldTrade: boolean;
  direction: 'buy' | 'sell' | null;
  positionSize: number;
  riskPercent: number;
  adjustedConfidence: number;
  reasoning: string;
}

export interface CacheStats {
  cacheTier: string;
  totalLookups: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  avgCacheAgeSeconds: number;
  totalLlmCallsSaved: number;
}

type OmegaBrainName = 'trend' | 'scalper' | 'confirmation' | 'reversal' |
                      'volatility' | 'risk' | 'orderflow' | 'sentiment' |
                      'hallucination' | 'meta_reasoning' | 'regime_oracle' |
                      'adversarial_detector';

class SharedIntelligenceCoordinator {
  private localCacheEnabled = true;
  private localOmegaCache = new Map<string, { data: CachedOmegaIntelligence; expiresAt: number }>();
  private localAlphaCache = new Map<string, { data: AlphaStrategicInsight; expiresAt: number }>();
  private localScoutCache = new Map<string, { data: ScoutState; expiresAt: number }>();

  async getOmegaIntelligence(
    symbol: string,
    timeframe: string,
    brainName: OmegaBrainName,
    candles: CandleData[],
    fetchFreshFn: () => Promise<OmegaVote>
  ): Promise<CachedOmegaIntelligence> {
    const snapshot = buildMarketStateSnapshot(symbol, timeframe, candles);
    if (!snapshot) {
      const fresh = await fetchFreshFn();
      return {
        brainName,
        vote: fresh,
        cacheAgeSeconds: 0,
        fromCache: false
      };
    }

    const { hash, atrPriceBucket } = generateMarketStateHash(snapshot);

    const localKey = `omega:${symbol}:${timeframe}:${brainName}:${hash}`;
    const localCached = this.localOmegaCache.get(localKey);
    if (localCached && localCached.expiresAt > Date.now()) {
      await this.logCacheStat('omega', symbol, timeframe, 'lookup', 'hit', localCached.data.cacheAgeSeconds);
      return localCached.data;
    }

    try {
      const { data: cached, error } = await supabase
        .rpc('get_omega_intelligence', {
          p_symbol: symbol,
          p_timeframe: timeframe,
          p_brain_name: brainName,
          p_market_state_hash: hash
        });

      if (!error && cached && cached.length > 0) {
        const result: CachedOmegaIntelligence = {
          brainName,
          vote: {
            vote: cached[0].vote as OmegaVote['vote'],
            confidence: cached[0].confidence,
            reasoning: cached[0].reasoning,
            keyFactors: cached[0].key_factors || []
          },
          cacheAgeSeconds: cached[0].cache_age_seconds,
          fromCache: true
        };

        this.localOmegaCache.set(localKey, {
          data: result,
          expiresAt: Date.now() + getTTLForTimeframe(timeframe)
        });

        await this.logCacheStat('omega', symbol, timeframe, 'lookup', 'hit', result.cacheAgeSeconds, 1);
        return result;
      }
    } catch (err) {
      console.warn('[SharedIntelligence] DB cache lookup failed, fetching fresh:', err);
    }

    await this.logCacheStat('omega', symbol, timeframe, 'lookup', 'miss', 0);

    const fresh = await fetchFreshFn();

    const ttl = getTTLForTimeframe(timeframe);
    const expiresAt = new Date(Date.now() + ttl);

    try {
      await supabase.from('omega_market_intelligence').upsert({
        symbol,
        timeframe,
        brain_name: brainName,
        atr_price_bucket: atrPriceBucket,
        market_state_hash: hash,
        vote: fresh.vote,
        confidence: fresh.confidence,
        reasoning: fresh.reasoning,
        key_factors: fresh.keyFactors || [],
        expires_at: expiresAt.toISOString()
      }, {
        onConflict: 'symbol,timeframe,brain_name,market_state_hash'
      });
    } catch (err) {
      console.warn('[SharedIntelligence] Failed to write omega cache:', err);
    }

    const result: CachedOmegaIntelligence = {
      brainName,
      vote: fresh,
      cacheAgeSeconds: 0,
      fromCache: false
    };

    this.localOmegaCache.set(localKey, {
      data: result,
      expiresAt: Date.now() + ttl
    });

    return result;
  }

  async getAllOmegaIntelligence(
    symbol: string,
    timeframe: string,
    candles: CandleData[],
    brainFetchers: Record<OmegaBrainName, () => Promise<OmegaVote>>
  ): Promise<Map<OmegaBrainName, CachedOmegaIntelligence>> {
    const results = new Map<OmegaBrainName, CachedOmegaIntelligence>();

    const brainNames = Object.keys(brainFetchers) as OmegaBrainName[];

    const promises = brainNames.map(async (brainName) => {
      const result = await this.getOmegaIntelligence(
        symbol,
        timeframe,
        brainName,
        candles,
        brainFetchers[brainName]
      );
      return { brainName, result };
    });

    const allResults = await Promise.all(promises);

    for (const { brainName, result } of allResults) {
      results.set(brainName, result);
    }

    return results;
  }

  async getAlphaStrategicInsight(
    symbol: string,
    timeframe: string,
    omegaVotes: Array<{ brainName: string; vote: string; confidence: number }>,
    fetchFreshFn: () => Promise<Omit<AlphaStrategicInsight, 'cacheAgeSeconds' | 'fromCache'>>
  ): Promise<AlphaStrategicInsight> {
    const omegaVotesHash = generateOmegaVotesHash(omegaVotes);

    const localKey = `alpha:${symbol}:${timeframe}:${omegaVotesHash}`;
    const localCached = this.localAlphaCache.get(localKey);
    if (localCached && localCached.expiresAt > Date.now()) {
      await this.logCacheStat('alpha', symbol, timeframe, 'lookup', 'hit', localCached.data.cacheAgeSeconds);
      return localCached.data;
    }

    try {
      const { data: cached, error } = await supabase
        .rpc('get_alpha_strategic', {
          p_symbol: symbol,
          p_timeframe: timeframe,
          p_omega_votes_hash: omegaVotesHash
        });

      if (!error && cached && cached.length > 0) {
        const result: AlphaStrategicInsight = {
          marketBias: cached[0].market_bias as AlphaStrategicInsight['marketBias'],
          conviction: cached[0].conviction,
          suggestedDirection: cached[0].suggested_direction as AlphaStrategicInsight['suggestedDirection'],
          rrRangeMin: parseFloat(cached[0].rr_range_min) || 1.5,
          rrRangeMax: parseFloat(cached[0].rr_range_max) || 3.0,
          waitRecommended: cached[0].wait_recommended,
          keyReasoning: cached[0].key_reasoning,
          omegaSummary: cached[0].omega_summary || {},
          cacheAgeSeconds: cached[0].cache_age_seconds,
          fromCache: true
        };

        this.localAlphaCache.set(localKey, {
          data: result,
          expiresAt: Date.now() + getTTLForAlphaCache(timeframe)
        });

        await this.logCacheStat('alpha', symbol, timeframe, 'lookup', 'hit', result.cacheAgeSeconds, 1);
        return result;
      }
    } catch (err) {
      console.warn('[SharedIntelligence] Alpha cache lookup failed:', err);
    }

    await this.logCacheStat('alpha', symbol, timeframe, 'lookup', 'miss', 0);

    const fresh = await fetchFreshFn();

    const ttl = getTTLForAlphaCache(timeframe);
    const expiresAt = new Date(Date.now() + ttl);

    try {
      await supabase.from('alpha_strategic_cache').upsert({
        symbol,
        timeframe,
        omega_votes_hash: omegaVotesHash,
        market_bias: fresh.marketBias,
        conviction: fresh.conviction,
        suggested_direction: fresh.suggestedDirection,
        rr_range_min: fresh.rrRangeMin,
        rr_range_max: fresh.rrRangeMax,
        wait_recommended: fresh.waitRecommended,
        key_reasoning: fresh.keyReasoning,
        omega_summary: fresh.omegaSummary,
        expires_at: expiresAt.toISOString()
      }, {
        onConflict: 'symbol,timeframe,omega_votes_hash'
      });
    } catch (err) {
      console.warn('[SharedIntelligence] Failed to write alpha cache:', err);
    }

    const result: AlphaStrategicInsight = {
      ...fresh,
      cacheAgeSeconds: 0,
      fromCache: false
    };

    this.localAlphaCache.set(localKey, {
      data: result,
      expiresAt: Date.now() + ttl
    });

    return result;
  }

  async getScoutState(
    symbol: string,
    timeframe: string
  ): Promise<ScoutState | null> {
    const localKey = `scout:${symbol}:${timeframe}`;
    const localCached = this.localScoutCache.get(localKey);
    if (localCached && localCached.expiresAt > Date.now()) {
      return localCached.data;
    }

    try {
      const { data: cached, error } = await supabase
        .rpc('get_scout_state', {
          p_symbol: symbol,
          p_timeframe: timeframe
        });

      if (!error && cached && cached.length > 0) {
        const result: ScoutState = {
          improvementScore: cached[0].improvement_score,
          shouldReconvene: cached[0].should_reconvene,
          keyChanges: cached[0].key_changes || [],
          marketSummary: cached[0].market_summary || '',
          volatilityState: cached[0].volatility_state || 'medium',
          trendState: cached[0].trend_state || 'sideways',
          priceAtScan: parseFloat(cached[0].price_at_scan) || 0,
          cacheAgeSeconds: cached[0].cache_age_seconds
        };

        this.localScoutCache.set(localKey, {
          data: result,
          expiresAt: Date.now() + getTTLForScoutCache()
        });

        return result;
      }
    } catch (err) {
      console.warn('[SharedIntelligence] Scout state lookup failed:', err);
    }

    return null;
  }

  async updateScoutState(
    symbol: string,
    timeframe: string,
    state: Omit<ScoutState, 'cacheAgeSeconds'>,
    snapshotHash: string
  ): Promise<void> {
    const ttl = getTTLForScoutCache();
    const expiresAt = new Date(Date.now() + ttl);

    try {
      await supabase.from('scout_market_state').upsert({
        symbol,
        timeframe,
        improvement_score: state.improvementScore,
        should_reconvene: state.shouldReconvene,
        key_changes: state.keyChanges,
        market_summary: state.marketSummary,
        snapshot_hash: snapshotHash,
        price_at_scan: state.priceAtScan,
        volatility_state: state.volatilityState,
        trend_state: state.trendState,
        expires_at: expiresAt.toISOString()
      }, {
        onConflict: 'symbol,timeframe'
      });

      const localKey = `scout:${symbol}:${timeframe}`;
      this.localScoutCache.set(localKey, {
        data: { ...state, cacheAgeSeconds: 0 },
        expiresAt: Date.now() + ttl
      });
    } catch (err) {
      console.warn('[SharedIntelligence] Failed to update scout state:', err);
    }
  }

  personalizeExecution(
    alphaInsight: AlphaStrategicInsight,
    goalContext: {
      goalAmount: number;
      currentProgress: number;
      accountBalance: number;
      riskMode: 'conservative' | 'moderate' | 'aggressive';
      maxRiskPercent: number;
    }
  ): PersonalizedExecution {
    const riskMultipliers = {
      conservative: 0.5,
      moderate: 1.0,
      aggressive: 1.5
    };

    const riskMult = riskMultipliers[goalContext.riskMode];

    const progressPercent = goalContext.currentProgress / goalContext.goalAmount;
    let urgencyFactor = 1.0;
    if (progressPercent > 0.8) {
      urgencyFactor = 0.7;
    } else if (progressPercent < 0.2) {
      urgencyFactor = 1.2;
    }

    const baseRiskPercent = Math.min(goalContext.maxRiskPercent, 3);
    const adjustedRiskPercent = baseRiskPercent * riskMult * urgencyFactor;
    const finalRiskPercent = Math.min(adjustedRiskPercent, goalContext.maxRiskPercent);

    const positionValue = goalContext.accountBalance * (finalRiskPercent / 100);

    let shouldTrade = false;
    let direction: 'buy' | 'sell' | null = null;

    if (alphaInsight.waitRecommended) {
      shouldTrade = false;
    } else if (alphaInsight.suggestedDirection === 'buy' || alphaInsight.suggestedDirection === 'sell') {
      shouldTrade = alphaInsight.conviction >= 60;
      direction = alphaInsight.suggestedDirection;
    }

    let adjustedConfidence = alphaInsight.conviction;
    if (goalContext.riskMode === 'conservative') {
      adjustedConfidence = Math.max(0, adjustedConfidence - 10);
    } else if (goalContext.riskMode === 'aggressive') {
      adjustedConfidence = Math.min(100, adjustedConfidence + 5);
    }

    let reasoning = `Market bias: ${alphaInsight.marketBias}, Conviction: ${alphaInsight.conviction}%. `;
    reasoning += `Risk mode: ${goalContext.riskMode}, Risk: ${finalRiskPercent.toFixed(2)}%. `;
    reasoning += alphaInsight.keyReasoning;

    return {
      shouldTrade,
      direction,
      positionSize: positionValue,
      riskPercent: finalRiskPercent,
      adjustedConfidence,
      reasoning
    };
  }

  async getCacheStats(hours: number = 24): Promise<CacheStats[]> {
    try {
      const { data, error } = await supabase.rpc('get_cache_stats', { p_hours: hours });
      if (error) throw error;
      return (data || []).map((row: {
        cache_tier: string;
        total_lookups: string;
        cache_hits: string;
        cache_misses: string;
        hit_rate: string;
        avg_cache_age_seconds: string;
        total_llm_calls_saved: string;
      }) => ({
        cacheTier: row.cache_tier,
        totalLookups: parseInt(row.total_lookups),
        cacheHits: parseInt(row.cache_hits),
        cacheMisses: parseInt(row.cache_misses),
        hitRate: parseFloat(row.hit_rate),
        avgCacheAgeSeconds: parseFloat(row.avg_cache_age_seconds) || 0,
        totalLlmCallsSaved: parseInt(row.total_llm_calls_saved)
      }));
    } catch (err) {
      console.error('[SharedIntelligence] Failed to get cache stats:', err);
      return [];
    }
  }

  async cleanupExpiredCache(): Promise<{ omega: number; alpha: number; scout: number }> {
    try {
      const { data, error } = await supabase.rpc('cleanup_expired_cache');
      if (error) throw error;
      return {
        omega: data?.[0]?.omega_deleted || 0,
        alpha: data?.[0]?.alpha_deleted || 0,
        scout: data?.[0]?.scout_deleted || 0
      };
    } catch (err) {
      console.error('[SharedIntelligence] Failed to cleanup cache:', err);
      return { omega: 0, alpha: 0, scout: 0 };
    }
  }

  clearLocalCache(): void {
    this.localOmegaCache.clear();
    this.localAlphaCache.clear();
    this.localScoutCache.clear();
    console.log('[SharedIntelligence] Local cache cleared');
  }

  private async logCacheStat(
    tier: 'omega' | 'alpha' | 'scout',
    symbol: string,
    timeframe: string,
    eventType: 'lookup' | 'write' | 'expire' | 'warm',
    hitOrMiss: 'hit' | 'miss' | null,
    cacheAgeSeconds: number,
    llmCallsSaved: number = 0
  ): Promise<void> {
    try {
      await supabase.from('cache_stats_log').insert({
        cache_tier: tier,
        symbol,
        timeframe,
        event_type: eventType,
        hit_or_miss: hitOrMiss,
        cache_age_seconds: cacheAgeSeconds,
        llm_calls_saved: llmCallsSaved
      });
    } catch (err) {
    }
  }
}

export const sharedIntelligenceCoordinator = new SharedIntelligenceCoordinator();
