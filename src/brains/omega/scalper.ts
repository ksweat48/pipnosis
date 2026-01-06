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
 * FULLY DETERMINISTIC - NO LLM CALLS
 */

import type { OmegaVote } from '../../types/omega-vote';
import type { OmegaSensors } from '../../services/omega-sensors';
import { analyzeVWAP, formatVWAPEvidence, calculateEntryQualityFromVWAP } from '../../lib/technical-math/vwap';
import { calculateChaseRiskScore } from '../../lib/technical-math/atr';
import { detectMomentumBar } from '../../lib/technical-math/candle';
import { SCALPER_THRESHOLDS } from '../../config/omega-thresholds';

export interface ScalperSnapshot {
  p: number;
  vw: number;
  atr: number;
  rsi: number;
  vol: string;
  c: number[][];
  sensors?: OmegaSensors;
  momentum?: number;
}

class OmegaScalperBrain {
  evaluate(snapshot: ScalperSnapshot): OmegaVote {
    const { p, vw, atr, rsi, c, sensors, momentum = 0 } = snapshot;

    const vwapAnalysis = analyzeVWAP(p, vw, atr);
    const chaseRisk = calculateChaseRiskScore(p, vw, atr, momentum);

    let score = 0;
    const factors: string[] = [];

    let candidateDirection: 'BUY' | 'SELL' | null = null;

    if (vwapAnalysis.favorableForBuy && !vwapAnalysis.favorableForSell) {
      candidateDirection = 'BUY';
      factors.push(`VWAP_FAV_BUY(${vwapAnalysis.zone})`);
    } else if (vwapAnalysis.favorableForSell && !vwapAnalysis.favorableForBuy) {
      candidateDirection = 'SELL';
      factors.push(`VWAP_FAV_SELL(${vwapAnalysis.zone})`);
    }

    if (candidateDirection) {
      const entryQuality = calculateEntryQualityFromVWAP(vwapAnalysis, candidateDirection);
      score += entryQuality - 50;
      factors.push(`ENTRY_Q=${entryQuality}`);
    }

    if (chaseRisk.level === 'HIGH') {
      score -= 25;
      factors.push('CHASE_HIGH');
    } else if (chaseRisk.level === 'MEDIUM') {
      score -= 10;
      factors.push('CHASE_MED');
    } else {
      score += 10;
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
          if (isBullish && candidateDirection === 'BUY') {
            score += 10;
            factors.push('MOM_BAR_BULL');
          } else if (!isBullish && candidateDirection === 'SELL') {
            score += 10;
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

      if (sensors.mic.pull > 0 && sensors.mic.pull <= 3) {
        score += 8;
        factors.push(`PULLBACK(${sensors.mic.pull})`);
      }
    }

    let vote: 'BUY' | 'SELL' | 'NO_TRADE';
    let confidence: number;

    if (!candidateDirection) {
      vote = 'NO_TRADE';
      confidence = 30;
      factors.push('NO_CLEAR_DIR');
    } else if (score >= 20) {
      vote = candidateDirection;
      confidence = Math.min(90, 55 + score);
    } else if (score <= -15) {
      vote = 'NO_TRADE';
      confidence = Math.max(25, 40 - Math.abs(score));
      factors.push('UNFAVORABLE');
    } else {
      vote = 'NO_TRADE';
      confidence = 40;
      factors.push('UNCLEAR');
    }

    if (vote !== 'NO_TRADE' && confidence < SCALPER_THRESHOLDS.MIN_CONFIDENCE_FOR_TRADE) {
      vote = 'NO_TRADE';
      factors.push('BELOW_MIN_CONF');
    }

    const evidence = [
      formatVWAPEvidence(vwapAnalysis),
      `CHASE=${chaseRisk.level}`,
      `RSI=${rsi}`
    ].join('|');

    const reasoning = `[DET] ${vote} @ ${confidence}% | ${factors.slice(0, 4).join(', ')}`;

    console.log(`[Omega-2 Scalper] [DET] Vote: ${vote} | Confidence: ${confidence}% | Factors: ${factors.join(', ')}`);

    return {
      vote,
      confidence: Math.round(confidence),
      reasoning,
      evidence,
      keyFactors: factors
    };
  }
}

export const omegaScalper = new OmegaScalperBrain();
