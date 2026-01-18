/**
 * Regime Signature Extractor
 *
 * Converts market context into regime signatures for thesis caching
 * Extracts structural market state from Omega analysis
 */

import type { RegimeSignature } from '../types/alpha-thesis';
import type { OmegaVote } from '../brains/omega/trend';
import type { RegimeSnapshot } from './regime-oracle';
import { logger } from '../lib/logger';

export interface MarketContext {
  symbol: string;
  price: number;
  timeframe?: string;
  atr?: any;
  [key: string]: any;
}

export interface OmegaCouncilVotes {
  omega1: OmegaVote;
  omega2: OmegaVote;
  omega3: OmegaVote;
  omega4: OmegaVote;
  omega5: OmegaVote;
  omega6: OmegaVote;
  omega7?: any;
  omega8?: any;
  [key: string]: any;
}

/**
 * Extract regime signature from market context and Omega votes
 * This creates a structural fingerprint of the market state
 */
export function extractRegimeSignature(
  symbol: string,
  marketContext: MarketContext,
  votes: OmegaCouncilVotes,
  regimeSnapshot?: RegimeSnapshot
): RegimeSignature {
  // Extract HTF bias from trend Omega (Omega1)
  const htfBias = extractHTFBias(votes.omega1);

  // Extract micro regime from reversal/scalper Omegas (Omega3/Omega5)
  const microRegime = extractMicroRegime(votes.omega3, votes.omega5);

  // Extract volatility regime from volatility Omega (Omega6)
  const volatilityRegime = extractVolatilityRegime(votes.omega6, regimeSnapshot);

  // Extract structure state from confluence (Omega2) and confirmation (Omega4)
  const structureState = extractStructureState(votes.omega2, votes.omega4);

  // Determine timeframe relevance from market context
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

/**
 * Extract higher timeframe bias from trend analysis
 */
function extractHTFBias(trendVote: OmegaVote): RegimeSignature['htfBias'] {
  if (!trendVote) return 'ranging';

  const direction = trendVote.direction?.toLowerCase() || '';
  const confidence = trendVote.confidence || 0;

  if (confidence < 50) {
    return 'ranging';
  }

  if (direction === 'buy' || direction === 'bullish' || direction === 'long') {
    return confidence > 70 ? 'strongly_bullish' : 'bullish';
  }

  if (direction === 'sell' || direction === 'bearish' || direction === 'short') {
    return confidence > 70 ? 'strongly_bearish' : 'bearish';
  }

  return 'ranging';
}

/**
 * Extract micro regime from reversal and scalper analysis
 */
function extractMicroRegime(
  reversalVote: OmegaVote,
  scalperVote: OmegaVote
): RegimeSignature['microRegime'] {
  const reversalConfidence = reversalVote?.confidence || 0;
  const scalperConfidence = scalperVote?.confidence || 0;

  // High reversal confidence = potential reversal setup
  if (reversalConfidence > 70) {
    return 'reversal_setup';
  }

  // High scalper confidence = range-bound
  if (scalperConfidence > 65) {
    return 'range_bound';
  }

  // Both moderate = trending
  if (reversalConfidence < 50 && scalperConfidence < 50) {
    return 'trending';
  }

  // Default to consolidation
  return 'consolidation';
}

/**
 * Extract volatility regime from volatility analysis and regime oracle
 */
function extractVolatilityRegime(
  volatilityVote: OmegaVote,
  regimeSnapshot?: RegimeSnapshot
): RegimeSignature['volatilityRegime'] {
  // Use regime oracle if available
  if (regimeSnapshot?.category) {
    const category = regimeSnapshot.category.toLowerCase();
    if (category.includes('high') || category.includes('volatile')) {
      return 'high_volatility';
    }
    if (category.includes('low') || category.includes('quiet')) {
      return 'low_volatility';
    }
  }

  // Fall back to volatility omega
  if (volatilityVote) {
    const confidence = volatilityVote.confidence || 50;
    if (confidence > 70) {
      return 'high_volatility';
    }
    if (confidence < 40) {
      return 'low_volatility';
    }
  }

  return 'normal_volatility';
}

/**
 * Extract structure state from confluence and confirmation analysis
 */
function extractStructureState(
  confluenceVote: OmegaVote,
  confirmationVote: OmegaVote
): RegimeSignature['structureState'] {
  const confluenceConfidence = confluenceVote?.confidence || 0;
  const confirmationConfidence = confirmationVote?.confidence || 0;

  // Strong confluence + confirmation = strong trend
  if (confluenceConfidence > 70 && confirmationConfidence > 70) {
    return 'strong_trend';
  }

  // Weak both = choppy
  if (confluenceConfidence < 40 && confirmationConfidence < 40) {
    return 'choppy';
  }

  // Moderate both = consolidating
  if (confluenceConfidence < 60 && confirmationConfidence < 60) {
    return 'consolidating';
  }

  // Default to weak trend
  return 'weak_trend';
}
