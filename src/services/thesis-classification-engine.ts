/**
 * THESIS CLASSIFICATION ENGINE
 * SSOT for determining trade thesis types
 *
 * Pure deterministic logic - NO LLM calls
 * Analyzes market context to classify which of 7 thesis types applies
 *
 * AUTHORITY: Only this file determines thesis classification
 * CONSUMERS: Alpha (for context), EQS Engine (for scoring), Forensics (for learning)
 */

import type { ThesisType, ThesisClassification } from '../types/thesis';

interface MarketContext {
  direction: 'BUY' | 'SELL';
  price_action: {
    recent_momentum: 'strong' | 'moderate' | 'weak' | 'none';
    candle_structure: 'bullish_engulf' | 'bearish_engulf' | 'doji' | 'hammer' | 'shooting_star' | 'normal';
    wick_dominance: 'upper' | 'lower' | 'balanced';
    body_to_wick_ratio: number;
  };
  structure: {
    trend: 'strong_up' | 'weak_up' | 'ranging' | 'weak_down' | 'strong_down';
    recent_break: boolean;
    sweep_detected: boolean;
    range_bound: boolean;
    compression: boolean;
  };
  indicators: {
    distance_from_vwap: number;
    ema_alignment: 'bullish' | 'bearish' | 'neutral';
    pullback_depth_percent?: number;
    volume_trend: 'increasing' | 'decreasing' | 'stable';
  };
  regime?: {
    type: string;
    volatility: 'high' | 'medium' | 'low';
  };
}

export class ThesisClassificationEngine {
  /**
   * SSOT: Classify thesis type based on market context
   * Called by: Alpha (for understanding), EQS Engine (for scoring)
   */
  classifyThesis(context: MarketContext): ThesisClassification {
    const classifications: Array<{ thesis: ThesisType; score: number; reason: string }> = [];

    classifications.push(this.scoreMomentumScalp(context));
    classifications.push(this.scoreLiquiditySweepReversal(context));
    classifications.push(this.scoreTrendPullback(context));
    classifications.push(this.scoreBreakoutContinuation(context));
    classifications.push(this.scoreMeanReversion(context));
    classifications.push(this.scoreFailedMove(context));
    classifications.push(this.scoreRangeExtreme(context));

    classifications.sort((a, b) => b.score - a.score);
    const winner = classifications[0];
    const supporting = classifications.filter(c => c.score > 30 && c.thesis !== winner.thesis);

    return {
      thesis: winner.thesis,
      confidence: Math.min(100, winner.score),
      supporting_factors: supporting.map(s => `${s.thesis} (${s.score}%)`),
      primary_driver: winner.reason
    };
  }

  private scoreMomentumScalp(context: MarketContext): { thesis: ThesisType; score: number; reason: string } {
    let score = 0;
    const reasons: string[] = [];

    if (context.price_action.recent_momentum === 'strong') {
      score += 40;
      reasons.push('Strong momentum detected');
    } else if (context.price_action.recent_momentum === 'moderate') {
      score += 20;
    }

    if (context.price_action.body_to_wick_ratio > 0.7) {
      score += 25;
      reasons.push('Strong body dominance');
    }

    if (context.indicators.ema_alignment !== 'neutral') {
      score += 15;
      reasons.push('EMA alignment present');
    }

    if (Math.abs(context.indicators.distance_from_vwap) < 0.3) {
      score += 15;
      reasons.push('Near VWAP - not overextended');
    } else if (Math.abs(context.indicators.distance_from_vwap) > 1.0) {
      score -= 20;
    }

    if (context.indicators.volume_trend === 'increasing') {
      score += 5;
    }

    return {
      thesis: 'momentum_scalp',
      score: Math.max(0, score),
      reason: reasons.join(', ') || 'Weak momentum setup'
    };
  }

  private scoreLiquiditySweepReversal(context: MarketContext): { thesis: ThesisType; score: number; reason: string } {
    let score = 0;
    const reasons: string[] = [];

    if (context.structure.sweep_detected) {
      score += 30;
      reasons.push('Liquidity sweep detected');
    } else {
      return { thesis: 'liquidity_sweep_reversal', score: 0, reason: 'No sweep detected' };
    }

    if (context.structure.recent_break) {
      score += 30;
      reasons.push('Break of structure confirmed');
    }

    if (context.price_action.wick_dominance === 'upper' && context.direction === 'SELL') {
      score += 20;
      reasons.push('Wick rejection on bearish sweep');
    } else if (context.price_action.wick_dominance === 'lower' && context.direction === 'BUY') {
      score += 20;
      reasons.push('Wick rejection on bullish sweep');
    }

    if (['bullish_engulf', 'bearish_engulf', 'hammer'].includes(context.price_action.candle_structure)) {
      score += 15;
      reasons.push('Strong acceptance candle');
    }

    if (context.indicators.volume_trend === 'increasing') {
      score += 5;
    }

    return {
      thesis: 'liquidity_sweep_reversal',
      score,
      reason: reasons.join(', ')
    };
  }

  private scoreTrendPullback(context: MarketContext): { thesis: ThesisType; score: number; reason: string } {
    let score = 0;
    const reasons: string[] = [];

    const strongTrend = context.structure.trend === 'strong_up' || context.structure.trend === 'strong_down';
    const trendDirection = context.structure.trend.includes('up') ? 'BUY' : 'SELL';

    if (!strongTrend) {
      return { thesis: 'trend_pullback', score: 0, reason: 'No strong trend present' };
    }

    if (trendDirection !== context.direction) {
      return { thesis: 'trend_pullback', score: 0, reason: 'Direction against trend' };
    }

    score += 25;
    reasons.push('Strong HTF trend aligned');

    const pullbackDepth = context.indicators.pullback_depth_percent || 0;
    if (pullbackDepth >= 38 && pullbackDepth <= 61) {
      score += 25;
      reasons.push(`Ideal pullback depth: ${pullbackDepth}%`);
    } else if (pullbackDepth >= 23 && pullbackDepth < 38) {
      score += 15;
      reasons.push('Shallow pullback');
    } else if (pullbackDepth > 61) {
      score += 10;
      reasons.push('Deep pullback - risky');
    }

    if (context.indicators.ema_alignment !== 'neutral') {
      score += 20;
      reasons.push('EMA support/resistance confirmed');
    }

    if (Math.abs(context.indicators.distance_from_vwap) < 0.5) {
      score += 15;
      reasons.push('Good VWAP interaction');
    }

    if (['bullish_engulf', 'bearish_engulf', 'hammer'].includes(context.price_action.candle_structure)) {
      score += 15;
      reasons.push('Acceptance candle formed');
    }

    return {
      thesis: 'trend_pullback',
      score,
      reason: reasons.join(', ')
    };
  }

  private scoreBreakoutContinuation(context: MarketContext): { thesis: ThesisType; score: number; reason: string } {
    let score = 0;
    const reasons: string[] = [];

    if (!context.structure.recent_break) {
      return { thesis: 'breakout_continuation', score: 0, reason: 'No recent breakout' };
    }

    score += 25;
    reasons.push('Recent breakout confirmed');

    if (context.structure.compression) {
      score += 20;
      reasons.push('Pre-breakout compression present');
    }

    if (context.price_action.recent_momentum === 'strong') {
      score += 20;
      reasons.push('Strong break momentum');
    } else if (context.price_action.recent_momentum === 'moderate') {
      score += 10;
    }

    if (context.price_action.body_to_wick_ratio > 0.6) {
      score += 15;
      reasons.push('Strong acceptance above level');
    }

    if (context.indicators.volume_trend === 'increasing') {
      score += 15;
      reasons.push('Volume expansion on break');
    }

    if (context.indicators.ema_alignment !== 'neutral') {
      score += 5;
    }

    return {
      thesis: 'breakout_continuation',
      score,
      reason: reasons.join(', ')
    };
  }

  private scoreMeanReversion(context: MarketContext): { thesis: ThesisType; score: number; reason: string } {
    let score = 0;
    const reasons: string[] = [];

    const distanceFromVWAP = Math.abs(context.indicators.distance_from_vwap);

    if (distanceFromVWAP < 0.5) {
      return { thesis: 'mean_reversion', score: 0, reason: 'Too close to mean' };
    }

    if (distanceFromVWAP >= 1.0) {
      score += 30;
      reasons.push(`Extended from VWAP: ${distanceFromVWAP.toFixed(2)} ATR`);
    } else if (distanceFromVWAP >= 0.7) {
      score += 20;
      reasons.push('Moderate extension from mean');
    }

    if (context.price_action.candle_structure === 'shooting_star' && context.direction === 'SELL') {
      score += 25;
      reasons.push('Exhaustion candle (shooting star)');
    } else if (context.price_action.candle_structure === 'hammer' && context.direction === 'BUY') {
      score += 25;
      reasons.push('Exhaustion candle (hammer)');
    } else if (context.price_action.wick_dominance !== 'balanced') {
      score += 10;
      reasons.push('Wick rejection present');
    }

    if (context.price_action.recent_momentum === 'weak') {
      score += 20;
      reasons.push('Momentum decay detected');
    } else if (context.price_action.recent_momentum === 'none') {
      score += 15;
    }

    if (context.structure.range_bound) {
      score += 15;
      reasons.push('Range context supports mean reversion');
    }

    if (context.regime?.volatility === 'low') {
      score += 10;
    }

    return {
      thesis: 'mean_reversion',
      score,
      reason: reasons.join(', ')
    };
  }

  private scoreFailedMove(context: MarketContext): { thesis: ThesisType; score: number; reason: string } {
    let score = 0;
    const reasons: string[] = [];

    if (!context.structure.recent_break) {
      return { thesis: 'failed_move', score: 0, reason: 'No recent structure test' };
    }

    if (context.structure.sweep_detected) {
      score += 35;
      reasons.push('Failed break confirmed (sweep and rejection)');
    } else {
      score += 20;
      reasons.push('Structure test detected');
    }

    if (context.price_action.recent_momentum === 'strong') {
      score += 25;
      reasons.push('Fast reclaim of level');
    } else if (context.price_action.recent_momentum === 'moderate') {
      score += 15;
    }

    if (context.price_action.wick_dominance !== 'balanced') {
      score += 20;
      reasons.push('Wick rejection present');
    }

    if (context.indicators.volume_trend === 'increasing') {
      score += 10;
      reasons.push('Volume confirmation on reclaim');
    }

    if (context.structure.trend !== 'ranging') {
      score += 10;
      reasons.push('Trending context supports failed break');
    }

    return {
      thesis: 'failed_move',
      score,
      reason: reasons.join(', ')
    };
  }

  private scoreRangeExtreme(context: MarketContext): { thesis: ThesisType; score: number; reason: string } {
    let score = 0;
    const reasons: string[] = [];

    if (!context.structure.range_bound) {
      return { thesis: 'range_extreme', score: 0, reason: 'Not in ranging market' };
    }

    score += 25;
    reasons.push('Valid range detected');

    const distanceFromVWAP = Math.abs(context.indicators.distance_from_vwap);
    if (distanceFromVWAP >= 0.8) {
      score += 25;
      reasons.push(`At range extreme: ${distanceFromVWAP.toFixed(2)} ATR from VWAP`);
    } else if (distanceFromVWAP >= 0.5) {
      score += 15;
    }

    if (context.price_action.candle_structure === 'shooting_star' && context.direction === 'SELL') {
      score += 25;
      reasons.push('Rejection candle at range top');
    } else if (context.price_action.candle_structure === 'hammer' && context.direction === 'BUY') {
      score += 25;
      reasons.push('Rejection candle at range bottom');
    } else if (context.price_action.wick_dominance !== 'balanced') {
      score += 15;
      reasons.push('Wick rejection');
    }

    if (context.structure.recent_break && !context.structure.sweep_detected) {
      score -= 15;
      reasons.push('Warning: Potential breakout attempt');
    }

    if (context.regime?.volatility === 'low') {
      score += 10;
      reasons.push('Low volatility supports range trading');
    }

    return {
      thesis: 'range_extreme',
      score,
      reason: reasons.join(', ')
    };
  }

  /**
   * Helper: Extract market context from Omega votes and market data
   * This bridges the gap between Pipnosis data structures and thesis engine
   */
  extractMarketContext(
    omegaVotes: any[],
    priceData: any,
    indicators: any,
    regime?: any
  ): MarketContext {
    const trendVote = omegaVotes.find(v => v.name === 'Trend');
    const scalperVote = omegaVotes.find(v => v.name === 'Scalper');
    const reversalVote = omegaVotes.find(v => v.name === 'Reversal');
    const volatilityVote = omegaVotes.find(v => v.name === 'Volatility');

    const momentum = scalperVote?.details?.momentum || 'none';
    const trendStrength = trendVote?.details?.trend || 'ranging';

    const vwap = indicators?.vwap || priceData.price;
    const distanceFromVWAP = Math.abs(priceData.price - vwap) / (indicators?.atr || 1);

    const emaAlignment = trendVote?.vote === 'BUY' ? 'bullish' :
                        trendVote?.vote === 'SELL' ? 'bearish' : 'neutral';

    return {
      direction: 'BUY',
      price_action: {
        recent_momentum: momentum,
        candle_structure: this.detectCandleStructure(priceData),
        wick_dominance: this.detectWickDominance(priceData),
        body_to_wick_ratio: this.calculateBodyToWickRatio(priceData)
      },
      structure: {
        trend: trendStrength,
        recent_break: reversalVote?.details?.break_detected || false,
        sweep_detected: reversalVote?.details?.sweep_detected || false,
        range_bound: trendStrength === 'ranging',
        compression: volatilityVote?.details?.compression || false
      },
      indicators: {
        distance_from_vwap: distanceFromVWAP,
        ema_alignment: emaAlignment,
        pullback_depth_percent: trendVote?.details?.pullback_depth,
        volume_trend: 'stable'
      },
      regime
    };
  }

  private detectCandleStructure(priceData: any): string {
    if (!priceData.open || !priceData.close || !priceData.high || !priceData.low) {
      return 'normal';
    }

    const body = Math.abs(priceData.close - priceData.open);
    const upperWick = priceData.high - Math.max(priceData.open, priceData.close);
    const lowerWick = Math.min(priceData.open, priceData.close) - priceData.low;
    const totalRange = priceData.high - priceData.low;

    if (body < totalRange * 0.1) return 'doji';
    if (lowerWick > body * 2 && upperWick < body) return 'hammer';
    if (upperWick > body * 2 && lowerWick < body) return 'shooting_star';
    if (priceData.close > priceData.open && body > totalRange * 0.7) return 'bullish_engulf';
    if (priceData.close < priceData.open && body > totalRange * 0.7) return 'bearish_engulf';

    return 'normal';
  }

  private detectWickDominance(priceData: any): 'upper' | 'lower' | 'balanced' {
    if (!priceData.open || !priceData.close || !priceData.high || !priceData.low) {
      return 'balanced';
    }

    const upperWick = priceData.high - Math.max(priceData.open, priceData.close);
    const lowerWick = Math.min(priceData.open, priceData.close) - priceData.low;

    if (upperWick > lowerWick * 1.5) return 'upper';
    if (lowerWick > upperWick * 1.5) return 'lower';
    return 'balanced';
  }

  private calculateBodyToWickRatio(priceData: any): number {
    if (!priceData.open || !priceData.close || !priceData.high || !priceData.low) {
      return 0.5;
    }

    const body = Math.abs(priceData.close - priceData.open);
    const totalRange = priceData.high - priceData.low;

    if (totalRange === 0) return 0;
    return body / totalRange;
  }
}

export const thesisClassificationEngine = new ThesisClassificationEngine();
