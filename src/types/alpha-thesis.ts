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
 */

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

  /** Omega council votes summary (for cache key generation) */
  omegaSummary: Record<string, unknown>;

  /** When this thesis was generated */
  createdAt: Date;

  /** Age of cached thesis in seconds */
  cacheAgeSeconds: number;

  /** Whether this came from cache or was freshly generated */
  fromCache: boolean;
}

/**
 * Thesis TTL strategy based on timeframe context
 *
 * Scalp context (M5): 3-5 minutes - fast-moving markets
 * Micro context (M15): 5-10 minutes - moderate pace
 * Intraday context (H1+): 10-15 minutes - slower structural changes
 */
export type ThesisTTLStrategy = {
  M5: number;    // 300000ms (5 minutes)
  M15: number;   // 600000ms (10 minutes)
  H1: number;    // 900000ms (15 minutes)
  H4: number;    // 900000ms (15 minutes)
  D: number;     // 900000ms (15 minutes)
};

export const THESIS_TTL: ThesisTTLStrategy = {
  M5: 300000,    // 5 minutes
  M15: 600000,   // 10 minutes
  H1: 900000,    // 15 minutes
  H4: 900000,    // 15 minutes
  D: 900000      // 15 minutes
};

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
