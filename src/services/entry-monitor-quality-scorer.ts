/**
 * Entry Monitor Quality Scorer
 *
 * DETERMINISTIC entry quality scoring for Entry Monitor mode.
 * This scorer is used during ENTRY_MONITOR_ACTIVE state where ZERO LLM calls are allowed.
 *
 * Key Design Principles:
 * 1. Pure mathematical calculations - NO LLM involvement
 * 2. Style-specific weights (SCALP, MICRO, INTRADAY)
 * 3. Fast execution (< 10ms) for 2-5 second polling
 * 4. Detailed breakdown for debugging
 *
 * The EQS determines WHEN to execute, not IF. Alpha's directional signal is trusted.
 * Only two outcomes: EXECUTE_NOW or CONTINUE_WAITING.
 */

import { analyzeCandleMetrics, CandleMetrics } from '../lib/technical-math/candle';
import { analyzeVWAP, VWAPAnalysis } from '../lib/technical-math/vwap';
import { calculateEMAAlignment, calculateEMASlope, EMAAlignment, EMASlope } from '../lib/technical-math/ema';

export type TradeStyle = 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY';
export type TradeDirection = 'BUY' | 'SELL';

export interface CandleData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  time?: number;
}

export interface MarketContext {
  currentPrice: number;
  vwap?: number;
  ema20?: number;
  ema50?: number;
  ema200?: number;
  atr: number;
  recentCandles: CandleData[];
  m15SupportResistance?: { support: number; resistance: number };
}

export interface EQSComponentScores {
  acceptance: number;
  vwapInteraction: number;
  microstructure: number;
  pullback: number;
  emaAlign: number;
  compression: number;
  location: number;
  trendAlign: number;
}

export interface EQSBreakdownDetails {
  acceptance: {
    bodyPercent: number;
    consecutiveCloses: number;
    closePosition: number;
    rangeExpansion: boolean;
  };
  vwapInteraction: {
    distanceATR: number;
    zone: string;
    favorable: boolean;
  };
  microstructure: {
    wickImbalance: number;
    momentumBar: boolean;
    rejectionPattern: boolean;
  };
  pullback: {
    depth: number;
    grade: string;
    impulseIdentified: boolean;
  };
  emaAlign: {
    stack: string;
    slopeDirection: string;
    directionMatch: boolean;
  };
  compression: {
    detected: boolean;
    expansionFollows: boolean;
  };
  location: {
    nearSupport: boolean;
    nearResistance: boolean;
    midRange: boolean;
  };
}

export interface EntryQualityResult {
  score: number;
  decision: 'EXECUTE_NOW' | 'CONTINUE_WAITING' | 'ABANDON_INTENT';
  componentScores: EQSComponentScores;
  breakdown: EQSBreakdownDetails;
  threshold: number;
  reasoning: string;
  executionReady: boolean;
}

const STYLE_WEIGHTS: Record<TradeStyle, Record<string, number>> = {
  SCALP: {
    acceptance: 30,
    vwapInteraction: 25,
    microstructure: 20,
    pullback: 15,
    emaAlign: 10
  },
  MICRO_INTRADAY: {
    pullback: 25,
    acceptance: 25,
    location: 20,
    vwapInteraction: 15,
    compression: 15
  },
  INTRADAY: {
    location: 30,
    pullback: 25,
    acceptance: 20,
    trendAlign: 15,
    vwapInteraction: 10
  }
};

const STYLE_THRESHOLDS: Record<TradeStyle, number> = {
  SCALP: 70,
  MICRO_INTRADAY: 65,
  INTRADAY: 60
};

export class EntryMonitorQualityScorer {
  private style: TradeStyle;
  private direction: TradeDirection;
  private entryZoneMin: number;
  private entryZoneMax: number;

  constructor(
    style: TradeStyle,
    direction: TradeDirection,
    entryZoneMin: number,
    entryZoneMax: number
  ) {
    this.style = style;
    this.direction = direction;
    this.entryZoneMin = entryZoneMin;
    this.entryZoneMax = entryZoneMax;
  }

  calculate(context: MarketContext): EntryQualityResult {
    const weights = STYLE_WEIGHTS[this.style];
    const threshold = STYLE_THRESHOLDS[this.style];
    const breakdown = this.calculateBreakdown(context);
    const componentScores = this.calculateComponentScores(breakdown, weights);

    let totalScore = 0;
    for (const [key, weight] of Object.entries(weights)) {
      const componentScore = componentScores[key as keyof EQSComponentScores] || 0;
      totalScore += (componentScore / 100) * weight;
    }

    totalScore = Math.round(Math.max(0, Math.min(100, totalScore)));

    const inZone = this.isPriceInEntryZone(context.currentPrice);
    const executionReady = inZone && totalScore >= threshold;

    let decision: 'EXECUTE_NOW' | 'CONTINUE_WAITING' | 'ABANDON_INTENT';
    let reasoning: string;

    if (executionReady) {
      decision = 'EXECUTE_NOW';
      reasoning = `EQS ${totalScore} >= ${threshold} threshold AND price in entry zone. Execute now.`;
    } else if (!inZone) {
      decision = 'CONTINUE_WAITING';
      reasoning = `Price ${context.currentPrice} not in entry zone [${this.entryZoneMin}, ${this.entryZoneMax}]. Waiting.`;
    } else {
      decision = 'CONTINUE_WAITING';
      reasoning = `EQS ${totalScore} < ${threshold} threshold. Waiting for better microstructure.`;
    }

    if (import.meta.env.DEV) {
      console.log('[ENTRY_MONITOR_EQS]', {
        score: totalScore,
        threshold,
        inZone,
        decision,
        style: this.style,
        direction: this.direction,
        price: context.currentPrice
      });
    }

    return {
      score: totalScore,
      decision,
      componentScores,
      breakdown,
      threshold,
      reasoning,
      executionReady
    };
  }

  private isPriceInEntryZone(price: number): boolean {
    return price >= this.entryZoneMin && price <= this.entryZoneMax;
  }

  private calculateBreakdown(context: MarketContext): EQSBreakdownDetails {
    const { currentPrice, vwap, ema20, ema50, ema200, atr, recentCandles, m15SupportResistance } = context;

    const acceptanceBreakdown = this.analyzeAcceptance(recentCandles, atr);
    const vwapBreakdown = this.analyzeVWAPInteraction(currentPrice, vwap, atr);
    const microBreakdown = this.analyzeMicrostructure(recentCandles, atr);
    const pullbackBreakdown = this.analyzePullback(recentCandles, atr);
    const emaBreakdown = this.analyzeEMAAlignment(currentPrice, ema20, ema50, ema200, atr, recentCandles);
    const compressionBreakdown = this.analyzeCompression(recentCandles, atr);
    const locationBreakdown = this.analyzeLocation(currentPrice, m15SupportResistance, atr);

    return {
      acceptance: acceptanceBreakdown,
      vwapInteraction: vwapBreakdown,
      microstructure: microBreakdown,
      pullback: pullbackBreakdown,
      emaAlign: emaBreakdown,
      compression: compressionBreakdown,
      location: locationBreakdown
    };
  }

  private analyzeAcceptance(candles: CandleData[], atr: number): EQSBreakdownDetails['acceptance'] {
    if (candles.length < 3) {
      return { bodyPercent: 0, consecutiveCloses: 0, closePosition: 0, rangeExpansion: false };
    }

    const recent = candles.slice(-5);
    let consecutiveCloses = 0;

    for (let i = recent.length - 1; i >= 0; i--) {
      const c = recent[i];
      const isBullish = c.close > c.open;
      const matchesDirection = (this.direction === 'BUY' && isBullish) || (this.direction === 'SELL' && !isBullish);
      if (matchesDirection) {
        consecutiveCloses++;
      } else {
        break;
      }
    }

    const lastCandle = recent[recent.length - 1];
    const metrics = analyzeCandleMetrics(lastCandle.open, lastCandle.high, lastCandle.low, lastCandle.close);
    const bodyPercent = metrics.bodyRatio * 100;

    let closePosition = 0;
    if (metrics.totalRange > 0) {
      if (this.direction === 'BUY') {
        closePosition = ((lastCandle.close - lastCandle.low) / metrics.totalRange) * 100;
      } else {
        closePosition = ((lastCandle.high - lastCandle.close) / metrics.totalRange) * 100;
      }
    }

    const avgRange = recent.reduce((sum, c) => sum + (c.high - c.low), 0) / recent.length;
    const rangeExpansion = metrics.totalRange > avgRange * 1.3;

    return {
      bodyPercent: Math.round(bodyPercent),
      consecutiveCloses,
      closePosition: Math.round(closePosition),
      rangeExpansion
    };
  }

  private analyzeVWAPInteraction(price: number, vwap: number | undefined, atr: number): EQSBreakdownDetails['vwapInteraction'] {
    if (!vwap || atr <= 0) {
      return { distanceATR: 99, zone: 'UNKNOWN', favorable: false };
    }

    const analysis = analyzeVWAP(price, vwap, atr);
    const favorable = (this.direction === 'BUY' && analysis.favorableForBuy) ||
                     (this.direction === 'SELL' && analysis.favorableForSell);

    return {
      distanceATR: Math.round(analysis.distanceATR * 100) / 100,
      zone: analysis.zone,
      favorable
    };
  }

  private analyzeMicrostructure(candles: CandleData[], atr: number): EQSBreakdownDetails['microstructure'] {
    if (candles.length < 3) {
      return { wickImbalance: 0, momentumBar: false, rejectionPattern: false };
    }

    const lastCandle = candles[candles.length - 1];
    const metrics = analyzeCandleMetrics(lastCandle.open, lastCandle.high, lastCandle.low, lastCandle.close);

    let wickImbalance = 0;
    if (metrics.totalRange > 0) {
      const totalWick = metrics.upperWick + metrics.lowerWick;
      if (this.direction === 'BUY') {
        wickImbalance = totalWick > 0 ? (metrics.lowerWick - metrics.upperWick) / totalWick : 0;
      } else {
        wickImbalance = totalWick > 0 ? (metrics.upperWick - metrics.lowerWick) / totalWick : 0;
      }
    }

    const momentumBar = metrics.bodyRatio > 0.7 && metrics.totalRange > atr * 0.6;

    const prevCandle = candles[candles.length - 2];
    const prevMetrics = analyzeCandleMetrics(prevCandle.open, prevCandle.high, prevCandle.low, prevCandle.close);
    let rejectionPattern = false;

    if (this.direction === 'BUY') {
      rejectionPattern = prevMetrics.lowerWick > prevMetrics.bodySize * 1.5 && lastCandle.close > prevCandle.close;
    } else {
      rejectionPattern = prevMetrics.upperWick > prevMetrics.bodySize * 1.5 && lastCandle.close < prevCandle.close;
    }

    return {
      wickImbalance: Math.round(wickImbalance * 100),
      momentumBar,
      rejectionPattern
    };
  }

  private analyzePullback(candles: CandleData[], atr: number): EQSBreakdownDetails['pullback'] {
    if (candles.length < 10) {
      return { depth: 50, grade: 'B', impulseIdentified: false };
    }

    const lookback = candles.slice(-10);
    let impulseHigh = lookback[0].high;
    let impulseLow = lookback[0].low;
    let impulseStart = 0;

    for (let i = 0; i < lookback.length; i++) {
      if (lookback[i].high > impulseHigh) {
        impulseHigh = lookback[i].high;
      }
      if (lookback[i].low < impulseLow) {
        impulseLow = lookback[i].low;
      }
    }

    const impulseRange = impulseHigh - impulseLow;
    if (impulseRange < atr * 0.5) {
      return { depth: 50, grade: 'B', impulseIdentified: false };
    }

    const currentPrice = lookback[lookback.length - 1].close;
    let depth = 50;

    if (this.direction === 'BUY') {
      depth = impulseRange > 0 ? ((impulseHigh - currentPrice) / impulseRange) * 100 : 50;
    } else {
      depth = impulseRange > 0 ? ((currentPrice - impulseLow) / impulseRange) * 100 : 50;
    }

    depth = Math.max(0, Math.min(100, depth));

    let grade: string;
    if (depth >= 30 && depth <= 50) {
      grade = 'A';
    } else if (depth > 50 && depth <= 70) {
      grade = 'B';
    } else if (depth > 70) {
      grade = 'C';
    } else {
      grade = 'D';
    }

    return {
      depth: Math.round(depth),
      grade,
      impulseIdentified: true
    };
  }

  private analyzeEMAAlignment(
    price: number,
    ema20: number | undefined,
    ema50: number | undefined,
    ema200: number | undefined,
    atr: number,
    candles: CandleData[]
  ): EQSBreakdownDetails['emaAlign'] {
    if (!ema20 || !ema50 || !ema200) {
      return { stack: 'UNKNOWN', slopeDirection: 'FLAT', directionMatch: false };
    }

    const alignment = calculateEMAAlignment(price, ema20, ema50, ema200);

    let prevEma20 = ema20;
    if (candles.length > 0) {
      const prevPrice = candles[candles.length - 2]?.close || price;
      prevEma20 = ema20 * 0.98 + prevPrice * 0.02;
    }
    const slope = calculateEMASlope(ema20, prevEma20, atr);

    let directionMatch = false;
    if (this.direction === 'BUY') {
      directionMatch = alignment.stack === 'BULL' || (alignment.stack === 'MIXED' && slope.direction === 'UP');
    } else {
      directionMatch = alignment.stack === 'BEAR' || (alignment.stack === 'MIXED' && slope.direction === 'DOWN');
    }

    return {
      stack: alignment.stack,
      slopeDirection: slope.direction,
      directionMatch
    };
  }

  private analyzeCompression(candles: CandleData[], atr: number): EQSBreakdownDetails['compression'] {
    if (candles.length < 6) {
      return { detected: false, expansionFollows: false };
    }

    const lookback = candles.slice(-6, -1);
    const lastCandle = candles[candles.length - 1];

    const avgRange = lookback.reduce((sum, c) => sum + (c.high - c.low), 0) / lookback.length;
    const compressionThreshold = atr * 0.5;

    const narrowCandles = lookback.filter(c => (c.high - c.low) < compressionThreshold).length;
    const detected = narrowCandles >= 3;

    const lastRange = lastCandle.high - lastCandle.low;
    const expansionFollows = detected && lastRange > avgRange * 1.5;

    return {
      detected,
      expansionFollows
    };
  }

  private analyzeLocation(
    price: number,
    levels: { support: number; resistance: number } | undefined,
    atr: number
  ): EQSBreakdownDetails['location'] {
    if (!levels) {
      return { nearSupport: false, nearResistance: false, midRange: true };
    }

    const range = levels.resistance - levels.support;
    const proximityThreshold = atr * 0.3;

    const nearSupport = Math.abs(price - levels.support) < proximityThreshold;
    const nearResistance = Math.abs(price - levels.resistance) < proximityThreshold;

    const positionInRange = range > 0 ? (price - levels.support) / range : 0.5;
    const midRange = !nearSupport && !nearResistance && positionInRange > 0.3 && positionInRange < 0.7;

    return {
      nearSupport,
      nearResistance,
      midRange
    };
  }

  private calculateComponentScores(breakdown: EQSBreakdownDetails, weights: Record<string, number>): EQSComponentScores {
    const scores: EQSComponentScores = {
      acceptance: 0,
      vwapInteraction: 0,
      microstructure: 0,
      pullback: 0,
      emaAlign: 0,
      compression: 0,
      location: 0,
      trendAlign: 0
    };

    if ('acceptance' in weights) {
      let acceptanceScore = 0;
      if (breakdown.acceptance.consecutiveCloses >= 2) acceptanceScore += 40;
      else if (breakdown.acceptance.consecutiveCloses >= 1) acceptanceScore += 20;

      if (breakdown.acceptance.bodyPercent >= 60) acceptanceScore += 30;
      else if (breakdown.acceptance.bodyPercent >= 40) acceptanceScore += 15;

      if (breakdown.acceptance.closePosition >= 70) acceptanceScore += 20;
      else if (breakdown.acceptance.closePosition >= 50) acceptanceScore += 10;

      if (breakdown.acceptance.rangeExpansion) acceptanceScore += 10;

      scores.acceptance = Math.min(100, acceptanceScore);
    }

    if ('vwapInteraction' in weights) {
      let vwapScore = 0;
      if (breakdown.vwapInteraction.favorable) {
        if (breakdown.vwapInteraction.distanceATR <= 0.15) vwapScore = 100;
        else if (breakdown.vwapInteraction.distanceATR <= 0.3) vwapScore = 85;
        else if (breakdown.vwapInteraction.distanceATR <= 0.5) vwapScore = 70;
        else if (breakdown.vwapInteraction.distanceATR <= 1.0) vwapScore = 50;
        else vwapScore = 30;
      } else {
        vwapScore = Math.max(0, 40 - breakdown.vwapInteraction.distanceATR * 20);
      }
      scores.vwapInteraction = Math.round(vwapScore);
    }

    if ('microstructure' in weights) {
      let microScore = 50;
      if (breakdown.microstructure.wickImbalance > 30) microScore += 25;
      else if (breakdown.microstructure.wickImbalance > 0) microScore += 10;
      else if (breakdown.microstructure.wickImbalance < -30) microScore -= 20;

      if (breakdown.microstructure.momentumBar) microScore += 15;
      if (breakdown.microstructure.rejectionPattern) microScore += 10;

      scores.microstructure = Math.max(0, Math.min(100, microScore));
    }

    if ('pullback' in weights) {
      switch (breakdown.pullback.grade) {
        case 'A':
          scores.pullback = 100;
          break;
        case 'B':
          scores.pullback = 75;
          break;
        case 'C':
          scores.pullback = 50;
          break;
        default:
          scores.pullback = 30;
      }
      if (!breakdown.pullback.impulseIdentified) scores.pullback = Math.round(scores.pullback * 0.6);
    }

    if ('emaAlign' in weights || 'trendAlign' in weights) {
      let emaScore = 50;
      if (breakdown.emaAlign.directionMatch) emaScore += 30;
      if (breakdown.emaAlign.stack === 'BULL' && this.direction === 'BUY') emaScore += 20;
      else if (breakdown.emaAlign.stack === 'BEAR' && this.direction === 'SELL') emaScore += 20;

      if ((this.direction === 'BUY' && breakdown.emaAlign.slopeDirection === 'UP') ||
          (this.direction === 'SELL' && breakdown.emaAlign.slopeDirection === 'DOWN')) {
        emaScore += 10;
      }

      scores.emaAlign = Math.min(100, emaScore);
      scores.trendAlign = scores.emaAlign;
    }

    if ('compression' in weights) {
      if (breakdown.compression.detected && breakdown.compression.expansionFollows) {
        scores.compression = 100;
      } else if (breakdown.compression.detected) {
        scores.compression = 60;
      } else {
        scores.compression = 40;
      }
    }

    if ('location' in weights) {
      if (this.direction === 'BUY') {
        if (breakdown.location.nearSupport) scores.location = 100;
        else if (breakdown.location.midRange) scores.location = 50;
        else if (breakdown.location.nearResistance) scores.location = 20;
        else scores.location = 40;
      } else {
        if (breakdown.location.nearResistance) scores.location = 100;
        else if (breakdown.location.midRange) scores.location = 50;
        else if (breakdown.location.nearSupport) scores.location = 20;
        else scores.location = 40;
      }
    }

    return scores;
  }
}

export function createEntryMonitorScorer(
  style: TradeStyle,
  direction: TradeDirection,
  entryZoneMin: number,
  entryZoneMax: number
): EntryMonitorQualityScorer {
  return new EntryMonitorQualityScorer(style, direction, entryZoneMin, entryZoneMax);
}

export function getStyleThreshold(style: TradeStyle): number {
  return STYLE_THRESHOLDS[style];
}
