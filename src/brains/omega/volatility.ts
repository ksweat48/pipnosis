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

    // TIER 7: Determine candidate direction from market context if not provided
    let tradeDirection: 'BUY' | 'SELL' = candidateDirection || 'BUY'; // Default fallback

    if (!candidateDirection) {
      // Infer from trend or regime bias
      const trendLower = trend?.toLowerCase() || '';
      const biaslower = regime?.market_bias?.toLowerCase() || '';

      if (trendLower.includes('bear') || biaslower.includes('bear') || biaslower.includes('short')) {
        tradeDirection = 'SELL';
        factors.push('BIAS_BEARISH');
      } else if (trendLower.includes('bull') || biaslower.includes('bull') || biaslower.includes('long')) {
        tradeDirection = 'BUY';
        factors.push('BIAS_BULLISH');
      } else {
        // Neutral/sideways: favor compression breakouts in volatility expansion direction
        if (regime?.volatility_trend?.toLowerCase().includes('up')) {
          tradeDirection = 'BUY'; // Rising volatility often favors continuation
          factors.push('VOL_TREND_UP');
        } else {
          tradeDirection = 'BUY'; // Default when no clear direction
          factors.push('BIAS_NEUTRAL');
        }
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

    let vote: 'BUY' | 'SELL' | 'NO_TRADE';
    let confidence: number;

    // TIER 7 FIX: Vote in the determined trade direction (BUY/SELL) if volatility is favorable
    if (score >= 35) {
      vote = tradeDirection; // Vote in candidate direction
      confidence = Math.min(90, 55 + score * 0.6);
      factors.push('VOL_FAVORABLE');
    } else if (score >= 20) {
      vote = tradeDirection; // Vote in candidate direction
      confidence = Math.min(70, 45 + score * 0.5);
      factors.push('VOL_ACCEPTABLE');
    } else if (score <= -15) {
      vote = 'NO_TRADE';
      confidence = Math.max(20, 35 - Math.abs(score));
      factors.push('VOL_UNFAVORABLE');
    } else {
      vote = 'NO_TRADE';
      confidence = 40;
      factors.push('VOL_UNCLEAR');
    }

    if (vote !== 'NO_TRADE' && confidence < VOLATILITY_THRESHOLDS.MIN_CONFIDENCE_FOR_TRADE) {
      vote = 'NO_TRADE';
      factors.push('BELOW_MIN_CONF');
    }

    const evidence = [
      formatATREvidence(atrAnalysis),
      `WICK_RATIO=${wick_ratio.toFixed(2)}`,
      `VOL_STATE=${vol}`
    ].join('|');

    const reasoning = `[DET] ${vote} @ ${confidence}% | ${factors.slice(0, 4).join(', ')}`;

    console.log(`[Omega-5 Volatility] [DET] Vote: ${vote} | Confidence: ${confidence}% | Factors: ${factors.join(', ')}`);

    return {
      vote,
      confidence: Math.round(confidence),
      reasoning,
      evidence,
      keyFactors: factors
    };
  }
}

export const omegaVolatility = new OmegaVolatilityBrain();
