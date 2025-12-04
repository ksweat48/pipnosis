/**
 * Omega-8: Dark Pool & Order Flow Specialist
 *
 * Specializes in:
 * - Liquidity zone identification
 * - Stop-run risk detection
 * - Equal highs/lows sweep patterns
 * - Imbalance zones (FVG-style)
 * - Magnet liquidity levels
 * - Institutional behavior signals
 *
 * Uses ultra-compressed prompts for cost efficiency
 */

import { openAIClient } from '../../services/openai-client';
import type { Omega8Vote, Omega8LiquidityBias } from '../../types/omega';

export interface OrderFlowSnapshot {
  p: number;
  liq_above: number[];
  liq_below: number[];
  eq_highs: number[];
  eq_lows: number[];
  imb_zones: Array<[number, number]>;
  recent_sweeps: string[];
  vol_profile: string;
  tr: string;
  vol: string;
  atr: number;
  current_sl?: number;
}

class Omega8OrderFlowBrain {
  /**
   * Evaluate order flow and liquidity conditions
   */
  async evaluate(snapshot: OrderFlowSnapshot): Promise<Omega8Vote> {
    const prompt = `OrderFlow:
${JSON.stringify(snapshot)}

Analyze liquidity zones, stop-run risk, sweep patterns.
liquidity_bias: clean (safe), stoprun_risk (danger near stops), reaccumulation (building), distribution (selling).
direction_support: buy/sell/neutral based on order flow.

Return JSON only:
{
  "vote": "BUY|SELL|NO_TRADE",
  "confidence": 0-100,
  "reasoning": "brief 1-line",
  "liquidity_bias": "clean|stoprun_risk|reaccumulation|distribution",
  "direction_support": "buy|sell|neutral"
}`;

    try {
      const response = await openAIClient.chat(
        [
          {
            role: 'system',
            content: 'You are Omega8, order flow specialist. Detect liquidity traps, stop runs. Return JSON only.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        {
          model: 'gpt-4o-mini',
          temperature: 0.3,
          max_tokens: 120,
          requestType: 'omega8_orderflow_vote',
          endpoint: 'omega8-orderflow'
        }
      );

      const content = response.choices[0]?.message?.content || '{}';
      return this.parseVote(content);
    } catch (error) {
      console.error('[Omega-8 OrderFlow] Error:', error);
      return {
        vote: 'NO_TRADE',
        confidence: 0,
        reasoning: 'OrderFlow analysis failed',
        liquidity_bias: 'clean',
        direction_support: 'neutral'
      };
    }
  }

  /**
   * Parse LLM response into Omega8Vote
   */
  private parseVote(response: string): Omega8Vote {
    try {
      const cleaned = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();

      const parsed = JSON.parse(cleaned);

      const liquidityBias = this.validateLiquidityBias(parsed.liquidity_bias);
      const directionSupport = this.validateDirectionSupport(parsed.direction_support);

      return {
        vote: parsed.vote || 'NO_TRADE',
        confidence: Math.min(100, Math.max(0, parsed.confidence || 0)),
        reasoning: parsed.reasoning || 'No reasoning provided',
        liquidity_bias: liquidityBias,
        direction_support: directionSupport
      };
    } catch (error) {
      console.error('[Omega-8 OrderFlow] Parse error:', error);
      return {
        vote: 'NO_TRADE',
        confidence: 0,
        reasoning: 'Parse failed',
        liquidity_bias: 'clean',
        direction_support: 'neutral'
      };
    }
  }

  /**
   * Validate and sanitize liquidity bias
   */
  private validateLiquidityBias(bias: any): Omega8LiquidityBias {
    const validBiases: Omega8LiquidityBias[] = ['clean', 'stoprun_risk', 'reaccumulation', 'distribution'];
    if (validBiases.includes(bias)) {
      return bias;
    }
    return 'clean';
  }

  /**
   * Validate and sanitize direction support
   */
  private validateDirectionSupport(dir: any): 'buy' | 'sell' | 'neutral' {
    const validDirections = ['buy', 'sell', 'neutral'];
    if (validDirections.includes(dir)) {
      return dir;
    }
    return 'neutral';
  }

  /**
   * Build order flow snapshot from market data
   */
  buildSnapshot(params: {
    price: number;
    support: number[];
    resistance: number[];
    recentCandles: any[];
    atr: number;
    trend: string;
    volatility: string;
    currentStopLoss?: number;
  }): OrderFlowSnapshot {
    const liqAbove = params.resistance.filter(r => r > params.price && r < params.price + params.atr * 3);
    const liqBelow = params.support.filter(s => s < params.price && s > params.price - params.atr * 3);

    const eqHighs = this.detectEqualHighs(params.recentCandles, params.price);
    const eqLows = this.detectEqualLows(params.recentCandles, params.price);
    const imbZones = this.detectImbalanceZones(params.recentCandles);
    const recentSweeps = this.detectRecentSweeps(params.recentCandles);
    const volProfile = this.assessVolumeProfile(params.recentCandles);

    return {
      p: params.price,
      liq_above: liqAbove,
      liq_below: liqBelow,
      eq_highs: eqHighs,
      eq_lows: eqLows,
      imb_zones: imbZones,
      recent_sweeps: recentSweeps,
      vol_profile: volProfile,
      tr: params.trend,
      vol: params.volatility,
      atr: params.atr,
      current_sl: params.currentStopLoss
    };
  }

  /**
   * Detect equal highs for potential sweeps
   */
  private detectEqualHighs(candles: any[], currentPrice: number): number[] {
    if (!candles || candles.length < 3) return [];

    const highs: number[] = [];
    const tolerance = 0.0002;

    for (let i = 0; i < candles.length - 1; i++) {
      const h1 = candles[i].high;
      for (let j = i + 1; j < candles.length; j++) {
        const h2 = candles[j].high;
        const diff = Math.abs(h1 - h2) / h1;
        if (diff < tolerance && h1 > currentPrice) {
          if (!highs.includes(h1)) {
            highs.push(h1);
          }
        }
      }
    }

    return highs.slice(0, 3);
  }

  /**
   * Detect equal lows for potential sweeps
   */
  private detectEqualLows(candles: any[], currentPrice: number): number[] {
    if (!candles || candles.length < 3) return [];

    const lows: number[] = [];
    const tolerance = 0.0002;

    for (let i = 0; i < candles.length - 1; i++) {
      const l1 = candles[i].low;
      for (let j = i + 1; j < candles.length; j++) {
        const l2 = candles[j].low;
        const diff = Math.abs(l1 - l2) / l1;
        if (diff < tolerance && l1 < currentPrice) {
          if (!lows.includes(l1)) {
            lows.push(l1);
          }
        }
      }
    }

    return lows.slice(0, 3);
  }

  /**
   * Detect imbalance zones (Fair Value Gaps)
   */
  private detectImbalanceZones(candles: any[]): Array<[number, number]> {
    if (!candles || candles.length < 3) return [];

    const zones: Array<[number, number]> = [];

    for (let i = 0; i < candles.length - 2; i++) {
      const c1 = candles[i];
      const c2 = candles[i + 1];
      const c3 = candles[i + 2];

      const gap1 = c1.low - c3.high;
      const gap2 = c3.low - c1.high;

      if (gap1 > 0) {
        zones.push([c3.high, c1.low]);
      } else if (gap2 > 0) {
        zones.push([c1.high, c3.low]);
      }
    }

    return zones.slice(-3);
  }

  /**
   * Detect recent sweep patterns
   */
  private detectRecentSweeps(candles: any[]): string[] {
    if (!candles || candles.length < 3) return [];

    const sweeps: string[] = [];

    for (let i = 1; i < candles.length - 1; i++) {
      const prev = candles[i - 1];
      const curr = candles[i];
      const next = candles[i + 1];

      if (curr.high > prev.high && curr.high > next.high && curr.close < curr.open) {
        sweeps.push('high_sweep');
      }

      if (curr.low < prev.low && curr.low < next.low && curr.close > curr.open) {
        sweeps.push('low_sweep');
      }
    }

    return sweeps.slice(-2);
  }

  /**
   * Assess volume profile
   */
  private assessVolumeProfile(candles: any[]): string {
    if (!candles || candles.length < 5) return 'unknown';

    const recentVols = candles.slice(-5).map(c => c.volume || 0);
    const avgVol = recentVols.reduce((a, b) => a + b, 0) / recentVols.length;
    const lastVol = recentVols[recentVols.length - 1];

    if (lastVol > avgVol * 1.5) return 'spike';
    if (lastVol < avgVol * 0.5) return 'dry';
    return 'normal';
  }
}

export const omega8OrderFlow = new Omega8OrderFlowBrain();
