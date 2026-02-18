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

  if (hasReversalSignals && reversalScore > 30 && reversalBias !== 'NEUTRAL') {
    return 'reversal_setup';
  }

  if (hasRangeSignals && scalperScore > 25) {
    return 'range_bound';
  }

  if (reversalScore < 15 && scalperScore < 15) {
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
  const hasVolSpike = hasKeyFactor(confirmationVote?.keyFactors, 'VOL_SPIKE');

  if (hasBOS && confirmBias !== 'NEUTRAL' && confirmScore > 30) {
    return 'strong_trend';
  }

  if (confirmScore < 10) {
    return 'choppy';
  }

  if (confirmScore < 20 && !hasBOS) {
    return 'consolidating';
  }

  return 'weak_trend';
}
