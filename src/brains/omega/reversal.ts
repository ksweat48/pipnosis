/**
 * Omega-4 Reversal - DETERMINISTIC Divergence & Reversal Specialist
 *
 * Specializes in:
 * - RSI divergences
 * - Momentum shifts
 * - Reversal patterns
 * - Exhaustion signals
 * - Pivot flips
 *
 * FULLY DETERMINISTIC - NO LLM CALLS
 */

import type { OmegaVote } from '../../types/omega-vote';
import type { OmegaSensors } from '../../services/omega-sensors';
import { calculateExhaustion } from '../../lib/technical-math/candle';
import { REVERSAL_THRESHOLDS } from '../../config/omega-thresholds';

export interface ReversalSnapshot {
  p: number;
  rsi: number;
  st: number;
  mom: number;
  e20: number;
  e50: number;
  tr: string;
  vol: string;
  sensors?: OmegaSensors;
  recentCandles?: Array<{ open: number; high: number; low: number; close: number }>;
}

class OmegaReversalBrain {
  evaluate(snapshot: ReversalSnapshot): OmegaVote {
    const { rsi, st, mom, tr, sensors, recentCandles = [] } = snapshot;

    let score = 0;
    const factors: string[] = [];
    let candidateDirection: 'BUY' | 'SELL' | null = null;

    if (rsi >= REVERSAL_THRESHOLDS.RSI_EXTREME_HIGH) {
      score += 20;
      candidateDirection = 'SELL';
      factors.push(`RSI_EXTREME_HIGH(${rsi})`);
    } else if (rsi <= REVERSAL_THRESHOLDS.RSI_EXTREME_LOW) {
      score += 20;
      candidateDirection = 'BUY';
      factors.push(`RSI_EXTREME_LOW(${rsi})`);
    }

    if (st > 80 && !candidateDirection) {
      score += 10;
      candidateDirection = 'SELL';
      factors.push('STOCH_OB');
    } else if (st < 20 && !candidateDirection) {
      score += 10;
      candidateDirection = 'BUY';
      factors.push('STOCH_OS');
    }

    if (sensors) {
      if (sensors.rdiv === 'bull') {
        score += REVERSAL_THRESHOLDS.DIVERGENCE_STRONG_BONUS;
        if (!candidateDirection) candidateDirection = 'BUY';
        factors.push('RSI_DIV_BULL');
      } else if (sensors.rdiv === 'bear') {
        score += REVERSAL_THRESHOLDS.DIVERGENCE_STRONG_BONUS;
        if (!candidateDirection) candidateDirection = 'SELL';
        factors.push('RSI_DIV_BEAR');
      }

      if (sensors.mdiv === 'bull') {
        score += REVERSAL_THRESHOLDS.DIVERGENCE_MODERATE_BONUS;
        if (!candidateDirection) candidateDirection = 'BUY';
        factors.push('MACD_DIV_BULL');
      } else if (sensors.mdiv === 'bear') {
        score += REVERSAL_THRESHOLDS.DIVERGENCE_MODERATE_BONUS;
        if (!candidateDirection) candidateDirection = 'SELL';
        factors.push('MACD_DIV_BEAR');
      }

      if (sensors.cho === 'bull') {
        score += 12;
        if (!candidateDirection) candidateDirection = 'BUY';
        factors.push('CHOCH_BULL');
      } else if (sensors.cho === 'bear') {
        score += 12;
        if (!candidateDirection) candidateDirection = 'SELL';
        factors.push('CHOCH_BEAR');
      }

      if (sensors.pat.pin_b === 1) {
        score += REVERSAL_THRESHOLDS.PATTERN_BONUS;
        if (!candidateDirection) candidateDirection = 'BUY';
        factors.push('PIN_BAR_BULL');
      } else if (sensors.pat.pin_s === 1) {
        score += REVERSAL_THRESHOLDS.PATTERN_BONUS;
        if (!candidateDirection) candidateDirection = 'SELL';
        factors.push('PIN_BAR_BEAR');
      }

      if (sensors.pat.eng_b === 1) {
        score += REVERSAL_THRESHOLDS.PATTERN_BONUS;
        if (!candidateDirection) candidateDirection = 'BUY';
        factors.push('ENGULF_BULL');
      } else if (sensors.pat.eng_s === 1) {
        score += REVERSAL_THRESHOLDS.PATTERN_BONUS;
        if (!candidateDirection) candidateDirection = 'SELL';
        factors.push('ENGULF_BEAR');
      }
    }

    if (recentCandles.length >= 3) {
      const exhaustion = calculateExhaustion(recentCandles, rsi);
      if (exhaustion.level === 'STRONG') {
        score += REVERSAL_THRESHOLDS.EXHAUSTION_STRONG_BONUS;
        factors.push('EXHAUSTION_STRONG');
      } else if (exhaustion.level === 'MODERATE') {
        score += REVERSAL_THRESHOLDS.EXHAUSTION_MODERATE_BONUS;
        factors.push('EXHAUSTION_MOD');
      }
    }

    const trendLower = tr.toLowerCase();
    if (trendLower === 'bull' && candidateDirection === 'SELL') {
      score += 5;
      factors.push('REVERSAL_VS_TREND');
    } else if (trendLower === 'bear' && candidateDirection === 'BUY') {
      score += 5;
      factors.push('REVERSAL_VS_TREND');
    } else if (candidateDirection) {
      score -= 8;
      factors.push('WITH_TREND_CAUTION');
    }

    let bias: string;
    if (!candidateDirection) {
      bias = 'NO_REVERSAL';
      factors.push('WEAK_LEAN');
    } else if (score >= 35) {
      bias = candidateDirection === 'BUY' ? 'STRONG_BULLISH_REVERSAL' : 'STRONG_BEARISH_REVERSAL';
    } else if (score >= 20) {
      bias = candidateDirection === 'BUY' ? 'MODERATE_BULLISH_REVERSAL' : 'MODERATE_BEARISH_REVERSAL';
    } else {
      bias = 'WEAK_REVERSAL';
      factors.push('WEAK_REVERSAL');
    }

    const evidence = [
      `RSI=${rsi}`,
      `STOCH=${st}`,
      `MOM=${mom}`,
      `TREND=${tr}`,
      sensors?.rdiv ? `RDIV=${sensors.rdiv}` : '',
      sensors?.mdiv ? `MDIV=${sensors.mdiv}` : ''
    ].filter(Boolean).join('|');

    const reasoning = `[DET] Reversal ${bias} (score: ${score.toFixed(0)}) | ${factors.slice(0, 4).join(', ')}`;

    console.log(`[Omega-4 Reversal] [DET] Intelligence: ${bias} | Score: ${score.toFixed(0)} | Factors: ${factors.join(', ')}`);

    return {
      reasoning,
      evidence,
      keyFactors: factors
    };
  }
}

export const omegaReversal = new OmegaReversalBrain();
