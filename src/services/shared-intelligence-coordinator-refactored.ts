/**
 * Shared Intelligence Coordinator - REFACTORED
 *
 * PURPOSE: Cache EXPENSIVE operations only
 *
 * CRITICAL ARCHITECTURE CHANGE:
 * ✅ Cache Alpha LLM decisions (expensive, ~$0.10-0.50 per call)
 * ✅ Cache market snapshots (input SSOT, prevents duplicate DB reads)
 * ❌ NO LONGER cache Omega votes (deterministic, instant computation)
 *
 * OLD MODEL (wrong):
 * - Cached deterministic Omega vote outputs
 * - Each Omega queried candles separately
 * - Inconsistent ATR/price across Omegas
 *
 * NEW MODEL (correct):
 * - Omega votes computed fresh every time (instant, deterministic)
 * - All Omegas share the SAME snapshot (input SSOT)
 * - Only Alpha LLM calls are cached (expensive)
 */

import { supabase } from '../lib/supabase';
import { generateOmegaVotesHash } from './cache-key-generator';
import { marketSnapshotCache, type MarketSnapshotData } from './market-snapshot-cache';
import type { Timeframe, RiskMode } from '../config/timeframe-hierarchy';

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
 * Get TTL for Alpha cache based on timeframe
 */
function getTTLForAlphaCache(timeframe: Timeframe): number {
  const ttls: Record<Timeframe, number> = {
    'M5': 300000,     // 5 minutes
    'M15': 600000,    // 10 minutes
    'H1': 900000,     // 15 minutes
    'H4': 1800000,    // 30 minutes
    'D': 3600000      // 1 hour
  };

  return ttls[timeframe] || 600000; // Default: 10 minutes
}

class SharedIntelligenceCoordinator {
  private localAlphaCache = new Map<string, { data: AlphaStrategicInsight; expiresAt: number }>();

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
   * Get Alpha strategic insight (with LLM caching)
   * This is the ONLY expensive operation we cache now
   */
  async getAlphaStrategicInsight(
    symbol: string,
    timeframe: Timeframe,
    omegaVotes: Array<{ brainName: string; vote: string; confidence: number }>,
    fetchFreshFn: () => Promise<Omit<AlphaStrategicInsight, 'cacheAgeSeconds' | 'fromCache'>>
  ): Promise<AlphaStrategicInsight> {
    const omegaVotesHash = generateOmegaVotesHash(omegaVotes);

    // Check local cache first
    const localKey = `alpha:${symbol}:${timeframe}:${omegaVotesHash}`;
    const localCached = this.localAlphaCache.get(localKey);
    const now = Date.now();

    if (localCached && localCached.expiresAt > now) {
      const ageSeconds = Math.round((now - localCached.data.cacheAgeSeconds * 1000) / 1000);
      await this.logCacheStat('alpha', symbol, timeframe, 'lookup', 'hit', ageSeconds);
      console.log(`[SharedIntelligence] ⚡ Alpha LOCAL HIT: ${symbol}@${timeframe} (age: ${ageSeconds}s)`);
      return localCached.data;
    }

    // Check database cache
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

        // Store in local cache
        const ttl = getTTLForAlphaCache(timeframe);
        this.localAlphaCache.set(localKey, {
          data: result,
          expiresAt: now + ttl
        });

        await this.logCacheStat('alpha', symbol, timeframe, 'lookup', 'hit', result.cacheAgeSeconds, 1);
        console.log(`[SharedIntelligence] ⚡ Alpha DB HIT: ${symbol}@${timeframe} (age: ${result.cacheAgeSeconds}s) | Saved ~$0.20`);
        return result;
      }
    } catch (err) {
      console.warn('[SharedIntelligence] Alpha cache lookup failed:', err);
    }

    // Cache miss - call LLM
    console.log(`[SharedIntelligence] 🔄 Alpha MISS: ${symbol}@${timeframe} - Calling LLM (~$0.20)`);
    await this.logCacheStat('alpha', symbol, timeframe, 'lookup', 'miss', 0);

    const fresh = await fetchFreshFn();

    // Write to database cache
    const ttl = getTTLForAlphaCache(timeframe);
    const expiresAt = new Date(now + ttl);

    try {
      const { error: upsertError } = await supabase.from('alpha_strategic_cache').upsert({
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

      if (upsertError) {
        console.error('[SharedIntelligence] ❌ Alpha cache write failed:', upsertError);
        this.localAlphaCache.delete(localKey);
      } else {
        console.log(`[SharedIntelligence] ✅ Alpha cached: ${symbol}@${timeframe} (TTL: ${ttl / 1000}s)`);
      }
    } catch (err) {
      console.error('[SharedIntelligence] ❌ Alpha cache write error:', err);
      this.localAlphaCache.delete(localKey);
    }

    const result: AlphaStrategicInsight = {
      ...fresh,
      cacheAgeSeconds: 0,
      fromCache: false
    };

    // Store in local cache
    this.localAlphaCache.set(localKey, {
      data: result,
      expiresAt: now + ttl
    });

    return result;
  }

  /**
   * Clear all local caches
   */
  clearLocalCache(): void {
    this.localAlphaCache.clear();
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
  async cleanupExpiredCache(): Promise<{ alpha: number }> {
    try {
      const { data, error } = await supabase.rpc('cleanup_expired_cache');
      if (error) throw error;
      return {
        alpha: data?.[0]?.alpha_deleted || 0
      };
    } catch (err) {
      console.error('[SharedIntelligence] Failed to cleanup cache:', err);
      return { alpha: 0 };
    }
  }

  /**
   * Log cache statistics event
   */
  private async logCacheStat(
    tier: 'alpha' | 'snapshot',
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
    console.log('  === Alpha Cache (LLM Decisions) ===');
    console.log(`    Local cache size: ${this.localAlphaCache.size} entries`);
  }
}

export const sharedIntelligenceCoordinator = new SharedIntelligenceCoordinator();
