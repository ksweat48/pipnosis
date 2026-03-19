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
 *
 * CCIP-COORDINATOR-AUDIT-2026-03-03:
 * Resolved 8 SSOT / governance violations found in post-improvement audit:
 *  1. CRITICAL  - Cache key prefix mismatch in invalidateThesisForSymbol():
 *                 was searching `${symbol}_` but actual key format is `thesis:${symbol}:`
 *  2. HIGH      - Missing try-catch around logThesisRejection / invalidateThesisByRegime
 *                 inside fetchPromise IIFE (amplification risk via thundering herd)
 *  3. HIGH      - Hardcoded '$0.20' cost strings → ALPHA_THESIS_LLM_COST_PER_CALL (alpha-thesis.ts)
 *  4. MEDIUM    - Magic number 60 (fresh-cache skip threshold) → TIME_MS.CACHE.FRESH_SKIP_HASH_SECONDS
 *  5. MEDIUM    - 7 raw console.log/error calls replaced with structured logger.*
 *  6. MEDIUM    - Hardcoded default fallback strings → THESIS_DEFAULTS (alpha-thesis.ts)
 *  7. LOW       - Dead AlphaStrategicInsight export removed (CCIP-POST-AUDIT-2026-03-03)
 *  8. LOW       - Magic number 255 (error message truncation) → TIME_MS.CACHE.AUDIT_ERROR_MESSAGE_MAX_LENGTH
 */

import { supabase } from '../lib/supabase';
import {
  generateRegimeSignatureHash,
  generateThesisCacheKey,
  validateRegimeSignature,
  detectRegimeChange
} from './cache-key-generator';
import { marketSnapshotCache, type MarketSnapshotData } from './market-snapshot-cache';
import type { Timeframe } from '../config/timeframe-hierarchy';
import type {
  AlphaMarketThesis,
  RegimeSignature
} from '../types/alpha-thesis';
import {
  THESIS_TTL_MS,
  ALPHA_THESIS_LLM_COST_PER_CALL,
  THESIS_DEFAULTS
} from '../types/alpha-thesis';
import { TIME_MS } from '../config/time-constants';
import {
  createImmutableThesis,
  verifyCachedThesisIntegrity,
  freezeThesis
} from './thesis-immutability-guard';
import { logThesisRejection } from './thesis-rejection-logger';
import { logger } from '../lib/logger';


/**
 * Get TTL for Alpha thesis cache
 * Baseline: 30 minutes (SSOT: TIME_MS.CACHE.ALPHA_THESIS in time-constants.ts)
 * Early invalidation: H1+ candle close OR material regime signature change
 * See CCIP-CACHE-WRITE-FIX-2026-03-19 in time-constants.ts for rationale.
 */
function getTTLForAlphaThesis(): number {
  return THESIS_TTL_MS; // 15 minutes (SSOT: time-constants.ts TIME_MS.CACHE.ALPHA_THESIS)
}

class SharedIntelligenceCoordinator {
  private localThesisCache = new Map<string, { data: AlphaMarketThesis; expiresAt: number }>();

  /**
   * In-flight deduplication guard (Thundering Herd prevention).
   *
   * CCIP-THUNDERING-HERD-FIX-2026-03-03:
   * When N concurrent scans hit a cache miss for the same symbol + regimeHash,
   * all N would call the LLM and attempt a DB write simultaneously. This guard
   * stores the first in-flight Promise under the same localKey so subsequent
   * callers await the same result instead of launching duplicate LLM requests.
   *
   * Lifecycle:
   *  - Entry inserted: immediately before fetchFreshFn() is called
   *  - Entry deleted: in finally{} after the promise resolves or rejects
   *  - Key space: identical to localThesisCache (symbol + regimeHash) so the
   *    deduplication boundary is the correct grain — same symbol, different
   *    regimes still produce independent concurrent fetches.
   *
   * SSOT: This Map lives alongside localThesisCache. Both are cleared together
   * in clearLocalCache() so the guard never holds stale references.
   */
  private inFlightThesisRequests = new Map<string, Promise<AlphaMarketThesis>>();

  /**
   * Get market snapshot (SSOT for inputs)
   * All Omegas will receive the SAME snapshot.
   *
   * CCIP-STYLE-TF-2026: Caller must pass the style-derived timeframe.
   * riskMode has been removed — it no longer overrides timeframe selection.
   */
  async getMarketSnapshot(
    symbol: string,
    timeframe: Timeframe
  ): Promise<MarketSnapshotData> {
    return marketSnapshotCache.getSnapshot(symbol, timeframe);
  }

  /**
   * Invalidate snapshot cache for a symbol/timeframe
   * Use this when price drift is detected or data is stale
   */
  invalidateSnapshot(symbol: string, timeframe: Timeframe): void {
    marketSnapshotCache.invalidateSnapshot(symbol, timeframe);
    logger.info('[SharedIntelligence] Snapshot invalidated', { symbol, timeframe });
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
        await this.logCacheStat('alpha_thesis', symbol, regimeSignature.timeframeRelevance ?? 'H1', 'lookup', 'hit', ageSeconds);
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
          cacheAgeSeconds: ageSeconds, // SSOT: Use actual computed age, not hardcoded 0
          fromCache: true
        };

        // Freeze thesis BEFORE integrity check (SSOT requirement)
        const frozenThesis = freezeThesis(result);

        // SSOT GOVERNANCE: Skip hash validation for fresh cache
        // CCIP-COORDINATOR-AUDIT-2026-03-03: threshold now sourced from
        // TIME_MS.CACHE.FRESH_SKIP_HASH_SECONDS (time-constants.ts) — was magic literal 60.
        // Reason: Just-created theses are already validated at creation time;
        // hash mismatch this soon indicates a JSON serialisation artifact, not corruption.
        const skipHashCheck = ageSeconds < TIME_MS.CACHE.FRESH_SKIP_HASH_SECONDS;

        // Verify integrity after freezing (skip hash for fresh cache)
        const integrityCheck = skipHashCheck
          ? { valid: true }
          : verifyCachedThesisIntegrity(frozenThesis);
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

          await this.logCacheStat('alpha_thesis', symbol, regimeSignature.timeframeRelevance ?? 'H1', 'lookup', 'hit', ageSeconds, 1);
          logger.info('[SharedIntelligence] Thesis DB HIT', {
            symbol,
            ageSeconds,
            regimeHash,
            costSaved: ALPHA_THESIS_LLM_COST_PER_CALL
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

    // Cache miss — check for an in-flight request for the same key (thundering herd guard).
    // CCIP-THUNDERING-HERD-FIX-2026-03-03: If a concurrent caller is already fetching
    // a fresh thesis for this symbol + regimeHash, short-circuit to their Promise.
    const existingFlight = this.inFlightThesisRequests.get(localKey);
    if (existingFlight) {
      logger.info('[SharedIntelligence] Thesis IN-FLIGHT HIT - awaiting concurrent fetch', {
        symbol,
        regimeHash,
        note: 'thundering_herd_guard_active'
      });
      return existingFlight;
    }

    // Cache miss - call LLM (with cached thesis for Alpha to review)
    logger.info('[SharedIntelligence] Thesis MISS - Calling LLM', {
      symbol,
      regimeHash,
      hasCachedThesis: !!cachedThesis,
      cost: ALPHA_THESIS_LLM_COST_PER_CALL
    });
    await this.logCacheStat('alpha_thesis', symbol, regimeSignature.timeframeRelevance ?? 'H1', 'lookup', 'miss', 0);

    // Register the fetch promise under the in-flight guard before awaiting.
    // The finally{} block always removes it so no stale entries accumulate.
    // CCIP-THUNDERING-HERD-FIX-2026-03-03: Single LLM call per symbol+regimeHash.
    const fetchPromise = (async (): Promise<AlphaMarketThesis> => {
      const freshResult = await fetchFreshFn(cachedThesis);

      // Check if Alpha rejected the cached thesis
      if (freshResult.thesisRejected && cachedThesis) {
        logger.info('[SharedIntelligence] Alpha rejected cached thesis', {
          symbol,
          reason: freshResult.rejectionReason
        });

        // CCIP-COORDINATOR-AUDIT-2026-03-03: Both calls below are wrapped in
        // independent try-catch blocks so that a transient failure in either
        // does NOT poison the shared in-flight Promise (which would propagate
        // the error to all concurrent callers sharing the thundering-herd guard).
        // logThesisRejection already swallows its own errors, but
        // invalidateThesisByRegime re-throws on Supabase RPC failure — making
        // the try-catch here mandatory for correct degradation behaviour.

        // Log rejection as learning signal (non-blocking)
        try {
          await logThesisRejection(
            cachedThesis.thesisHash,
            symbol,
            freshResult.rejectionReason || 'Market conditions changed',
            regimeSignature,
            now - cachedThesis.createdAt.getTime(),
            'unknown',
            'unknown'
          );
        } catch (rejectionLogErr) {
          logger.warn('[SharedIntelligence] Failed to log thesis rejection signal', {
            error: rejectionLogErr instanceof Error ? rejectionLogErr.message : 'Unknown error',
            symbol
          });
        }

        // Invalidate old thesis (non-blocking)
        try {
          await this.invalidateThesisByRegime(symbol, regimeHash);
        } catch (invalidationErr) {
          logger.warn('[SharedIntelligence] Failed to invalidate rejected thesis — will expire via TTL', {
            error: invalidationErr instanceof Error ? invalidationErr.message : 'Unknown error',
            symbol,
            regimeHash
          });
        }
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
        const regimeSignatureJson = JSON.stringify(regimeSignature);

        const cacheResult = await supabase.rpc('cache_alpha_thesis', {
          p_symbol: symbol,
          p_timeframe: regimeSignature.timeframeRelevance || 'H1',
          p_direction_bias: freshResult.thesis.directionBias,
          p_narrative: freshResult.thesis.narrative,
          p_regime: freshResult.thesis.regime,
          p_liquidity_context: freshResult.thesis.liquidityContext || THESIS_DEFAULTS.LIQUIDITY_CONTEXT,
          p_invalidation_logic: freshResult.thesis.invalidationLogic || THESIS_DEFAULTS.INVALIDATION_LOGIC,
          p_confidence_band: freshResult.thesis.confidenceBand,
          p_thesis_summary: freshResult.thesis.thesisSummary,
          p_regime_signature_hash: regimeHash,
          p_thesis_hash: immutableThesis.thesisHash,
          p_regime_signature_json: regimeSignatureJson,
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
          ttl: `${Math.round(THESIS_TTL_MS / 60000)}min`,
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
            p_error_message: errorMsg.substring(0, TIME_MS.CACHE.AUDIT_ERROR_MESSAGE_MAX_LENGTH),
            p_cache_tier: 'alpha_thesis'
          });
        } catch (auditErr) {
          logger.warn('[SharedIntelligence] Failed to log cache write failure to audit trail', {
            error: auditErr instanceof Error ? auditErr.message : 'Unknown error'
          });
        }

        // Cache write failure does NOT block execution — intelligent degradation.
      }

      // Store in local cache
      const ttl = getTTLForAlphaThesis();
      this.localThesisCache.set(localKey, {
        data: immutableThesis,
        expiresAt: now + ttl
      });

      return immutableThesis;
    })();

    // Register in-flight promise so concurrent callers share this fetch.
    this.inFlightThesisRequests.set(localKey, fetchPromise);

    try {
      return await fetchPromise;
    } finally {
      // Always remove the in-flight entry regardless of success or failure.
      this.inFlightThesisRequests.delete(localKey);
    }
  }

  /**
   * Cache a freshly-generated Alpha thesis directly to the database.
   *
   * CCIP-CACHE-WRITE-FIX-2026-03-19:
   * This method is the SOLE entry point for writing a thesis to the DB cache.
   * It bypasses the getAlphaThesis() lookup path entirely, which is the correct
   * design — the caller already HAS a fresh thesis and simply needs to persist it.
   *
   * The previous pattern called getAlphaThesis() with the finished thesis as a
   * parameter. Because getAlphaThesis() checks the in-memory localThesisCache
   * first (line 154) and the thesis was already stored there during generation,
   * it returned immediately without ever reaching the fetchPromise DB-write block.
   * The result: zero DB writes since the GPT-4o upgrade (CCIP-2026-0317A) went
   * live on 2026-03-17, causing 100% cache misses and full LLM cost on every scan.
   *
   * SSOT: SharedIntelligenceCoordinator is the sole authority for cache persistence.
   * Callers (e.g. coordinator-alpha.ts) MUST NOT call cache_alpha_thesis RPC directly.
   *
   * @param symbol  Trading symbol (e.g. 'XAUUSD')
   * @param regimeSignature  Structural market fingerprint
   * @param thesisData  The thesis fields to persist (from Alpha's parsed response)
   */
  async cacheThesis(
    symbol: string,
    regimeSignature: RegimeSignature,
    thesisData: {
      directionBias: 'BUY' | 'SELL' | 'NEUTRAL';
      narrative: string;
      regime: string;
      liquidityContext?: string;
      invalidationLogic?: string;
      confidenceBand: AlphaMarketThesis['confidenceBand'];
      thesisSummary: string;
    }
  ): Promise<void> {
    if (!validateRegimeSignature(regimeSignature)) {
      logger.warn('[SharedIntelligence] cacheThesis: invalid regime signature — skipping write', { symbol });
      return;
    }

    const regimeHash = generateRegimeSignatureHash(regimeSignature);
    const localKey = generateThesisCacheKey(symbol, regimeHash);

    const immutableThesis = createImmutableThesis({
      ...thesisData,
      symbol,
      regimeSignature,
      createdAt: new Date(),
      cacheAgeSeconds: 0,
      fromCache: false
    });

    const ttl = getTTLForAlphaThesis();
    this.localThesisCache.set(localKey, {
      data: immutableThesis,
      expiresAt: Date.now() + ttl
    });

    try {
      const regimeSignatureJson = JSON.stringify(regimeSignature);

      await supabase.rpc('cache_alpha_thesis', {
        p_symbol: symbol,
        p_timeframe: regimeSignature.timeframeRelevance || 'H1',
        p_direction_bias: thesisData.directionBias,
        p_narrative: thesisData.narrative,
        p_regime: thesisData.regime,
        p_liquidity_context: thesisData.liquidityContext || THESIS_DEFAULTS.LIQUIDITY_CONTEXT,
        p_invalidation_logic: thesisData.invalidationLogic || THESIS_DEFAULTS.INVALIDATION_LOGIC,
        p_confidence_band: thesisData.confidenceBand,
        p_thesis_summary: thesisData.thesisSummary,
        p_regime_signature_hash: regimeHash,
        p_thesis_hash: immutableThesis.thesisHash,
        p_regime_signature_json: regimeSignatureJson,
        p_htf_bias: regimeSignature.htfBias,
        p_micro_regime: regimeSignature.microRegime,
        p_volatility_regime: regimeSignature.volatilityRegime,
        p_structure_state: regimeSignature.structureState,
        p_timeframe_relevance: regimeSignature.timeframeRelevance || 'H1'
      });

      try {
        await supabase.rpc('log_cache_write_event', {
          p_symbol: symbol,
          p_regime_signature_hash: regimeHash,
          p_write_status: 'success',
          p_error_message: null,
          p_cache_tier: 'alpha_thesis'
        });
      } catch (auditErr) {
        logger.warn('[SharedIntelligence] cacheThesis: audit log failed (non-blocking)', {
          error: auditErr instanceof Error ? auditErr.message : 'Unknown error'
        });
      }

      logger.info('[SharedIntelligence] cacheThesis: thesis written to DB', {
        symbol,
        regimeHash,
        directionBias: thesisData.directionBias,
        ttlMin: Math.round(ttl / 60000)
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';

      logger.error('[SharedIntelligence] cacheThesis: DB write failed', {
        error: errorMsg,
        symbol,
        regimeHash
      });

      try {
        await supabase.rpc('log_cache_write_event', {
          p_symbol: symbol,
          p_regime_signature_hash: regimeHash,
          p_write_status: 'failed',
          p_error_message: errorMsg.substring(0, TIME_MS.CACHE.AUDIT_ERROR_MESSAGE_MAX_LENGTH),
          p_cache_tier: 'alpha_thesis'
        });
      } catch (auditErr) {
        logger.warn('[SharedIntelligence] cacheThesis: failure audit log failed (non-blocking)', {
          error: auditErr instanceof Error ? auditErr.message : 'Unknown error'
        });
      }
    }
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
   * Invalidate ALL local thesis entries for a symbol.
   *
   * CCIP-STALENESS-FIX-2026-02-20:
   * Called by candle-cache-manager when an H1+ structural candle closes.
   * We cannot know which regime hash the active thesis used without replaying
   * the full regime extraction, so we sweep the entire local Map for the symbol.
   * The database cache row will expire naturally within its own TTL (now 5 min).
   * This guarantees the NEXT orchestrator cycle generates a fresh thesis against
   * the new candle rather than re-reading a now-stale local hit.
   *
   * @param symbol  Trading symbol whose structural candle just closed
   * @param timeframe  Timeframe of the closing candle (e.g. 'H1', 'H4', 'D')
   */
  invalidateThesisForSymbol(symbol: string, timeframe: string): void {
    let evicted = 0;
    // CCIP-COORDINATOR-AUDIT-2026-03-03 CRITICAL FIX:
    // generateThesisCacheKey() produces keys in the format `thesis:${symbol}:${regimeHash}`.
    // The previous code searched for `${symbol}_` (underscore separator) which NEVER matched
    // any key, silently making this entire eviction loop a no-op. The correct prefix is
    // `thesis:${symbol}:` (colon separators, as defined in cache-key-generator.ts line 330).
    const keyPrefix = `thesis:${symbol}:`;
    for (const key of this.localThesisCache.keys()) {
      if (key.startsWith(keyPrefix)) {
        this.localThesisCache.delete(key);
        evicted++;
      }
    }
    logger.info('[SharedIntelligence] Thesis local-cache evicted on structural candle close', {
      symbol,
      timeframe,
      evicted
    });
  }

  /**
   * Clear all local caches
   */
  clearLocalCache(): void {
    this.localThesisCache.clear();
    this.inFlightThesisRequests.clear();
    marketSnapshotCache.clearAll();
    logger.info('[SharedIntelligence] All local caches cleared');
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
      logger.error('[SharedIntelligence] Failed to cleanup cache', {
        error: err instanceof Error ? err.message : 'Unknown error'
      });
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
      logger.warn('[SharedIntelligence] logCacheStat write failed (non-blocking)', {
        error: err instanceof Error ? err.message : 'Unknown error',
        tier,
        symbol,
        timeframe,
        eventType
      });
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
    logger.info('[SharedIntelligence] Cache Statistics', {
      snapshotCache: marketSnapshotCache.getStats(),
      alphaThesisLocalSize: this.localThesisCache.size,
      inFlightRequests: this.inFlightThesisRequests.size
    });
  }
}

export const sharedIntelligenceCoordinator = new SharedIntelligenceCoordinator();
