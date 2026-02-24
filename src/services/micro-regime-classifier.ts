/**
 * Micro-Regime Classifier - SSOT for 8-regime market classification
 *
 * Transforms basic trend/range/volatility detection into granular behavioral patterns.
 * Exposes raw sensor observations only — no confidence modifiers, trading advice,
 * or pre-synthesized behavioral expectations.
 *
 * SSOT / CCIP CONTRACT (2026-02-24):
 * This service outputs RAW OBSERVATIONS ONLY.
 * It does NOT compute confidence modifiers, trading adjustments, or behavioral guidance.
 * Alpha is the sole authority for interpreting raw indicators into trading decisions.
 *
 * 8 Micro-Regimes:
 * 1. Trend Acceleration - Strong momentum with expanding ATR
 * 2. Trend Exhaustion - Weakening momentum with divergences
 * 3. Mean Reversion Pocket - Extreme stretch from value with reversal signals
 * 4. Liquidity Vacuum - Low volume compression before breakout
 * 5. Stop-Hunt Expansion - Post-sweep violent directional move
 * 6. Pre-Break Compression - Range tightening before structural break
 * 7. Post-Break Retest - Return to broken level for continuation
 * 8. Neutral Ranging - No clear pattern, balanced conditions
 */

import { calculateEMA } from '../strategies/indicators';
import { calculateATR, calculateRSI } from '../utils/technicalIndicators';

export type MicroRegime =
  | 'trend_acceleration'
  | 'trend_exhaustion'
  | 'mean_reversion_pocket'
  | 'liquidity_vacuum'
  | 'stop_hunt_expansion'
  | 'pre_break_compression'
  | 'post_break_retest'
  | 'neutral_ranging';

export interface MicroRegimeCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MicroRegimeClassification {
  regime: MicroRegime;
  confidence: number; // 0-100 confidence in the regime classification itself
  direction: 'bullish' | 'bearish' | 'neutral';
  indicators: {
    atrExpansion: number; // ratio vs 20-period avg
    emaDisplacement: number; // % distance from EMA50
    rsi: number;
    volumeProfile: 'rising' | 'falling' | 'stable';
    rangeCompression: number; // current range / 20-period avg
  };
}

export class MicroRegimeClassifier {
  private readonly EMA_PERIOD = 50;
  private readonly ATR_PERIOD = 20;
  private readonly LOOKBACK = 50;

  /**
   * Classify current micro-regime
   * SSOT for regime detection - always returns valid classification
   */
  async classify(candles: MicroRegimeCandle[]): Promise<MicroRegimeClassification> {
    if (candles.length < this.LOOKBACK) {
      return this.fallbackRegime();
    }

    // Calculate indicators
    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume || 0);

    const currentEMA = calculateEMA(closes, this.EMA_PERIOD);
    const currentPrice = candles[candles.length - 1].close;

    const atrResults = calculateATR(candles, this.ATR_PERIOD);
    const currentATR = atrResults[atrResults.length - 1]?.value || 0;
    const avgATR = atrResults.length > 0
      ? atrResults.slice(-this.ATR_PERIOD).reduce((sum, r) => sum + r.value, 0) / Math.min(atrResults.length, this.ATR_PERIOD)
      : 0;
    const atrExpansion = avgATR > 0 ? currentATR / avgATR : 1.0;

    const emaDisplacement = ((currentPrice - currentEMA) / currentEMA) * 100;

    const rsiResults = calculateRSI(candles, 14);
    const currentRSI = rsiResults[rsiResults.length - 1]?.value || 50;

    const volumeProfile = this.analyzeVolumeProfile(volumes);
    const rangeCompression = this.calculateRangeCompression(candles);

    const indicators = {
      atrExpansion,
      emaDisplacement,
      rsi: currentRSI,
      volumeProfile,
      rangeCompression
    };

    // Detect sweeps for stop-hunt identification
    const recentSweep = this.detectRecentSweep(candles);

    // Detect structural levels for retest identification
    const structuralRetest = this.detectStructuralRetest(candles);

    // Classify regime based on indicators
    const classification = this.classifyRegime(indicators, recentSweep, structuralRetest, candles);

    return classification;
  }

  /**
   * Classify regime based on indicator readings
   */
  private classifyRegime(
    indicators: MicroRegimeClassification['indicators'],
    recentSweep: { detected: boolean; direction: 'up' | 'down' | null; candlesAgo: number },
    structuralRetest: { detected: boolean; direction: 'up' | 'down' | null },
    candles: MicroRegimeCandle[]
  ): MicroRegimeClassification {
    const { atrExpansion, emaDisplacement, rsi, volumeProfile, rangeCompression } = indicators;

    // 1. Stop-Hunt Expansion - Recent sweep + ATR expansion + strong directional close
    if (recentSweep.detected && recentSweep.candlesAgo <= 3 && atrExpansion > 1.3) {
      const direction = recentSweep.direction === 'up' ? 'bullish' : 'bearish';
      return {
        regime: 'stop_hunt_expansion',
        confidence: 85,
        direction,
        indicators
      };
    }

    // 2. Trend Acceleration - ATR expanding + price far from EMA + momentum
    if (atrExpansion > 1.2 && Math.abs(emaDisplacement) > 1.5 && volumeProfile === 'rising') {
      const direction = emaDisplacement > 0 ? 'bullish' : 'bearish';
      const rsiConfirmation = direction === 'bullish' ? rsi > 55 : rsi < 45;

      if (rsiConfirmation) {
        return {
          regime: 'trend_acceleration',
          confidence: 80,
          direction,
          indicators
        };
      }
    }

    // 3. Trend Exhaustion - Extended move + RSI divergence + volume declining
    if (Math.abs(emaDisplacement) > 2.0 && volumeProfile === 'falling') {
      const direction = emaDisplacement > 0 ? 'bearish' : 'bullish'; // Reversal expected
      const rsiExtreme = emaDisplacement > 0 ? rsi > 70 : rsi < 30;

      if (rsiExtreme) {
        return {
          regime: 'trend_exhaustion',
          confidence: 70,
          direction,
          indicators
        };
      }
    }

    // 4. Mean Reversion Pocket - Extreme stretch + RSI extreme + no sweep
    if (Math.abs(emaDisplacement) > 1.8 && !recentSweep.detected) {
      const direction = emaDisplacement > 0 ? 'bearish' : 'bullish'; // Mean reversion
      const rsiExtreme = (emaDisplacement > 0 && rsi > 75) || (emaDisplacement < 0 && rsi < 25);

      if (rsiExtreme) {
        return {
          regime: 'mean_reversion_pocket',
          confidence: 75,
          direction,
          indicators
        };
      }
    }

    // 5. Liquidity Vacuum - Range compression + low volume + pre-breakout
    if (rangeCompression < 0.6 && volumeProfile === 'stable' && atrExpansion < 0.9) {
      return {
        regime: 'liquidity_vacuum',
        confidence: 65,
        direction: 'neutral',
        indicators
      };
    }

    // 6. Pre-Break Compression - Short-term compression vs long-term + at structure
    if (rangeCompression < 0.75 && rangeCompression > 0.5 && Math.abs(emaDisplacement) < 0.5) {
      return {
        regime: 'pre_break_compression',
        confidence: 70,
        direction: 'neutral',
        indicators
      };
    }

    // 7. Post-Break Retest - Structural retest detected
    if (structuralRetest.detected) {
      const direction = structuralRetest.direction!;
      return {
        regime: 'post_break_retest',
        confidence: 80,
        direction: direction === 'up' ? 'bullish' : 'bearish',
        indicators
      };
    }

    // 8. Neutral Ranging - Default when no clear pattern
    return {
      regime: 'neutral_ranging',
      confidence: 50,
      direction: 'neutral',
      indicators
    };
  }

  /**
   * Analyze volume profile trend
   */
  private analyzeVolumeProfile(volumes: number[]): 'rising' | 'falling' | 'stable' {
    if (volumes.length < 10) return 'stable';

    const recent5 = volumes.slice(-5);
    const previous5 = volumes.slice(-10, -5);

    const avgRecent = recent5.reduce((a, b) => a + b, 0) / 5;
    const avgPrevious = previous5.reduce((a, b) => a + b, 0) / 5;

    const ratio = avgRecent / avgPrevious;

    if (ratio > 1.15) return 'rising';
    if (ratio < 0.85) return 'falling';
    return 'stable';
  }

  /**
   * Calculate range compression ratio
   */
  private calculateRangeCompression(candles: MicroRegimeCandle[]): number {
    if (candles.length < 20) return 1.0;

    const recent = candles.slice(-5);
    const historical = candles.slice(-20, -5);

    const recentAvgRange = recent.reduce((sum, c) => sum + (c.high - c.low), 0) / recent.length;
    const historicalAvgRange = historical.reduce((sum, c) => sum + (c.high - c.low), 0) / historical.length;

    return recentAvgRange / historicalAvgRange;
  }

  /**
   * Detect recent sweep (within last 5 candles)
   */
  private detectRecentSweep(candles: MicroRegimeCandle[]): {
    detected: boolean;
    direction: 'up' | 'down' | null;
    candlesAgo: number;
  } {
    if (candles.length < 5) {
      return { detected: false, direction: null, candlesAgo: 0 };
    }

    const recent = candles.slice(-5);

    for (let i = recent.length - 1; i >= 1; i--) {
      const curr = recent[i];
      const prev = recent[i - 1];

      const wickTop = curr.high - Math.max(curr.open, curr.close);
      const wickBottom = Math.min(curr.open, curr.close) - curr.low;
      const bodySize = Math.abs(curr.close - curr.open);

      // Bullish sweep (sweep low, close up)
      if (curr.low < prev.low && wickBottom > bodySize * 1.5 && curr.close > curr.open) {
        const candlesAgo = recent.length - 1 - i;
        return { detected: true, direction: 'up', candlesAgo };
      }

      // Bearish sweep (sweep high, close down)
      if (curr.high > prev.high && wickTop > bodySize * 1.5 && curr.close < curr.open) {
        const candlesAgo = recent.length - 1 - i;
        return { detected: true, direction: 'down', candlesAgo };
      }
    }

    return { detected: false, direction: null, candlesAgo: 0 };
  }

  /**
   * Detect structural retest (return to recently broken level)
   */
  private detectStructuralRetest(candles: MicroRegimeCandle[]): {
    detected: boolean;
    direction: 'up' | 'down' | null;
  } {
    if (candles.length < 20) {
      return { detected: false, direction: null };
    }

    const recent = candles.slice(-10);
    const historical = candles.slice(-20, -10);

    // Find significant high in historical period
    const historicalHigh = Math.max(...historical.map(c => c.high));
    const historicalLow = Math.min(...historical.map(c => c.low));

    const currentPrice = recent[recent.length - 1].close;
    const tolerance = (historicalHigh - historicalLow) * 0.02; // 2% tolerance

    // Check if we broke above historical high and are now retesting
    const brokeAbove = recent.slice(0, -3).some(c => c.close > historicalHigh);
    const nearHistoricalHigh = Math.abs(currentPrice - historicalHigh) < tolerance;

    if (brokeAbove && nearHistoricalHigh && currentPrice >= historicalHigh * 0.998) {
      return { detected: true, direction: 'up' };
    }

    // Check if we broke below historical low and are now retesting
    const brokeBelow = recent.slice(0, -3).some(c => c.close < historicalLow);
    const nearHistoricalLow = Math.abs(currentPrice - historicalLow) < tolerance;

    if (brokeBelow && nearHistoricalLow && currentPrice <= historicalLow * 1.002) {
      return { detected: true, direction: 'down' };
    }

    return { detected: false, direction: null };
  }

  /**
   * Fallback when insufficient data
   */
  private fallbackRegime(): MicroRegimeClassification {
    return {
      regime: 'neutral_ranging',
      confidence: 30,
      direction: 'neutral',
      indicators: {
        atrExpansion: 1.0,
        emaDisplacement: 0,
        rsi: 50,
        volumeProfile: 'stable',
        rangeCompression: 1.0
      }
    };
  }
}

export const microRegimeClassifier = new MicroRegimeClassifier();
