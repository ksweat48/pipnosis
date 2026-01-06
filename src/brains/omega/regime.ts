/**
 * Omega-7 Market Regime - DETERMINISTIC Regime Classification Specialist
 *
 * Specializes in:
 * - Market regime classification (trending/ranging/mixed)
 * - Volatility regime detection
 * - Session timing awareness
 * - Price location analysis
 *
 * FULLY DETERMINISTIC - NO LLM CALLS
 */

import type { OmegaVote } from '../../types/omega-vote';
import type { OmegaSensors } from '../../services/omega-sensors';
import { REGIME_THRESHOLDS } from '../../config/omega-thresholds';

export interface RegimeSnapshot {
  p: number;
  e20: number;
  e50: number;
  e200: number;
  atr: number;
  atr_avg: number;
  tr: string;
  vol: string;
  sensors?: OmegaSensors;
  recentHighs?: number[];
  recentLows?: number[];
  sessionHour?: number;
}

export type RegimeType = 'trending_up' | 'trending_down' | 'ranging' | 'mixed';
export type VolatilityRegime = 'low' | 'medium' | 'high' | 'extreme';

export interface RegimeAnalysis {
  regimeType: RegimeType;
  volatilityRegime: VolatilityRegime;
  trendStrength: number;
  priceLocation: 'near_high' | 'near_low' | 'middle';
  sessionFavorability: number;
}

class OmegaRegimeBrain {
  evaluate(snapshot: RegimeSnapshot): OmegaVote {
    const analysis = this.analyzeRegime(snapshot);

    let score = 0;
    const factors: string[] = [];

    if (analysis.regimeType === 'trending_up') {
      score += 25;
      factors.push('REGIME_TREND_UP');
    } else if (analysis.regimeType === 'trending_down') {
      score -= 25;
      factors.push('REGIME_TREND_DOWN');
    } else if (analysis.regimeType === 'ranging') {
      factors.push('REGIME_RANGING');
    } else {
      score -= 10;
      factors.push('REGIME_MIXED');
    }

    if (analysis.volatilityRegime === 'medium') {
      score += 15;
      factors.push('VOL_OPTIMAL');
    } else if (analysis.volatilityRegime === 'low') {
      score += 5;
      factors.push('VOL_LOW');
    } else if (analysis.volatilityRegime === 'high') {
      score -= 5;
      factors.push('VOL_HIGH');
    } else if (analysis.volatilityRegime === 'extreme') {
      score -= 20;
      factors.push('VOL_EXTREME');
    }

    if (analysis.trendStrength >= REGIME_THRESHOLDS.STRONG_TREND_THRESHOLD) {
      const bonus = analysis.regimeType.includes('up') ? 15 : -15;
      score += bonus;
      factors.push('TREND_STRONG');
    } else if (analysis.trendStrength <= REGIME_THRESHOLDS.WEAK_TREND_THRESHOLD) {
      factors.push('TREND_WEAK');
    }

    if (analysis.regimeType === 'trending_up' && analysis.priceLocation === 'near_low') {
      score += 10;
      factors.push('PULLBACK_IN_UPTREND');
    } else if (analysis.regimeType === 'trending_down' && analysis.priceLocation === 'near_high') {
      score -= 10;
      factors.push('RALLY_IN_DOWNTREND');
    }

    score += analysis.sessionFavorability;
    if (analysis.sessionFavorability >= 10) {
      factors.push('SESSION_OPTIMAL');
    } else if (analysis.sessionFavorability <= -5) {
      factors.push('SESSION_SUBOPTIMAL');
    }

    if (snapshot.sensors) {
      if (snapshot.sensors.bos === 'bull' && analysis.regimeType === 'trending_up') {
        score += 10;
        factors.push('BOS_CONFIRMS_REGIME');
      } else if (snapshot.sensors.bos === 'bear' && analysis.regimeType === 'trending_down') {
        score -= 10;
        factors.push('BOS_CONFIRMS_REGIME');
      }
    }

    let vote: 'BUY' | 'SELL' | 'NO_TRADE';
    let confidence: number;

    if (score >= 30) {
      vote = 'BUY';
      confidence = Math.min(90, 50 + score);
      factors.push('REGIME_FAV_BUY');
    } else if (score <= -30) {
      vote = 'SELL';
      confidence = Math.min(90, 50 + Math.abs(score));
      factors.push('REGIME_FAV_SELL');
    } else if (analysis.volatilityRegime === 'extreme' || analysis.regimeType === 'mixed') {
      vote = 'NO_TRADE';
      confidence = Math.max(30, 50 - Math.abs(score));
      factors.push('REGIME_UNFAVORABLE');
    } else {
      vote = 'NO_TRADE';
      confidence = 45;
      factors.push('REGIME_NEUTRAL');
    }

    if (vote !== 'NO_TRADE' && confidence < REGIME_THRESHOLDS.MIN_CONFIDENCE_FOR_TRADE) {
      vote = 'NO_TRADE';
      factors.push('BELOW_MIN_CONF');
    }

    const evidence = this.buildEvidence(analysis);
    const reasoning = `[DET] ${vote} @ ${confidence}% | ${factors.slice(0, 4).join(', ')}`;

    console.log(`[Omega-7 Regime] [DET] Vote: ${vote} | Confidence: ${confidence}% | Regime: ${analysis.regimeType} | Vol: ${analysis.volatilityRegime}`);

    return {
      vote,
      confidence: Math.round(confidence),
      reasoning,
      evidence,
      keyFactors: factors
    };
  }

  private analyzeRegime(snapshot: RegimeSnapshot): RegimeAnalysis {
    const regimeType = this.classifyRegimeType(snapshot);
    const volatilityRegime = this.classifyVolatility(snapshot);
    const trendStrength = this.calculateTrendStrength(snapshot);
    const priceLocation = this.analyzePriceLocation(snapshot);
    const sessionFavorability = this.assessSessionFavorability(snapshot.sessionHour);

    return {
      regimeType,
      volatilityRegime,
      trendStrength,
      priceLocation,
      sessionFavorability
    };
  }

  private classifyRegimeType(snapshot: RegimeSnapshot): RegimeType {
    const { p, e20, e50, e200, tr } = snapshot;

    const bullStack = p > e20 && e20 > e50 && e50 > e200;
    const bearStack = p < e20 && e20 < e50 && e50 < e200;

    const trendLower = tr.toLowerCase();

    if (bullStack && (trendLower === 'bull' || trendLower === 'up')) {
      return 'trending_up';
    }

    if (bearStack && (trendLower === 'bear' || trendLower === 'down')) {
      return 'trending_down';
    }

    const priceNearEma20 = Math.abs(p - e20) / e20 < 0.005;
    const ema20NearEma50 = Math.abs(e20 - e50) / e50 < 0.003;

    if (priceNearEma20 && ema20NearEma50) {
      return 'ranging';
    }

    return 'mixed';
  }

  private classifyVolatility(snapshot: RegimeSnapshot): VolatilityRegime {
    const { atr, atr_avg, vol, sensors } = snapshot;

    const atrRatio = atr_avg > 0 ? atr / atr_avg : 1;

    if (sensors?.vol_r) {
      const volR = sensors.vol_r;
      if (volR === 'low') return 'low';
      if (volR === 'mid') return 'medium';
      if (volR === 'high') {
        return atrRatio > 1.5 ? 'extreme' : 'high';
      }
    }

    if (atrRatio > 2.0) return 'extreme';
    if (atrRatio > 1.3) return 'high';
    if (atrRatio < 0.7) return 'low';
    return 'medium';
  }

  private calculateTrendStrength(snapshot: RegimeSnapshot): number {
    const { p, e20, e50, e200 } = snapshot;

    let strength = 0;

    const distFromE20 = Math.abs(p - e20) / e20;
    const distFromE50 = Math.abs(p - e50) / e50;
    const distFromE200 = Math.abs(p - e200) / e200;

    strength += Math.min(30, distFromE20 * 1000);
    strength += Math.min(30, distFromE50 * 500);
    strength += Math.min(40, distFromE200 * 300);

    return Math.min(100, Math.max(0, strength));
  }

  private analyzePriceLocation(snapshot: RegimeSnapshot): 'near_high' | 'near_low' | 'middle' {
    const { recentHighs, recentLows, p } = snapshot;

    if (!recentHighs?.length || !recentLows?.length) {
      return 'middle';
    }

    const rangeHigh = Math.max(...recentHighs);
    const rangeLow = Math.min(...recentLows);
    const rangeSize = rangeHigh - rangeLow;

    if (rangeSize === 0) return 'middle';

    const positionInRange = (p - rangeLow) / rangeSize;

    if (positionInRange > 0.7) return 'near_high';
    if (positionInRange < 0.3) return 'near_low';
    return 'middle';
  }

  private assessSessionFavorability(sessionHour?: number): number {
    if (sessionHour === undefined) {
      const now = new Date();
      sessionHour = now.getUTCHours();
    }

    if (sessionHour >= 13 && sessionHour < 17) {
      return 15;
    }

    if (sessionHour >= 8 && sessionHour < 13) {
      return 10;
    }

    if (sessionHour >= 13 && sessionHour < 22) {
      return 8;
    }

    return -5;
  }

  private buildEvidence(analysis: RegimeAnalysis): string {
    return [
      `REGIME=${analysis.regimeType}`,
      `VOL=${analysis.volatilityRegime}`,
      `STR=${analysis.trendStrength.toFixed(0)}`,
      `LOC=${analysis.priceLocation}`,
      `SESS=${analysis.sessionFavorability}`
    ].join('|');
  }
}

export const omegaRegime = new OmegaRegimeBrain();
