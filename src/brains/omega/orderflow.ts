/**
 * Omega-8 Order Flow - DETERMINISTIC Liquidity & Order Flow Specialist
 *
 * Specializes in:
 * - Liquidity zone identification
 * - Stop-run risk detection
 * - Equal highs/lows sweep patterns
 * - Fair Value Gaps (FVG)
 * - Volume anomalies
 * - Accumulation/Distribution zones
 *
 * FULLY DETERMINISTIC - NO LLM CALLS
 */

import type { OmegaVote } from '../../types/omega-vote';
import type { OmegaSensors } from '../../services/omega-sensors';
import { ORDERFLOW_THRESHOLDS } from '../../config/omega-thresholds';

export interface OrderFlowSnapshot {
  p: number;
  atr: number;
  c: Array<{ open: number; high: number; low: number; close: number; volume?: number }>;
  sup: number[];
  res: number[];
  tr: string;
  vol: string;
  sensors?: OmegaSensors;
  currentSL?: number;
}

export interface OrderFlowPatterns {
  equalHighs: number;
  equalLows: number;
  sweptHighs: number;
  sweptLows: number;
  fvgBullish: number;
  fvgBearish: number;
  volSpikeBullish: boolean;
  volSpikeBearish: boolean;
  absorptionBullish: boolean;
  absorptionBearish: boolean;
  accumulationZone: boolean;
  distributionZone: boolean;
  confluenceScore: number;
}

export type LiquidityBias = 'clean' | 'stoprun_risk' | 'stoprun_entry' | 'reaccumulation' | 'distribution';

class OmegaOrderFlowBrain {
  private readonly VOL_SPIKE_THRESHOLD = 1.5;
  private readonly ABSORPTION_VOL_THRESHOLD = 1.8;

  evaluate(snapshot: OrderFlowSnapshot): OmegaVote {
    const patterns = this.detectPatterns(snapshot);
    const { score, factors } = this.scorePatterns(patterns, snapshot);
    const liquidityBias = this.determineLiquidityBias(patterns, snapshot);

    let vote: 'BUY' | 'SELL' | 'NO_TRADE';
    let confidence: number;

    if (liquidityBias === 'stoprun_risk') {
      vote = 'NO_TRADE';
      confidence = 35;
      factors.push('STOPRUN_RISK');
    } else if (score >= ORDERFLOW_THRESHOLDS.STRONG_BULLISH_SCORE) {
      vote = 'BUY';
      confidence = Math.min(90, 55 + score);
      factors.push('ORDERFLOW_BULLISH');
    } else if (score <= -ORDERFLOW_THRESHOLDS.STRONG_BULLISH_SCORE) {
      vote = 'SELL';
      confidence = Math.min(90, 55 + Math.abs(score));
      factors.push('ORDERFLOW_BEARISH');
    } else if (Math.abs(score) < ORDERFLOW_THRESHOLDS.NEUTRAL_THRESHOLD) {
      vote = 'NO_TRADE';
      confidence = Math.max(30, 45 - Math.abs(score));
      factors.push('ORDERFLOW_NEUTRAL');
    } else {
      vote = score > 0 ? 'BUY' : 'SELL';
      confidence = Math.min(70, 45 + Math.abs(score) * 0.5);
      factors.push('ORDERFLOW_WEAK');
    }

    if (liquidityBias === 'stoprun_entry' && vote !== 'NO_TRADE') {
      confidence = Math.min(90, confidence + 10);
      factors.push('STOPRUN_ENTRY_BONUS');
    }

    if (vote !== 'NO_TRADE' && confidence < ORDERFLOW_THRESHOLDS.MIN_CONFIDENCE_FOR_TRADE) {
      vote = 'NO_TRADE';
      factors.push('BELOW_MIN_CONF');
    }

    const evidence = this.buildEvidence(patterns, liquidityBias, score);
    const reasoning = `[DET] ${vote} @ ${confidence}% | ${factors.slice(0, 4).join(', ')}`;

    console.log(`[Omega-8 OrderFlow] [DET] Vote: ${vote} | Confidence: ${confidence}% | LiqBias: ${liquidityBias} | Score: ${score}`);

    return {
      vote,
      confidence: Math.round(confidence),
      reasoning,
      evidence,
      keyFactors: factors
    };
  }

  private detectPatterns(snapshot: OrderFlowSnapshot): OrderFlowPatterns {
    const { c: candles, atr, p: price } = snapshot;
    const tolerance = atr * 0.1;

    const equalHighs = this.detectEqualHighs(candles, price, tolerance);
    const equalLows = this.detectEqualLows(candles, price, tolerance);
    const sweeps = this.detectSweeps(candles, tolerance);
    const fvg = this.detectFVG(candles);
    const volAnalysis = this.analyzeVolume(candles);
    const zones = this.detectAccumulationDistribution(candles);

    const confluenceScore = this.calculateConfluence({
      sweptHighs: sweeps.highSweeps,
      sweptLows: sweeps.lowSweeps,
      fvgBullish: fvg.bullish,
      fvgBearish: fvg.bearish,
      volSpikeBullish: volAnalysis.bullishSpike,
      volSpikeBearish: volAnalysis.bearishSpike,
      absorptionBullish: volAnalysis.absorptionBullish,
      absorptionBearish: volAnalysis.absorptionBearish
    });

    return {
      equalHighs,
      equalLows,
      sweptHighs: sweeps.highSweeps,
      sweptLows: sweeps.lowSweeps,
      fvgBullish: fvg.bullish,
      fvgBearish: fvg.bearish,
      volSpikeBullish: volAnalysis.bullishSpike,
      volSpikeBearish: volAnalysis.bearishSpike,
      absorptionBullish: volAnalysis.absorptionBullish,
      absorptionBearish: volAnalysis.absorptionBearish,
      accumulationZone: zones.accumulation,
      distributionZone: zones.distribution,
      confluenceScore
    };
  }

  private detectEqualHighs(
    candles: Array<{ high: number }>,
    currentPrice: number,
    tolerance: number
  ): number {
    if (candles.length < 3) return 0;

    const highs: number[] = [];
    for (let i = 0; i < candles.length - 1; i++) {
      const h1 = candles[i].high;
      for (let j = i + 1; j < candles.length; j++) {
        const h2 = candles[j].high;
        if (Math.abs(h1 - h2) <= tolerance && h1 > currentPrice) {
          if (!highs.includes(h1)) {
            highs.push(h1);
          }
        }
      }
    }
    return highs.length;
  }

  private detectEqualLows(
    candles: Array<{ low: number }>,
    currentPrice: number,
    tolerance: number
  ): number {
    if (candles.length < 3) return 0;

    const lows: number[] = [];
    for (let i = 0; i < candles.length - 1; i++) {
      const l1 = candles[i].low;
      for (let j = i + 1; j < candles.length; j++) {
        const l2 = candles[j].low;
        if (Math.abs(l1 - l2) <= tolerance && l1 < currentPrice) {
          if (!lows.includes(l1)) {
            lows.push(l1);
          }
        }
      }
    }
    return lows.length;
  }

  private detectSweeps(
    candles: Array<{ open: number; high: number; low: number; close: number }>,
    tolerance: number
  ): { highSweeps: number; lowSweeps: number } {
    if (candles.length < 3) return { highSweeps: 0, lowSweeps: 0 };

    let highSweeps = 0;
    let lowSweeps = 0;

    for (let i = 1; i < candles.length - 1; i++) {
      const prev = candles[i - 1];
      const curr = candles[i];

      const wickTop = curr.high - Math.max(curr.open, curr.close);
      const wickBottom = Math.min(curr.open, curr.close) - curr.low;
      const bodySize = Math.abs(curr.close - curr.open);

      if (curr.high > prev.high && wickTop > bodySize * 1.5 && curr.close < curr.open) {
        highSweeps++;
      }

      if (curr.low < prev.low && wickBottom > bodySize * 1.5 && curr.close > curr.open) {
        lowSweeps++;
      }
    }

    return { highSweeps, lowSweeps };
  }

  private detectFVG(
    candles: Array<{ open: number; high: number; low: number; close: number }>
  ): { bullish: number; bearish: number } {
    if (candles.length < 3) return { bullish: 0, bearish: 0 };

    let bullish = 0;
    let bearish = 0;

    for (let i = 0; i < candles.length - 2; i++) {
      const c1 = candles[i];
      const c3 = candles[i + 2];

      const gapUp = c3.low - c1.high;
      const gapDown = c1.low - c3.high;

      if (gapUp > 0) bullish++;
      else if (gapDown > 0) bearish++;
    }

    return { bullish, bearish };
  }

  private analyzeVolume(
    candles: Array<{ open: number; high: number; low: number; close: number; volume?: number }>
  ): {
    bullishSpike: boolean;
    bearishSpike: boolean;
    absorptionBullish: boolean;
    absorptionBearish: boolean;
  } {
    if (candles.length < 5) {
      return { bullishSpike: false, bearishSpike: false, absorptionBullish: false, absorptionBearish: false };
    }

    const volumes = candles.map(c => c.volume || 0);
    const avgVol = volumes.slice(0, -1).reduce((a, b) => a + b, 0) / (volumes.length - 1);
    const lastCandle = candles[candles.length - 1];
    const lastVol = lastCandle.volume || 0;

    const isBullishCandle = lastCandle.close > lastCandle.open;
    const range = lastCandle.high - lastCandle.low;
    const closeNearHigh = range > 0 && (lastCandle.close - lastCandle.low) / range > 0.7;
    const closeNearLow = range > 0 && (lastCandle.high - lastCandle.close) / range > 0.7;

    const bullishSpike = lastVol > avgVol * this.VOL_SPIKE_THRESHOLD && isBullishCandle && closeNearHigh;
    const bearishSpike = lastVol > avgVol * this.VOL_SPIKE_THRESHOLD && !isBullishCandle && closeNearLow;

    const absorptionBullish = lastVol > avgVol * this.ABSORPTION_VOL_THRESHOLD && isBullishCandle && !closeNearHigh;
    const absorptionBearish = lastVol > avgVol * this.ABSORPTION_VOL_THRESHOLD && !isBullishCandle && !closeNearLow;

    return { bullishSpike, bearishSpike, absorptionBullish, absorptionBearish };
  }

  private detectAccumulationDistribution(
    candles: Array<{ open: number; high: number; low: number; close: number; volume?: number }>
  ): { accumulation: boolean; distribution: boolean } {
    if (candles.length < 10) return { accumulation: false, distribution: false };

    const recent = candles.slice(-10);
    const avgRange = recent.reduce((sum, c) => sum + (c.high - c.low), 0) / recent.length;
    const avgVol = recent.reduce((sum, c) => sum + (c.volume || 0), 0) / recent.length;

    const tightRange = recent.every(c => (c.high - c.low) < avgRange * 1.2);
    const highVolume = recent.slice(-3).every(c => (c.volume || 0) > avgVol * 0.8);

    if (!tightRange || !highVolume) {
      return { accumulation: false, distribution: false };
    }

    let bottomWickDominant = 0;
    let topWickDominant = 0;

    for (const c of recent) {
      const wickTop = c.high - Math.max(c.open, c.close);
      const wickBottom = Math.min(c.open, c.close) - c.low;
      const bodySize = Math.abs(c.close - c.open) || 0.0001;

      if (wickBottom > bodySize && wickBottom > wickTop * 1.3) {
        bottomWickDominant++;
      } else if (wickTop > bodySize && wickTop > wickBottom * 1.3) {
        topWickDominant++;
      }
    }

    return { accumulation: bottomWickDominant >= 5, distribution: topWickDominant >= 5 };
  }

  private calculateConfluence(signals: {
    sweptHighs: number;
    sweptLows: number;
    fvgBullish: number;
    fvgBearish: number;
    volSpikeBullish: boolean;
    volSpikeBearish: boolean;
    absorptionBullish: boolean;
    absorptionBearish: boolean;
  }): number {
    let bullishSignals = 0;
    let bearishSignals = 0;

    if (signals.sweptLows > 0) bullishSignals++;
    if (signals.fvgBullish > 0) bullishSignals++;
    if (signals.volSpikeBullish) bullishSignals++;
    if (signals.absorptionBullish) bullishSignals++;

    if (signals.sweptHighs > 0) bearishSignals++;
    if (signals.fvgBearish > 0) bearishSignals++;
    if (signals.volSpikeBearish) bearishSignals++;
    if (signals.absorptionBearish) bearishSignals++;

    return Math.max(bullishSignals, bearishSignals);
  }

  private scorePatterns(patterns: OrderFlowPatterns, snapshot: OrderFlowSnapshot): { score: number; factors: string[] } {
    let score = 0;
    const factors: string[] = [];
    const trendLower = snapshot.tr.toLowerCase();

    if (patterns.sweptLows > 0 && (trendLower === 'bull' || trendLower === 'up')) {
      const points = 20 * patterns.sweptLows;
      score += points;
      factors.push(`LIQ_SWEEP_LOW(+${points})`);
    }

    if (patterns.sweptHighs > 0 && (trendLower === 'bear' || trendLower === 'down')) {
      const points = 20 * patterns.sweptHighs;
      score -= points;
      factors.push(`LIQ_SWEEP_HIGH(-${points})`);
    }

    if (patterns.fvgBullish > 0) {
      const points = 10 * patterns.fvgBullish;
      score += points;
      factors.push(`FVG_BULL(+${points})`);
    }

    if (patterns.fvgBearish > 0) {
      const points = 10 * patterns.fvgBearish;
      score -= points;
      factors.push(`FVG_BEAR(-${points})`);
    }

    if (patterns.volSpikeBullish) {
      score += 10;
      factors.push('VOL_SPIKE_BULL');
    }

    if (patterns.volSpikeBearish) {
      score -= 10;
      factors.push('VOL_SPIKE_BEAR');
    }

    if (patterns.absorptionBullish) {
      score += 10;
      factors.push('ABSORPTION_BULL');
    }

    if (patterns.absorptionBearish) {
      score -= 10;
      factors.push('ABSORPTION_BEAR');
    }

    if (patterns.confluenceScore >= 3) {
      const bonus = 15;
      score += score > 0 ? bonus : -bonus;
      factors.push('HIGH_CONFLUENCE');
    }

    if (patterns.accumulationZone && trendLower !== 'bear' && trendLower !== 'down') {
      score += 8;
      factors.push('ACCUMULATION');
    }

    if (patterns.distributionZone && trendLower !== 'bull' && trendLower !== 'up') {
      score -= 8;
      factors.push('DISTRIBUTION');
    }

    return { score, factors };
  }

  private determineLiquidityBias(patterns: OrderFlowPatterns, snapshot: OrderFlowSnapshot): LiquidityBias {
    const hasSweeps = patterns.sweptHighs > 0 || patterns.sweptLows > 0;

    if (hasSweeps && snapshot.c.length >= 5) {
      const sweepAnalysis = this.analyzeSweepWithBOS(snapshot.c, patterns);

      if (sweepAnalysis.has_bos) {
        return 'stoprun_entry';
      }

      if (sweepAnalysis.candles_ago <= 3 && !sweepAnalysis.has_bos) {
        return 'stoprun_risk';
      }

      if (sweepAnalysis.candles_ago > 5) {
        return 'clean';
      }
    }

    if (patterns.accumulationZone) return 'reaccumulation';
    if (patterns.distributionZone) return 'distribution';
    return 'clean';
  }

  private analyzeSweepWithBOS(
    candles: Array<{ open: number; high: number; low: number; close: number }>,
    patterns: OrderFlowPatterns
  ): { type: 'high' | 'low' | 'none'; candles_ago: number; has_bos: boolean } {
    if (candles.length < 5) {
      return { type: 'none', candles_ago: 0, has_bos: false };
    }

    const isHighSweep = patterns.sweptHighs > 0;
    const isLowSweep = patterns.sweptLows > 0;

    if (!isHighSweep && !isLowSweep) {
      return { type: 'none', candles_ago: 0, has_bos: false };
    }

    let sweepCandleIdx = -1;
    const recentCandles = candles.slice(-10);

    for (let i = recentCandles.length - 1; i >= 1; i--) {
      const curr = recentCandles[i];
      const prev = recentCandles[i - 1];
      const wickTop = curr.high - Math.max(curr.open, curr.close);
      const wickBottom = Math.min(curr.open, curr.close) - curr.low;
      const bodySize = Math.abs(curr.close - curr.open);

      if (isHighSweep && curr.high > prev.high && wickTop > bodySize * 1.5 && curr.close < curr.open) {
        sweepCandleIdx = i;
        break;
      }

      if (isLowSweep && curr.low < prev.low && wickBottom > bodySize * 1.5 && curr.close > curr.open) {
        sweepCandleIdx = i;
        break;
      }
    }

    if (sweepCandleIdx === -1) {
      return { type: isHighSweep ? 'high' : 'low', candles_ago: 10, has_bos: false };
    }

    const candles_ago = recentCandles.length - 1 - sweepCandleIdx;
    let has_bos = false;

    if (sweepCandleIdx < recentCandles.length - 1) {
      const sweepCandle = recentCandles[sweepCandleIdx];

      for (let i = sweepCandleIdx + 1; i < recentCandles.length; i++) {
        const afterCandle = recentCandles[i];

        if (isHighSweep && afterCandle.close < sweepCandle.low) {
          has_bos = true;
          break;
        }

        if (isLowSweep && afterCandle.close > sweepCandle.high) {
          has_bos = true;
          break;
        }
      }
    }

    return {
      type: isHighSweep ? 'high' : 'low',
      candles_ago,
      has_bos
    };
  }

  private buildEvidence(patterns: OrderFlowPatterns, liquidityBias: LiquidityBias, score: number): string {
    const parts = [
      `EH=${patterns.equalHighs}`,
      `EL=${patterns.equalLows}`,
      `SH=${patterns.sweptHighs}`,
      `SL=${patterns.sweptLows}`,
      `FVG_B=${patterns.fvgBullish}`,
      `FVG_S=${patterns.fvgBearish}`,
      `LIQ=${liquidityBias}`,
      `SCORE=${score}`
    ];

    return parts.join('|');
  }
}

export const omegaOrderFlow = new OmegaOrderFlowBrain();
