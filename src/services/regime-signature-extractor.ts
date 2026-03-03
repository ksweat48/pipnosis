/**
 * Regime Signature Extractor
 *
 * SSOT: Converts Omega intelligence reports into regime signatures for thesis caching.
 *
 * CCIP FIX (2026-02-18): Corrected TWO compounding bugs:
 * 1. Property name mismatch: was reading votes.omega1/omega2/etc. but actual properties
 *    are votes.trend/scalper/confirmation/reversal/volatility/risk/omega8
 * 2. Deprecated field access: was reading vote.confidence/vote.direction which are
 *    deprecated and always undefined. Now parses vote.reasoning and vote.keyFactors
 *    which contain the actual Omega intelligence output.
 *
 * Omega reasoning format: "[DET] BrainName BIAS (score: N) | factor1, factor2"
 * Omega keyFactors format: ["EMA_BULL(80)", "MOM_BULL", "BOS_BEAR", etc.]
 *
 * ROOT CAUSE: These bugs caused the regime signature to be STATIC across all scans,
 * meaning the thesis cache NEVER invalidated on market regime changes, and Alpha
 * was served stale cached theses that contradicted current market conditions.
 *
 * CCIP STABILITY FIX (2026-03-03):
 * Raised score thresholds for microRegime and structureState transitions to prevent
 * cache-busting on minor oscillations in sideways/low-volatility markets.
 *
 * PROBLEM: In a low-volatility sideways market, Omega vote scores oscillate ±5-10
 * points around the old thresholds (30 for reversal, 25 for range-bound, 30 for
 * strong_trend, 10/20 for choppy/consolidating). These micro-oscillations generated
 * a new regime signature hash every ~12 minutes, forcing full LLM thesis regeneration
 * for all 9 symbols on every scan cycle. This drove scan times to 126s (>120s alert
 * threshold), caused 66.7% governance error rate, and wasted ~$1/hr in LLM costs.
 *
 * SOLUTION: Stabilization bands — each regime transition now requires a score that
 * comfortably exceeds the threshold rather than barely crossing it:
 * - microRegime reversal_setup:  reversalScore > 30  → > 40 (hysteresis band: +10)
 * - microRegime range_bound:     scalperScore  > 25  → > 35 (hysteresis band: +10)
 * - microRegime trending floor:  score < 15          → < 10 (tighter: avoids neutral flip)
 * - structureState strong_trend: confirmScore > 30   → > 40 (hysteresis band: +10)
 * - structureState choppy:       confirmScore < 10   → < 7  (floor reduced to avoid noise)
 * - structureState consolidating:confirmScore < 20   → < 15 (tighter midband)
 *
 * LONG-TERM CORRECTNESS: Regime signatures must reflect structural market shifts, not
 * candle-to-candle noise. Score oscillations near a threshold are not structural changes.
 * Raising thresholds ensures only statistically meaningful regime transitions invalidate
 * the thesis cache. The 15-minute TTL restoration (time-constants.ts) works in concert
 * with this: structural H1+ candle closes remain the primary early-invalidation trigger.
 */

import type { RegimeSignature } from '../types/alpha-thesis';
import type { OmegaVote } from '../types/omega-vote';
import type { OmegaCouncilVotes } from '../types/omega';
import type { RegimeSnapshot } from './regime-oracle';
import { logger } from '../lib/logger';

export interface MarketContext {
  symbol: string;
  price: number;
  timeframe?: string;
  atr?: any;
  [key: string]: any;
}

function parseScoreFromReasoning(reasoning: string): number {
  const match = reasoning.match(/score:\s*(-?\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function parseBiasFromReasoning(reasoning: string): 'BULLISH' | 'BEARISH' | 'NEUTRAL' {
  if (reasoning.includes('BULLISH')) return 'BULLISH';
  if (reasoning.includes('BEARISH')) return 'BEARISH';
  return 'NEUTRAL';
}

function hasKeyFactor(factors: string[] | undefined, prefix: string): boolean {
  if (!factors) return false;
  return factors.some(f => f.startsWith(prefix));
}

function hasAnyKeyFactor(factors: string[] | undefined, prefixes: string[]): boolean {
  if (!factors) return false;
  return prefixes.some(prefix => factors.some(f => f.startsWith(prefix)));
}

export function extractRegimeSignature(
  symbol: string,
  marketContext: MarketContext,
  votes: OmegaCouncilVotes,
  regimeSnapshot?: RegimeSnapshot
): RegimeSignature {
  const htfBias = extractHTFBias(votes.trend);
  const microRegime = extractMicroRegime(votes.reversal, votes.scalper);
  const volatilityRegime = extractVolatilityRegime(votes.volatility, regimeSnapshot);
  const structureState = extractStructureState(votes.risk, votes.confirmation);
  const timeframeRelevance = marketContext.timeframe || 'H1';

  const signature: RegimeSignature = {
    symbol,
    htfBias,
    microRegime,
    volatilityRegime,
    structureState,
    timeframeRelevance
  };

  logger.info('[RegimeExtractor] Generated signature', {
    symbol,
    signature
  });

  return signature;
}

function extractHTFBias(trendVote: OmegaVote | null): RegimeSignature['htfBias'] {
  if (!trendVote || !trendVote.reasoning) return 'ranging';

  const bias = parseBiasFromReasoning(trendVote.reasoning);
  const score = parseScoreFromReasoning(trendVote.reasoning);
  const absScore = Math.abs(score);

  if (absScore < 15) return 'ranging';

  if (bias === 'BULLISH') {
    return absScore >= 35 ? 'strongly_bullish' : 'bullish';
  }

  if (bias === 'BEARISH') {
    return absScore >= 35 ? 'strongly_bearish' : 'bearish';
  }

  return 'ranging';
}

function extractMicroRegime(
  reversalVote: OmegaVote | null,
  scalperVote: OmegaVote | null
): RegimeSignature['microRegime'] {
  const reversalBias = reversalVote?.reasoning ? parseBiasFromReasoning(reversalVote.reasoning) : 'NEUTRAL';
  const reversalScore = reversalVote?.reasoning ? Math.abs(parseScoreFromReasoning(reversalVote.reasoning)) : 0;
  const scalperScore = scalperVote?.reasoning ? Math.abs(parseScoreFromReasoning(scalperVote.reasoning)) : 0;

  const hasReversalSignals = hasAnyKeyFactor(reversalVote?.keyFactors, ['RSI_DIV', 'MACD_DIV', 'ENG_BULL', 'ENG_BEAR', 'PIN_BULL', 'PIN_BEAR']);
  const hasRangeSignals = hasAnyKeyFactor(scalperVote?.keyFactors, ['RSI_OB', 'RSI_OS', 'VWAP_REVERT']);

  // STABILITY FIX: Raised from >30 to >40 — prevents cache-busting on oscillations
  // near the threshold in sideways markets. Requires a structurally significant reversal
  // signal before invalidating the thesis cache.
  if (hasReversalSignals && reversalScore > 40 && reversalBias !== 'NEUTRAL') {
    return 'reversal_setup';
  }

  // STABILITY FIX: Raised from >25 to >35 — range-bound regime requires sustained
  // scalper conviction, not just a temporary RSI extreme.
  if (hasRangeSignals && scalperScore > 35) {
    return 'range_bound';
  }

  // STABILITY FIX: Lowered floor from <15 to <10 — avoids flipping to 'trending'
  // on minor score noise; 'trending' now requires very low conviction from both brains.
  if (reversalScore < 10 && scalperScore < 10) {
    return 'trending';
  }

  return 'consolidation';
}

function extractVolatilityRegime(
  volatilityVote: OmegaVote | null,
  regimeSnapshot?: RegimeSnapshot
): RegimeSignature['volatilityRegime'] {
  if (regimeSnapshot?.category) {
    const category = regimeSnapshot.category.toLowerCase();
    if (category.includes('high') || category.includes('volatile')) {
      return 'high_volatility';
    }
    if (category.includes('low') || category.includes('quiet')) {
      return 'low_volatility';
    }
  }

  if (volatilityVote?.reasoning) {
    const bias = parseBiasFromReasoning(volatilityVote.reasoning);
    const score = Math.abs(parseScoreFromReasoning(volatilityVote.reasoning));
    const hasHighVol = hasAnyKeyFactor(volatilityVote.keyFactors, ['ATR_EXPANDING', 'VOL_SPIKE']);
    const hasLowVol = hasKeyFactor(volatilityVote.keyFactors, 'ATR_CONTRACTING');

    // CCIP-TYPE-CONTRACT-FIX-2026-03-03: Explicit conflict detection for contradictory ATR signals.
    // If both ATR_EXPANDING and ATR_CONTRACTING appear simultaneously (e.g. during a volatility
    // squeeze-then-expansion transition), ATR_EXPANDING takes explicit precedence because an
    // expanding volatility environment carries greater execution risk than a contracting one.
    // This was previously silent first-match logic. Now logged for governance observability.
    if (hasHighVol && hasLowVol) {
      logger.warn('[RegimeExtractor] Contradictory ATR signals detected: ATR_EXPANDING and ATR_CONTRACTING both present. Resolving to high_volatility (expansion takes precedence by governance policy).', {
        keyFactors: volatilityVote.keyFactors,
        score,
        bias
      });
      return 'high_volatility';
    }

    if (hasHighVol || (bias !== 'NEUTRAL' && score > 35)) {
      return 'high_volatility';
    }
    if (hasLowVol || score < 10) {
      return 'low_volatility';
    }
  }

  return 'normal_volatility';
}

function extractStructureState(
  riskVote: OmegaVote | null,
  confirmationVote: OmegaVote | null
): RegimeSignature['structureState'] {
  const confirmBias = confirmationVote?.reasoning ? parseBiasFromReasoning(confirmationVote.reasoning) : 'NEUTRAL';
  const confirmScore = confirmationVote?.reasoning ? Math.abs(parseScoreFromReasoning(confirmationVote.reasoning)) : 0;

  const hasBOS = hasAnyKeyFactor(confirmationVote?.keyFactors, ['BOS_BULL', 'BOS_BEAR']);

  // STABILITY FIX: Raised from >30 to >40 — strong_trend requires a confirmed BOS
  // with high-conviction confirmation. Prevents noisy BOS detections near threshold
  // from constantly toggling between strong_trend and weak_trend.
  if (hasBOS && confirmBias !== 'NEUTRAL' && confirmScore > 40) {
    return 'strong_trend';
  }

  // STABILITY FIX: Lowered from <10 to <7 — choppy state now requires very low
  // confirmation scores, reducing false choppy classifications during consolidations
  // with minor confirmation signals.
  if (confirmScore < 7) {
    return 'choppy';
  }

  // STABILITY FIX: Lowered from <20 to <15 — tighter midband prevents oscillation
  // between consolidating and weak_trend near the 15-20 score range.
  if (confirmScore < 15 && !hasBOS) {
    return 'consolidating';
  }

  return 'weak_trend';
}
