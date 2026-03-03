/**
 * Alpha Market Thesis Type System
 *
 * ARCHITECTURAL PRINCIPLE:
 * Cache Alpha's MARKET THESIS (what's happening in the market)
 * Do NOT cache execution decisions (how to trade it per user)
 *
 * This separation preserves:
 * - User-specific execution (SL/TP, risk%, style, goals)
 * - Alpha's final authority for each user
 * - Learning and accountability per user
 *
 * While providing:
 * - 60-85% cost reduction through thesis reuse
 * - Institutional-grade separation (thesis vs execution)
 * - Clean audit trails
 *
 * CCIP-STABILITY-FIX-2026-03-03:
 * THESIS_TTL_MS restored to 15 minutes (from 5 minutes set 2026-02-20).
 * The 5-minute TTL caused LLM thesis regeneration for all 9 symbols on every
 * scan cycle, driving scan times to 126s and a 66.7% symbol error rate.
 * Two independent mechanisms ensure stale theses are never executed:
 *   1. Regime signature change detection: detectRegimeChange() invalidates on any
 *      htfBias / microRegime / volatilityRegime / structureState shift
 *   2. H1+ candle close: evicts local cache immediately via candle-cache-manager
 * The freshness gate (SEVERITY_THRESHOLDS.alpha) provides an independent execution
 * guard and is intentionally separate from the cache TTL — see time-constants.ts.
 *
 * CCIP-TYPE-CONTRACT-FIX-2026-03-03:
 * RegimeSignature enum values corrected to match regime-signature-extractor.ts output.
 * Previous interface declared abstract taxonomy (accumulation/distribution/etc.) that
 * was never produced by the extractor, causing silent type-system bypass via `as` casts.
 * All values now reflect what the extractor actually returns at runtime.
 */

import { TIME_MS } from '../config/time-constants';

/**
 * Regime Signature - Structural fingerprint for thesis caching
 *
 * IMPORTANT: Session context (Asia/London/NY) is EXCLUDED
 * Session affects how you trade (urgency, spread, follow-through)
 * Session does NOT change what the market is doing structurally
 *
 * This signature captures structural truth, not execution bias.
 */
export interface RegimeSignature {
  /** Trading symbol */
  symbol: string;

  /**
   * HTF directional bias (H1/H4 timeframe)
   * SSOT: Values produced by regime-signature-extractor.ts extractHTFBias()
   * - strongly_bullish: absScore >= 35, BULLISH bias
   * - bullish: absScore 15-34, BULLISH bias
   * - strongly_bearish: absScore >= 35, BEARISH bias
   * - bearish: absScore 15-34, BEARISH bias
   * - ranging: absScore < 15 or NEUTRAL bias (default)
   */
  htfBias: 'strongly_bullish' | 'bullish' | 'strongly_bearish' | 'bearish' | 'ranging';

  /**
   * Micro regime classification
   * SSOT: Values produced by regime-signature-extractor.ts extractMicroRegime()
   * - reversal_setup: Strong reversal signals + high score (>40) + directional bias
   * - range_bound: Range signals present + scalper score > 35
   * - trending: Both reversal and scalper scores very low (<10) — momentum continuation
   * - consolidation: Default when no dominant micro signal (catch-all)
   */
  microRegime: 'reversal_setup' | 'range_bound' | 'trending' | 'consolidation';

  /**
   * Volatility regime
   * SSOT: Values produced by regime-signature-extractor.ts extractVolatilityRegime()
   * - high_volatility: ATR_EXPANDING or VOL_SPIKE present, or high bias score (>35)
   * - low_volatility: ATR_CONTRACTING present, or very low score (<10)
   * - normal_volatility: Default when no dominant volatility signal (catch-all)
   */
  volatilityRegime: 'high_volatility' | 'low_volatility' | 'normal_volatility';

  /**
   * Structure state
   * SSOT: Values produced by regime-signature-extractor.ts extractStructureState()
   * - strong_trend: BOS confirmed + directional bias + high confirmation score (>40)
   * - weak_trend: Moderate confirmation signals, no dominant structural state
   * - consolidating: Low confirmation score (<15), no BOS — sideways accumulation
   * - choppy: Very low confirmation score (<7) — no tradeable structure
   */
  structureState: 'strong_trend' | 'weak_trend' | 'consolidating' | 'choppy';

  /** Timeframe relevance for thesis */
  timeframeRelevance?: string;
}

/**
 * Regime signature hash type (SHA-256 hex string)
 * Used as cache key component
 */
export type RegimeSignatureHash = string;

/**
 * Alpha's Market Thesis - Expensive LLM analysis cached for reuse
 *
 * This is what Alpha analyzes ONCE and can be reused across users:
 * - Market direction bias
 * - Liquidity and structure narrative
 * - Regime classification
 * - Invalidation logic
 *
 * This is what remains USER-SPECIFIC (never cached):
 * - Entry timing (BUY now vs WAIT)
 * - Entry zone and price
 * - Stop loss / take profit levels
 * - Risk percentage
 * - Style (scalp/micro/intraday)
 * - Goal-specific adjustments
 * - Final confidence score
 */
export interface AlphaMarketThesis {
  /** Trading symbol (EURUSD, BTCUSD, etc) */
  symbol: string;

  /** HTF timeframe context used for thesis generation */
  timeframe: string;

  /** Market direction bias: BUY, SELL, NEUTRAL, MIXED */
  directionBias: 'BUY' | 'SELL' | 'NEUTRAL' | 'MIXED';

  /** Alpha's explanation of market structure, liquidity, and context */
  narrative: string;

  /** Market regime classification */
  regime: string;

  /** Liquidity context (sweep, trap, continuation, etc) */
  liquidityContext?: string;

  /** Logic that would invalidate this thesis */
  invalidationLogic?: string;

  /** Rough confidence band: weak, medium, strong */
  confidenceBand: 'weak' | 'medium' | 'strong';

  /** Brief summary of thesis for quick reference */
  thesisSummary: string;

  /** Regime signature used for this thesis */
  regimeSignature: RegimeSignature;

  /** Content hash for immutability verification */
  thesisHash: string;

  /** When this thesis was generated */
  createdAt: Date;

  /** Age of cached thesis in seconds */
  cacheAgeSeconds: number;

  /** Whether this came from cache or was freshly generated */
  fromCache: boolean;

  /** If Alpha rejected this cached thesis, the reason */
  rejectedBy?: string;
}

/**
 * Thesis TTL Strategy
 *
 * Fixed baseline: 15 minutes (SSOT: TIME_MS.CACHE.ALPHA_THESIS in time-constants.ts)
 *
 * CCIP-STABILITY-FIX-2026-03-03: Restored from 5 min back to 15 min.
 * The 5-minute TTL (set 2026-02-20 to align with freshness gate CRITICAL threshold)
 * was architecturally flawed: it caused full LLM regeneration for all 9 symbols on
 * every 15-minute scan cycle, making the cache effectively useless.
 *
 * The TTL and the freshness gate threshold are ORTHOGONAL concerns:
 * - TTL governs structural cache lifetime (when to evict regardless of regime match)
 * - Freshness gate governs execution safety (when to block a trade, independent of cache)
 * A thesis can be structurally valid (regime unchanged) but still require the freshness
 * gate to impose a WARNING or INFO advisory. Alpha factors this into its confidence.
 *
 * Early invalidation triggers (take precedence over TTL):
 * - Regime signature change: any htfBias / microRegime / volatilityRegime / structureState shift
 * - H1+ candle close: structural timeframe close evicts local cache immediately
 * - Price drift beyond pip threshold since thesis was generated
 */
export const THESIS_TTL_MS = TIME_MS.CACHE.ALPHA_THESIS; // 15 minutes (SSOT: time-constants.ts)

/**
 * Estimated cost per Alpha thesis LLM call.
 * SSOT: All log messages and cost-saving calculations must reference this constant.
 * CCIP-COORDINATOR-AUDIT-2026-03-03: Extracted from hardcoded '$0.20' strings in
 * shared-intelligence-coordinator.ts to prevent silent cost-figure drift on API re-pricing.
 */
export const ALPHA_THESIS_LLM_COST_PER_CALL = '$0.20';

/**
 * Default fallback strings used when optional thesis fields are absent.
 * SSOT: Centralised here so schema defaults and RPC call defaults stay in sync.
 * CCIP-COORDINATOR-AUDIT-2026-03-03: Extracted from hardcoded strings in
 * shared-intelligence-coordinator.ts cache_alpha_thesis RPC call.
 */
export const THESIS_DEFAULTS = {
  LIQUIDITY_CONTEXT: 'Standard liquidity conditions',
  INVALIDATION_LOGIC: 'Standard invalidation rules',
} as const;

/**
 * Structure change thresholds for early invalidation
 */
export const STRUCTURE_INVALIDATION_THRESHOLDS = {
  /** BOS against thesis direction */
  breakOfStructure: true,

  /** Volatility regime shift (e.g. normal_volatility → high_volatility) */
  volatilityRegimeChange: true,

  /** Micro regime change (e.g. trending → reversal_setup) */
  microRegimeChange: true,
} as const;

/**
 * Cache statistics for Alpha thesis caching
 */
export interface AlphaThesisCacheStats {
  cacheTier: 'alpha_thesis';
  totalLookups: number;
  cacheHits: number;
  cacheMisses: number;
  hitRate: number;
  avgCacheAgeSeconds: number;
  totalLlmCallsSaved: number;
  estimatedCostSaved: number; // Derived: totalLlmCallsSaved * 0.20
}

/**
 * Result from thesis generation (either from cache or fresh LLM call)
 */
export interface ThesisGenerationResult {
  thesis: AlphaMarketThesis;
  wasFromCache: boolean;
  costSaved: boolean; // True if cache hit
  llmCallMade: boolean; // True if fresh generation required
}

/**
 * Thesis rejection event - High-value learning signal
 *
 * When Alpha rejects a cached thesis, it means:
 * - Market truth changed
 * - Thesis was poorly formed
 * - Regime signature was insufficient
 * - Structure invalidation occurred
 *
 * This is a first-class learning signal for:
 * - Offline analysis of false theses
 * - Improving regime signature definition
 * - Improving thesis quality
 */
export interface ThesisRejectionEvent {
  /** Unique thesis ID that was rejected */
  thesisId: string;

  /** Symbol being analyzed */
  symbol: string;

  /** Alpha's explanation for rejection */
  rejectionReason: string;

  /** Current regime snapshot at rejection time */
  currentRegimeSnapshot: RegimeSignature;

  /** Time elapsed since thesis was created (ms) */
  timeSinceThesisMs: number;

  /** Execution style context (for analysis, not caching) */
  executionStyle: string;

  /** Session context at rejection (for analysis, not caching) */
  sessionContext: string;

  /** Timestamp of rejection */
  rejectedAt: Date;
}

/**
 * Conflict Information from Omega Council
 *
 * SSOT: Detected by alpha-omega-orchestrator.detectOmegaConflicts()
 * Attached to AlphaDecision for learning system tracking
 */
export interface ConflictInfo {
  /** Whether a conflict was detected */
  detected: boolean;

  /** Type of conflict detected */
  type: 'HARD' | 'SOFT' | 'NONE';

  /** Severity of the conflict */
  severity?: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

  /** Human-readable description of the conflict */
  description?: string;

  /** Confidence penalty multiplier applied (1.0 = no penalty, 0.75 = -25% penalty) */
  penalty?: number;
}

/**
 * Parsed Alpha response with thesis/execution separation
 */
export interface ParsedAlphaResponse {
  /** Market thesis (cacheable) */
  thesis: {
    directionBias: 'BUY' | 'SELL' | 'NEUTRAL' | 'MIXED';
    narrative: string;
    regime: string;
    liquidityContext?: string;
    invalidationLogic?: string;
    timeframeRelevance?: string;
    confidenceBand: 'weak' | 'medium' | 'strong';
  };

  /** Execution plan (user-specific, never cached) */
  execution: {
    decision: 'BUY' | 'SELL' | 'WAIT';
    entry?: number;
    stopLoss?: number;
    takeProfit?: number;
    confidence: number;
    reasoning: string;
    style: string;
  };

  /** If thesis was rejected, the reason */
  thesisRejected: boolean;
  rejectionReason?: string;
}
