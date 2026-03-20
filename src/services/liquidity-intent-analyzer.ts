/**
 * Liquidity Sweep Facts — Pure Measurement Layer
 *
 * CCIP-2026-0320-LIA: Refactored from behavioral verdict engine to raw sensor.
 *
 * GOVERNANCE CONTRACT:
 * This module is a DATA ENRICHMENT layer only. It receives Omega-8 sweep
 * detection output and extracts measurable, observable facts about the sweep.
 *
 * WHAT THIS MODULE MUST NEVER DO:
 * - Label trapped participants (e.g. "retail_shorts") — Alpha reasons about this
 * - Determine predator direction — Alpha decides what the sweep means directionally
 * - Score conviction or cascade confidence — Alpha's job, not ours
 * - Recommend an entry window (immediate/missed) — Alpha's judgment
 * - Generate stop placement guidance strings — stop calculator + Alpha own this
 * - Build any reasoning narrative — Alpha constructs his own reasoning
 *
 * WHAT THIS MODULE PROVIDES:
 * - sweep_type: 'high' | 'low' (observable fact — which side was swept)
 * - sweep_extreme_price: exact wick extreme price (SSOT for stop calculator)
 * - nearest_cluster_price: adjacent equal high/low cluster price (stop context)
 * - candles_since_sweep: raw recency count (no status label)
 * - has_bos: structural break-of-structure boolean (observable confirmation)
 * - wick_to_body_ratio: wick size vs body size on sweep candle (raw ratio)
 * - volume_ratio: sweep candle volume vs average volume (raw ratio, 0 if unavailable)
 * - equal_highs_count / equal_lows_count: cluster depth at the swept level
 * - fvg_present_in_sweep_direction: boolean (observable structural fact)
 *
 * SSOT COMPLIANCE:
 * - sweep_extreme_price feeds risk-aware-stop-calculator.ts (unchanged wire)
 * - nearest_cluster_price feeds cross-direction cluster advisory (unchanged)
 * - All behavioral interpretation is deferred to Alpha's LLM reasoning
 *
 * CCIP CHANGE LOG:
 * - CCIP-2026-0320-LIA: Removed TrappedParticipant, VulnerabilityType,
 *   HuntZoneStatus, PredatorDirection, cascadeConfidence, overallConviction,
 *   optimalEntryWindow, stopPlacementGuidance, buildReasoning(). These were
 *   pre-answering Alpha's most important questions before he could ask them.
 *   Replaced with LiquiditySweepFacts — measurements only, zero interpretation.
 */

import type { Omega8Patterns, Omega8Candle } from '../brains/omega8-hybrid-orderflow';

/**
 * Raw measurable facts about a detected liquidity sweep.
 * SSOT: This is the only shape that flows from this module into coordinator-alpha.
 *
 * All fields are observable measurements — none are interpretive conclusions.
 */
export interface LiquiditySweepFacts {
  sweep_detected: boolean;
  sweep_type: 'high' | 'low';

  sweep_extreme_price: number;
  nearest_cluster_price?: number;

  candles_since_sweep: number;
  has_bos: boolean;

  wick_to_body_ratio: number;
  volume_ratio: number;

  equal_highs_count: number;
  equal_lows_count: number;

  fvg_present_in_sweep_direction: boolean;
}

/**
 * Null object — returned when no sweep is detected.
 * Callers check sweep_detected === false before using any other field.
 */
const NO_SWEEP_FACTS: LiquiditySweepFacts = {
  sweep_detected: false,
  sweep_type: 'low',
  sweep_extreme_price: 0,
  nearest_cluster_price: undefined,
  candles_since_sweep: 999,
  has_bos: false,
  wick_to_body_ratio: 0,
  volume_ratio: 0,
  equal_highs_count: 0,
  equal_lows_count: 0,
  fvg_present_in_sweep_direction: false,
};

export class LiquidityIntentAnalyzer {
  /**
   * Extract measurable facts from an Omega-8 sweep detection.
   * SSOT for sweep fact extraction — coordinator-alpha calls this once per scan.
   *
   * Returns NO_SWEEP_FACTS when no meaningful sweep is present.
   * All interpretation of these facts belongs to Alpha.
   */
  extractSweepFacts(
    patterns: Omega8Patterns,
    candles: Omega8Candle[],
    sweepDetails?: {
      type: 'high' | 'low' | 'none';
      candles_ago: number;
      has_bos: boolean;
      sweep_extreme_price?: number;
      nearest_cluster_price?: number;
    }
  ): LiquiditySweepFacts {
    if (!sweepDetails || sweepDetails.type === 'none' || !sweepDetails.sweep_extreme_price) {
      return NO_SWEEP_FACTS;
    }

    if (patterns.sweptHighs === 0 && patterns.sweptLows === 0) {
      return NO_SWEEP_FACTS;
    }

    const sweepType = sweepDetails.type;
    const sweepCandle = this.findSweepCandle(candles, sweepDetails.candles_ago, sweepType);

    const wickToBodyRatio = sweepCandle
      ? this.calculateWickToBodyRatio(sweepCandle, sweepType)
      : 0;

    const volumeRatio = sweepCandle && candles.length >= 5
      ? this.calculateVolumeRatio(sweepCandle, candles)
      : 0;

    const fvgPresent = sweepType === 'low'
      ? patterns.fvgBullish > 0
      : patterns.fvgBearish > 0;

    return {
      sweep_detected: true,
      sweep_type: sweepType,
      sweep_extreme_price: sweepDetails.sweep_extreme_price,
      nearest_cluster_price: sweepDetails.nearest_cluster_price,
      candles_since_sweep: sweepDetails.candles_ago,
      has_bos: sweepDetails.has_bos,
      wick_to_body_ratio: wickToBodyRatio,
      volume_ratio: volumeRatio,
      equal_highs_count: patterns.sweptHighs,
      equal_lows_count: patterns.sweptLows,
      fvg_present_in_sweep_direction: fvgPresent,
    };
  }

  /**
   * Locate the candle at the sweep point.
   * Uses candles_ago offset from the most recent candle.
   */
  private findSweepCandle(
    candles: Omega8Candle[],
    candlesAgo: number,
    _sweepType: 'high' | 'low'
  ): Omega8Candle | null {
    if (candles.length === 0) return null;
    const idx = candles.length - 1 - candlesAgo;
    if (idx < 0 || idx >= candles.length) return null;
    return candles[idx];
  }

  /**
   * Calculate the wick-to-body ratio on the sweep candle.
   * For a low sweep: lower wick / body size.
   * For a high sweep: upper wick / body size.
   * Returns 0 if body is zero (doji — treat as 0 for safety).
   */
  private calculateWickToBodyRatio(candle: Omega8Candle, sweepType: 'high' | 'low'): number {
    const body = Math.abs(candle.close - candle.open);
    if (body === 0) return 0;

    if (sweepType === 'low') {
      const lowerWick = Math.min(candle.open, candle.close) - candle.low;
      return parseFloat((lowerWick / body).toFixed(2));
    } else {
      const upperWick = candle.high - Math.max(candle.open, candle.close);
      return parseFloat((upperWick / body).toFixed(2));
    }
  }

  /**
   * Calculate sweep candle volume relative to the recent average.
   * Returns ratio (e.g. 2.3 = 2.3x average). Returns 0 if no volume data.
   */
  private calculateVolumeRatio(sweepCandle: Omega8Candle, allCandles: Omega8Candle[]): number {
    if (!sweepCandle.volume || sweepCandle.volume === 0) return 0;

    const recentCandles = allCandles.slice(-10);
    const volumes = recentCandles.map(c => c.volume || 0).filter(v => v > 0);
    if (volumes.length === 0) return 0;

    const avgVolume = volumes.reduce((s, v) => s + v, 0) / volumes.length;
    if (avgVolume === 0) return 0;

    return parseFloat((sweepCandle.volume / avgVolume).toFixed(2));
  }
}

export const liquidityIntentAnalyzer = new LiquidityIntentAnalyzer();
