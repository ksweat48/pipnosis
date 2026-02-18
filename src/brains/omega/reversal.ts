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
 * STYLE-AWARE: SCALP ignores multi-session divergences — only immediate RSI extremes and
 * single-candle patterns (pin bar, engulfing) matter at this timeframe.
 * MICRO_INTRADAY treats divergences as moderate confirmation signals.
 * INTRADAY requires HTF divergence confirmation — single-candle patterns alone are insufficient.
 *
 * FULLY DETERMINISTIC - NO LLM CALLS
 */

import type { OmegaVote } from '../../types/omega-vote';
import type { OmegaSensors } from '../../services/omega-sensors';
import { calculateExhaustion } from '../../lib/technical-math/candle';
import { REVERSAL_THRESHOLDS } from '../../config/omega-thresholds';
import type { OmegaTradeStyle } from './trend';

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
  tradeStyle?: OmegaTradeStyle;
}

class OmegaReversalBrain {
  evaluate(snapshot: ReversalSnapshot): OmegaVote {
    const { rsi, st, mom, tr, sensors, recentCandles = [], tradeStyle = 'SCALP' } = snapshot;

    let score = 0;
    const factors: string[] = [];
    let candidateDirection: 'BUY' | 'SELL' | null = null;

    factors.push(`STYLE:${tradeStyle}`);

    // RSI extremes — SCALP uses tighter extremes (immediate overbought/oversold matters more)
    const rsiExtremeHigh = tradeStyle === 'SCALP'
      ? REVERSAL_THRESHOLDS.RSI_EXTREME_HIGH - 5
      : REVERSAL_THRESHOLDS.RSI_EXTREME_HIGH;
    const rsiExtremeLow = tradeStyle === 'SCALP'
      ? REVERSAL_THRESHOLDS.RSI_EXTREME_LOW + 5
      : REVERSAL_THRESHOLDS.RSI_EXTREME_LOW;

    const rsiExtremeBonus = tradeStyle === 'SCALP' ? 25 : 20;

    if (rsi >= rsiExtremeHigh) {
      score += rsiExtremeBonus;
      candidateDirection = 'SELL';
      factors.push(`RSI_EXTREME_HIGH(${rsi})`);
    } else if (rsi <= rsiExtremeLow) {
      score += rsiExtremeBonus;
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
      // INTRADAY requires HTF divergence — weight it higher
      // SCALP: divergences are informational only (takes time to develop, scalp is over)
      const divWeight = tradeStyle === 'INTRADAY' ? 1.4 : tradeStyle === 'MICRO_INTRADAY' ? 1.1 : 0.7;

      if (sensors.rdiv === 'bull') {
        score += Math.round(REVERSAL_THRESHOLDS.DIVERGENCE_STRONG_BONUS * divWeight);
        if (!candidateDirection) candidateDirection = 'BUY';
        factors.push('RSI_DIV_BULL');
      } else if (sensors.rdiv === 'bear') {
        score += Math.round(REVERSAL_THRESHOLDS.DIVERGENCE_STRONG_BONUS * divWeight);
        if (!candidateDirection) candidateDirection = 'SELL';
        factors.push('RSI_DIV_BEAR');
      }

      if (sensors.mdiv === 'bull') {
        score += Math.round(REVERSAL_THRESHOLDS.DIVERGENCE_MODERATE_BONUS * divWeight);
        if (!candidateDirection) candidateDirection = 'BUY';
        factors.push('MACD_DIV_BULL');
      } else if (sensors.mdiv === 'bear') {
        score += Math.round(REVERSAL_THRESHOLDS.DIVERGENCE_MODERATE_BONUS * divWeight);
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

      // Candle patterns — SCALP weights these highly (immediate price action)
      // INTRADAY alone, a single pin bar is insufficient — needs divergence confirmation
      const patternWeight = tradeStyle === 'SCALP' ? 1.3 : tradeStyle === 'MICRO_INTRADAY' ? 1.0 : 0.6;

      if (sensors.pat.pin_b === 1) {
        score += Math.round(REVERSAL_THRESHOLDS.PATTERN_BONUS * patternWeight);
        if (!candidateDirection) candidateDirection = 'BUY';
        factors.push('PIN_BAR_BULL');
      } else if (sensors.pat.pin_s === 1) {
        score += Math.round(REVERSAL_THRESHOLDS.PATTERN_BONUS * patternWeight);
        if (!candidateDirection) candidateDirection = 'SELL';
        factors.push('PIN_BAR_BEAR');
      }

      if (sensors.pat.eng_b === 1) {
        score += Math.round(REVERSAL_THRESHOLDS.PATTERN_BONUS * patternWeight);
        if (!candidateDirection) candidateDirection = 'BUY';
        factors.push('ENGULF_BULL');
      } else if (sensors.pat.eng_s === 1) {
        score += Math.round(REVERSAL_THRESHOLDS.PATTERN_BONUS * patternWeight);
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

    // INTRADAY: solo candle patterns without divergence are insufficient confirmation
    if (tradeStyle === 'INTRADAY' && candidateDirection && !factors.some(f => f.includes('DIV'))) {
      score -= 10;
      factors.push('INTRADAY_NO_DIVERGENCE_PENALTY');
    }

    const strongThreshold = tradeStyle === 'INTRADAY' ? 40 : 35;
    const moderateThreshold = tradeStyle === 'INTRADAY' ? 25 : 20;

    let bias: string;
    if (!candidateDirection) {
      bias = 'NO_REVERSAL';
      factors.push('WEAK_LEAN');
    } else if (score >= strongThreshold) {
      bias = candidateDirection === 'BUY' ? 'STRONG_BULLISH_REVERSAL' : 'STRONG_BEARISH_REVERSAL';
    } else if (score >= moderateThreshold) {
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

    const reasoning = `[DET:${tradeStyle}] Reversal ${bias} (score: ${score.toFixed(0)}) | ${factors.slice(0, 5).join(', ')}`;

    console.log(`[Omega-4 Reversal] [DET:${tradeStyle}] Intelligence: ${bias} | Score: ${score.toFixed(0)} | Factors: ${factors.join(', ')}`);

    return {
      reasoning,
      evidence,
      keyFactors: factors
    };
  }
}

export const omegaReversal = new OmegaReversalBrain();
