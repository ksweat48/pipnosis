/**
 * Omega-1 Trend - DETERMINISTIC Trend Analysis Specialist
 *
 * Specializes in:
 * - Trend identification and strength
 * - EMA alignment and crossovers
 * - Momentum analysis
 * - Trend continuation vs reversal
 *
 * FULLY DETERMINISTIC - NO LLM CALLS
 * Uses OmegaSensors and technical-math library for all calculations.
 */

import type { OmegaVote } from '../../types/omega-vote';
import type { OmegaSensors } from '../../services/omega-sensors';
import {
  calculateEMAAlignment,
  calculateEMASlope,
  formatEMAEvidence
} from '../../lib/technical-math/ema';
import { analyzeMomentum, formatMomentumEvidence } from '../../lib/technical-math/momentum';
import { TREND_THRESHOLDS } from '../../config/omega-thresholds';

export interface TrendSnapshot {
  p: number;
  e20: number;
  e50: number;
  e200: number;
  mom: number;
  tr: string;
  vol: string;
  sensors?: OmegaSensors;
  previousEma20?: number;
  atr?: number;
}

class OmegaTrendBrain {
  evaluate(snapshot: TrendSnapshot): OmegaVote {
    const { p, e20, e50, e200, mom, sensors, previousEma20, atr } = snapshot;

    const emaAlignment = calculateEMAAlignment(p, e20, e50, e200);
    const emaSlope = calculateEMASlope(e20, previousEma20 || e20, atr || 1);
    const momentum = analyzeMomentum(mom);

    let score = 0;
    const factors: string[] = [];

    if (emaAlignment.stack === 'BULL') {
      score += emaAlignment.strength * 0.4;
      factors.push(`EMA_BULL(${emaAlignment.strength})`);
    } else if (emaAlignment.stack === 'BEAR') {
      score -= emaAlignment.strength * 0.4;
      factors.push(`EMA_BEAR(${emaAlignment.strength})`);
    } else if (emaAlignment.strength >= 40) {
      const partialBullish = emaAlignment.e20_above_e50 && emaAlignment.e20_above_e200;
      if (partialBullish) {
        score += emaAlignment.strength * 0.25;
        factors.push(`EMA_PARTIAL_BULL(${emaAlignment.strength})`);
      } else {
        score -= emaAlignment.strength * 0.25;
        factors.push(`EMA_PARTIAL_BEAR(${emaAlignment.strength})`);
      }
    } else {
      factors.push('EMA_MIXED');
    }

    if (emaSlope.direction === 'UP' && emaSlope.magnitude > TREND_THRESHOLDS.EMA_SLOPE_STRONG) {
      score += 15;
      factors.push('SLOPE_STRONG_UP');
    } else if (emaSlope.direction === 'DOWN' && emaSlope.magnitude > TREND_THRESHOLDS.EMA_SLOPE_STRONG) {
      score -= 15;
      factors.push('SLOPE_STRONG_DOWN');
    } else if (emaSlope.direction === 'UP') {
      score += 8;
      factors.push('SLOPE_UP');
    } else if (emaSlope.direction === 'DOWN') {
      score -= 8;
      factors.push('SLOPE_DOWN');
    }

    if (momentum.direction === 'STRONG_BULL') {
      score += 20;
      factors.push('MOM_STRONG_BULL');
    } else if (momentum.direction === 'BULL') {
      score += 10;
      factors.push('MOM_BULL');
    } else if (momentum.direction === 'STRONG_BEAR') {
      score -= 20;
      factors.push('MOM_STRONG_BEAR');
    } else if (momentum.direction === 'BEAR') {
      score -= 10;
      factors.push('MOM_BEAR');
    }

    if (sensors) {
      if (sensors.bos === 'bull') {
        score += 12;
        factors.push('BOS_BULL');
      } else if (sensors.bos === 'bear') {
        score -= 12;
        factors.push('BOS_BEAR');
      }

      if (sensors.cho === 'bull') {
        score += 8;
        factors.push('CHOCH_BULL');
      } else if (sensors.cho === 'bear') {
        score -= 8;
        factors.push('CHOCH_BEAR');
      }

      if (sensors.atr_t === 'up') {
        const bonus = score > 0 ? 5 : -5;
        score += bonus;
        factors.push('ATR_EXPANDING');
      }
    }

    let vote: 'BUY' | 'SELL';
    let confidence: number;

    const scoreThreshold = TREND_THRESHOLDS.SCORE_THRESHOLD;
    if (score >= scoreThreshold) {
      vote = 'BUY';
      confidence = Math.min(95, 55 + score);
    } else if (score <= -scoreThreshold) {
      vote = 'SELL';
      confidence = Math.min(95, 55 + Math.abs(score));
    } else {
      vote = score >= 0 ? 'BUY' : 'SELL';
      confidence = Math.max(1, Math.min(30, 15 + Math.abs(score) * 0.5));
      factors.push('WEAK_LEAN');
    }

    const evidence = [
      formatEMAEvidence(emaAlignment, emaSlope),
      formatMomentumEvidence(momentum)
    ].join('|');

    const reasoning = `[DET] ${vote} @ ${confidence}% | ${factors.slice(0, 4).join(', ')}`;

    console.log(`[Omega-1 Trend] [DET] Vote: ${vote} | Confidence: ${confidence}% | Factors: ${factors.join(', ')}`);

    return {
      vote,
      confidence: Math.round(confidence),
      reasoning,
      evidence,
      keyFactors: factors
    };
  }
}

export const omegaTrend = new OmegaTrendBrain();
