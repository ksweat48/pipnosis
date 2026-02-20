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
 * CCIP-STALENESS-FIX-2026-02-20:
 * THESIS_TTL_MS is now sourced from TIME_MS.CACHE.ALPHA_THESIS (5 minutes).
 * This aligns the thesis TTL with the freshness gate's CRITICAL threshold (300s),
 * ensuring Alpha never operates on structure that is older than what the gate
 * already considers stale-enough-to-block.
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

  /** HTF directional bias (H1/H4 timeframe) */
  htfBias: 'bullish' | 'bearish' | 'neutral';

  /** Micro regime classification */
  microRegime: 'accumulation' | 'distribution' | 'expansion' | 'rotation';

  /** Volatility regime */
  volatilityRegime: 'compressed' | 'normal' | 'expanding';

  /** Structure state */
  structureState: 'trending' | 'ranging' | 'transition';

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
 * Fixed baseline: 15 minutes (global)
 * This is long enough to capture reuse across users while staying fresh.
 *
 * Early invalidation triggers (more important than TTL):
 * - Structure state flips (BOS against thesis)
 * - Volatility regime changes materially
 * - Invalidation logic defined in thesis is violated
 *
 * Rule: TTL = 5 minutes OR invalidate earlier if:
 *   - Regime signature changes (structure flip, volatility shift)
 *   - Price drifts beyond pip threshold since thesis was generated
 *   - H1+ candle closes (structural timeframe closes)
 *
 * CCIP-STALENESS-FIX-2026-02-20: Reduced from 15 min to 5 min.
 * Sourced from TIME_MS.CACHE.ALPHA_THESIS for SSOT compliance.
 */
export const THESIS_TTL_MS = TIME_MS.CACHE.ALPHA_THESIS; // 5 minutes (SSOT: time-constants.ts)

/**
 * Structure change thresholds for early invalidation
 */
export const STRUCTURE_INVALIDATION_THRESHOLDS = {
  /** BOS against thesis direction */
  breakOfStructure: true,

  /** Volatility regime shift (compressed → expanding or vice versa) */
  volatilityRegimeChange: true,

  /** Micro regime change (accumulation → distribution) */
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
