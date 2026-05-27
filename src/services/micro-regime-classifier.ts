/**
 * Micro-Regime Classifier — CCIP-2026-0401-REGIME-SSOT
 *
 * SSOT / CCIP CONTRACT:
 * This service outputs RAW OBSERVATIONS ONLY. It does NOT produce verdicts,
 * confidence modifiers, or behavioral guidance. Alpha is the sole authority
 * for interpreting raw indicators into trading decisions.
 *
 * GOVERNANCE CHANGE (CCIP-2026-0401):
 * FALLBACK CLASSIFICATION ELIMINATED. The classifier NEVER returns a regime
 * label or direction verdict unless a dynamic Supabase baseline with >=20
 * real samples exists for the exact symbol+session pair.
 *
 * When no dynamic baseline exists, the classifier returns live-computed
 * indicator values (ATR expansion, EMA displacement, RSI, volume profile,
 * range compression) with thresholdSource 'live_only'. The coordinator
 * presents these as raw sensor data for Alpha to read directly.
 *
 * This eliminates the root cause: static_fallback thresholds producing
 * near-universal 'neutral_ranging' labels that contaminate Alpha's judgment
 * and suppress legitimate trade execution.
 *
 * Baseline data self-accumulates from every scan call. Once >=20 samples
 * exist for a symbol+session pair, full dynamic classification activates.
 *
 * 7 Classified Micro-Regimes (only emitted with dynamic baseline):
 * 1. Trend Acceleration    — Strong momentum with expanding ATR
 * 2. Trend Exhaustion      — Weakening momentum with divergences
 * 3. Mean Reversion Pocket — Extreme stretch from value with reversal signals
 * 4. Liquidity Vacuum      — Low volume compression before breakout
 * 5. Stop-Hunt Expansion   — Post-sweep violent directional move
 * 6. Pre-Break Compression — Range tightening before structural break
 * 7. Post-Break Retest     — Return to broken level for continuation
 */

import { calculateEMA } from '../strategies/indicators';
import { calculateATR, calculateRSI } from '../utils/technicalIndicators';
import { supabase } from '../lib/supabase';

/**
 * CCIP-2026-0401: 'neutral_ranging' removed from the classified regime union.
 * A neutral_ranging verdict was always the product of static fallback thresholds
 * that could not distinguish anything. Alpha reads live indicators directly when
 * no dynamic baseline is available.
 */
export type MicroRegime =
  | 'trend_acceleration'
  | 'trend_exhaustion'
  | 'mean_reversion_pocket'
  | 'liquidity_vacuum'
  | 'stop_hunt_expansion'
  | 'pre_break_compression'
  | 'post_break_retest';

export type RegimeSession = 'asian' | 'london' | 'ny' | 'overlap' | 'dead';

export interface MicroRegimeCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MicroRegimeIndicators {
  atrExpansion: number;
  emaDisplacement: number;
  rsi: number;
  volumeProfile: 'rising' | 'falling' | 'stable';
  volumeRatio: number;
  rangeCompression: number;
}

/**
 * Threshold set — only populated when thresholdSource is 'dynamic'.
 * CCIP-2026-0401: 'static_fallback' removed. Thresholds are either real
 * dynamic data from Supabase or absent entirely (live_only path).
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
  thresholdSource: 'dynamic';
}

/**
 * CCIP-2026-0401 Discriminated union result from classify():
 *
 * classified — dynamic baseline >=20 samples; full regime label + direction emitted.
 * live_only  — no baseline yet; raw computed indicators from live candles only.
 *              No regime label, no direction verdict. Alpha reads the numbers.
 */
export type MicroRegimeResult =
  | {
      type: 'classified';
      regime: MicroRegime;
      confidence: number;
      direction: 'bullish' | 'bearish' | 'neutral';
      indicators: MicroRegimeIndicators;
      thresholds: RegimeThresholds;
    }
  | {
      type: 'live_only';
      indicators: MicroRegimeIndicators;
      sampleCount: number;
    };

/**
 * @deprecated Use MicroRegimeResult. Kept for any external callers that destructure
 * the old shape — will be removed after full migration.
 */
export interface MicroRegimeClassification {
  regime: MicroRegime;
  confidence: number;
  direction: 'bullish' | 'bearish' | 'neutral';
  indicators: MicroRegimeIndicators;
  thresholds: RegimeThresholds;
}

export class MicroRegimeClassifier {
  private readonly EMA_PERIOD = 50;
  private readonly ATR_PERIOD = 20;
  private readonly LOOKBACK = 50;

  /**
   * CCIP-2026-0401-REGIME-SSOT: Classify current micro-regime.
   *
   * AUTHORITY CONTRACT:
   * - Raw indicators are ALWAYS computed from live candle data. No synthetic values.
   * - A regime label and direction are ONLY emitted when a dynamic Supabase
   *   baseline with >=20 real samples exists for this symbol+session pair.
   * - When no dynamic baseline exists, returns type:'live_only' with raw computed
   *   indicators. The coordinator presents these as raw sensor data. Alpha reads
   *   the numbers directly — no regime label, no direction verdict is injected.
   * - Static fallback thresholds are ELIMINATED. No hardcoded constants classify
   *   this market under any circumstances.
   *
   * @param candles  - M5 candles for the current symbol (minimum 50 required)
   * @param symbol   - Trading symbol (XAUUSD, EURUSD, etc.)
   * @param session  - Current market session (asian, london, ny, overlap, dead)
   */
  async classify(
    candles: MicroRegimeCandle[],
    symbol?: string,
    session?: RegimeSession
  ): Promise<MicroRegimeResult | null> {
    if (candles.length < this.LOOKBACK) {
      return null;
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

    const indicators: MicroRegimeIndicators = {
      atrExpansion,
      emaDisplacement,
      rsi: currentRSI,
      volumeProfile,
      volumeRatio,
      rangeCompression,
    };

    const dynamicThresholds = await this.fetchDynamicThresholds(
      symbol,
      session,
      atrExpansion,
      emaDisplacement,
      rangeCompression,
      volumeRatio
    );

    if (!dynamicThresholds) {
      return { type: 'live_only', indicators, sampleCount: 0 };
    }

    const recentSweep = this.detectRecentSweep(candles);
    const structuralRetest = this.detectStructuralRetest(candles);

    return this.classifyRegime(indicators, recentSweep, structuralRetest, dynamicThresholds);
  }

  /**
   * Fetch DYNAMIC thresholds from Supabase and trigger baseline update.
   *
   * CCIP-2026-0401: Returns null when:
   * - symbol or session is missing
   * - Supabase is unreachable
   * - sample_count < 20 (insufficient real data to produce valid percentiles)
   *
   * Null signals the classifier to take the live_only path — raw indicators
   * are presented to Alpha without any regime classification verdict.
   */
  private async fetchDynamicThresholds(
    symbol?: string,
    session?: RegimeSession,
    atrExpansion?: number,
    emaDisplacement?: number,
    rangeCompression?: number,
    volumeRatio?: number
  ): Promise<RegimeThresholds | null> {
    if (!symbol || !session) {
      return null;
    }

    try {
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

      const { data, error } = await supabase.rpc('get_regime_baselines', {
        p_symbol: symbol,
        p_session_name: session,
      });

      if (error || !data) {
        return null;
      }

      const sampleCount = Number(data.sample_count) || 0;

      if ((data.is_dynamic !== true) || sampleCount < 20) {
        return null;
      }

      const atrExpansionP70 = Number(data.atr_expansion_p70);
      const atrExpansionP85 = Number(data.atr_expansion_p85);
      const atrExpansionP30 = Number(data.atr_expansion_p30);
      const emaDisplacementP80 = Number(data.ema_displacement_p80);
      const emaDisplacementP90 = Number(data.ema_displacement_p90);
      const emaDisplacementP95 = Number(data.ema_displacement_p95);
      const rangeCompressionP20 = Number(data.range_compression_p20);
      const rangeCompressionP35 = Number(data.range_compression_p35);

      if (
        !atrExpansionP70 || !atrExpansionP85 || !atrExpansionP30 ||
        !emaDisplacementP80 || !emaDisplacementP90 || !emaDisplacementP95 ||
        !rangeCompressionP20 || !rangeCompressionP35
      ) {
        return null;
      }

      return {
        atrExpansionP70,
        atrExpansionP85,
        atrExpansionP30,
        emaDisplacementP80,
        emaDisplacementP90,
        emaDisplacementP95,
        rangeCompressionP20,
        rangeCompressionP35,
        sampleCount,
        thresholdSource: 'dynamic',
      };
    } catch {
      return null;
    }
  }

  /**
   * CCIP-2026-0401: Classify regime using DYNAMIC percentile thresholds only.
   *
   * Every condition asks "is this reading in the top/bottom N% for this exact
   * symbol+session pair?" — backed by real accumulated observations.
   *
   * When no pattern matches the dynamic thresholds, returns live_only so Alpha
   * reads the raw indicator values directly. No neutral_ranging label is emitted.
   */
  private classifyRegime(
    indicators: MicroRegimeIndicators,
    recentSweep: { detected: boolean; direction: 'up' | 'down' | null; candlesAgo: number },
    structuralRetest: { detected: boolean; direction: 'up' | 'down' | null },
    thresholds: RegimeThresholds
  ): MicroRegimeResult {
    const { atrExpansion, emaDisplacement, rsi, volumeProfile, rangeCompression } = indicators;
    const {
      atrExpansionP70, atrExpansionP85, atrExpansionP30,
      emaDisplacementP80, emaDisplacementP90, emaDisplacementP95,
      rangeCompressionP20, rangeCompressionP35,
      sampleCount,
    } = thresholds;

    // 1. Stop-Hunt Expansion — Recent sweep + ATR in top 15% for this symbol+session
    if (recentSweep.detected && recentSweep.candlesAgo <= 3 && atrExpansion > atrExpansionP85) {
      const direction = recentSweep.direction === 'up' ? 'bullish' : 'bearish';
      return { type: 'classified', regime: 'stop_hunt_expansion', confidence: 85, direction, indicators, thresholds };
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
        return { type: 'classified', regime: 'trend_acceleration', confidence: 80, direction, indicators, thresholds };
      }
    }

    // 3. Trend Exhaustion — Displacement above 90th percentile + falling volume + RSI extreme
    if (Math.abs(emaDisplacement) > emaDisplacementP90 && volumeProfile === 'falling') {
      const direction = emaDisplacement > 0 ? 'bearish' : 'bullish';
      const rsiExtreme = emaDisplacement > 0 ? rsi > 70 : rsi < 30;
      if (rsiExtreme) {
        return { type: 'classified', regime: 'trend_exhaustion', confidence: 70, direction, indicators, thresholds };
      }
    }

    // 4. Mean Reversion Pocket — Displacement above 80th percentile + RSI extreme + no sweep
    if (Math.abs(emaDisplacement) > emaDisplacementP80 && !recentSweep.detected) {
      const direction = emaDisplacement > 0 ? 'bearish' : 'bullish';
      const rsiExtreme = (emaDisplacement > 0 && rsi > 75) || (emaDisplacement < 0 && rsi < 25);
      if (rsiExtreme) {
        return { type: 'classified', regime: 'mean_reversion_pocket', confidence: 75, direction, indicators, thresholds };
      }
    }

    // 5. Liquidity Vacuum — Range in bottom 20% + stable volume + ATR in bottom 30%
    if (
      rangeCompression < rangeCompressionP20 &&
      volumeProfile === 'stable' &&
      atrExpansion < atrExpansionP30
    ) {
      return { type: 'classified', regime: 'liquidity_vacuum', confidence: 65, direction: 'neutral', indicators, thresholds };
    }

    // 6. Pre-Break Compression — Range between P20 and P35 + near EMA (displacement below P80)
    if (
      rangeCompression < rangeCompressionP35 &&
      rangeCompression > rangeCompressionP20 &&
      Math.abs(emaDisplacement) < emaDisplacementP80
    ) {
      return { type: 'classified', regime: 'pre_break_compression', confidence: 70, direction: 'neutral', indicators, thresholds };
    }

    // 7. Post-Break Retest — Structural retest detected
    if (structuralRetest.detected) {
      const dir = structuralRetest.direction!;
      return {
        type: 'classified',
        regime: 'post_break_retest',
        confidence: 80,
        direction: dir === 'up' ? 'bullish' : 'bearish',
        indicators,
        thresholds,
      };
    }

    // No pattern matched the dynamic thresholds — return live indicators only.
    // CCIP-2026-0401: Do NOT emit neutral_ranging. Alpha reads the raw numbers.
    return { type: 'live_only', indicators, sampleCount };
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

}

export const microRegimeClassifier = new MicroRegimeClassifier();
