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
 * STYLE-AWARE score thresholds: SCALP confirms at score >= 30 (low proximity + structure floor).
 * MICRO_INTRADAY confirms at score >= 35 — MTF alignment and pullback bonuses apply.
 * INTRADAY confirms at score >= 40 — MTF conflict carries the largest penalty of any style.
 * NOTE: These thresholds are internal scoring boundaries. They are not dimension counts and are
 * independent of the Q7 framework Alpha uses for pre-trade entry analysis.
 *
 * FULLY DETERMINISTIC - NO LLM CALLS
 */

import type { OmegaVote } from '../../types/omega-vote';
import type { OmegaSensors } from '../../services/omega-sensors';
import { calculateATRDistance } from '../../lib/technical-math/atr';
import { CONFIRMATION_THRESHOLDS } from '../../config/omega-thresholds';
import type { OmegaTradeStyle } from './trend';

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
  tradeStyle?: OmegaTradeStyle;
}

class OmegaConfirmationBrain {
  evaluate(snapshot: ConfirmationSnapshot): OmegaVote {
    const { p, sup, res, str, tr, mtf, pullback, sensors, atr = 1, tradeStyle = 'SCALP' } = snapshot;

    let score = 0;
    const factors: string[] = [];
    let candidateDirection: 'BUY' | 'SELL' | null = null;

    factors.push(`STYLE:${tradeStyle}`);

    const nearestSupport = sup.length > 0 ? Math.max(...sup.filter(s => s < p)) : 0;
    const nearestResistance = res.length > 0 ? Math.min(...res.filter(r => r > p)) : 0;

    const distToSupport = nearestSupport > 0 ? calculateATRDistance(p, nearestSupport, atr) : Infinity;
    const distToResistance = nearestResistance > 0 ? calculateATRDistance(p, nearestResistance, atr) : Infinity;

    // SCALP uses same proximity threshold; INTRADAY uses a tighter proximity requirement
    const proximityThreshold = tradeStyle === 'INTRADAY'
      ? CONFIRMATION_THRESHOLDS.SR_PROXIMITY_ATR * 0.7
      : CONFIRMATION_THRESHOLDS.SR_PROXIMITY_ATR;

    const srBonus = tradeStyle === 'INTRADAY' ? 25 : 20;

    if (distToSupport < proximityThreshold && distToSupport < distToResistance) {
      score += srBonus;
      candidateDirection = 'BUY';
      factors.push(`NEAR_SUPPORT(${distToSupport.toFixed(2)}ATR)`);
    } else if (distToResistance < proximityThreshold && distToResistance < distToSupport) {
      score += srBonus;
      candidateDirection = 'SELL';
      factors.push(`NEAR_RESISTANCE(${distToResistance.toFixed(2)}ATR)`);
    }

    const structureBonus = tradeStyle === 'INTRADAY' ? 30 : 25;
    const structurePenalty = tradeStyle === 'INTRADAY' ? 20 : 15;

    const structurePattern = str.toLowerCase();
    if (structurePattern === 'hh' || structurePattern === 'hh_hl') {
      if (!candidateDirection) candidateDirection = 'BUY';
      if (candidateDirection === 'BUY') {
        score += structureBonus;
        factors.push('STRUCTURE_HH_HL');
      } else {
        score -= structurePenalty;
        factors.push('STRUCTURE_VS_SELL');
      }
    } else if (structurePattern === 'll' || structurePattern === 'll_lh') {
      if (!candidateDirection) candidateDirection = 'SELL';
      if (candidateDirection === 'SELL') {
        score += structureBonus;
        factors.push('STRUCTURE_LL_LH');
      } else {
        score -= structurePenalty;
        factors.push('STRUCTURE_VS_BUY');
      }
    }

    if (sensors) {
      const bosBonus = tradeStyle === 'INTRADAY' ? 20 : tradeStyle === 'MICRO_INTRADAY' ? 15 : 12;
      const bosConflictPenalty = tradeStyle === 'INTRADAY' ? 18 : 10;

      if (sensors.bos === 'bull' && candidateDirection === 'BUY') {
        score += bosBonus;
        factors.push('BOS_CONFIRMS_BUY');
      } else if (sensors.bos === 'bear' && candidateDirection === 'SELL') {
        score += bosBonus;
        factors.push('BOS_CONFIRMS_SELL');
      } else if (sensors.bos !== 'none') {
        score -= bosConflictPenalty;
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
      // INTRADAY requires MTF alignment — conflict is a larger penalty
      const mtfBonus = tradeStyle === 'INTRADAY'
        ? CONFIRMATION_THRESHOLDS.MTF_ALIGNMENT_BONUS + 8
        : CONFIRMATION_THRESHOLDS.MTF_ALIGNMENT_BONUS;
      const mtfConflictPenalty = tradeStyle === 'INTRADAY' ? 20 : tradeStyle === 'MICRO_INTRADAY' ? 15 : 10;

      if ((mtfLower.includes('bull') || mtfLower.includes('up')) && candidateDirection === 'BUY') {
        score += mtfBonus;
        factors.push('MTF_ALIGNED_BUY');
      } else if ((mtfLower.includes('bear') || mtfLower.includes('down')) && candidateDirection === 'SELL') {
        score += mtfBonus;
        factors.push('MTF_ALIGNED_SELL');
      } else if (mtfLower.includes('bull') || mtfLower.includes('bear')) {
        score -= mtfConflictPenalty;
        factors.push('MTF_CONFLICT');
      }
    } else if (tradeStyle === 'INTRADAY') {
      // INTRADAY without MTF data is a confirmation gap — apply soft penalty
      score -= 8;
      factors.push('MTF_DATA_MISSING');
    }

    const pullbackBonus = tradeStyle === 'SCALP'
      ? CONFIRMATION_THRESHOLDS.PULLBACK_BONUS
      : tradeStyle === 'MICRO_INTRADAY'
        ? CONFIRMATION_THRESHOLDS.PULLBACK_BONUS + 5
        : CONFIRMATION_THRESHOLDS.PULLBACK_BONUS + 10;

    if (pullback) {
      score += pullbackBonus;
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

    const confirmThreshold = tradeStyle === 'SCALP' ? 30 : tradeStyle === 'MICRO_INTRADAY' ? 35 : 40;
    const leanThreshold = tradeStyle === 'SCALP' ? 12 : 15;

    let bias: string;
    if (!candidateDirection) {
      bias = 'NEUTRAL';
      factors.push('WEAK_LEAN');
    } else if (score >= confirmThreshold) {
      bias = candidateDirection === 'BUY' ? 'CONFIRMED_BULLISH' : 'CONFIRMED_BEARISH';
    } else if (score >= leanThreshold) {
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

    const reasoning = `[DET:${tradeStyle}] Confirmation ${bias} (score: ${score.toFixed(0)}) | ${factors.slice(0, 5).join(', ')}`;

    console.log(`[Omega-3 Confirmation] [DET:${tradeStyle}] Intelligence: ${bias} | Score: ${score.toFixed(0)} | Factors: ${factors.join(', ')}`);

    return {
      reasoning,
      evidence,
      keyFactors: factors
    };
  }
}

export const omegaConfirmation = new OmegaConfirmationBrain();
