/**
 * PATTERN DETECTION SERVICE - SSOT FOR MARKET STRUCTURE RECOGNITION
 *
 * Detects 13 approved pattern types across three timeframe layers:
 * - HTF (D1/H4): Campaign Intent
 * - MTF (H1/M30): Expansion Preparation
 * - LTF (M15/M5): Execution Timing
 *
 * CRITICAL: Patterns are NOT trade signals - they classify market intent only
 *
 * Pattern Categories:
 * 1. CONTINUATION/LOADING: Flags, pennants, channels, break-retest
 * 2. REVERSAL/TRAP: SFP, QML, H&S, exhaustion wedges
 * 3. LIQUIDITY STRUCTURE: Range boxes, equal highs/lows, vacuums, stop-hunts
 */

import type { CandleData } from './candle-data-service';
import { logger } from '../lib/logger';
import {
  PULLBACK_THRESHOLDS,
  SWING_THRESHOLDS,
  REVERSAL_THRESHOLDS,
  CONTINUATION_THRESHOLDS,
  VWAP_THRESHOLDS,
  STRUCTURE_BREAK_THRESHOLDS,
  PATTERN_CONFIDENCE,
  NOISE_FILTERING
} from '../config/pattern-detection-thresholds';

export type PatternType =
  | 'flag'
  | 'pennant'
  | 'channel_continuation'
  | 'pre_break_compression'
  | 'break_retest'
  | 'sfp_sweep'
  | 'quasimodo'
  | 'head_shoulders'
  | 'exhaustion_wedge'
  | 'range_liquidity_box'
  | 'equal_highs_lows'
  | 'liquidity_vacuum'
  | 'stop_hunt_expansion';

export type PatternCategory = 'continuation' | 'reversal' | 'liquidity_structure';

export type PatternStrength = 'weak' | 'moderate' | 'strong';

export interface PatternDetection {
  patternType: PatternType;
  category: PatternCategory;
  strength: PatternStrength;
  confidence: number; // 0-100
  direction: 'bullish' | 'bearish' | 'neutral';

  // Pattern structure
  keyLevels: {
    high: number;
    low: number;
    support?: number;
    resistance?: number;
  };

  // Invalidation
  invalidationPrice: number;
  invalidationReasoning: string;

  // Liquidity
  liquidityTargets: number[];

  // Context
  candleCount: number;
  lookbackPeriod: number;
  reasoning: string;
}

export interface TimeframePatternScan {
  timeframe: string;
  layer: 'HTF' | 'MTF' | 'LTF';
  patterns: PatternDetection[];
  primaryPattern: PatternDetection | null;
  scanTimestamp: number;
}

class PatternDetectionService {
  private readonly MIN_CANDLES_FOR_PATTERN = 20;
  private readonly TOUCH_TOLERANCE = 0.0005; // 0.05% tolerance for level touches

  /**
   * Scan candles for all approved patterns at a given timeframe
   */
  scanForPatterns(
    candles: CandleData[],
    timeframe: string,
    layer: 'HTF' | 'MTF' | 'LTF'
  ): TimeframePatternScan {
    if (candles.length < this.MIN_CANDLES_FOR_PATTERN) {
      return {
        timeframe,
        layer,
        patterns: [],
        primaryPattern: null,
        scanTimestamp: Date.now(),
      };
    }

    const detectedPatterns: PatternDetection[] = [];

    // CONTINUATION PATTERNS
    const flag = this.detectFlag(candles);
    if (flag) detectedPatterns.push(flag);

    const pennant = this.detectPennant(candles);
    if (pennant) detectedPatterns.push(pennant);

    const channel = this.detectChannelContinuation(candles);
    if (channel) detectedPatterns.push(channel);

    const compression = this.detectPreBreakCompression(candles);
    if (compression) detectedPatterns.push(compression);

    const breakRetest = this.detectBreakRetest(candles);
    if (breakRetest) detectedPatterns.push(breakRetest);

    // REVERSAL PATTERNS
    const sfp = this.detectSFP(candles);
    if (sfp) detectedPatterns.push(sfp);

    const qml = this.detectQuasimodo(candles);
    if (qml) detectedPatterns.push(qml);

    const hs = this.detectHeadShoulders(candles);
    if (hs) detectedPatterns.push(hs);

    const exhaustion = this.detectExhaustionWedge(candles);
    if (exhaustion) detectedPatterns.push(exhaustion);

    // LIQUIDITY STRUCTURE
    const rangeBox = this.detectRangeLiquidityBox(candles);
    if (rangeBox) detectedPatterns.push(rangeBox);

    const equalLevels = this.detectEqualHighsLows(candles);
    if (equalLevels) detectedPatterns.push(equalLevels);

    const vacuum = this.detectLiquidityVacuum(candles);
    if (vacuum) detectedPatterns.push(vacuum);

    const stopHunt = this.detectStopHuntExpansion(candles);
    if (stopHunt) detectedPatterns.push(stopHunt);

    // Select primary pattern (highest confidence)
    const primaryPattern = detectedPatterns.sort((a, b) => b.confidence - a.confidence)[0] || null;

    return {
      timeframe,
      layer,
      patterns: detectedPatterns,
      primaryPattern,
      scanTimestamp: Date.now(),
    };
  }

  // ============================================================================
  // CONTINUATION PATTERNS
  // ============================================================================

  private detectFlag(candles: CandleData[]): PatternDetection | null {
    const recentCandles = candles.slice(-30);
    if (recentCandles.length < 20) return null;

    // Look for sharp move followed by tight consolidation
    const impulse = recentCandles.slice(0, 10);
    const consolidation = recentCandles.slice(-10);

    const impulseRange = this.calculateRange(impulse);
    const consolidationRange = this.calculateRange(consolidation);

    // Flag = small consolidation after big move
    if (consolidationRange < impulseRange * 0.3) {
      const trend = this.determineTrend(impulse);
      const consHigh = Math.max(...consolidation.map(c => c.high));
      const consLow = Math.min(...consolidation.map(c => c.low));

      return {
        patternType: 'flag',
        category: 'continuation',
        strength: consolidationRange < impulseRange * 0.2 ? 'strong' : 'moderate',
        confidence: 75,
        direction: trend === 'up' ? 'bullish' : 'bearish',
        keyLevels: {
          high: consHigh,
          low: consLow,
          support: consLow,
          resistance: consHigh,
        },
        invalidationPrice: trend === 'up' ? consLow : consHigh,
        invalidationReasoning: `Break ${trend === 'up' ? 'below' : 'above'} flag boundary`,
        liquidityTargets: this.calculateContinuationTargets(consHigh, consLow, trend),
        candleCount: recentCandles.length,
        lookbackPeriod: 30,
        reasoning: 'Tight consolidation after strong impulse suggests continuation loading',
      };
    }

    return null;
  }

  private detectPennant(candles: CandleData[]): PatternDetection | null {
    const recentCandles = candles.slice(-25);
    if (recentCandles.length < 20) return null;

    // Look for converging highs and lows
    const highs = recentCandles.map(c => c.high);
    const lows = recentCandles.map(c => c.low);

    const highTrend = this.calculateTrendLine(highs);
    const lowTrend = this.calculateTrendLine(lows);

    // Pennant = converging trend lines
    if (highTrend < -0.0001 && lowTrend > 0.0001) {
      const currentHigh = highs[highs.length - 1];
      const currentLow = lows[lows.length - 1];
      const apex = this.estimateApex(currentHigh, currentLow);

      return {
        patternType: 'pennant',
        category: 'continuation',
        strength: 'moderate',
        confidence: 70,
        direction: this.determineTrend(candles.slice(-40, -25)) === 'up' ? 'bullish' : 'bearish',
        keyLevels: {
          high: currentHigh,
          low: currentLow,
        },
        invalidationPrice: apex,
        invalidationReasoning: 'Pennant apex reached without breakout',
        liquidityTargets: [currentHigh * 1.01, currentLow * 0.99],
        candleCount: recentCandles.length,
        lookbackPeriod: 25,
        reasoning: 'Converging price action forming pennant triangle',
      };
    }

    return null;
  }

  private detectChannelContinuation(candles: CandleData[]): PatternDetection | null {
    const recentCandles = candles.slice(-50);
    if (recentCandles.length < 40) return null;

    const closes = recentCandles.map(c => c.close);
    const highs = recentCandles.map(c => c.high);
    const lows = recentCandles.map(c => c.low);

    // Check if price is moving in clean channel
    const channelTouches = this.countChannelTouches(highs, lows);

    if (channelTouches >= 4) {
      const trend = this.determineTrend(recentCandles);
      const channelHigh = Math.max(...highs.slice(-20));
      const channelLow = Math.min(...lows.slice(-20));

      return {
        patternType: 'channel_continuation',
        category: 'continuation',
        strength: 'moderate',
        confidence: 65,
        direction: trend === 'up' ? 'bullish' : 'bearish',
        keyLevels: {
          high: channelHigh,
          low: channelLow,
          resistance: channelHigh,
          support: channelLow,
        },
        invalidationPrice: trend === 'up' ? channelLow : channelHigh,
        invalidationReasoning: 'Channel boundary break against trend',
        liquidityTargets: [channelHigh, channelLow],
        candleCount: recentCandles.length,
        lookbackPeriod: 50,
        reasoning: 'Clean trending channel with multiple touches',
      };
    }

    return null;
  }

  private detectPreBreakCompression(candles: CandleData[]): PatternDetection | null {
    const recentCandles = candles.slice(-15);
    if (recentCandles.length < 10) return null;

    // Look for tightening range (compression before breakout)
    const ranges = recentCandles.map(c => c.high - c.low);
    const avgEarlyRange = ranges.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const avgLateRange = ranges.slice(-5).reduce((a, b) => a + b, 0) / 5;

    if (avgLateRange < avgEarlyRange * 0.6) {
      const high = Math.max(...recentCandles.map(c => c.high));
      const low = Math.min(...recentCandles.map(c => c.low));
      const mid = (high + low) / 2;

      return {
        patternType: 'pre_break_compression',
        category: 'continuation',
        strength: 'strong',
        confidence: 80,
        direction: 'neutral', // Direction unknown until break
        keyLevels: {
          high,
          low,
          resistance: high,
          support: low,
        },
        invalidationPrice: mid,
        invalidationReasoning: 'Compression resolves without clean directional break',
        liquidityTargets: [high * 1.01, low * 0.99],
        candleCount: recentCandles.length,
        lookbackPeriod: 15,
        reasoning: 'Tightening range indicates energy compression before expansion',
      };
    }

    return null;
  }

  private detectBreakRetest(candles: CandleData[]): PatternDetection | null {
    const recentCandles = candles.slice(-20);
    if (recentCandles.length < 15) return null;

    // Look for level break followed by pullback retest
    const priorRange = candles.slice(-40, -20);
    const rangeHigh = Math.max(...priorRange.map(c => c.high));
    const rangeLow = Math.min(...priorRange.map(c => c.low));

    const currentClose = recentCandles[recentCandles.length - 1].close;
    const recentHigh = Math.max(...recentCandles.slice(-5).map(c => c.high));
    const recentLow = Math.min(...recentCandles.slice(-5).map(c => c.low));

    // Bullish break-retest
    if (recentHigh > rangeHigh * 1.002 && currentClose > rangeHigh && recentLow <= rangeHigh * 1.005) {
      return {
        patternType: 'break_retest',
        category: 'continuation',
        strength: 'strong',
        confidence: 85,
        direction: 'bullish',
        keyLevels: {
          high: recentHigh,
          low: rangeLow,
          support: rangeHigh,
        },
        invalidationPrice: rangeHigh,
        invalidationReasoning: 'Retest fails, price reclaims below breakout level',
        liquidityTargets: [recentHigh * 1.02, recentHigh * 1.03],
        candleCount: recentCandles.length,
        lookbackPeriod: 20,
        reasoning: 'Clean breakout with successful retest of prior resistance as support',
      };
    }

    // Bearish break-retest
    // Using BOS break threshold (0.2%) and retest tolerance (0.5% = 2.5x break threshold)
    const breakThreshold = 1 - STRUCTURE_BREAK_THRESHOLDS.BOS_MIN_BREAK_PERCENT; // 0.998
    const retestTolerance = 1 - (STRUCTURE_BREAK_THRESHOLDS.BOS_MIN_BREAK_PERCENT * 2.5); // 0.995
    if (recentLow < rangeLow * breakThreshold && currentClose < rangeLow && recentHigh >= rangeLow * retestTolerance) {
      return {
        patternType: 'break_retest',
        category: 'continuation',
        strength: 'strong',
        confidence: 85,
        direction: 'bearish',
        keyLevels: {
          high: rangeHigh,
          low: recentLow,
          resistance: rangeLow,
        },
        invalidationPrice: rangeLow,
        invalidationReasoning: 'Retest fails, price reclaims above breakdown level',
        liquidityTargets: [recentLow * 0.98, recentLow * 0.97],
        candleCount: recentCandles.length,
        lookbackPeriod: 20,
        reasoning: 'Clean breakdown with successful retest of prior support as resistance',
      };
    }

    return null;
  }

  // ============================================================================
  // REVERSAL PATTERNS
  // ============================================================================

  private detectSFP(candles: CandleData[]): PatternDetection | null {
    const recentCandles = candles.slice(-10);
    if (recentCandles.length < 5) return null;

    const priorSwing = candles.slice(-30, -10);
    const swingHigh = Math.max(...priorSwing.map(c => c.high));
    const swingLow = Math.min(...priorSwing.map(c => c.low));

    const latest = recentCandles[recentCandles.length - 1];

    // Bullish SFP: Sweep low then strong rejection
    const lowestRecent = Math.min(...recentCandles.map(c => c.low));
    if (lowestRecent < swingLow && latest.close > swingLow) {
      return {
        patternType: 'sfp_sweep',
        category: 'reversal',
        strength: 'strong',
        confidence: 80,
        direction: 'bullish',
        keyLevels: {
          high: swingHigh,
          low: lowestRecent,
          support: swingLow,
        },
        invalidationPrice: lowestRecent,
        invalidationReasoning: 'Price breaks below sweep low again',
        liquidityTargets: [swingHigh, swingHigh * 1.01],
        candleCount: recentCandles.length,
        lookbackPeriod: 10,
        reasoning: 'Liquidity sweep below swing low with strong rejection indicates reversal',
      };
    }

    // Bearish SFP: Sweep high then strong rejection
    const highestRecent = Math.max(...recentCandles.map(c => c.high));
    if (highestRecent > swingHigh && latest.close < swingHigh) {
      return {
        patternType: 'sfp_sweep',
        category: 'reversal',
        strength: 'strong',
        confidence: 80,
        direction: 'bearish',
        keyLevels: {
          high: highestRecent,
          low: swingLow,
          resistance: swingHigh,
        },
        invalidationPrice: highestRecent,
        invalidationReasoning: 'Price breaks above sweep high again',
        liquidityTargets: [swingLow, swingLow * 0.99],
        candleCount: recentCandles.length,
        lookbackPeriod: 10,
        reasoning: 'Liquidity sweep above swing high with strong rejection indicates reversal',
      };
    }

    return null;
  }

  private detectQuasimodo(candles: CandleData[]): PatternDetection | null {
    // Simplified Quasimodo: Break of structure then return through origin
    const recentCandles = candles.slice(-30);
    if (recentCandles.length < 25) return null;

    // Look for displacement pattern
    const swings = this.identifySwingPoints(recentCandles);
    if (swings.length < 3) return null;

    // QML pattern detected
    const latest = recentCandles[recentCandles.length - 1];
    const direction = swings[swings.length - 1].high > swings[0].high ? 'bearish' : 'bullish';

    return {
      patternType: 'quasimodo',
      category: 'reversal',
      strength: 'moderate',
      confidence: 65,
      direction,
      keyLevels: {
        high: Math.max(...recentCandles.map(c => c.high)),
        low: Math.min(...recentCandles.map(c => c.low)),
      },
      invalidationPrice: direction === 'bullish'
        ? Math.min(...recentCandles.slice(-5).map(c => c.low))
        : Math.max(...recentCandles.slice(-5).map(c => c.high)),
      invalidationReasoning: 'QML structure breaks, displacement continues',
      liquidityTargets: direction === 'bullish'
        ? [latest.close * 1.02, latest.close * 1.03]
        : [latest.close * 0.98, latest.close * 0.97],
      candleCount: recentCandles.length,
      lookbackPeriod: 30,
      reasoning: 'Quasimodo pattern suggests institutional reversal',
    };
  }

  private detectHeadShoulders(candles: CandleData[]): PatternDetection | null {
    const recentCandles = candles.slice(-60);
    if (recentCandles.length < 50) return null;

    // Look for three peaks with middle highest (head) and two lower shoulders
    const swings = this.identifySwingPoints(recentCandles);
    if (swings.length < 5) return null;

    // Simplified detection - needs refinement for production
    const peaks = swings.filter((s, i) =>
      i > 0 && i < swings.length - 1 &&
      s.high > swings[i - 1].high && s.high > swings[i + 1].high
    );

    if (peaks.length >= 3) {
      const head = peaks[1];
      const leftShoulder = peaks[0];
      const rightShoulder = peaks[2];

      if (head.high > leftShoulder.high * 1.01 && head.high > rightShoulder.high * 1.01) {
        const neckline = (leftShoulder.low + rightShoulder.low) / 2;

        return {
          patternType: 'head_shoulders',
          category: 'reversal',
          strength: 'strong',
          confidence: 70,
          direction: 'bearish',
          keyLevels: {
            high: head.high,
            low: neckline,
            resistance: head.high,
            support: neckline,
          },
          invalidationPrice: head.high,
          invalidationReasoning: 'Head high reclaimed',
          liquidityTargets: [neckline * 0.98, neckline * 0.95],
          candleCount: recentCandles.length,
          lookbackPeriod: 60,
          reasoning: 'Head and shoulders distribution pattern suggests reversal',
        };
      }
    }

    return null;
  }

  private detectExhaustionWedge(candles: CandleData[]): PatternDetection | null {
    const recentCandles = candles.slice(-30);
    if (recentCandles.length < 25) return null;

    // Look for narrowing range at end of strong trend
    const fullTrend = candles.slice(-50);
    const trendDirection = this.determineTrend(fullTrend);

    const ranges = recentCandles.map(c => c.high - c.low);
    const avgEarlyRange = ranges.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
    const avgLateRange = ranges.slice(-10).reduce((a, b) => a + b, 0) / 10;

    // Exhaustion = tightening after strong move
    if (avgLateRange < avgEarlyRange * 0.7 && trendDirection !== 'sideways') {
      const high = Math.max(...recentCandles.map(c => c.high));
      const low = Math.min(...recentCandles.map(c => c.low));

      return {
        patternType: 'exhaustion_wedge',
        category: 'reversal',
        strength: 'moderate',
        confidence: 60,
        direction: trendDirection === 'up' ? 'bearish' : 'bullish',
        keyLevels: {
          high,
          low,
        },
        invalidationPrice: trendDirection === 'up' ? high : low,
        invalidationReasoning: 'Trend resumes past exhaustion zone',
        liquidityTargets: trendDirection === 'up'
          ? [low * 0.98, low * 0.96]
          : [high * 1.02, high * 1.04],
        candleCount: recentCandles.length,
        lookbackPeriod: 30,
        reasoning: 'Narrowing range at trend extreme suggests exhaustion and potential reversal',
      };
    }

    return null;
  }

  // ============================================================================
  // LIQUIDITY STRUCTURE PATTERNS
  // ============================================================================

  private detectRangeLiquidityBox(candles: CandleData[]): PatternDetection | null {
    const recentCandles = candles.slice(-40);
    if (recentCandles.length < 30) return null;

    const highs = recentCandles.map(c => c.high);
    const lows = recentCandles.map(c => c.low);

    const rangeHigh = Math.max(...highs);
    const rangeLow = Math.min(...lows);
    const rangeSize = rangeHigh - rangeLow;

    // Check if price is oscillating in tight range
    // Using 0.5% tolerance for range boundary touches (2.5x base pattern tolerance)
    const rangeTouchTolerance = STRUCTURE_BREAK_THRESHOLDS.BOS_MIN_BREAK_PERCENT * 2.5; // 0.005 (0.5%)
    const touches = highs.filter(h => h > rangeHigh * (1 - rangeTouchTolerance)).length +
                    lows.filter(l => l < rangeLow * (1 + rangeTouchTolerance)).length;

    if (touches >= 4 && rangeSize < rangeHigh * 0.03) {
      return {
        patternType: 'range_liquidity_box',
        category: 'liquidity_structure',
        strength: 'moderate',
        confidence: 70,
        direction: 'neutral',
        keyLevels: {
          high: rangeHigh,
          low: rangeLow,
          resistance: rangeHigh,
          support: rangeLow,
        },
        invalidationPrice: (rangeHigh + rangeLow) / 2,
        invalidationReasoning: 'Range breaks in either direction',
        liquidityTargets: [rangeHigh, rangeLow],
        candleCount: recentCandles.length,
        lookbackPeriod: 40,
        reasoning: 'Defined range with liquidity building at boundaries',
      };
    }

    return null;
  }

  private detectEqualHighsLows(candles: CandleData[]): PatternDetection | null {
    const recentCandles = candles.slice(-30);
    if (recentCandles.length < 20) return null;

    const highs = recentCandles.map(c => c.high);
    const lows = recentCandles.map(c => c.low);

    // Find equal highs
    const equalHighs = this.findEqualLevels(highs, 'high');
    const equalLows = this.findEqualLevels(lows, 'low');

    if (equalHighs.length >= 2 || equalLows.length >= 2) {
      const primaryLevel = equalHighs.length >= equalLows.length
        ? Math.max(...equalHighs)
        : Math.min(...equalLows);

      const type = equalHighs.length >= equalLows.length ? 'resistance' : 'support';

      return {
        patternType: 'equal_highs_lows',
        category: 'liquidity_structure',
        strength: 'moderate',
        confidence: 75,
        direction: 'neutral',
        keyLevels: {
          high: Math.max(...highs),
          low: Math.min(...lows),
          [type]: primaryLevel,
        },
        invalidationPrice: primaryLevel,
        invalidationReasoning: `Equal ${type === 'resistance' ? 'highs' : 'lows'} swept and closed through`,
        liquidityTargets: [primaryLevel],
        candleCount: recentCandles.length,
        lookbackPeriod: 30,
        reasoning: `Equal ${type === 'resistance' ? 'highs' : 'lows'} indicate liquidity pool for potential sweep`,
      };
    }

    return null;
  }

  private detectLiquidityVacuum(candles: CandleData[]): PatternDetection | null {
    const recentCandles = candles.slice(-50);
    if (recentCandles.length < 40) return null;

    // Look for zones with very little price action (thin liquidity)
    const volumes = recentCandles.map(c => c.high - c.low);
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;

    // Find gaps or thin zones
    for (let i = 10; i < recentCandles.length - 10; i++) {
      const zone = recentCandles.slice(i - 5, i + 5);
      const zoneVolume = zone.reduce((sum, c) => sum + (c.high - c.low), 0) / zone.length;

      if (zoneVolume < avgVolume * 0.5) {
        const vacuumHigh = Math.max(...zone.map(c => c.high));
        const vacuumLow = Math.min(...zone.map(c => c.low));
        const current = recentCandles[recentCandles.length - 1].close;

        // Determine if vacuum is above or below
        const direction = current < vacuumLow ? 'bullish' : current > vacuumHigh ? 'bearish' : 'neutral';

        if (direction !== 'neutral') {
          return {
            patternType: 'liquidity_vacuum',
            category: 'liquidity_structure',
            strength: 'strong',
            confidence: 70,
            direction,
            keyLevels: {
              high: vacuumHigh,
              low: vacuumLow,
            },
            // Invalidation price buffer: 0.5% from current price (2.5x base pattern tolerance)
            invalidationPrice: direction === 'bullish'
              ? current * (1 - STRUCTURE_BREAK_THRESHOLDS.BOS_MIN_BREAK_PERCENT * 2.5)
              : current * (1 + STRUCTURE_BREAK_THRESHOLDS.BOS_MIN_BREAK_PERCENT * 2.5),
            invalidationReasoning: 'Price reverses before reaching vacuum zone',
            liquidityTargets: direction === 'bullish' ? [vacuumHigh, vacuumHigh * 1.01] : [vacuumLow, vacuumLow * 0.99],
            candleCount: recentCandles.length,
            lookbackPeriod: 50,
            reasoning: 'Thin liquidity zone suggests fast price travel when reached',
          };
        }
      }
    }

    return null;
  }

  private detectStopHuntExpansion(candles: CandleData[]): PatternDetection | null {
    const recentCandles = candles.slice(-15);
    if (recentCandles.length < 10) return null;

    // Look for sweep + immediate expansion
    const priorSwing = candles.slice(-30, -15);
    const swingHigh = Math.max(...priorSwing.map(c => c.high));
    const swingLow = Math.min(...priorSwing.map(c => c.low));

    const sweepCandle = recentCandles.slice(-3, -1);
    const expansionCandle = recentCandles.slice(-2);

    const sweepHigh = Math.max(...sweepCandle.map(c => c.high));
    const sweepLow = Math.min(...sweepCandle.map(c => c.low));
    const expansionRange = Math.max(...expansionCandle.map(c => c.high - c.low));

    // Bullish stop hunt: Sweep low then strong expansion up
    if (sweepLow < swingLow && expansionCandle[expansionCandle.length - 1].close > sweepLow) {
      const avgRange = recentCandles.slice(0, -2).reduce((sum, c) => sum + (c.high - c.low), 0) / (recentCandles.length - 2);

      if (expansionRange > avgRange * 1.5) {
        return {
          patternType: 'stop_hunt_expansion',
          category: 'liquidity_structure',
          strength: 'strong',
          confidence: 85,
          direction: 'bullish',
          keyLevels: {
            high: swingHigh,
            low: sweepLow,
            support: swingLow,
          },
          invalidationPrice: sweepLow,
          invalidationReasoning: 'Price breaks below sweep low again',
          liquidityTargets: [swingHigh * 1.01, swingHigh * 1.02],
          candleCount: recentCandles.length,
          lookbackPeriod: 15,
          reasoning: 'Stop hunt below swing low followed by strong expansion indicates institutional entry',
        };
      }
    }

    // Bearish stop hunt: Sweep high then strong expansion down
    if (sweepHigh > swingHigh && expansionCandle[expansionCandle.length - 1].close < sweepHigh) {
      const avgRange = recentCandles.slice(0, -2).reduce((sum, c) => sum + (c.high - c.low), 0) / (recentCandles.length - 2);

      if (expansionRange > avgRange * 1.5) {
        return {
          patternType: 'stop_hunt_expansion',
          category: 'liquidity_structure',
          strength: 'strong',
          confidence: 85,
          direction: 'bearish',
          keyLevels: {
            high: sweepHigh,
            low: swingLow,
            resistance: swingHigh,
          },
          invalidationPrice: sweepHigh,
          invalidationReasoning: 'Price breaks above sweep high again',
          liquidityTargets: [swingLow * 0.99, swingLow * 0.98],
          candleCount: recentCandles.length,
          lookbackPeriod: 15,
          reasoning: 'Stop hunt above swing high followed by strong expansion indicates institutional entry',
        };
      }
    }

    return null;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private calculateRange(candles: CandleData[]): number {
    const high = Math.max(...candles.map(c => c.high));
    const low = Math.min(...candles.map(c => c.low));
    return high - low;
  }

  private determineTrend(candles: CandleData[]): 'up' | 'down' | 'sideways' {
    if (candles.length < 10) return 'sideways';

    const closes = candles.map(c => c.close);
    const firstHalf = closes.slice(0, Math.floor(closes.length / 2));
    const secondHalf = closes.slice(Math.floor(closes.length / 2));

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    const change = (secondAvg - firstAvg) / firstAvg;

    if (change > 0.005) return 'up';
    if (change < -0.005) return 'down';
    return 'sideways';
  }

  private calculateTrendLine(values: number[]): number {
    if (values.length < 2) return 0;

    const n = values.length;
    const indices = Array.from({ length: n }, (_, i) => i);

    const sumX = indices.reduce((a, b) => a + b, 0);
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = indices.reduce((sum, x, i) => sum + x * values[i], 0);
    const sumX2 = indices.reduce((sum, x) => sum + x * x, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return slope;
  }

  private estimateApex(currentHigh: number, currentLow: number): number {
    return (currentHigh + currentLow) / 2;
  }

  private countChannelTouches(highs: number[], lows: number[]): number {
    const channelHigh = Math.max(...highs);
    const channelLow = Math.min(...lows);
    const tolerance = (channelHigh - channelLow) * 0.02;

    let touches = 0;
    for (const high of highs) {
      if (Math.abs(high - channelHigh) < tolerance) touches++;
    }
    for (const low of lows) {
      if (Math.abs(low - channelLow) < tolerance) touches++;
    }

    return touches;
  }

  private calculateContinuationTargets(high: number, low: number, trend: 'up' | 'down' | 'sideways'): number[] {
    const range = high - low;
    if (trend === 'up') {
      return [high + range, high + range * 2];
    } else if (trend === 'down') {
      return [low - range, low - range * 2];
    }
    return [high, low];
  }

  private identifySwingPoints(candles: CandleData[]): Array<{ high: number; low: number }> {
    const swings: Array<{ high: number; low: number }> = [];
    const lookback = 3;

    for (let i = lookback; i < candles.length - lookback; i++) {
      const current = candles[i];
      const before = candles.slice(i - lookback, i);
      const after = candles.slice(i + 1, i + lookback + 1);

      const isSwingHigh = before.every(c => c.high < current.high) &&
                          after.every(c => c.high < current.high);
      const isSwingLow = before.every(c => c.low > current.low) &&
                         after.every(c => c.low > current.low);

      if (isSwingHigh || isSwingLow) {
        swings.push({ high: current.high, low: current.low });
      }
    }

    return swings;
  }

  private findEqualLevels(levels: number[], type: 'high' | 'low'): number[] {
    // Using double top tolerance for identifying equal levels (0.2% tolerance)
    const tolerance = REVERSAL_THRESHOLDS.DOUBLE_TOP_TOLERANCE_PERCENT;
    const equalLevels: number[] = [];

    for (let i = 0; i < levels.length; i++) {
      let matches = 1;
      for (let j = i + 1; j < levels.length; j++) {
        if (Math.abs(levels[i] - levels[j]) / levels[i] < tolerance) {
          matches++;
        }
      }
      if (matches >= 2 && !equalLevels.includes(levels[i])) {
        equalLevels.push(levels[i]);
      }
    }

    return equalLevels;
  }
}

export const patternDetectionService = new PatternDetectionService();
