/**
 * Omega-3 Confirmation - DETERMINISTIC Intraday Setup Confirmation Specialist
 *
 * Specializes in:
 * - Multi-timeframe alignment for intraday trades
 * - Entry confirmation signals
 * - Support and resistance confluences
 * - Pullback structure validation
 * - Trade setup confirmation for 20min-2hr durations
 *
 * FULLY DETERMINISTIC - NO LLM CALLS
 */

import type { OmegaVote } from '../../types/omega-vote';
import type { OmegaSensors } from '../../services/omega-sensors';
import { calculateATRDistance } from '../../lib/technical-math/atr';
import { CONFIRMATION_THRESHOLDS } from '../../config/omega-thresholds';

export interface ConfirmationSnapshot {
  p: number;
  sup: number[];
  res: number[];
  sw: { h: number; l: number };
  str: string;
  tr: string;
  mtf?: string;
  pullback?: boolean;
  sensors?: OmegaSensors;
  atr?: number;
}

class OmegaConfirmationBrain {
  evaluate(snapshot: ConfirmationSnapshot): OmegaVote {
    const { p, sup, res, str, tr, mtf, pullback, sensors, atr = 1 } = snapshot;

    let score = 0;
    const factors: string[] = [];
    let candidateDirection: 'BUY' | 'SELL' | null = null;

    const nearestSupport = sup.length > 0 ? Math.max(...sup.filter(s => s < p)) : 0;
    const nearestResistance = res.length > 0 ? Math.min(...res.filter(r => r > p)) : 0;

    const distToSupport = nearestSupport > 0 ? calculateATRDistance(p, nearestSupport, atr) : Infinity;
    const distToResistance = nearestResistance > 0 ? calculateATRDistance(p, nearestResistance, atr) : Infinity;

    if (distToSupport < CONFIRMATION_THRESHOLDS.SR_PROXIMITY_ATR && distToSupport < distToResistance) {
      score += 20;
      candidateDirection = 'BUY';
      factors.push(`NEAR_SUPPORT(${distToSupport.toFixed(2)}ATR)`);
    } else if (distToResistance < CONFIRMATION_THRESHOLDS.SR_PROXIMITY_ATR && distToResistance < distToSupport) {
      score += 20;
      candidateDirection = 'SELL';
      factors.push(`NEAR_RESISTANCE(${distToResistance.toFixed(2)}ATR)`);
    }

    const structurePattern = str.toLowerCase();
    if (structurePattern === 'hh' || structurePattern === 'hh_hl') {
      if (!candidateDirection) candidateDirection = 'BUY';
      if (candidateDirection === 'BUY') {
        score += 25;
        factors.push('STRUCTURE_HH_HL');
      } else {
        score -= 15;
        factors.push('STRUCTURE_VS_SELL');
      }
    } else if (structurePattern === 'll' || structurePattern === 'll_lh') {
      if (!candidateDirection) candidateDirection = 'SELL';
      if (candidateDirection === 'SELL') {
        score += 25;
        factors.push('STRUCTURE_LL_LH');
      } else {
        score -= 15;
        factors.push('STRUCTURE_VS_BUY');
      }
    }

    if (sensors) {
      if (sensors.bos === 'bull' && candidateDirection === 'BUY') {
        score += 15;
        factors.push('BOS_CONFIRMS_BUY');
      } else if (sensors.bos === 'bear' && candidateDirection === 'SELL') {
        score += 15;
        factors.push('BOS_CONFIRMS_SELL');
      } else if (sensors.bos !== 'none') {
        score -= 10;
        factors.push('BOS_CONFLICT');
      }

      if (sensors.sh === 1 && candidateDirection === 'SELL') {
        score += 10;
        factors.push('SWING_HIGH_SELL');
      } else if (sensors.sl === 1 && candidateDirection === 'BUY') {
        score += 10;
        factors.push('SWING_LOW_BUY');
      }

      if (sensors.mic.msr === 'above' && candidateDirection === 'SELL') {
        score += 8;
        factors.push('ABOVE_MICRO_SR');
      } else if (sensors.mic.msr === 'below' && candidateDirection === 'BUY') {
        score += 8;
        factors.push('BELOW_MICRO_SR');
      }
    }

    if (mtf) {
      const mtfLower = mtf.toLowerCase();
      if ((mtfLower.includes('bull') || mtfLower.includes('up')) && candidateDirection === 'BUY') {
        score += CONFIRMATION_THRESHOLDS.MTF_ALIGNMENT_BONUS;
        factors.push('MTF_ALIGNED_BUY');
      } else if ((mtfLower.includes('bear') || mtfLower.includes('down')) && candidateDirection === 'SELL') {
        score += CONFIRMATION_THRESHOLDS.MTF_ALIGNMENT_BONUS;
        factors.push('MTF_ALIGNED_SELL');
      } else if (mtfLower.includes('bull') || mtfLower.includes('bear')) {
        score -= 10;
        factors.push('MTF_CONFLICT');
      }
    }

    if (pullback) {
      score += CONFIRMATION_THRESHOLDS.PULLBACK_BONUS;
      factors.push('PULLBACK_ENTRY');
    }

    const trendLower = tr.toLowerCase();
    if (trendLower === 'bull' && candidateDirection === 'BUY') {
      score += 10;
      factors.push('TREND_ALIGNED');
    } else if (trendLower === 'bear' && candidateDirection === 'SELL') {
      score += 10;
      factors.push('TREND_ALIGNED');
    } else if (trendLower === 'bull' || trendLower === 'bear') {
      score -= 5;
    }

    let bias: string;
    if (!candidateDirection) {
      bias = 'NEUTRAL';
      factors.push('WEAK_LEAN');
    } else if (score >= 35) {
      bias = candidateDirection === 'BUY' ? 'CONFIRMED_BULLISH' : 'CONFIRMED_BEARISH';
    } else if (score >= 15) {
      bias = candidateDirection === 'BUY' ? 'LEAN_BULLISH' : 'LEAN_BEARISH';
    } else {
      bias = 'WEAK_CONFIRMATION';
      factors.push('WEAK_CONFIRMATION');
    }

    const evidence = [
      `SUP_DIST=${distToSupport === Infinity ? 'N/A' : distToSupport.toFixed(2) + 'ATR'}`,
      `RES_DIST=${distToResistance === Infinity ? 'N/A' : distToResistance.toFixed(2) + 'ATR'}`,
      `STR=${str}`,
      `TREND=${tr}`
    ].join('|');

    const reasoning = `[DET] Confirmation ${bias} (score: ${score.toFixed(0)}) | ${factors.slice(0, 4).join(', ')}`;

    console.log(`[Omega-3 Confirmation] [DET] Intelligence: ${bias} | Score: ${score.toFixed(0)} | Factors: ${factors.join(', ')}`);

    return {
      reasoning,
      evidence,
      keyFactors: factors
    };
  }
}

export const omegaConfirmation = new OmegaConfirmationBrain();
