/**
 * THESIS-AWARE ENTRY QUALITY SCORE (EQS) ENGINE
 * SSOT for calculating entry quality based on thesis type
 *
 * Pure deterministic scoring - NO LLM calls
 * Each thesis has its own weighted requirements
 *
 * OUTPUT: score (0-100), readiness (EXECUTE_NOW | WAIT)
 * NEVER outputs REJECT
 *
 * AUTHORITY: Only this file calculates EQS per thesis
 * CONSUMERS: Entry Monitor (for execute/wait decision), Forensics (for learning)
 */

import type { ThesisType, ThesisEQSBreakdown, ThesisRequirements } from '../types/thesis';

interface EQSInput {
  thesis: ThesisType;
  direction: 'BUY' | 'SELL';
  price_data: {
    price: number;
    momentum: 'strong' | 'moderate' | 'weak' | 'none';
    candle_body_ratio: number;
    wick_rejection: number;
  };
  indicators: {
    ema_slope: number;
    ema_alignment: 'bullish' | 'bearish' | 'neutral';
    vwap: number;
    atr: number;
    pullback_quality: number;
    noise_level: number;
  };
  structure: {
    sweep_magnitude?: number;
    break_of_structure: boolean;
    acceptance_candles: boolean;
    htf_trend_aligned: boolean;
    pullback_depth_percent?: number;
    ema_support: boolean;
    range_compression?: number;
    break_strength?: number;
    retest_quality?: number;
    volume_expansion: boolean;
    distance_from_mean: number;
    exhaustion_candle: boolean;
    momentum_decay: boolean;
    failed_break_confirmed: boolean;
    fast_reclaim: boolean;
    momentum_flip: boolean;
    range_validity: boolean;
    extreme_location: number;
    rejection_candle: boolean;
    volatility_contraction: boolean;
  };
  execution_preference?: 'IMMEDIATE' | 'WAIT_PULLBACK' | 'WAIT_CONFIRMATION';
  alpha_confidence?: number;
}

export class ThesisEntryQualityEngine {
  /**
   * SSOT: Calculate EQS for any thesis type
   */
  calculateEQS(input: EQSInput): ThesisEQSBreakdown {
    switch (input.thesis) {
      case 'momentum_scalp':
        return this.scoreMomentumScalp(input);
      case 'liquidity_sweep_reversal':
        return this.scoreLiquiditySweepReversal(input);
      case 'trend_pullback':
        return this.scoreTrendPullback(input);
      case 'breakout_continuation':
        return this.scoreBreakoutContinuation(input);
      case 'mean_reversion':
        return this.scoreMeanReversion(input);
      case 'failed_move':
        return this.scoreFailedMove(input);
      case 'range_extreme':
        return this.scoreRangeExtreme(input);
      default:
        return this.createDefaultBreakdown(input.thesis, 0);
    }
  }

  /**
   * MOMENTUM SCALP EQS (Fast Execution)
   * Goal: Catch immediate continuation / impulse
   *
   * Weights:
   * - Momentum strength: 30%
   * - Candle body dominance: 20%
   * - EMA alignment: 15%
   * - VWAP proximity: 15%
   * - Pullback quality: 10%
   * - Noise absence: 10%
   *
   * Execution: EQS ≥40 → Execute, IMMEDIATE can override to 30
   */
  private scoreMomentumScalp(input: EQSInput): ThesisEQSBreakdown {
    let score = 0;
    const met: Partial<ThesisRequirements> = {};
    const missed: Partial<ThesisRequirements> = {};
    const gaps: string[] = [];

    const momentumScore = this.scoreMomentum(input.price_data.momentum);
    score += momentumScore * 0.30;
    met.momentum_strength = momentumScore;
    if (momentumScore < 70) gaps.push('Momentum not strong enough');

    const bodyScore = input.price_data.candle_body_ratio * 100;
    score += bodyScore * 0.20;
    met.candle_body_dominance = bodyScore;
    if (bodyScore < 60) gaps.push('Weak candle body dominance');

    const emaScore = this.scoreEMAAlignment(input.indicators.ema_slope, input.indicators.ema_alignment);
    score += emaScore * 0.15;
    met.ema_alignment = emaScore;
    if (emaScore < 50) gaps.push('Poor EMA alignment');

    const vwapProximity = Math.abs(input.price_data.price - input.indicators.vwap) / input.indicators.atr;
    const vwapScore = vwapProximity < 0.3 ? 100 : vwapProximity < 0.7 ? 70 : vwapProximity < 1.5 ? 40 : 0;
    score += vwapScore * 0.15;
    met.vwap_proximity = vwapScore;
    if (vwapScore < 40) gaps.push('Too far from VWAP - overextended');

    const pullbackScore = input.indicators.pullback_quality;
    score += pullbackScore * 0.10;
    met.pullback_quality = pullbackScore;

    const noiseScore = 100 - input.indicators.noise_level;
    score += noiseScore * 0.10;
    met.noise_absence = noiseScore;
    if (noiseScore < 60) gaps.push('Too much price noise/chop');

    const readiness = this.determineReadiness(score, input, 40, 30);

    return {
      thesis: 'momentum_scalp',
      score: Math.round(score),
      readiness,
      requirements_met: met,
      requirements_missed: missed,
      critical_gaps: gaps,
      improvement_suggestions: this.generateImprovementSuggestions(gaps, 'momentum_scalp')
    };
  }

  /**
   * LIQUIDITY SWEEP REVERSAL EQS
   * Goal: Fade engineered stop runs
   *
   * Weights:
   * - Valid sweep magnitude: 25%
   * - Break of structure after sweep: 25%
   * - Acceptance candles: 20%
   * - Wick rejection: 15%
   * - VWAP reclaim: 10%
   * - Volume confirmation: 5%
   *
   * Rule: No BOS + no acceptance → EQS capped at 55
   */
  private scoreLiquiditySweepReversal(input: EQSInput): ThesisEQSBreakdown {
    let score = 0;
    const met: Partial<ThesisRequirements> = {};
    const gaps: string[] = [];

    const sweepScore = (input.structure.sweep_magnitude || 0) * 100;
    score += sweepScore * 0.25;
    met.sweep_magnitude = sweepScore;
    if (sweepScore < 50) gaps.push('Weak or questionable sweep');

    const bosScore = input.structure.break_of_structure ? 100 : 0;
    score += bosScore * 0.25;
    met.break_of_structure = input.structure.break_of_structure;
    if (!input.structure.break_of_structure) gaps.push('NO break of structure confirmed');

    const acceptanceScore = input.structure.acceptance_candles ? 100 : 0;
    score += acceptanceScore * 0.20;
    met.acceptance_candles = input.structure.acceptance_candles;
    if (!input.structure.acceptance_candles) gaps.push('NO acceptance candles post-sweep');

    const wickScore = input.price_data.wick_rejection * 100;
    score += wickScore * 0.15;
    met.wick_rejection = wickScore;
    if (wickScore < 50) gaps.push('Weak wick rejection');

    const vwapReclaim = this.checkVWAPReclaim(input);
    const vwapReclaimScore = vwapReclaim ? 100 : 0;
    score += vwapReclaimScore * 0.10;
    met.vwap_reclaim = vwapReclaim;
    if (!vwapReclaim) gaps.push('VWAP not reclaimed');

    const volumeScore = input.structure.volume_expansion ? 100 : 50;
    score += volumeScore * 0.05;
    met.volume_confirmation = input.structure.volume_expansion;

    if (!input.structure.break_of_structure && !input.structure.acceptance_candles) {
      score = Math.min(score, 55);
      gaps.push('CRITICAL: No BOS and no acceptance - capping EQS at 55');
    }

    const readiness = this.determineReadiness(score, input, 60, 45);

    return {
      thesis: 'liquidity_sweep_reversal',
      score: Math.round(score),
      readiness,
      requirements_met: met,
      requirements_missed: {},
      critical_gaps: gaps,
      improvement_suggestions: this.generateImprovementSuggestions(gaps, 'liquidity_sweep_reversal')
    };
  }

  /**
   * TREND PULLBACK EQS
   * Goal: Enter continuation at value
   *
   * Weights:
   * - HTF trend alignment: 20%
   * - Pullback depth (38-61%): 20%
   * - EMA support/resistance: 15%
   * - VWAP interaction: 15%
   * - Acceptance candle: 15%
   * - Liquidity cleanliness: 10%
   */
  private scoreTrendPullback(input: EQSInput): ThesisEQSBreakdown {
    let score = 0;
    const met: Partial<ThesisRequirements> = {};
    const gaps: string[] = [];

    const htfScore = input.structure.htf_trend_aligned ? 100 : 0;
    score += htfScore * 0.20;
    met.htf_trend_alignment = input.structure.htf_trend_aligned;
    if (!input.structure.htf_trend_aligned) gaps.push('HTF trend not aligned');

    const pullbackDepth = input.structure.pullback_depth_percent || 0;
    let pullbackScore = 0;
    if (pullbackDepth >= 38 && pullbackDepth <= 61) {
      pullbackScore = 100;
    } else if (pullbackDepth >= 23 && pullbackDepth < 38) {
      pullbackScore = 70;
    } else if (pullbackDepth > 61 && pullbackDepth <= 78) {
      pullbackScore = 60;
    } else {
      pullbackScore = 30;
      gaps.push(`Pullback depth suboptimal: ${pullbackDepth}%`);
    }
    score += pullbackScore * 0.20;
    met.pullback_depth = pullbackScore;

    const emaScore = input.structure.ema_support ? 100 : 50;
    score += emaScore * 0.15;
    met.ema_support = input.structure.ema_support;
    if (!input.structure.ema_support) gaps.push('No EMA support/resistance');

    const vwapDistance = Math.abs(input.price_data.price - input.indicators.vwap) / input.indicators.atr;
    const vwapScore = vwapDistance < 0.5 ? 100 : vwapDistance < 1.0 ? 70 : 40;
    score += vwapScore * 0.15;
    met.vwap_proximity = vwapScore;
    if (vwapScore < 70) gaps.push('VWAP interaction weak');

    const acceptanceScore = input.structure.acceptance_candles ? 100 : 40;
    score += acceptanceScore * 0.15;
    met.acceptance_candles = input.structure.acceptance_candles;
    if (!input.structure.acceptance_candles) gaps.push('No acceptance candle yet');

    const cleanlinessScore = input.indicators.noise_level < 30 ? 100 : 60;
    score += cleanlinessScore * 0.10;

    const readiness = this.determineReadiness(score, input, 55, 40);

    return {
      thesis: 'trend_pullback',
      score: Math.round(score),
      readiness,
      requirements_met: met,
      requirements_missed: {},
      critical_gaps: gaps,
      improvement_suggestions: this.generateImprovementSuggestions(gaps, 'trend_pullback')
    };
  }

  /**
   * BREAKOUT CONTINUATION EQS
   * Goal: Trade post-break acceptance
   *
   * Weights:
   * - Range compression pre-break: 20%
   * - Break strength: 20%
   * - Retest quality: 20%
   * - Volume expansion: 15%
   * - Acceptance above level: 15%
   * - Trend alignment: 10%
   */
  private scoreBreakoutContinuation(input: EQSInput): ThesisEQSBreakdown {
    let score = 0;
    const met: Partial<ThesisRequirements> = {};
    const gaps: string[] = [];

    const compressionScore = (input.structure.range_compression || 0) * 100;
    score += compressionScore * 0.20;
    met.range_compression = compressionScore;
    if (compressionScore < 50) gaps.push('Weak pre-break compression');

    const breakStrength = (input.structure.break_strength || 0) * 100;
    score += breakStrength * 0.20;
    if (breakStrength < 60) gaps.push('Break not strong enough');

    const retestScore = (input.structure.retest_quality || 0) * 100;
    score += retestScore * 0.20;
    met.retest_quality = retestScore;
    if (retestScore < 50) gaps.push('Poor retest quality');

    const volumeScore = input.structure.volume_expansion ? 100 : 40;
    score += volumeScore * 0.15;
    met.volume_expansion = input.structure.volume_expansion;
    if (!input.structure.volume_expansion) gaps.push('No volume expansion');

    const acceptanceScore = input.structure.acceptance_candles ? 100 : 30;
    score += acceptanceScore * 0.15;
    if (!input.structure.acceptance_candles) gaps.push('No acceptance above level');

    const trendScore = input.structure.htf_trend_aligned ? 100 : 60;
    score += trendScore * 0.10;

    const readiness = this.determineReadiness(score, input, 50, 35);

    return {
      thesis: 'breakout_continuation',
      score: Math.round(score),
      readiness,
      requirements_met: met,
      requirements_missed: {},
      critical_gaps: gaps,
      improvement_suggestions: this.generateImprovementSuggestions(gaps, 'breakout_continuation')
    };
  }

  /**
   * MEAN REVERSION EQS
   * Goal: Fade extremes
   *
   * Weights:
   * - Distance from VWAP/mean: 25%
   * - Exhaustion candle: 20%
   * - Momentum decay: 15%
   * - HTF range context: 15%
   * - Liquidity proximity: 15%
   * - Acceptance: 10%
   */
  private scoreMeanReversion(input: EQSInput): ThesisEQSBreakdown {
    let score = 0;
    const met: Partial<ThesisRequirements> = {};
    const gaps: string[] = [];

    const distance = input.structure.distance_from_mean;
    let distanceScore = 0;
    if (distance >= 1.5) {
      distanceScore = 100;
    } else if (distance >= 1.0) {
      distanceScore = 80;
    } else if (distance >= 0.7) {
      distanceScore = 60;
    } else {
      distanceScore = 20;
      gaps.push('Not extended enough from mean');
    }
    score += distanceScore * 0.25;
    met.distance_from_mean = distanceScore;

    const exhaustionScore = input.structure.exhaustion_candle ? 100 : 40;
    score += exhaustionScore * 0.20;
    met.exhaustion_candle = input.structure.exhaustion_candle;
    if (!input.structure.exhaustion_candle) gaps.push('No exhaustion candle');

    const decayScore = input.structure.momentum_decay ? 100 : 50;
    score += decayScore * 0.15;
    met.momentum_decay = input.structure.momentum_decay;
    if (!input.structure.momentum_decay) gaps.push('Momentum still strong');

    const rangeScore = input.structure.range_validity ? 100 : 60;
    score += rangeScore * 0.15;

    const proximityScore = 70;
    score += proximityScore * 0.15;

    const acceptanceScore = input.structure.acceptance_candles ? 100 : 50;
    score += acceptanceScore * 0.10;

    const readiness = this.determineReadiness(score, input, 60, 45);

    return {
      thesis: 'mean_reversion',
      score: Math.round(score),
      readiness,
      requirements_met: met,
      requirements_missed: {},
      critical_gaps: gaps,
      improvement_suggestions: this.generateImprovementSuggestions(gaps, 'mean_reversion')
    };
  }

  /**
   * FAILED MOVE EQS
   * Goal: Trade reclaim after rejection
   *
   * Weights:
   * - Failed break confirmation: 30%
   * - Fast reclaim: 20%
   * - Wick rejection: 15%
   * - Momentum flip: 15%
   * - Volume confirmation: 10%
   * - Context alignment: 10%
   */
  private scoreFailedMove(input: EQSInput): ThesisEQSBreakdown {
    let score = 0;
    const met: Partial<ThesisRequirements> = {};
    const gaps: string[] = [];

    const failedBreakScore = input.structure.failed_break_confirmed ? 100 : 0;
    score += failedBreakScore * 0.30;
    met.failed_break_confirmation = input.structure.failed_break_confirmed;
    if (!input.structure.failed_break_confirmed) gaps.push('Failed break not confirmed');

    const reclaimScore = input.structure.fast_reclaim ? 100 : 50;
    score += reclaimScore * 0.20;
    met.fast_reclaim = input.structure.fast_reclaim;
    if (!input.structure.fast_reclaim) gaps.push('Reclaim not fast enough');

    const wickScore = input.price_data.wick_rejection * 100;
    score += wickScore * 0.15;
    met.wick_rejection = wickScore;
    if (wickScore < 60) gaps.push('Weak wick rejection');

    const flipScore = input.structure.momentum_flip ? 100 : 40;
    score += flipScore * 0.15;
    met.momentum_flip = input.structure.momentum_flip;
    if (!input.structure.momentum_flip) gaps.push('No momentum flip detected');

    const volumeScore = input.structure.volume_expansion ? 100 : 60;
    score += volumeScore * 0.10;

    const contextScore = input.structure.htf_trend_aligned ? 100 : 70;
    score += contextScore * 0.10;

    const readiness = this.determineReadiness(score, input, 55, 40);

    return {
      thesis: 'failed_move',
      score: Math.round(score),
      readiness,
      requirements_met: met,
      requirements_missed: {},
      critical_gaps: gaps,
      improvement_suggestions: this.generateImprovementSuggestions(gaps, 'failed_move')
    };
  }

  /**
   * RANGE EXTREME EQS
   * Goal: Fade defined boundaries
   *
   * Weights:
   * - Range validity: 20%
   * - Extreme location: 20%
   * - Rejection candle: 20%
   * - VWAP distance: 15%
   * - Failed breakout attempt: 15%
   * - Volatility contraction: 10%
   */
  private scoreRangeExtreme(input: EQSInput): ThesisEQSBreakdown {
    let score = 0;
    const met: Partial<ThesisRequirements> = {};
    const gaps: string[] = [];

    const validityScore = input.structure.range_validity ? 100 : 0;
    score += validityScore * 0.20;
    met.range_validity = input.structure.range_validity;
    if (!input.structure.range_validity) gaps.push('Range not valid');

    const extremeScore = input.structure.extreme_location * 100;
    score += extremeScore * 0.20;
    met.extreme_location = extremeScore;
    if (extremeScore < 70) gaps.push('Not at range extreme');

    const rejectionScore = input.structure.rejection_candle ? 100 : 30;
    score += rejectionScore * 0.20;
    met.rejection_candle = input.structure.rejection_candle;
    if (!input.structure.rejection_candle) gaps.push('No rejection candle');

    const vwapDistance = input.structure.distance_from_mean;
    const vwapScore = vwapDistance >= 0.8 ? 100 : vwapDistance >= 0.5 ? 70 : 40;
    score += vwapScore * 0.15;

    const failedBreakoutScore = input.structure.failed_break_confirmed ? 100 : 70;
    score += failedBreakoutScore * 0.15;

    const contractionScore = input.structure.volatility_contraction ? 100 : 60;
    score += contractionScore * 0.10;
    met.volatility_contraction = input.structure.volatility_contraction;

    const readiness = this.determineReadiness(score, input, 55, 40);

    return {
      thesis: 'range_extreme',
      score: Math.round(score),
      readiness,
      requirements_met: met,
      requirements_missed: {},
      critical_gaps: gaps,
      improvement_suggestions: this.generateImprovementSuggestions(gaps, 'range_extreme')
    };
  }

  private determineReadiness(
    score: number,
    input: EQSInput,
    baseThreshold: number,
    immediateOverrideThreshold: number
  ): 'EXECUTE_NOW' | 'WAIT' {
    if (score >= baseThreshold) return 'EXECUTE_NOW';

    if (input.execution_preference === 'IMMEDIATE' && score >= immediateOverrideThreshold) {
      return 'EXECUTE_NOW';
    }

    if (input.alpha_confidence && input.alpha_confidence >= 85 && score >= immediateOverrideThreshold) {
      return 'EXECUTE_NOW';
    }

    return 'WAIT';
  }

  private scoreMomentum(momentum: string): number {
    switch (momentum) {
      case 'strong': return 100;
      case 'moderate': return 65;
      case 'weak': return 35;
      case 'none': return 0;
      default: return 50;
    }
  }

  private scoreEMAAlignment(slope: number, alignment: string): number {
    if (alignment === 'neutral') return 40;
    const slopeStrength = Math.min(100, Math.abs(slope) * 100);
    return slopeStrength;
  }

  private checkVWAPReclaim(input: EQSInput): boolean {
    const aboveVWAP = input.price_data.price > input.indicators.vwap;
    if (input.direction === 'BUY' && aboveVWAP) return true;
    if (input.direction === 'SELL' && !aboveVWAP) return true;
    return false;
  }

  private generateImprovementSuggestions(gaps: string[], thesis: ThesisType): string[] {
    const suggestions: string[] = [];

    switch (thesis) {
      case 'momentum_scalp':
        if (gaps.some(g => g.includes('Momentum'))) {
          suggestions.push('Wait for stronger price acceleration');
        }
        if (gaps.some(g => g.includes('VWAP'))) {
          suggestions.push('Consider waiting for pullback to VWAP');
        }
        break;
      case 'liquidity_sweep_reversal':
        if (gaps.some(g => g.includes('BOS'))) {
          suggestions.push('WAIT for break of structure confirmation');
        }
        if (gaps.some(g => g.includes('acceptance'))) {
          suggestions.push('WAIT for acceptance candle post-sweep');
        }
        break;
      case 'trend_pullback':
        if (gaps.some(g => g.includes('Pullback depth'))) {
          suggestions.push('Wait for deeper pullback into ideal zone');
        }
        if (gaps.some(g => g.includes('acceptance'))) {
          suggestions.push('Wait for acceptance candle at support/resistance');
        }
        break;
      default:
        suggestions.push('Monitor for improved conditions');
    }

    return suggestions;
  }

  private createDefaultBreakdown(thesis: ThesisType, score: number): ThesisEQSBreakdown {
    return {
      thesis,
      score,
      readiness: score >= 40 ? 'EXECUTE_NOW' : 'WAIT',
      requirements_met: {},
      requirements_missed: {},
      critical_gaps: [],
      improvement_suggestions: []
    };
  }
}

export const thesisEntryQualityEngine = new ThesisEntryQualityEngine();
