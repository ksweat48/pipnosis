/**
 * Omega-8 HYBRID: Order Flow & Liquidity Specialist
 *
 * Architecture:
 * - Layer 1: Deterministic pattern detection (pure math, no LLM)
 * - Layer 2: Deterministic scoring & bias calculation
 * - Layer 3: OPTIONAL LLM refinement (only when ambiguous 35-65 confidence)
 *
 * Patterns detected:
 * - Equal highs/lows (ATR-relative tolerance)
 * - Liquidity sweeps & stop-runs
 * - Fair Value Gaps (FVG)
 * - Volume anomalies (directional)
 * - Accumulation/Distribution zones
 *
 * LLM usage: ~20-30% of cases (when truly ambiguous)
 * Cost reduction: ~70-80% vs full LLM
 * Speed improvement: ~10x on deterministic cases
 */

import { openAIClient } from '../services/openai-client';
import type { Omega8Vote } from '../types/omega';
import { supabase } from '../lib/supabase';
import { llmTokenTracker } from '../services/llm-token-tracker';
import {
  VOLUME_THRESHOLDS,
  LIQUIDITY_ZONES,
  SMART_MONEY
} from '../config/orderflow-thresholds';

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

export interface DeterministicOmega8Decision {
  baseBias: 'buy' | 'sell' | 'neutral';
  confidence: number;
  scoreDetails: string[];
  rawScore: number;
}

export interface Omega8LLMRefinement {
  llmBias: 'buy' | 'sell' | 'neutral';
  llmConfidence: number;
  llmReason: string;
  tokensUsed: number;
}

export interface Omega8HybridResult {
  omega: 'orderflow';
  bias: 'buy' | 'sell' | 'neutral';
  confidence: number;
  deterministicBias: 'buy' | 'sell' | 'neutral';
  deterministicConfidence: number;
  usedLLM: boolean;
  llmBias?: 'buy' | 'sell' | 'neutral';
  llmConfidence?: number;
  llmReason?: string;
  patterns: Omega8Patterns;
  signals: string[];
  reason: string;
  /** @deprecated Omegas no longer vote. Use bias + direction_support instead. */
  vote?: 'BUY' | 'SELL';
  reasoning: string;
  liquidity_bias: 'clean' | 'stoprun_risk' | 'stoprun_entry' | 'reaccumulation' | 'distribution';
  direction_support: 'buy' | 'sell' | 'neutral';
  sweep_details?: {
    type: 'high' | 'low' | 'none';
    candles_ago: number;
    has_bos: boolean;
    /** Exact price of the sweep wick extreme — low of sweep candle for low sweeps, high for high sweeps */
    sweep_extreme_price?: number;
    /** Equal low/high cluster price nearest to the sweep extreme */
    nearest_cluster_price?: number;
  };
}

export class Omega8HybridBrain {
  private readonly LLM_CONFIDENCE_LOWER = 35;
  private readonly LLM_CONFIDENCE_UPPER = 65;
  // Using SSOT config constants for volume analysis
  private readonly VOL_SPIKE_THRESHOLD = VOLUME_THRESHOLDS.MODERATE_SPIKE_MULTIPLIER; // 1.5x
  private readonly ABSORPTION_VOL_THRESHOLD = LIQUIDITY_ZONES.MIN_VOLUME_CLUSTER_MULTIPLIER; // 1.8x

  /**
   * Main entry point - runs hybrid analysis
   */
  async runOmega8(snapshot: Omega8MarketSnapshot): Promise<Omega8HybridResult> {
    const patterns = this.detectPatterns(snapshot);

    const deterministic = this.scoreOmega8(patterns, snapshot.trendBias, snapshot.atr);

    let llmRefinement: Omega8LLMRefinement | null = null;
    let finalBias = deterministic.baseBias;
    let finalConfidence = deterministic.confidence;

    if (this.shouldUseLLM(deterministic, patterns)) {
      console.log(`[Omega-8 Hybrid] 🤔 Ambiguous case (conf=${deterministic.confidence}) - requesting LLM refinement`);
      llmRefinement = await this.refineWithLLM(deterministic, snapshot, patterns);

      if (llmRefinement) {
        finalBias = this.combineBiases(deterministic.baseBias, llmRefinement.llmBias, deterministic.confidence, llmRefinement.llmConfidence);
        finalConfidence = this.combineConfidences(deterministic.confidence, llmRefinement.llmConfidence);
      }
    } else {
      console.log(`[Omega-8 Hybrid] ✅ Deterministic decision (conf=${deterministic.confidence}) - skipping LLM`);
    }

    const liquidityAnalysis = this.determineLiquidityBias(patterns, deterministic, snapshot.candles);
    const signals = this.generateSignals(patterns);
    const reason = this.buildReason(deterministic, llmRefinement, patterns);

    await this.logUsage(snapshot.symbol, deterministic.confidence, llmRefinement !== null, llmRefinement?.tokensUsed || 0);

    return {
      omega: 'orderflow',
      bias: finalBias,
      confidence: finalConfidence,
      deterministicBias: deterministic.baseBias,
      deterministicConfidence: deterministic.confidence,
      usedLLM: llmRefinement !== null,
      llmBias: llmRefinement?.llmBias,
      llmConfidence: llmRefinement?.llmConfidence,
      llmReason: llmRefinement?.llmReason,
      patterns,
      signals,
      reason,
      reasoning: reason,
      liquidity_bias: liquidityAnalysis.bias,
      direction_support: finalBias,
      sweep_details: liquidityAnalysis.sweep_details
    };
  }

  /**
   * LAYER 1: DETERMINISTIC PATTERN DETECTION (NO LLM)
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
      const c2 = candles[i + 1];
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
   * LAYER 2: DETERMINISTIC SCORING & BIAS
   */
  private scoreOmega8(patterns: Omega8Patterns, trendBias: 'up' | 'down' | 'sideways', atr: number): DeterministicOmega8Decision {
    let score = 0;
    const scoreDetails: string[] = [];

    const sweepRatio = patterns.sweptHighs / Math.max(patterns.sweptLows, 1);
    const inverseSweepRatio = patterns.sweptLows / Math.max(patterns.sweptHighs, 1);

    if (patterns.sweptLows > 0) {
      if (inverseSweepRatio >= 3) {
        const points = 20 * patterns.sweptLows;
        score -= points;
        scoreDetails.push(`-${points} (bearish momentum: ${patterns.sweptLows}L/${patterns.sweptHighs}H ratio)`);
      } else if (trendBias === 'up') {
        const points = 15 * patterns.sweptLows;
        score += points;
        scoreDetails.push(`+${points} (bullish liq sweep in uptrend)`);
      }
    }

    if (patterns.sweptHighs > 0) {
      if (sweepRatio >= 3) {
        const points = 15 * patterns.sweptHighs;
        score += points;
        scoreDetails.push(`+${points} (bullish momentum: ${patterns.sweptHighs}H/${patterns.sweptLows}L ratio)`);
      } else if (trendBias === 'down') {
        const points = 20 * patterns.sweptHighs;
        score -= points;
        scoreDetails.push(`-${points} (bearish liq sweep in downtrend)`);
      } else if (trendBias === 'sideways' && sweepRatio >= 2) {
        const points = 10 * patterns.sweptHighs;
        score += points;
        scoreDetails.push(`+${points} (upward breakout momentum in range)`);
      }
    }

    if (patterns.fvgBullish > 0) {
      const points = 10 * patterns.fvgBullish;
      score += points;
      scoreDetails.push(`+${points} (bullish FVG)`);
    }

    if (patterns.fvgBearish > 0) {
      const points = 10 * patterns.fvgBearish;
      score -= points;
      scoreDetails.push(`-${points} (bearish FVG)`);
    }

    if (patterns.volSpikeBullish) {
      score += 10;
      scoreDetails.push('+10 (bullish vol spike)');
    }

    if (patterns.volSpikeBearish) {
      score -= 10;
      scoreDetails.push('-10 (bearish vol spike)');
    }

    if (patterns.absorptionBullish) {
      score += 10;
      scoreDetails.push('+10 (bullish absorption)');
    }

    if (patterns.absorptionBearish) {
      score -= 10;
      scoreDetails.push('-10 (bearish absorption)');
    }

    if (patterns.confluenceScore >= 3) {
      const bonus = 15;
      score += score > 0 ? bonus : -bonus;
      scoreDetails.push(`${score > 0 ? '+' : '-'}${bonus} (confluence bonus)`);
    }

    if (patterns.accumulationZone && trendBias !== 'down') {
      score += 8;
      scoreDetails.push('+8 (accumulation zone)');
    }

    if (patterns.distributionZone && trendBias !== 'up') {
      score -= 8;
      scoreDetails.push('-8 (distribution zone)');
    }

    let baseBias: 'buy' | 'sell' | 'neutral';
    let confidence: number;

    if (score >= 20) {
      baseBias = 'buy';
      confidence = Math.min(90, 50 + score);
    } else if (score <= -20) {
      baseBias = 'sell';
      confidence = Math.min(90, 50 + Math.abs(score));
    } else if (score > 0) {
      baseBias = 'buy';
      confidence = Math.max(1, Math.min(25, 10 + score * 0.5));
    } else if (score < 0) {
      baseBias = 'sell';
      confidence = Math.max(1, Math.min(25, 10 + Math.abs(score) * 0.5));
    } else {
      baseBias = 'neutral';
      confidence = 5;
    }

    return { baseBias, confidence, scoreDetails, rawScore: score };
  }

  /**
   * LAYER 3: LLM REFINEMENT (CONDITIONAL)
   */
  private shouldUseLLM(deterministic: DeterministicOmega8Decision, patterns: Omega8Patterns): boolean {
    if (deterministic.confidence >= 75) return false;
    if (deterministic.confidence <= 25) return false;

    if (deterministic.confidence >= this.LLM_CONFIDENCE_LOWER &&
        deterministic.confidence <= this.LLM_CONFIDENCE_UPPER) {
      return true;
    }

    const conflicting = (patterns.sweptHighs > 0 && patterns.sweptLows > 0) ||
                       (patterns.fvgBullish > 0 && patterns.fvgBearish > 0) ||
                       (patterns.volSpikeBullish && patterns.volSpikeBearish);

    return conflicting;
  }

  private async refineWithLLM(
    deterministic: DeterministicOmega8Decision,
    snapshot: Omega8MarketSnapshot,
    patterns: Omega8Patterns
  ): Promise<Omega8LLMRefinement | null> {
    const recentCandles = snapshot.candles.slice(-3).map(c => ({
      o: c.open.toFixed(2),
      h: c.high.toFixed(2),
      l: c.low.toFixed(2),
      c: c.close.toFixed(2),
      v: c.volume
    }));

    const sweepRatio = patterns.sweptHighs / Math.max(patterns.sweptLows, 1);
    const sweepContext = sweepRatio >= 3
      ? `sweepRatio:${patterns.sweptHighs}H/${patterns.sweptLows}L=BULLISH_MOMENTUM`
      : sweepRatio <= 0.33 && patterns.sweptLows > 0
        ? `sweepRatio:${patterns.sweptHighs}H/${patterns.sweptLows}L=BEARISH_MOMENTUM`
        : `sweepRatio:${patterns.sweptHighs}H/${patterns.sweptLows}L=BALANCED`;

    const prompt = `sym:${snapshot.symbol} tf:${snapshot.timeframe}
trend:${snapshot.trendBias}
patterns:{eh:${patterns.equalHighs},el:${patterns.equalLows},sh:${patterns.sweptHighs}(=price pushed UP to grab liquidity above highs),sl:${patterns.sweptLows}(=price pushed DOWN to grab liquidity below lows),fvgB:${patterns.fvgBullish},fvgBr:${patterns.fvgBearish},volB:${patterns.volSpikeBullish},volBr:${patterns.volSpikeBearish},acc:${patterns.accumulationZone},dist:${patterns.distributionZone}}
${sweepContext}
detBias:${deterministic.baseBias} detConf:${deterministic.confidence}
candles:${JSON.stringify(recentCandles)}

IMPORTANT: sweptHighs=price going UP to sweep above previous highs. High ratio of sweptHighs:sweptLows indicates bullish momentum, not bearish reversal, unless BOS (break of structure below) is confirmed.

Task: interpret orderflow patterns, decide: buy/sell/neutral. Be decisive if clear.

Return JSON:
{"bias":"buy|sell|neutral","conf":0-100,"why":"short"}`;

    try {
      const response = await openAIClient.chat(
        [
          {
            role: 'system',
            content: 'You are Omega-8, orderflow/liquidity specialist. Return JSON only. No prose.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        {
          model: 'gpt-4o-mini',
          temperature: 0.3,
          max_tokens: 80,
          requestType: 'omega8_hybrid_refinement',
          endpoint: 'omega8-hybrid'
        }
      );

      // Log token usage
      await llmTokenTracker.logUsage({
        brainName: 'Omega-8',
        model: 'gpt-4o-mini',
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0,
        contextType: 'omega8_hybrid_refinement',
        userId: undefined,
        sessionId: undefined
      });

      const content = response.choices[0]?.message?.content || '{}';
      const tokensUsed = response.usage?.total_tokens || 0;

      const parsed = this.parseLLMRefinement(content);

      if (parsed) {
        return { ...parsed, tokensUsed };
      }

      return null;
    } catch (error) {
      console.error('[Omega-8 Hybrid] LLM refinement error:', error);
      return null;
    }
  }

  private parseLLMRefinement(response: string): Omit<Omega8LLMRefinement, 'tokensUsed'> | null {
    try {
      const cleaned = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      const bias = parsed.bias as 'buy' | 'sell' | 'neutral';
      if (!['buy', 'sell', 'neutral'].includes(bias)) {
        return null;
      }

      return {
        llmBias: bias,
        llmConfidence: Math.min(100, Math.max(0, parsed.conf || 50)),
        llmReason: parsed.why || 'No reason provided'
      };
    } catch (error) {
      console.error('[Omega-8 Hybrid] LLM parse error:', error);
      return null;
    }
  }

  private combineBiases(
    detBias: 'buy' | 'sell' | 'neutral',
    llmBias: 'buy' | 'sell' | 'neutral',
    detConf: number,
    llmConf: number
  ): 'buy' | 'sell' | 'neutral' {
    if (detBias === llmBias) return detBias;

    if (Math.abs(detConf - llmConf) > 40) {
      return detConf > llmConf ? detBias : llmBias;
    }

    const avgConf = (detConf + llmConf) / 2;
    if (avgConf < 50) return 'neutral';

    return detConf > llmConf ? detBias : llmBias;
  }

  private combineConfidences(detConf: number, llmConf: number): number {
    return Math.round((detConf + llmConf) / 2);
  }

  /**
   * HELPER METHODS
   */
  private biasToVote(bias: 'buy' | 'sell' | 'neutral', snapshot: Omega8MarketSnapshot): 'BUY' | 'SELL' {
    if (bias === 'buy') return 'BUY';
    if (bias === 'sell') return 'SELL';
    return snapshot.trendBias === 'down' ? 'SELL' : 'BUY';
  }

  private determineLiquidityBias(
    patterns: Omega8Patterns,
    deterministic: DeterministicOmega8Decision,
    candles?: Omega8Candle[]
  ): {
    bias: 'clean' | 'stoprun_risk' | 'stoprun_entry' | 'reaccumulation' | 'distribution';
    sweep_details?: { type: 'high' | 'low' | 'none'; candles_ago: number; has_bos: boolean; sweep_extreme_price?: number; nearest_cluster_price?: number };
  } {
    const hasSweeps = patterns.sweptHighs > 0 || patterns.sweptLows > 0;

    if (hasSweeps && candles && candles.length >= 5) {
      const sweepAnalysis = this.analyzeSweepWithBOS(candles, patterns);

      if (sweepAnalysis.has_bos) {
        console.log(`[Omega-8] Stop-run ${sweepAnalysis.type} detected ${sweepAnalysis.candles_ago} candles ago WITH BOS confirmation - GOOD ENTRY. Sweep extreme: ${sweepAnalysis.sweep_extreme_price?.toFixed(5) ?? 'N/A'}`);
        return {
          bias: 'stoprun_entry',
          sweep_details: sweepAnalysis
        };
      }

      if (sweepAnalysis.candles_ago <= 3 && !sweepAnalysis.has_bos) {
        console.log(`[Omega-8] Recent stop-run ${sweepAnalysis.type} (${sweepAnalysis.candles_ago} candles ago) WITHOUT BOS - RISKY. Sweep extreme: ${sweepAnalysis.sweep_extreme_price?.toFixed(5) ?? 'N/A'}`);
        return {
          bias: 'stoprun_risk',
          sweep_details: sweepAnalysis
        };
      }

      if (sweepAnalysis.candles_ago > 5) {
        console.log(`[Omega-8] Old stop-run ${sweepAnalysis.type} (${sweepAnalysis.candles_ago} candles ago) - treating as clean`);
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

    // SSOT: Capture the exact price of the sweep wick extreme.
    // For low sweeps: the wick low is the liquidity pool price — SL must clear below it.
    // For high sweeps: the wick high is the liquidity pool price — SL must clear above it.
    const sweep_extreme_price = isLowSweep ? sweepCandle.low : sweepCandle.high;

    // Find nearest equal high/low cluster price for additional context
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

  private buildReason(
    deterministic: DeterministicOmega8Decision,
    llmRefinement: Omega8LLMRefinement | null,
    patterns: Omega8Patterns
  ): string {
    const parts: string[] = [];

    if (deterministic.baseBias !== 'neutral') {
      parts.push(`Orderflow: ${deterministic.baseBias.toUpperCase()} (${deterministic.confidence}%)`);
    } else {
      parts.push(`Orderflow: NEUTRAL (${deterministic.confidence}%)`);
    }

    if (deterministic.scoreDetails.length > 0) {
      parts.push(deterministic.scoreDetails.slice(0, 2).join(', '));
    }

    if (llmRefinement) {
      parts.push(`LLM: ${llmRefinement.llmReason}`);
    }

    return parts.join(' | ');
  }

  private async logUsage(symbol: string, confidence: number, usedLLM: boolean, tokensUsed: number): Promise<void> {
    try {
      // Get current user ID
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id;

      // Skip logging if no user context available
      if (!userId) {
        console.warn('[Omega-8 Hybrid] No user context available, skipping usage log');
        return;
      }

      await supabase.from('omega8_hybrid_usage').insert({
        user_id: userId,
        symbol,
        confidence,
        used_llm: usedLLM,
        tokens_used: tokensUsed,
        created_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('[Omega-8 Hybrid] Failed to log usage:', error);
    }
  }
}

export const omega8Hybrid = new Omega8HybridBrain();
