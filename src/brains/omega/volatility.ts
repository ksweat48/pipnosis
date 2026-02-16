/**
 * Omega-5 Volatility - DETERMINISTIC ATR & Liquidity Specialist
 *
 * Specializes in:
 * - ATR spikes and compression
 * - Volatility regime changes
 * - Liquidity pockets
 * - Price action smoothness
 * - Erratic movement detection
 *
 * FULLY DETERMINISTIC - NO LLM CALLS
 */

import type { OmegaVote } from '../../types/omega-vote';
import type { OmegaSensors } from '../../services/omega-sensors';
import { analyzeATR, formatATREvidence } from '../../lib/technical-math/atr';
import { analyzeCandleMetrics } from '../../lib/technical-math/candle';
import { VOLATILITY_THRESHOLDS } from '../../config/omega-thresholds';

export interface VolatilitySnapshot {
  atr: number;
  atr_avg: number;
  vol: string;
  c: number[][];
  wick_ratio: number;
  sensors?: OmegaSensors;
  candidateDirection?: 'BUY' | 'SELL'; // TIER 7: Enable directional awareness
  trend?: string; // Market trend for directional hints
  regime?: {
    market_bias?: string;
    volatility_trend?: string;
  };
}

class OmegaVolatilityBrain {
  evaluate(snapshot: VolatilitySnapshot): OmegaVote {
    const { atr, atr_avg, vol, c, wick_ratio, sensors, candidateDirection, trend, regime } = snapshot;

    const atrAnalysis = analyzeATR(atr, atr_avg);

    let score = 0;
    const factors: string[] = [];

    if (!candidateDirection) {
      const trendLower = trend?.toLowerCase() || '';
      const biaslower = regime?.market_bias?.toLowerCase() || '';
      if (trendLower.includes('bear') || biaslower.includes('bear') || biaslower.includes('short')) {
        factors.push('BIAS_BEARISH');
      } else if (trendLower.includes('bull') || biaslower.includes('bull') || biaslower.includes('long')) {
        factors.push('BIAS_BULLISH');
      } else if (regime?.volatility_trend?.toLowerCase().includes('up')) {
        factors.push('VOL_TREND_UP');
      } else {
        factors.push('BIAS_NEUTRAL');
      }
    }

    if (atrAnalysis.regime === 'NORMAL') {
      score += 25;
      factors.push('ATR_NORMAL');
    } else if (atrAnalysis.regime === 'COMPRESSION') {
      score += 15;
      factors.push('ATR_COMPRESSED');
    } else if (atrAnalysis.regime === 'EXPANSION') {
      if (atrAnalysis.expansion > 2.0) {
        score -= 20;
        factors.push('ATR_EXTREME_EXPANSION');
      } else {
        score += 5;
        factors.push('ATR_EXPANDING');
      }
    }

    if (wick_ratio <= 1.0) {
      score += 15;
      factors.push('CLEAN_CANDLES');
    } else if (wick_ratio <= VOLATILITY_THRESHOLDS.WICK_RATIO_HIGH) {
      score += 5;
      factors.push('MODERATE_WICKS');
    } else if (wick_ratio > VOLATILITY_THRESHOLDS.WICK_RATIO_ERRATIC) {
      score -= 25;
      factors.push('ERRATIC_WICKS');
    } else {
      score -= 10;
      factors.push('HIGH_WICKS');
    }

    if (sensors) {
      if (sensors.vol_r === 'mid') {
        score += 10;
        factors.push('VOL_REGIME_MID');
      } else if (sensors.vol_r === 'low') {
        score += 5;
        factors.push('VOL_REGIME_LOW');
      } else if (sensors.vol_r === 'high') {
        score -= 5;
        factors.push('VOL_REGIME_HIGH');
      }

      if (sensors.atr_t === 'flat') {
        score += 10;
        factors.push('ATR_STABLE');
      } else if (sensors.atr_t === 'down') {
        score += 5;
        factors.push('ATR_CONTRACTING');
      }

      if (sensors.vol_s === 1) {
        if (atrAnalysis.regime !== 'EXPANSION') {
          score += 5;
          factors.push('VOL_SPIKE_OPPORTUNITY');
        } else {
          score -= 5;
          factors.push('VOL_SPIKE_CAUTION');
        }
      }
    }

    if (c.length >= 3) {
      let cleanCount = 0;
      for (const candle of c.slice(-3)) {
        if (candle.length >= 4) {
          const metrics = analyzeCandleMetrics(candle[0], candle[1], candle[2], candle[3]);
          if (metrics.bodyRatio > 0.5) {
            cleanCount++;
          }
        }
      }

      if (cleanCount >= 2) {
        score += 10;
        factors.push('CONSISTENT_PA');
      }
    }

    let bias: string;
    if (score >= 35) {
      bias = 'FAVORABLE';
      factors.push('VOL_FAVORABLE');
    } else if (score >= 20) {
      bias = 'ACCEPTABLE';
      factors.push('VOL_ACCEPTABLE');
    } else if (score <= -15) {
      bias = 'UNFAVORABLE';
      factors.push('VOL_UNFAVORABLE');
    } else {
      bias = 'UNCLEAR';
      factors.push('VOL_UNCLEAR');
    }

    const evidence = [
      formatATREvidence(atrAnalysis),
      `WICK_RATIO=${wick_ratio.toFixed(2)}`,
      `VOL_STATE=${vol}`
    ].join('|');

    const reasoning = `[DET] Volatility ${bias} (score: ${score.toFixed(0)}) | ${factors.slice(0, 4).join(', ')}`;

    console.log(`[Omega-5 Volatility] [DET] Intelligence: ${bias} | Score: ${score.toFixed(0)} | Factors: ${factors.join(', ')}`);

    return {
      reasoning,
      evidence,
      keyFactors: factors
    };
  }
}

export const omegaVolatility = new OmegaVolatilityBrain();
