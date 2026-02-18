/**
 * Omega-1 Trend - DETERMINISTIC Trend Analysis Specialist
 *
 * Specializes in:
 * - Trend identification and strength
 * - EMA alignment and crossovers
 * - Momentum analysis
 * - Trend continuation vs reversal
 *
 * STYLE-AWARE: SCALP focuses on micro-structure only (EMA20/EMA50 proximity).
 * MICRO_INTRADAY requires EMA50 alignment + BOS as structural confirmation.
 * INTRADAY requires full EMA200 stack alignment — mixed stack is a penalty.
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

export type OmegaTradeStyle = 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';

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
  tradeStyle?: OmegaTradeStyle;
}

class OmegaTrendBrain {
  evaluate(snapshot: TrendSnapshot): OmegaVote {
    const { p, e20, e50, e200, mom, sensors, previousEma20, atr, tradeStyle = 'SCALP' } = snapshot;

    const emaAlignment = calculateEMAAlignment(p, e20, e50, e200);
    const emaSlope = calculateEMASlope(e20, previousEma20 || e20, atr || 1);
    const momentum = analyzeMomentum(mom);

    let score = 0;
    const factors: string[] = [];

    factors.push(`STYLE:${tradeStyle}`);

    if (tradeStyle === 'SCALP') {
      // SCALP: EMA20/EMA50 proximity matters, EMA200 is context only
      if (emaAlignment.e20_above_e50) {
        score += emaAlignment.strength * 0.3;
        factors.push(`EMA_MICRO_BULL(${emaAlignment.strength})`);
      } else {
        score -= emaAlignment.strength * 0.3;
        factors.push(`EMA_MICRO_BEAR(${emaAlignment.strength})`);
      }
    } else if (tradeStyle === 'MICRO_INTRADAY') {
      // MICRO_INTRADAY: EMA50 alignment required, EMA200 acts as a context modifier
      if (emaAlignment.stack === 'BULL') {
        score += emaAlignment.strength * 0.4;
        factors.push(`EMA_BULL(${emaAlignment.strength})`);
      } else if (emaAlignment.stack === 'BEAR') {
        score -= emaAlignment.strength * 0.4;
        factors.push(`EMA_BEAR(${emaAlignment.strength})`);
      } else if (emaAlignment.e20_above_e50) {
        score += emaAlignment.strength * 0.2;
        factors.push(`EMA_PARTIAL_BULL(${emaAlignment.strength})`);
      } else {
        score -= emaAlignment.strength * 0.2;
        factors.push(`EMA_PARTIAL_BEAR(${emaAlignment.strength})`);
      }
    } else {
      // INTRADAY: Full EMA200 stack alignment is required — mixed stack is a penalty
      if (emaAlignment.stack === 'BULL') {
        score += emaAlignment.strength * 0.5;
        factors.push(`EMA_BULL_HTF(${emaAlignment.strength})`);
      } else if (emaAlignment.stack === 'BEAR') {
        score -= emaAlignment.strength * 0.5;
        factors.push(`EMA_BEAR_HTF(${emaAlignment.strength})`);
      } else {
        // Mixed EMA stack on INTRADAY is a significant penalty
        score -= 20;
        factors.push('EMA_MIXED_INTRADAY_PENALTY');
      }
    }

    if (emaSlope.direction === 'UP' && emaSlope.magnitude > TREND_THRESHOLDS.EMA_SLOPE_STRONG) {
      score += tradeStyle === 'INTRADAY' ? 18 : 15;
      factors.push('SLOPE_STRONG_UP');
    } else if (emaSlope.direction === 'DOWN' && emaSlope.magnitude > TREND_THRESHOLDS.EMA_SLOPE_STRONG) {
      score -= tradeStyle === 'INTRADAY' ? 18 : 15;
      factors.push('SLOPE_STRONG_DOWN');
    } else if (emaSlope.direction === 'UP') {
      score += 8;
      factors.push('SLOPE_UP');
    } else if (emaSlope.direction === 'DOWN') {
      score -= 8;
      factors.push('SLOPE_DOWN');
    }

    if (momentum.direction === 'STRONG_BULL') {
      score += tradeStyle === 'SCALP' ? 25 : 20;
      factors.push('MOM_STRONG_BULL');
    } else if (momentum.direction === 'BULL') {
      score += 10;
      factors.push('MOM_BULL');
    } else if (momentum.direction === 'STRONG_BEAR') {
      score -= tradeStyle === 'SCALP' ? 25 : 20;
      factors.push('MOM_STRONG_BEAR');
    } else if (momentum.direction === 'BEAR') {
      score -= 10;
      factors.push('MOM_BEAR');
    }

    if (sensors) {
      const bosWeight = tradeStyle === 'INTRADAY' ? 18 : tradeStyle === 'MICRO_INTRADAY' ? 15 : 12;
      if (sensors.bos === 'bull') {
        score += bosWeight;
        factors.push('BOS_BULL');
      } else if (sensors.bos === 'bear') {
        score -= bosWeight;
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

    const scoreThreshold = TREND_THRESHOLDS.SCORE_THRESHOLD;
    if (Math.abs(score) < scoreThreshold) {
      factors.push('WEAK_LEAN');
    }

    const bias = score >= scoreThreshold ? 'BULLISH' : score <= -scoreThreshold ? 'BEARISH' : 'NEUTRAL';

    const evidence = [
      formatEMAEvidence(emaAlignment, emaSlope),
      formatMomentumEvidence(momentum)
    ].join('|');

    const reasoning = `[DET:${tradeStyle}] Trend ${bias} (score: ${score.toFixed(0)}) | ${factors.slice(0, 5).join(', ')}`;

    console.log(`[Omega-1 Trend] [DET:${tradeStyle}] Intelligence: ${bias} | Score: ${score.toFixed(0)} | Factors: ${factors.join(', ')}`);

    return {
      reasoning,
      evidence,
      keyFactors: factors
    };
  }
}

export const omegaTrend = new OmegaTrendBrain();
