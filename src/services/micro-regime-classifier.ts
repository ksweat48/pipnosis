/**
 * Micro-Regime Classifier — Dynamic Baseline Edition
 *
 * SSOT / CCIP CONTRACT (2026-03-30):
 * This service outputs RAW OBSERVATIONS ONLY. It does NOT compute confidence
 * modifiers, trading adjustments, or behavioral guidance. Alpha is the sole
 * authority for interpreting raw indicators into trading decisions.
 *
 * GOVERNANCE CHANGE (2026-03-30):
 * All classification thresholds are now DYNAMIC — computed from a rolling
 * 100-sample percentile baseline per symbol per session stored in Supabase.
 * Static fallback thresholds are used only when <20 samples exist for a
 * symbol+session pair (cold start). This eliminates hardcoded universal
 * constants that were miscalibrated across different instruments and sessions.
 *
 * The classifier also writes raw indicator readings to the Supabase baseline
 * table on every call so thresholds self-calibrate over time.
 *
 * Regime labels are accompanied by a `thresholdSource` field that tells Alpha
 * whether the classification came from dynamic data or static fallback, so
 * Alpha can weight the label accordingly.
 *
 * 8 Micro-Regimes:
 * 1. Trend Acceleration   — Strong momentum with expanding ATR
 * 2. Trend Exhaustion     — Weakening momentum with divergences
 * 3. Mean Reversion Pocket — Extreme stretch from value with reversal signals
 * 4. Liquidity Vacuum     — Low volume compression before breakout
 * 5. Stop-Hunt Expansion  — Post-sweep violent directional move
 * 6. Pre-Break Compression — Range tightening before structural break
 * 7. Post-Break Retest    — Return to broken level for continuation
 * 8. Neutral Ranging      — No clear pattern, balanced conditions
 */

import { calculateEMA } from '../strategies/indicators';
import { calculateATR, calculateRSI } from '../utils/technicalIndicators';
import { supabase } from '../lib/supabase';

export type MicroRegime =
  | 'trend_acceleration'
  | 'trend_exhaustion'
  | 'mean_reversion_pocket'
  | 'liquidity_vacuum'
  | 'stop_hunt_expansion'
  | 'pre_break_compression'
  | 'post_break_retest'
  | 'neutral_ranging';

export type RegimeSession = 'asian' | 'london' | 'ny' | 'overlap' | 'dead';

export interface MicroRegimeCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Threshold set used for regime classification.
 * When thresholdSource = 'dynamic', these came from percentile analysis of
 * real historical readings for this symbol+session.
 * When thresholdSource = 'static_fallback', fewer than 20 samples exist and
 * conservative universal defaults are being used.
 */
export interface RegimeThresholds {
  atrExpansionP70: number;
  atrExpansionP85: number;
  atrExpansionP30: number;
  emaDisplacementP80: number;
  emaDisplacementP90: number;
  emaDisplacementP95: number;
  rangeCompressionP20: number;
  rangeCompressionP35: number;
  sampleCount: number;
  thresholdSource: 'dynamic' | 'static_fallback';
}

export interface MicroRegimeClassification {
  regime: MicroRegime;
  confidence: number;
  direction: 'bullish' | 'bearish' | 'neutral';
  indicators: {
    atrExpansion: number;
    emaDisplacement: number;
    rsi: number;
    volumeProfile: 'rising' | 'falling' | 'stable';
    rangeCompression: number;
  };
  thresholds: RegimeThresholds;
}

/** Static fallback thresholds — used when <20 samples exist for this symbol+session */
const STATIC_FALLBACK_THRESHOLDS: Omit<RegimeThresholds, 'thresholdSource' | 'sampleCount'> = {
  atrExpansionP70: 1.2,
  atrExpansionP85: 1.4,
  atrExpansionP30: 0.85,
  emaDisplacementP80: 1.5,
  emaDisplacementP90: 2.0,
  emaDisplacementP95: 2.5,
  rangeCompressionP20: 0.6,
  rangeCompressionP35: 0.75,
};

export class MicroRegimeClassifier {
  private readonly EMA_PERIOD = 50;
  private readonly ATR_PERIOD = 20;
  private readonly LOOKBACK = 50;

  /**
   * Classify current micro-regime with dynamic per-symbol per-session thresholds.
   *
   * SSOT: Always returns a valid classification. Falls back gracefully when
   * baseline data is unavailable or Supabase is unreachable.
   *
   * @param candles  - M5 candles for the current symbol
   * @param symbol   - Trading symbol (XAUUSD, EURUSD, etc.)
   * @param session  - Current market session (asian, london, ny, overlap, dead)
   */
  async classify(
    candles: MicroRegimeCandle[],
    symbol?: string,
    session?: RegimeSession
  ): Promise<MicroRegimeClassification> {
    if (candles.length < this.LOOKBACK) {
      return this.fallbackRegime();
    }

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
    const volumeRatio = this.calculateVolumeRatio(volumes);

    const indicators = {
      atrExpansion,
      emaDisplacement,
      rsi: currentRSI,
      volumeProfile,
      rangeCompression,
    };

    // Fetch dynamic thresholds and update baseline in parallel (fire-and-forget for baseline update)
    const thresholds = await this.fetchThresholds(
      symbol,
      session,
      atrExpansion,
      emaDisplacement,
      rangeCompression,
      volumeRatio
    );

    const recentSweep = this.detectRecentSweep(candles);
    const structuralRetest = this.detectStructuralRetest(candles);

    return this.classifyRegime(indicators, recentSweep, structuralRetest, thresholds);
  }

  /**
   * Fetch calibrated thresholds from Supabase and trigger baseline update.
   * Falls back to static thresholds if Supabase is unreachable.
   */
  private async fetchThresholds(
    symbol?: string,
    session?: RegimeSession,
    atrExpansion?: number,
    emaDisplacement?: number,
    rangeCompression?: number,
    volumeRatio?: number
  ): Promise<RegimeThresholds> {
    if (!symbol || !session) {
      return { ...STATIC_FALLBACK_THRESHOLDS, sampleCount: 0, thresholdSource: 'static_fallback' };
    }

    try {
      // Fire baseline update without awaiting — non-blocking
      if (atrExpansion !== undefined) {
        supabase.rpc('upsert_regime_baseline', {
          p_symbol: symbol,
          p_session_name: session,
          p_atr_expansion: atrExpansion,
          p_ema_displacement: Math.abs(emaDisplacement ?? 0),
          p_range_compression: rangeCompression ?? 1.0,
          p_volume_ratio: volumeRatio ?? 1.0,
        }).then(({ error }) => {
          if (error) {
            console.warn('[Regime Classifier] Baseline upsert failed (non-blocking):', error.message);
          }
        });
      }

      // Fetch the current thresholds (fast read path)
      const { data, error } = await supabase.rpc('get_regime_baselines', {
        p_symbol: symbol,
        p_session_name: session,
      });

      if (error || !data) {
        return { ...STATIC_FALLBACK_THRESHOLDS, sampleCount: 0, thresholdSource: 'static_fallback' };
      }

      const isDynamic = (data.is_dynamic === true) && (data.sample_count >= 20);

      return {
        atrExpansionP70: Number(data.atr_expansion_p70) || STATIC_FALLBACK_THRESHOLDS.atrExpansionP70,
        atrExpansionP85: Number(data.atr_expansion_p85) || STATIC_FALLBACK_THRESHOLDS.atrExpansionP85,
        atrExpansionP30: Number(data.atr_expansion_p30) || STATIC_FALLBACK_THRESHOLDS.atrExpansionP30,
        emaDisplacementP80: Number(data.ema_displacement_p80) || STATIC_FALLBACK_THRESHOLDS.emaDisplacementP80,
        emaDisplacementP90: Number(data.ema_displacement_p90) || STATIC_FALLBACK_THRESHOLDS.emaDisplacementP90,
        emaDisplacementP95: Number(data.ema_displacement_p95) || STATIC_FALLBACK_THRESHOLDS.emaDisplacementP95,
        rangeCompressionP20: Number(data.range_compression_p20) || STATIC_FALLBACK_THRESHOLDS.rangeCompressionP20,
        rangeCompressionP35: Number(data.range_compression_p35) || STATIC_FALLBACK_THRESHOLDS.rangeCompressionP35,
        sampleCount: Number(data.sample_count) || 0,
        thresholdSource: isDynamic ? 'dynamic' : 'static_fallback',
      };
    } catch {
      return { ...STATIC_FALLBACK_THRESHOLDS, sampleCount: 0, thresholdSource: 'static_fallback' };
    }
  }

  /**
   * Classify regime using dynamic percentile thresholds.
   * Every condition now asks "is this reading in the top/bottom N% for this symbol+session?"
   * rather than "does this exceed a universal hardcoded number?"
   */
  private classifyRegime(
    indicators: MicroRegimeClassification['indicators'],
    recentSweep: { detected: boolean; direction: 'up' | 'down' | null; candlesAgo: number },
    structuralRetest: { detected: boolean; direction: 'up' | 'down' | null },
    thresholds: RegimeThresholds
  ): MicroRegimeClassification {
    const { atrExpansion, emaDisplacement, rsi, volumeProfile, rangeCompression } = indicators;
    const {
      atrExpansionP70, atrExpansionP85, atrExpansionP30,
      emaDisplacementP80, emaDisplacementP90, emaDisplacementP95,
      rangeCompressionP20, rangeCompressionP35,
    } = thresholds;

    // 1. Stop-Hunt Expansion — Recent sweep + ATR in top 15% for this symbol+session
    if (recentSweep.detected && recentSweep.candlesAgo <= 3 && atrExpansion > atrExpansionP85) {
      const direction = recentSweep.direction === 'up' ? 'bullish' : 'bearish';
      return { regime: 'stop_hunt_expansion', confidence: 85, direction, indicators, thresholds };
    }

    // 2. Trend Acceleration — ATR above 70th percentile + displacement above 80th + rising volume
    if (
      atrExpansion > atrExpansionP70 &&
      Math.abs(emaDisplacement) > emaDisplacementP80 &&
      volumeProfile === 'rising'
    ) {
      const direction = emaDisplacement > 0 ? 'bullish' : 'bearish';
      const rsiConfirmation = direction === 'bullish' ? rsi > 55 : rsi < 45;
      if (rsiConfirmation) {
        return { regime: 'trend_acceleration', confidence: 80, direction, indicators, thresholds };
      }
    }

    // 3. Trend Exhaustion — Displacement above 90th percentile + falling volume + RSI extreme
    if (Math.abs(emaDisplacement) > emaDisplacementP90 && volumeProfile === 'falling') {
      const direction = emaDisplacement > 0 ? 'bearish' : 'bullish';
      const rsiExtreme = emaDisplacement > 0 ? rsi > 70 : rsi < 30;
      if (rsiExtreme) {
        return { regime: 'trend_exhaustion', confidence: 70, direction, indicators, thresholds };
      }
    }

    // 4. Mean Reversion Pocket — Displacement above 80th percentile + RSI extreme + no sweep
    if (Math.abs(emaDisplacement) > emaDisplacementP80 && !recentSweep.detected) {
      const direction = emaDisplacement > 0 ? 'bearish' : 'bullish';
      const rsiExtreme = (emaDisplacement > 0 && rsi > 75) || (emaDisplacement < 0 && rsi < 25);
      if (rsiExtreme) {
        return { regime: 'mean_reversion_pocket', confidence: 75, direction, indicators, thresholds };
      }
    }

    // 5. Liquidity Vacuum — Range in bottom 20% + stable volume + ATR in bottom 30%
    if (
      rangeCompression < rangeCompressionP20 &&
      volumeProfile === 'stable' &&
      atrExpansion < atrExpansionP30
    ) {
      return { regime: 'liquidity_vacuum', confidence: 65, direction: 'neutral', indicators, thresholds };
    }

    // 6. Pre-Break Compression — Range between P20 and P35 + near EMA (displacement below P80)
    if (
      rangeCompression < rangeCompressionP35 &&
      rangeCompression > rangeCompressionP20 &&
      Math.abs(emaDisplacement) < emaDisplacementP80
    ) {
      return { regime: 'pre_break_compression', confidence: 70, direction: 'neutral', indicators, thresholds };
    }

    // 7. Post-Break Retest — Structural retest detected
    if (structuralRetest.detected) {
      const dir = structuralRetest.direction!;
      return {
        regime: 'post_break_retest',
        confidence: 80,
        direction: dir === 'up' ? 'bullish' : 'bearish',
        indicators,
        thresholds,
      };
    }

    // 8. Neutral Ranging — No clear pattern detected
    return { regime: 'neutral_ranging', confidence: 50, direction: 'neutral', indicators, thresholds };
  }

  private calculateVolumeRatio(volumes: number[]): number {
    if (volumes.length < 10) return 1.0;
    const recent = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const prior = volumes.slice(-20, -5).reduce((a, b) => a + b, 0) / 15;
    return prior > 0 ? recent / prior : 1.0;
  }

  private analyzeVolumeProfile(volumes: number[]): 'rising' | 'falling' | 'stable' {
    if (volumes.length < 10) return 'stable';
    const avgRecent = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const avgPrevious = volumes.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;
    const ratio = avgPrevious > 0 ? avgRecent / avgPrevious : 1.0;
    if (ratio > 1.15) return 'rising';
    if (ratio < 0.85) return 'falling';
    return 'stable';
  }

  private calculateRangeCompression(candles: MicroRegimeCandle[]): number {
    if (candles.length < 20) return 1.0;
    const recent = candles.slice(-5);
    const historical = candles.slice(-20, -5);
    const recentAvg = recent.reduce((sum, c) => sum + (c.high - c.low), 0) / recent.length;
    const historicalAvg = historical.reduce((sum, c) => sum + (c.high - c.low), 0) / historical.length;
    return historicalAvg > 0 ? recentAvg / historicalAvg : 1.0;
  }

  private detectRecentSweep(candles: MicroRegimeCandle[]): {
    detected: boolean;
    direction: 'up' | 'down' | null;
    candlesAgo: number;
  } {
    if (candles.length < 5) return { detected: false, direction: null, candlesAgo: 0 };
    const recent = candles.slice(-5);
    for (let i = recent.length - 1; i >= 1; i--) {
      const curr = recent[i];
      const prev = recent[i - 1];
      const wickTop = curr.high - Math.max(curr.open, curr.close);
      const wickBottom = Math.min(curr.open, curr.close) - curr.low;
      const bodySize = Math.abs(curr.close - curr.open);
      if (curr.low < prev.low && wickBottom > bodySize * 1.5 && curr.close > curr.open) {
        return { detected: true, direction: 'up', candlesAgo: recent.length - 1 - i };
      }
      if (curr.high > prev.high && wickTop > bodySize * 1.5 && curr.close < curr.open) {
        return { detected: true, direction: 'down', candlesAgo: recent.length - 1 - i };
      }
    }
    return { detected: false, direction: null, candlesAgo: 0 };
  }

  private detectStructuralRetest(candles: MicroRegimeCandle[]): {
    detected: boolean;
    direction: 'up' | 'down' | null;
  } {
    if (candles.length < 20) return { detected: false, direction: null };
    const recent = candles.slice(-10);
    const historical = candles.slice(-20, -10);
    const historicalHigh = Math.max(...historical.map(c => c.high));
    const historicalLow = Math.min(...historical.map(c => c.low));
    const currentPrice = recent[recent.length - 1].close;
    const tolerance = (historicalHigh - historicalLow) * 0.02;
    const brokeAbove = recent.slice(0, -3).some(c => c.close > historicalHigh);
    if (brokeAbove && Math.abs(currentPrice - historicalHigh) < tolerance && currentPrice >= historicalHigh * 0.998) {
      return { detected: true, direction: 'up' };
    }
    const brokeBelow = recent.slice(0, -3).some(c => c.close < historicalLow);
    if (brokeBelow && Math.abs(currentPrice - historicalLow) < tolerance && currentPrice <= historicalLow * 1.002) {
      return { detected: true, direction: 'down' };
    }
    return { detected: false, direction: null };
  }

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
        rangeCompression: 1.0,
      },
      thresholds: { ...STATIC_FALLBACK_THRESHOLDS, sampleCount: 0, thresholdSource: 'static_fallback' },
    };
  }
}

export const microRegimeClassifier = new MicroRegimeClassifier();
