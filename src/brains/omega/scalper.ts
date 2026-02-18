/**
 * Omega-2 Scalper - DETERMINISTIC Quick Entry Specialist
 *
 * Specializes in:
 * - Immediate price action
 * - VWAP positioning
 * - Short-term volatility
 * - Quick entry/exit opportunities
 * - Wick analysis
 *
 * STYLE-AWARE: SCALP weights VWAP proximity and chase risk heavily (primary signal).
 * MICRO_INTRADAY treats VWAP as secondary — M15 structure drives direction.
 * INTRADAY treats VWAP as context only — high chase risk is informational, not disqualifying.
 *
 * FULLY DETERMINISTIC - NO LLM CALLS
 */

import type { OmegaVote } from '../../types/omega-vote';
import type { OmegaSensors } from '../../services/omega-sensors';
import { analyzeVWAP, formatVWAPEvidence, calculateEntryQualityFromVWAP } from '../../lib/technical-math/vwap';
import { calculateChaseRiskScore } from '../../lib/technical-math/atr';
import { detectMomentumBar } from '../../lib/technical-math/candle';
import { SCALPER_THRESHOLDS } from '../../config/omega-thresholds';
import type { OmegaTradeStyle } from './trend';

export interface ScalperSnapshot {
  p: number;
  vw: number;
  atr: number;
  rsi: number;
  vol: string;
  c: number[][];
  sensors?: OmegaSensors;
  momentum?: number;
  tradeStyle?: OmegaTradeStyle;
}

class OmegaScalperBrain {
  evaluate(snapshot: ScalperSnapshot): OmegaVote {
    const { p, vw, atr, rsi, c, sensors, momentum = 0, tradeStyle = 'SCALP' } = snapshot;

    const vwapAnalysis = analyzeVWAP(p, vw, atr);
    const chaseRisk = calculateChaseRiskScore(p, vw, atr, momentum);

    let score = 0;
    const factors: string[] = [];

    factors.push(`STYLE:${tradeStyle}`);

    let candidateDirection: 'BUY' | 'SELL' | null = null;

    if (vwapAnalysis.favorableForBuy && !vwapAnalysis.favorableForSell) {
      candidateDirection = 'BUY';
      factors.push(`VWAP_FAV_BUY(${vwapAnalysis.zone})`);
    } else if (vwapAnalysis.favorableForSell && !vwapAnalysis.favorableForBuy) {
      candidateDirection = 'SELL';
      factors.push(`VWAP_FAV_SELL(${vwapAnalysis.zone})`);
    } else if (vwapAnalysis.favorableForBuy && vwapAnalysis.favorableForSell) {
      if (rsi < 45) {
        candidateDirection = 'BUY';
        factors.push('VWAP_NEAR_RSI_BUY');
      } else if (rsi > 55) {
        candidateDirection = 'SELL';
        factors.push('VWAP_NEAR_RSI_SELL');
      } else if (momentum < 0) {
        candidateDirection = 'BUY';
        factors.push('VWAP_NEAR_MOM_BUY');
      } else if (momentum > 0) {
        candidateDirection = 'SELL';
        factors.push('VWAP_NEAR_MOM_SELL');
      } else if (sensors?.bos === 'bull') {
        candidateDirection = 'BUY';
        factors.push('VWAP_NEAR_BOS_BUY');
      } else if (sensors?.bos === 'bear') {
        candidateDirection = 'SELL';
        factors.push('VWAP_NEAR_BOS_SELL');
      }
    }

    if (candidateDirection) {
      const entryQuality = calculateEntryQualityFromVWAP(vwapAnalysis, candidateDirection);
      // SCALP: VWAP entry quality is the primary signal — full weight
      // MICRO_INTRADAY: VWAP is secondary — reduced weight (M15 structure is primary)
      // INTRADAY: VWAP is context only — minimal weight
      const vwapWeight = tradeStyle === 'SCALP' ? 1.0 : tradeStyle === 'MICRO_INTRADAY' ? 0.6 : 0.3;
      score += (entryQuality - 50) * vwapWeight;
      factors.push(`ENTRY_Q=${entryQuality}(w=${vwapWeight})`);
    }

    // Chase risk — SCALP treats it as disqualifying, INTRADAY treats it as informational
    if (chaseRisk.level === 'HIGH') {
      const chasepenalty = tradeStyle === 'SCALP' ? 25 : tradeStyle === 'MICRO_INTRADAY' ? 15 : 8;
      score -= chasepenalty;
      factors.push(`CHASE_HIGH(-${chasepenalty})`);
    } else if (chaseRisk.level === 'MEDIUM') {
      const chasePenalty = tradeStyle === 'SCALP' ? 10 : 5;
      score -= chasePenalty;
      factors.push('CHASE_MED');
    } else {
      const chaseBonus = tradeStyle === 'SCALP' ? 10 : 6;
      score += chaseBonus;
      factors.push('CHASE_LOW');
    }

    if (rsi > SCALPER_THRESHOLDS.RSI_OVERBOUGHT) {
      if (candidateDirection === 'BUY') {
        score -= 15;
        factors.push('RSI_OB_VS_BUY');
      } else {
        score += 10;
        factors.push('RSI_OB_FAV_SELL');
      }
    } else if (rsi < SCALPER_THRESHOLDS.RSI_OVERSOLD) {
      if (candidateDirection === 'SELL') {
        score -= 15;
        factors.push('RSI_OS_VS_SELL');
      } else {
        score += 10;
        factors.push('RSI_OS_FAV_BUY');
      }
    }

    if (c.length >= 1) {
      const lastCandle = c[c.length - 1];
      if (lastCandle.length >= 4) {
        const hasMomentum = detectMomentumBar(
          { open: lastCandle[0], high: lastCandle[1], low: lastCandle[2], close: lastCandle[3] },
          atr
        );
        if (hasMomentum) {
          const isBullish = lastCandle[3] > lastCandle[0];
          const momBonus = tradeStyle === 'SCALP' ? 10 : 7;
          if (isBullish && candidateDirection === 'BUY') {
            score += momBonus;
            factors.push('MOM_BAR_BULL');
          } else if (!isBullish && candidateDirection === 'SELL') {
            score += momBonus;
            factors.push('MOM_BAR_BEAR');
          }
        }
      }
    }

    if (sensors) {
      if (sensors.vol_s === 1) {
        score += 8;
        factors.push('VOL_SPIKE');
      }

      if (sensors.pat.mom === 1) {
        score += 5;
        factors.push('SENSOR_MOM');
      }

      // Pullback bonus — SCALP benefits most from recent pullback completion
      if (sensors.mic.pull > 0 && sensors.mic.pull <= 3) {
        const pullBonus = tradeStyle === 'SCALP' ? 8 : tradeStyle === 'MICRO_INTRADAY' ? 6 : 4;
        score += pullBonus;
        factors.push(`PULLBACK(${sensors.mic.pull})`);
      }
    }

    let bias: string;
    if (!candidateDirection) {
      bias = 'NEUTRAL';
      factors.push('WEAK_LEAN');
    } else if (score >= 20) {
      bias = candidateDirection === 'BUY' ? 'BULLISH' : 'BEARISH';
    } else if (score <= -15) {
      bias = 'UNFAVORABLE';
      factors.push('CONTRARY_LEAN');
    } else {
      bias = candidateDirection === 'BUY' ? 'LEAN_BULLISH' : 'LEAN_BEARISH';
      factors.push('WEAK_LEAN');
    }

    const evidence = [
      formatVWAPEvidence(vwapAnalysis),
      `CHASE=${chaseRisk.level}`,
      `RSI=${rsi}`
    ].join('|');

    const reasoning = `[DET:${tradeStyle}] Scalper ${bias} (score: ${score.toFixed(0)}) | ${factors.slice(0, 5).join(', ')}`;

    console.log(`[Omega-2 Scalper] [DET:${tradeStyle}] Intelligence: ${bias} | Score: ${score.toFixed(0)} | Factors: ${factors.join(', ')}`);

    return {
      reasoning,
      evidence,
      keyFactors: factors
    };
  }
}

export const omegaScalper = new OmegaScalperBrain();
