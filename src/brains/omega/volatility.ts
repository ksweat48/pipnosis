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
 * STYLE-AWARE: SCALP requires tight ATR compression — expansion is unfavorable.
 * MICRO_INTRADAY accepts normal-to-mild expansion — extreme compression is a caution.
 * INTRADAY requires moderate ATR expansion — flat or compressed ATR signals no campaign range.
 *
 * FULLY DETERMINISTIC - NO LLM CALLS
 */

import type { OmegaVote } from '../../types/omega-vote';
import type { OmegaSensors } from '../../services/omega-sensors';
import { analyzeATR, formatATREvidence } from '../../lib/technical-math/atr';
import { analyzeCandleMetrics } from '../../lib/technical-math/candle';
import { VOLATILITY_THRESHOLDS } from '../../config/omega-thresholds';
import type { OmegaTradeStyle } from './trend';

export interface VolatilitySnapshot {
  atr: number;
  atr_avg: number;
  vol: string;
  c: number[][];
  wick_ratio: number;
  sensors?: OmegaSensors;
  candidateDirection?: 'BUY' | 'SELL';
  trend?: string;
  regime?: {
    market_bias?: string;
    volatility_trend?: string;
  };
  tradeStyle?: OmegaTradeStyle;
}

class OmegaVolatilityBrain {
  evaluate(snapshot: VolatilitySnapshot): OmegaVote {
    const { atr, atr_avg, vol, c, wick_ratio, sensors, candidateDirection, trend, regime, tradeStyle = 'SCALP' } = snapshot;

    const atrAnalysis = analyzeATR(atr, atr_avg);

    let score = 0;
    const factors: string[] = [];

    factors.push(`STYLE:${tradeStyle}`);

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

    // ATR regime scoring is style-dependent:
    // SCALP: Compression is optimal (tight range = controllable risk), expansion is a warning
    // MICRO_INTRADAY: Normal is optimal, mild expansion is acceptable
    // INTRADAY: Expansion is required for campaign range, flat/compressed ATR is a penalty
    if (atrAnalysis.regime === 'NORMAL') {
      if (tradeStyle === 'INTRADAY') {
        score += 15;
        factors.push('ATR_NORMAL');
      } else {
        score += 25;
        factors.push('ATR_NORMAL');
      }
    } else if (atrAnalysis.regime === 'COMPRESSION') {
      if (tradeStyle === 'SCALP') {
        score += 20;
        factors.push('ATR_COMPRESSED_SCALP_FAVORABLE');
      } else if (tradeStyle === 'MICRO_INTRADAY') {
        score += 10;
        factors.push('ATR_COMPRESSED_CAUTION');
      } else {
        // INTRADAY: compression means no campaign range
        score -= 15;
        factors.push('ATR_COMPRESSED_INTRADAY_PENALTY');
      }
    } else if (atrAnalysis.regime === 'EXPANSION') {
      if (atrAnalysis.expansion > 2.0) {
        // Extreme expansion is bad for all styles
        score -= 20;
        factors.push('ATR_EXTREME_EXPANSION');
      } else if (tradeStyle === 'SCALP') {
        // Expansion on scalp = unpredictable range
        score -= 10;
        factors.push('ATR_EXPANDING_SCALP_CAUTION');
      } else if (tradeStyle === 'MICRO_INTRADAY') {
        score += 5;
        factors.push('ATR_EXPANDING');
      } else {
        // INTRADAY: moderate expansion is the ideal condition
        score += 15;
        factors.push('ATR_EXPANDING_INTRADAY_FAVORABLE');
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
        score += tradeStyle === 'INTRADAY' ? 12 : 10;
        factors.push('VOL_REGIME_MID');
      } else if (sensors.vol_r === 'low') {
        const lowBonus = tradeStyle === 'SCALP' ? 10 : tradeStyle === 'INTRADAY' ? -5 : 5;
        score += lowBonus;
        factors.push(`VOL_REGIME_LOW(${lowBonus > 0 ? '+' : ''}${lowBonus})`);
      } else if (sensors.vol_r === 'high') {
        const highPenalty = tradeStyle === 'SCALP' ? -10 : tradeStyle === 'INTRADAY' ? 5 : -5;
        score += highPenalty;
        factors.push(`VOL_REGIME_HIGH(${highPenalty > 0 ? '+' : ''}${highPenalty})`);
      }

      if (sensors.atr_t === 'flat') {
        const flatBonus = tradeStyle === 'SCALP' ? 12 : tradeStyle === 'INTRADAY' ? -8 : 10;
        score += flatBonus;
        factors.push(`ATR_STABLE(${flatBonus > 0 ? '+' : ''}${flatBonus})`);
      } else if (sensors.atr_t === 'down') {
        const downBonus = tradeStyle === 'SCALP' ? 8 : tradeStyle === 'INTRADAY' ? -5 : 5;
        score += downBonus;
        factors.push('ATR_CONTRACTING');
      } else if (sensors.atr_t === 'up' && tradeStyle === 'INTRADAY') {
        score += 8;
        factors.push('ATR_BUILDING_INTRADAY');
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

    const favorableThreshold = tradeStyle === 'INTRADAY' ? 30 : 35;
    const acceptableThreshold = tradeStyle === 'INTRADAY' ? 15 : 20;

    let bias: string;
    if (score >= favorableThreshold) {
      bias = 'FAVORABLE';
      factors.push('VOL_FAVORABLE');
    } else if (score >= acceptableThreshold) {
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

    const reasoning = `[DET:${tradeStyle}] Volatility ${bias} (score: ${score.toFixed(0)}) | ${factors.slice(0, 5).join(', ')}`;

    console.log(`[Omega-5 Volatility] [DET:${tradeStyle}] Intelligence: ${bias} | Score: ${score.toFixed(0)} | Factors: ${factors.join(', ')}`);

    return {
      reasoning,
      evidence,
      keyFactors: factors
    };
  }
}

export const omegaVolatility = new OmegaVolatilityBrain();
