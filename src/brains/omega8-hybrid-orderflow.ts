/**
 * Omega-8: Order Flow & Liquidity Pattern Sensor
 *
 * CCIP-2026-03-12: PURE PATTERN SENSOR REFACTOR
 *
 * Omega-8 is a RAW DATA PROVIDER, not a decision-maker.
 * It detects and computes orderflow patterns that cannot be derived
 * from raw candle data alone, and returns them as structured facts
 * for Alpha to reason about independently.
 *
 * WHAT THIS MODULE DOES:
 * - Detects equal highs / equal lows (cluster prices)
 * - Detects liquidity sweeps (wick-dominant reversal candles)
 * - Detects Fair Value Gaps (unmitigated price imbalance zones)
 * - Detects volume anomalies (spikes, absorption)
 * - Detects accumulation / distribution zones
 * - Classifies liquidity context (sweep type + BOS confirmation)
 * - Computes exact sweep wick extreme price (SSOT for stop placement)
 *
 * WHAT THIS MODULE DOES NOT DO:
 * - Score patterns (no point-based scoring)
 * - Calculate bias (no buy/sell/neutral decision)
 * - Calculate confidence (no 0-100% score)
 * - Call any LLM (no OpenAI calls)
 * - Vote on direction (no direction_support field)
 *
 * Alpha receives the raw computed facts and reasons about them.
 * Architecture owner: CCIP-2026-03-12
 */

import { supabase } from '../lib/supabase';
import {
  VOLUME_THRESHOLDS,
  LIQUIDITY_ZONES,
} from '../config/orderflow-thresholds';
import type { Omega8Vote } from '../types/omega';

export interface Omega8Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Omega8MarketSnapshot {
  symbol: string;
  timeframe: string;
  price: number;
  atr: number;
  candles: Omega8Candle[];
  trendBias: 'up' | 'down' | 'sideways';
  support: number[];
  resistance: number[];
}

export interface Omega8Patterns {
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

export class Omega8HybridBrain {
  private readonly VOL_SPIKE_THRESHOLD = VOLUME_THRESHOLDS.MODERATE_SPIKE_MULTIPLIER;
  private readonly ABSORPTION_VOL_THRESHOLD = LIQUIDITY_ZONES.MIN_VOLUME_CLUSTER_MULTIPLIER;

  /**
   * Main entry point — pure pattern scan, no scoring, no LLM, no bias.
   * Returns Omega8Vote: raw computed facts for Alpha to reason about.
   */
  async runOmega8(snapshot: Omega8MarketSnapshot): Promise<Omega8Vote> {
    const patterns = this.detectPatterns(snapshot);
    const liquidityAnalysis = this.determineLiquidityBias(patterns, snapshot.candles);
    const signals = this.generateSignals(patterns);
    const reasoning = this.buildRawReasoning(patterns, liquidityAnalysis);

    await this.logUsage(snapshot.symbol);

    return {
      patterns,
      signals,
      reasoning,
      liquidity_bias: liquidityAnalysis.bias,
      sweep_details: liquidityAnalysis.sweep_details,
    };
  }

  /**
   * LAYER 1: DETERMINISTIC PATTERN DETECTION (NO LLM, NO SCORING)
   */
  private detectPatterns(snapshot: Omega8MarketSnapshot): Omega8Patterns {
    const { candles, atr, price } = snapshot;

    const tolerance = atr * 0.1;

    const equalHighs = this.detectEqualHighs(candles, price, tolerance);
    const equalLows = this.detectEqualLows(candles, price, tolerance);

    const sweeps = this.detectSweeps(candles, tolerance);
    const sweptHighs = sweeps.highSweeps;
    const sweptLows = sweeps.lowSweeps;

    const fvg = this.detectFVG(candles);
    const fvgBullish = fvg.bullish;
    const fvgBearish = fvg.bearish;

    const volAnalysis = this.analyzeVolume(candles);
    const volSpikeBullish = volAnalysis.bullishSpike;
    const volSpikeBearish = volAnalysis.bearishSpike;
    const absorptionBullish = volAnalysis.absorptionBullish;
    const absorptionBearish = volAnalysis.absorptionBearish;

    const zones = this.detectAccumulationDistribution(candles);
    const accumulationZone = zones.accumulation;
    const distributionZone = zones.distribution;

    const confluenceScore = this.calculateConfluence({
      sweptHighs, sweptLows, fvgBullish, fvgBearish,
      volSpikeBullish, volSpikeBearish,
      absorptionBullish, absorptionBearish
    });

    return {
      equalHighs,
      equalLows,
      sweptHighs,
      sweptLows,
      fvgBullish,
      fvgBearish,
      volSpikeBullish,
      volSpikeBearish,
      absorptionBullish,
      absorptionBearish,
      accumulationZone,
      distributionZone,
      confluenceScore
    };
  }

  private detectEqualHighs(candles: Omega8Candle[], currentPrice: number, tolerance: number): number {
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

  private detectEqualLows(candles: Omega8Candle[], currentPrice: number, tolerance: number): number {
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

  private detectSweeps(candles: Omega8Candle[], tolerance: number): { highSweeps: number; lowSweeps: number } {
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

  private detectFVG(candles: Omega8Candle[]): { bullish: number; bearish: number } {
    if (candles.length < 3) return { bullish: 0, bearish: 0 };

    let bullish = 0;
    let bearish = 0;

    for (let i = 0; i < candles.length - 2; i++) {
      const c1 = candles[i];
      const c3 = candles[i + 2];

      const gapUp = c3.low - c1.high;
      const gapDown = c1.low - c3.high;

      if (gapUp > 0) {
        bullish++;
      } else if (gapDown > 0) {
        bearish++;
      }
    }

    return { bullish, bearish };
  }

  private analyzeVolume(candles: Omega8Candle[]): {
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
    const closeNearHigh = (lastCandle.close - lastCandle.low) / (lastCandle.high - lastCandle.low) > 0.7;
    const closeNearLow = (lastCandle.high - lastCandle.close) / (lastCandle.high - lastCandle.low) > 0.7;

    const bullishSpike = lastVol > avgVol * this.VOL_SPIKE_THRESHOLD && isBullishCandle && closeNearHigh;
    const bearishSpike = lastVol > avgVol * this.VOL_SPIKE_THRESHOLD && !isBullishCandle && closeNearLow;

    const absorptionBullish = lastVol > avgVol * this.ABSORPTION_VOL_THRESHOLD && isBullishCandle && !closeNearHigh;
    const absorptionBearish = lastVol > avgVol * this.ABSORPTION_VOL_THRESHOLD && !isBullishCandle && !closeNearLow;

    return { bullishSpike, bearishSpike, absorptionBullish, absorptionBearish };
  }

  private detectAccumulationDistribution(candles: Omega8Candle[]): { accumulation: boolean; distribution: boolean } {
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

    const sweepRatio = signals.sweptHighs / Math.max(signals.sweptLows, 1);
    const inverseSweepRatio = signals.sweptLows / Math.max(signals.sweptHighs, 1);

    if (sweepRatio >= 3) {
      bullishSignals++;
    } else if (signals.sweptHighs > 0) {
      bearishSignals++;
    }

    if (inverseSweepRatio >= 3) {
      bearishSignals++;
    }

    if (signals.fvgBearish > 0) bearishSignals++;
    if (signals.volSpikeBearish) bearishSignals++;
    if (signals.absorptionBearish) bearishSignals++;

    return Math.max(bullishSignals, bearishSignals);
  }

  /**
   * LIQUIDITY BIAS CLASSIFICATION
   * Classifies the structural context of detected sweeps.
   * This is a FACTUAL classification (what happened), not a directional opinion.
   *
   * stoprun_entry  = Sweep detected WITH Break of Structure — liquidity taken, direction confirmed
   * stoprun_risk   = Recent sweep (<3 candles) WITHOUT BOS — manipulation risk still active
   * clean          = No recent sweeps, normal orderflow
   * reaccumulation = Accumulation zone detected
   * distribution   = Distribution zone detected
   */
  private determineLiquidityBias(
    patterns: Omega8Patterns,
    candles?: Omega8Candle[]
  ): {
    bias: 'clean' | 'stoprun_risk' | 'stoprun_entry' | 'reaccumulation' | 'distribution';
    sweep_details?: { type: 'high' | 'low' | 'none'; candles_ago: number; has_bos: boolean; sweep_extreme_price?: number; nearest_cluster_price?: number };
  } {
    const hasSweeps = patterns.sweptHighs > 0 || patterns.sweptLows > 0;

    if (hasSweeps && candles && candles.length >= 5) {
      const sweepAnalysis = this.analyzeSweepWithBOS(candles, patterns);

      if (sweepAnalysis.has_bos) {
        console.log(`[Omega-8] Stop-run ${sweepAnalysis.type} detected ${sweepAnalysis.candles_ago} candles ago WITH BOS. Sweep extreme: ${sweepAnalysis.sweep_extreme_price?.toFixed(5) ?? 'N/A'}`);
        return {
          bias: 'stoprun_entry',
          sweep_details: sweepAnalysis
        };
      }

      if (sweepAnalysis.candles_ago <= 3 && !sweepAnalysis.has_bos) {
        console.log(`[Omega-8] Recent stop-run ${sweepAnalysis.type} (${sweepAnalysis.candles_ago} candles ago) WITHOUT BOS. Sweep extreme: ${sweepAnalysis.sweep_extreme_price?.toFixed(5) ?? 'N/A'}`);
        return {
          bias: 'stoprun_risk',
          sweep_details: sweepAnalysis
        };
      }

      if (sweepAnalysis.candles_ago > 5) {
        return { bias: 'clean', sweep_details: sweepAnalysis };
      }
    }

    if (patterns.accumulationZone) {
      return { bias: 'reaccumulation' };
    }

    if (patterns.distributionZone) {
      return { bias: 'distribution' };
    }

    return { bias: 'clean' };
  }

  private analyzeSweepWithBOS(
    candles: Omega8Candle[],
    patterns: Omega8Patterns
  ): { type: 'high' | 'low' | 'none'; candles_ago: number; has_bos: boolean; sweep_extreme_price?: number; nearest_cluster_price?: number } {
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

    const sweepCandle = recentCandles[sweepCandleIdx];
    const candles_ago = recentCandles.length - 1 - sweepCandleIdx;

    // SSOT: Exact price of the sweep wick extreme.
    // For low sweeps: wick low = liquidity pool price — SL must clear below it.
    // For high sweeps: wick high = liquidity pool price — SL must clear above it.
    const sweep_extreme_price = isLowSweep ? sweepCandle.low : sweepCandle.high;

    const tolerance = (recentCandles[recentCandles.length - 1].high - recentCandles[recentCandles.length - 1].low) * 2;
    let nearest_cluster_price: number | undefined;
    if (isLowSweep) {
      const nearLows = recentCandles
        .filter(c => Math.abs(c.low - sweep_extreme_price) <= tolerance && c !== sweepCandle)
        .map(c => c.low);
      if (nearLows.length > 0) {
        nearest_cluster_price = Math.min(...nearLows);
      }
    } else {
      const nearHighs = recentCandles
        .filter(c => Math.abs(c.high - sweep_extreme_price) <= tolerance && c !== sweepCandle)
        .map(c => c.high);
      if (nearHighs.length > 0) {
        nearest_cluster_price = Math.max(...nearHighs);
      }
    }

    let has_bos = false;

    if (sweepCandleIdx < recentCandles.length - 1) {
      for (let i = sweepCandleIdx + 1; i < recentCandles.length; i++) {
        const afterCandle = recentCandles[i];

        if (isHighSweep) {
          if (afterCandle.close < sweepCandle.low) {
            has_bos = true;
            break;
          }
        }

        if (isLowSweep) {
          if (afterCandle.close > sweepCandle.high) {
            has_bos = true;
            break;
          }
        }
      }
    }

    return {
      type: isHighSweep ? 'high' : 'low',
      candles_ago,
      has_bos,
      sweep_extreme_price,
      nearest_cluster_price
    };
  }

  private generateSignals(patterns: Omega8Patterns): string[] {
    const signals: string[] = [];

    if (patterns.sweptLows > 0) signals.push('liq_sweep_low');
    if (patterns.sweptHighs > 0) signals.push('liq_sweep_high');
    if (patterns.fvgBullish > 0) signals.push('bull_fvg');
    if (patterns.fvgBearish > 0) signals.push('bear_fvg');
    if (patterns.volSpikeBullish) signals.push('bull_vol_spike');
    if (patterns.volSpikeBearish) signals.push('bear_vol_spike');
    if (patterns.absorptionBullish) signals.push('bull_absorption');
    if (patterns.absorptionBearish) signals.push('bear_absorption');
    if (patterns.accumulationZone) signals.push('accumulation');
    if (patterns.distributionZone) signals.push('distribution');
    if (patterns.confluenceScore >= 3) signals.push('high_confluence');

    return signals;
  }

  /**
   * Builds a raw factual reasoning string — no bias labels, no confidence scores.
   * States what was detected and what it structurally means.
   */
  private buildRawReasoning(
    patterns: Omega8Patterns,
    liquidityAnalysis: ReturnType<Omega8HybridBrain['determineLiquidityBias']>
  ): string {
    const parts: string[] = [];

    parts.push(`Swept highs: ${patterns.sweptHighs}, swept lows: ${patterns.sweptLows}`);
    parts.push(`FVG bullish: ${patterns.fvgBullish}, FVG bearish: ${patterns.fvgBearish}`);
    parts.push(`Equal highs: ${patterns.equalHighs}, equal lows: ${patterns.equalLows}`);

    if (patterns.accumulationZone) parts.push('Accumulation zone detected');
    if (patterns.distributionZone) parts.push('Distribution zone detected');
    if (patterns.volSpikeBullish) parts.push('Bullish volume spike on last candle');
    if (patterns.volSpikeBearish) parts.push('Bearish volume spike on last candle');
    if (patterns.absorptionBullish) parts.push('Bullish absorption (high vol, body not closing at high)');
    if (patterns.absorptionBearish) parts.push('Bearish absorption (high vol, body not closing at low)');

    parts.push(`Liquidity context: ${liquidityAnalysis.bias}`);

    if (liquidityAnalysis.sweep_details && liquidityAnalysis.sweep_details.type !== 'none') {
      const sd = liquidityAnalysis.sweep_details;
      parts.push(`Sweep: ${sd.type} sweep ${sd.candles_ago} candles ago, BOS=${sd.has_bos}${sd.sweep_extreme_price ? `, extreme=${sd.sweep_extreme_price.toFixed(5)}` : ''}`);
    }

    return parts.join(' | ');
  }

  private async logUsage(symbol: string): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id;

      if (!userId) return;

      await supabase.from('omega8_hybrid_usage').insert({
        user_id: userId,
        symbol,
        confidence: 0,
        used_llm: false,
        tokens_used: 0,
        created_at: new Date().toISOString()
      });
    } catch {
      // Non-critical logging — fail silently
    }
  }
}

export const omega8Hybrid = new Omega8HybridBrain();
