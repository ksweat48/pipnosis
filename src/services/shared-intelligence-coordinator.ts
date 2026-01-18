/**
 * Shared Intelligence Coordinator - THESIS-ONLY CACHING
 *
 * PURPOSE: Cache Alpha's MARKET THESIS (expensive LLM analysis), NOT execution decisions
 *
 * ARCHITECTURAL PRINCIPLE:
 * ✅ Cache Alpha's MARKET THESIS (what's happening in the market)
 * ✅ Cache market snapshots (input SSOT, prevents duplicate DB reads)
 * ❌ Do NOT cache execution decisions (how to trade it per user)
 * ❌ Do NOT cache Omega votes (deterministic, instant computation)
 *
 * INSTITUTIONAL SEPARATION:
 * - Thesis = Shared across users (market analysis)
 * - Execution = User-specific (SL/TP, risk%, style, goals)
 *
 * COST SAVINGS: 60-85% reduction through thesis reuse
 * USER AUTHORITY: Preserved - each user gets personalized execution
 */

import { supabase } from '../lib/supabase';
import { generateOmegaVotesHash } from './cache-key-generator';
import { marketSnapshotCache, type MarketSnapshotData } from './market-snapshot-cache';
import type { Timeframe, RiskMode } from '../config/timeframe-hierarchy';
import type { AlphaMarketThesis, THESIS_TTL } from '../types/alpha-thesis';

// Legacy interface - kept for backward compatibility during migration
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

export interface CacheStats {
  cacheTier: string;
  totalLookups: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  avgCacheAgeSeconds: number;
  totalLlmCallsSaved: number;
}

/**
 * Get TTL for Alpha thesis cache based on timeframe
 * Scalp (M5): 5 min | Micro (M15): 10 min | Intraday (H1+): 15 min
 */
function getTTLForAlphaThesis(timeframe: Timeframe): number {
  const ttls: Record<Timeframe, number> = {
    'M5': 300000,     // 5 minutes (fast-moving)
    'M15': 600000,    // 10 minutes (moderate)
    'H1': 900000,     // 15 minutes (slower structural changes)
    'H4': 900000,     // 15 minutes
    'D': 900000       // 15 minutes
  };

  return ttls[timeframe] || 600000; // Default: 10 minutes
}

class SharedIntelligenceCoordinator {
  private localThesisCache = new Map<string, { data: AlphaMarketThesis; expiresAt: number }>();

  /**
   * Get market snapshot (SSOT for inputs)
   * All Omegas will receive the SAME snapshot
   */
  async getMarketSnapshot(
    symbol: string,
    timeframe: Timeframe,
    riskMode?: RiskMode
  ): Promise<MarketSnapshotData> {
    return marketSnapshotCache.getSnapshot(symbol, timeframe, riskMode);
  }

  /**
   * Invalidate snapshot cache for a symbol/timeframe
   * Use this when price drift is detected or data is stale
   */
  invalidateSnapshot(symbol: string, timeframe: Timeframe): void {
    marketSnapshotCache.invalidateSnapshot(symbol, timeframe);
    console.log(`[SharedIntelligence] 🔄 Snapshot invalidated: ${symbol}@${timeframe}`);
  }

  /**
   * Get Alpha Market Thesis (with LLM caching)
   *
   * Caches ONLY the thesis (market analysis), NOT execution decisions
   * This is the ONLY expensive operation we cache now
   *
   * @param symbol Trading symbol
   * @param timeframe Analysis timeframe
   * @param omegaVotes Omega council votes (for cache key)
   * @param fetchFreshFn Function to generate fresh thesis if cache miss
   * @returns AlphaMarketThesis with cache metadata
   */
  async getAlphaThesis(
    symbol: string,
    timeframe: Timeframe,
    omegaVotes: Array<{ brainName: string; vote: string; confidence: number }>,
    fetchFreshFn: () => Promise<Omit<AlphaMarketThesis, 'cacheAgeSeconds' | 'fromCache' | 'createdAt'>>
  ): Promise<AlphaMarketThesis> {
    const omegaVotesHash = generateOmegaVotesHash(omegaVotes);

    // Check local cache first
    const localKey = `thesis:${symbol}:${timeframe}:${omegaVotesHash}`;
    const localCached = this.localThesisCache.get(localKey);
    const now = Date.now();

    if (localCached && localCached.expiresAt > now) {
      const ageSeconds = Math.round((now - localCached.data.createdAt.getTime()) / 1000);
      await this.logCacheStat('alpha_thesis', symbol, timeframe, 'lookup', 'hit', ageSeconds);
      console.log(`[SharedIntelligence] ⚡ Thesis LOCAL HIT: ${symbol}@${timeframe} (age: ${ageSeconds}s)`);
      return { ...localCached.data, cacheAgeSeconds: ageSeconds };
    }

    // Check database cache
    try {
      const { data: cached, error } = await supabase
        .rpc('get_alpha_thesis', {
          p_symbol: symbol,
          p_timeframe: timeframe,
          p_omega_votes_hash: omegaVotesHash
        });

      if (!error && cached && cached.length > 0) {
        const result: AlphaMarketThesis = {
          symbol: cached[0].symbol || symbol,
          timeframe: cached[0].timeframe || timeframe,
          directionBias: cached[0].direction_bias as AlphaMarketThesis['directionBias'],
          narrative: cached[0].narrative,
          regime: cached[0].regime,
          liquidityContext: cached[0].liquidity_context,
          invalidationLogic: cached[0].invalidation_logic,
          confidenceBand: cached[0].confidence_band as AlphaMarketThesis['confidenceBand'],
          thesisSummary: cached[0].thesis_summary,
          omegaSummary: cached[0].omega_summary || {},
          createdAt: new Date(cached[0].created_at),
          cacheAgeSeconds: cached[0].cache_age_seconds,
          fromCache: true
        };

        // Store in local cache
        const ttl = getTTLForAlphaThesis(timeframe);
        this.localThesisCache.set(localKey, {
          data: result,
          expiresAt: now + ttl
        });

        await this.logCacheStat('alpha_thesis', symbol, timeframe, 'lookup', 'hit', result.cacheAgeSeconds, 1);
        console.log(`[SharedIntelligence] ⚡ Thesis DB HIT: ${symbol}@${timeframe} (age: ${result.cacheAgeSeconds}s) | Saved ~$0.20`);
        return result;
      }
    } catch (err) {
      console.warn('[SharedIntelligence] Thesis cache lookup failed:', err);
    }

    // Cache miss - call LLM
    console.log(`[SharedIntelligence] 🔄 Thesis MISS: ${symbol}@${timeframe} - Calling LLM (~$0.20)`);
    await this.logCacheStat('alpha_thesis', symbol, timeframe, 'lookup', 'miss', 0);

    const fresh = await fetchFreshFn();

    // Write to database cache
    const ttl = getTTLForAlphaThesis(timeframe);
    const expiresAt = new Date(now + ttl);

    try {
      const { error: upsertError } = await supabase.from('alpha_market_thesis_cache').upsert({
        symbol,
        timeframe,
        omega_votes_hash: omegaVotesHash,
        direction_bias: fresh.directionBias,
        narrative: fresh.narrative,
        regime: fresh.regime,
        liquidity_context: fresh.liquidityContext || 'Standard liquidity conditions',
        invalidation_logic: fresh.invalidationLogic || 'Standard invalidation rules',
        confidence_band: fresh.confidenceBand,
        thesis_summary: fresh.thesisSummary,
        omega_summary: fresh.omegaSummary,
        expires_at: expiresAt.toISOString()
      }, {
        onConflict: 'symbol,timeframe,omega_votes_hash'
      });

      if (upsertError) {
        console.error('[SharedIntelligence] ❌ Thesis cache write failed:', upsertError);
        this.localThesisCache.delete(localKey);
      } else {
        console.log(`[SharedIntelligence] ✅ Thesis cached: ${symbol}@${timeframe} (TTL: ${ttl / 1000}s)`);
      }
    } catch (err) {
      console.error('[SharedIntelligence] ❌ Thesis cache write error:', err);
      this.localThesisCache.delete(localKey);
    }

    const result: AlphaMarketThesis = {
      ...fresh,
      symbol,
      timeframe,
      createdAt: new Date(),
      cacheAgeSeconds: 0,
      fromCache: false
    };

    // Store in local cache
    this.localThesisCache.set(localKey, {
      data: result,
      expiresAt: now + ttl
    });

    return result;
  }

  /**
   * Clear all local caches
   */
  clearLocalCache(): void {
    this.localThesisCache.clear();
    marketSnapshotCache.clearAll();
    console.log('[SharedIntelligence] 🗑️ All local caches cleared');
  }

  /**
   * Get cache statistics from database
   */
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

  /**
   * Cleanup expired cache entries
   */
  async cleanupExpiredCache(): Promise<{ alphaThesis: number }> {
    try {
      const { data, error } = await supabase.rpc('cleanup_expired_cache');
      if (error) throw error;
      return {
        alphaThesis: data?.[0]?.alpha_thesis_deleted || 0
      };
    } catch (err) {
      console.error('[SharedIntelligence] Failed to cleanup cache:', err);
      return { alphaThesis: 0 };
    }
  }

  /**
   * Log cache statistics event
   */
  private async logCacheStat(
    tier: 'alpha_thesis' | 'snapshot',
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
      // Silently fail - logging shouldn't break the system
    }
  }

  /**
   * Get snapshot cache statistics
   */
  getSnapshotStats(): {
    hits: number;
    misses: number;
    hitRate: number;
    cacheSize: number;
    dbReadsAvoided: number;
  } {
    return marketSnapshotCache.getStats();
  }

  /**
   * Log all cache statistics
   */
  logAllStats(): void {
    console.log('[SharedIntelligence] 📊 Cache Statistics:');
    console.log('  === Snapshot Cache (Input SSOT) ===');
    marketSnapshotCache.logStats();
    console.log('  === Alpha Thesis Cache (Market Analysis) ===');
    console.log(`    Local cache size: ${this.localThesisCache.size} entries`);
  }
}

export const sharedIntelligenceCoordinator = new SharedIntelligenceCoordinator();
