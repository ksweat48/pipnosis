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
import {
  generateRegimeSignatureHash,
  generateThesisCacheKey,
  validateRegimeSignature,
  detectRegimeChange
} from './cache-key-generator';
import { marketSnapshotCache, type MarketSnapshotData } from './market-snapshot-cache';
import type { Timeframe, RiskMode } from '../config/timeframe-hierarchy';
import type {
  AlphaMarketThesis,
  RegimeSignature
} from '../types/alpha-thesis';
import { THESIS_TTL_MS } from '../types/alpha-thesis';
import {
  createImmutableThesis,
  verifyCachedThesisIntegrity,
  freezeThesis
} from './thesis-immutability-guard';
import { logThesisRejection } from './thesis-rejection-logger';
import { logger } from '../lib/logger';

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


/**
 * Get TTL for Alpha thesis cache
 * Fixed baseline: 15 minutes (global)
 * Early invalidation handled by structure-aware triggers
 */
function getTTLForAlphaThesis(): number {
  return THESIS_TTL_MS; // 15 minutes fixed
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
   * Get Alpha Market Thesis (regime-based caching)
   *
   * SSOT: Caches ONLY the thesis (market analysis), NOT execution decisions
   * Cache key based on REGIME SIGNATURE, not Omega votes
   * Session context EXCLUDED (execution-only)
   *
   * @param symbol Trading symbol
   * @param regimeSignature Structural market fingerprint
   * @param cachedThesis Previously cached thesis (if available) for Alpha to accept/reject
   * @param fetchFreshFn Function to generate fresh thesis if needed
   * @returns AlphaMarketThesis with cache metadata
   */
  async getAlphaThesis(
    symbol: string,
    regimeSignature: RegimeSignature,
    cachedThesis: AlphaMarketThesis | null,
    fetchFreshFn: (cachedThesis: AlphaMarketThesis | null) => Promise<{
      thesis: Omit<AlphaMarketThesis, 'regimeSignature' | 'thesisHash' | 'cacheAgeSeconds' | 'fromCache' | 'createdAt'>;
      thesisRejected: boolean;
      rejectionReason?: string;
    }>
  ): Promise<AlphaMarketThesis> {
    // Validate regime signature
    if (!validateRegimeSignature(regimeSignature)) {
      logger.error('[SharedIntelligence] Invalid regime signature', { symbol, regimeSignature });
      throw new Error('Invalid regime signature');
    }

    const regimeHash = generateRegimeSignatureHash(regimeSignature);
    const now = Date.now();

    // Check local cache first
    const localKey = generateThesisCacheKey(symbol, regimeHash);
    const localCached = this.localThesisCache.get(localKey);

    if (localCached && localCached.expiresAt > now) {
      // Verify thesis integrity
      const integrityCheck = verifyCachedThesisIntegrity(localCached.data);
      if (integrityCheck.valid) {
        const ageSeconds = Math.round((now - localCached.data.createdAt.getTime()) / 1000);
        await this.logCacheStat('alpha_thesis', symbol, regimeSignature.symbol, 'lookup', 'hit', ageSeconds);
        logger.info('[SharedIntelligence] Thesis LOCAL HIT', {
          symbol,
          ageSeconds,
          regimeHash
        });
        return { ...localCached.data, cacheAgeSeconds: ageSeconds };
      } else {
        logger.warn('[SharedIntelligence] Local cache integrity failed - will check database or regenerate', {
          symbol,
          reason: integrityCheck.reason,
          regimeHash,
          action: 'checking_database_cache'
        });
        this.localThesisCache.delete(localKey);
        // System continues - will check database cache or generate fresh thesis
      }
    }

    // Check database cache
    try {
      const { data: cached, error } = await supabase
        .rpc('get_alpha_thesis_by_regime', {
          p_symbol: symbol,
          p_regime_hash: regimeHash
        });

      if (!error && cached && cached.length > 0) {
        const dbThesis = cached[0];
        const ageSeconds = Math.round((now - new Date(dbThesis.created_at).getTime()) / 1000);

        // Use stored regime_signature_json if available (SSOT compliance)
        // Fallback to reconstructed object for backward compatibility
        const storedRegimeSignature = dbThesis.regime_signature_json || {
          symbol: dbThesis.symbol,
          htfBias: dbThesis.htf_bias as RegimeSignature['htfBias'],
          microRegime: dbThesis.micro_regime as RegimeSignature['microRegime'],
          volatilityRegime: dbThesis.volatility_regime as RegimeSignature['volatilityRegime'],
          structureState: dbThesis.structure_state as RegimeSignature['structureState'],
          timeframeRelevance: dbThesis.timeframe_relevance
        };

        const result: AlphaMarketThesis = {
          symbol: dbThesis.symbol || symbol,
          timeframe: dbThesis.timeframe || regimeSignature.timeframeRelevance || 'H1',
          directionBias: dbThesis.direction_bias as AlphaMarketThesis['directionBias'],
          narrative: dbThesis.narrative,
          regime: dbThesis.regime,
          liquidityContext: dbThesis.liquidity_context,
          invalidationLogic: dbThesis.invalidation_logic,
          confidenceBand: dbThesis.confidence_band as AlphaMarketThesis['confidenceBand'],
          thesisSummary: dbThesis.thesis_summary,
          regimeSignature: storedRegimeSignature as RegimeSignature,
          thesisHash: dbThesis.thesis_hash,
          createdAt: new Date(dbThesis.created_at),
          cacheAgeSeconds: 0,
          fromCache: true
        };

        // Freeze thesis BEFORE integrity check (SSOT requirement)
        const frozenThesis = freezeThesis(result);

        // Verify integrity after freezing
        const integrityCheck = verifyCachedThesisIntegrity(frozenThesis);
        if (!integrityCheck.valid) {
          logger.error('[SharedIntelligence] DB cache integrity failed - regenerating fresh thesis', {
            symbol,
            reason: integrityCheck.reason,
            regimeHash,
            cacheAgeSeconds: ageSeconds,
            action: 'invalidating_and_regenerating'
          });
          // Invalidate and continue to fresh generation (intelligent degradation)
          await this.invalidateThesisByRegime(symbol, regimeHash);
          // System continues operating - Alpha will generate fresh thesis below
        } else {

          // Store in local cache
          const ttl = getTTLForAlphaThesis();
          this.localThesisCache.set(localKey, {
            data: frozenThesis,
            expiresAt: now + ttl
          });

          await this.logCacheStat('alpha_thesis', symbol, regimeSignature.symbol, 'lookup', 'hit', ageSeconds, 1);
          logger.info('[SharedIntelligence] Thesis DB HIT', {
            symbol,
            ageSeconds,
            regimeHash,
            costSaved: '$0.20'
          });

          return frozenThesis;
        }
      }
    } catch (err) {
      logger.error('[SharedIntelligence] Thesis cache lookup failed', {
        error: err instanceof Error ? err.message : 'Unknown error',
        symbol
      });
    }

    // Cache miss - call LLM (with cached thesis for Alpha to review)
    logger.info('[SharedIntelligence] Thesis MISS - Calling LLM', {
      symbol,
      regimeHash,
      hasCachedThesis: !!cachedThesis,
      cost: '$0.20'
    });
    await this.logCacheStat('alpha_thesis', symbol, regimeSignature.symbol, 'lookup', 'miss', 0);

    const freshResult = await fetchFreshFn(cachedThesis);

    // Check if Alpha rejected the cached thesis
    if (freshResult.thesisRejected && cachedThesis) {
      logger.info('[SharedIntelligence] Alpha rejected cached thesis', {
        symbol,
        reason: freshResult.rejectionReason
      });

      // Log rejection as learning signal
      await logThesisRejection(
        cachedThesis.thesisHash,
        symbol,
        freshResult.rejectionReason || 'Market conditions changed',
        regimeSignature,
        now - cachedThesis.createdAt.getTime(),
        'unknown', // Execution style (filled by caller if available)
        'unknown'  // Session context (filled by caller if available)
      );

      // Invalidate old thesis
      await this.invalidateThesisByRegime(symbol, regimeHash);
    }

    // Create immutable thesis
    const immutableThesis = createImmutableThesis({
      ...freshResult.thesis,
      symbol,
      regimeSignature,
      createdAt: new Date(),
      cacheAgeSeconds: 0,
      fromCache: false
    });

    // Cache new thesis in database
    try {
      const cacheResult = await supabase.rpc('cache_alpha_thesis', {
        p_symbol: symbol,
        p_timeframe: regimeSignature.timeframeRelevance || 'H1',
        p_direction_bias: freshResult.thesis.directionBias,
        p_narrative: freshResult.thesis.narrative,
        p_regime: freshResult.thesis.regime,
        p_liquidity_context: freshResult.thesis.liquidityContext || 'Standard liquidity conditions',
        p_invalidation_logic: freshResult.thesis.invalidationLogic || 'Standard invalidation rules',
        p_confidence_band: freshResult.thesis.confidenceBand,
        p_thesis_summary: freshResult.thesis.thesisSummary,
        p_regime_signature_hash: regimeHash,
        p_thesis_hash: immutableThesis.thesisHash,
        p_regime_signature_json: regimeSignature,
        p_htf_bias: regimeSignature.htfBias,
        p_micro_regime: regimeSignature.microRegime,
        p_volatility_regime: regimeSignature.volatilityRegime,
        p_structure_state: regimeSignature.structureState,
        p_timeframe_relevance: regimeSignature.timeframeRelevance || 'H1'
      });

      // Log cache write success for governance audit trail (non-blocking)
      try {
        await supabase.rpc('log_cache_write_event', {
          p_symbol: symbol,
          p_regime_signature_hash: regimeHash,
          p_write_status: 'success',
          p_error_message: null,
          p_cache_tier: 'alpha_thesis'
        });
      } catch (auditErr) {
        logger.warn('[SharedIntelligence] Failed to log cache write success to audit trail', {
          error: auditErr instanceof Error ? auditErr.message : 'Unknown error'
        });
      }

      logger.info('[SharedIntelligence] Thesis cached successfully', {
        symbol,
        regimeHash,
        ttl: '15min',
        thesisId: cacheResult
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';

      logger.error('[SharedIntelligence] Thesis cache write failed', {
        error: errorMsg,
        symbol,
        regimeHash
      });

      // Log cache write failure for governance audit trail (non-blocking)
      try {
        await supabase.rpc('log_cache_write_event', {
          p_symbol: symbol,
          p_regime_signature_hash: regimeHash,
          p_write_status: 'failed',
          p_error_message: errorMsg.substring(0, 255),
          p_cache_tier: 'alpha_thesis'
        });
      } catch (auditErr) {
        logger.warn('[SharedIntelligence] Failed to log cache write failure to audit trail', {
          error: auditErr instanceof Error ? auditErr.message : 'Unknown error'
        });
      }

      // Important: Do NOT rethrow error - cache write failure should NOT block execution
      // This is "intelligent degradation": thesis is still valid even if caching failed
    }

    // Store in local cache
    const ttl = getTTLForAlphaThesis();
    this.localThesisCache.set(localKey, {
      data: immutableThesis,
      expiresAt: now + ttl
    });

    return immutableThesis;
  }

  /**
   * Invalidate thesis by regime signature (structure-aware invalidation)
   * Called when market structure changes materially
   */
  async invalidateThesisByRegime(symbol: string, regimeHash: string): Promise<void> {
    try {
      await supabase.rpc('invalidate_thesis_by_structure', {
        p_symbol: symbol,
        p_regime_hash: regimeHash
      });

      // Clear from local cache
      const localKey = generateThesisCacheKey(symbol, regimeHash);
      this.localThesisCache.delete(localKey);

      logger.info('[SharedIntelligence] Thesis invalidated', {
        symbol,
        regimeHash
      });
    } catch (err) {
      logger.error('[SharedIntelligence] Thesis invalidation failed', {
        error: err instanceof Error ? err.message : 'Unknown error',
        symbol
      });
    }
  }

  /**
   * Detect regime change and invalidate thesis if needed
   * Returns true if thesis was invalidated
   */
  async checkAndInvalidateOnRegimeChange(
    symbol: string,
    oldSignature: RegimeSignature,
    newSignature: RegimeSignature
  ): Promise<boolean> {
    const regimeChanged = detectRegimeChange(oldSignature, newSignature);

    if (regimeChanged) {
      const oldHash = generateRegimeSignatureHash(oldSignature);
      await this.invalidateThesisByRegime(symbol, oldHash);

      logger.info('[SharedIntelligence] Regime change detected, thesis invalidated', {
        symbol,
        oldSignature,
        newSignature
      });

      return true;
    }

    return false;
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
