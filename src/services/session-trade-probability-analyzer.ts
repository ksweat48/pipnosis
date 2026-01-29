/**
 * Session Trade Probability Analyzer
 *
 * SINGLE SOURCE OF TRUTH for calculating high-probability trade percentages
 * during active trading sessions.
 *
 * Purpose:
 * - Analyze technical indicators for each symbol in current session
 * - Calculate probability score (0-100%) based on indicator alignment
 * - Display to users BEFORE they prompt Alpha (advisory only)
 * - Help users make informed decisions about WHEN to scan for trades
 *
 * Methodology:
 * - Purely technical, deterministic (no LLM)
 * - Checks: VWAP alignment, EMAs, RSI, volume pressure, candle patterns
 * - Scores based on how many indicators align in same direction
 * - High alignment = high probability
 *
 * Governance:
 * - This is ADVISORY ONLY - does not affect Alpha's autonomous trading
 * - Results stored in trade_probability_scores table for audit trail
 * - SSOT: All probability calculations flow through this service
 * - CCIP Compliant: Non-breaking, extends existing system
 */

import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import type { Candle } from '../types/index';

export interface ProbabilityInput {
  symbol: string;
  currentPrice: number;
  candles: Candle[]; // Last 200+ candles for reliable calculations
  timeframe: string;
  direction: 'buy' | 'sell' | 'neutral';
}

export interface IndicatorAlignment {
  vwap: boolean;
  ema20: boolean;
  ema50: boolean;
  rsi: boolean;
  volumePressure: boolean;
  candlePattern: boolean;
  structure: boolean;
  momentum: boolean;
}

export interface ProbabilityResult {
  symbol: string;
  confidence: number; // 0-100%
  direction: 'buy' | 'sell';
  alignedCount: number; // How many indicators aligned
  totalIndicators: number; // Total checked
  indicators: IndicatorAlignment;
  reasoning: string[];
  colorCode: 'green' | 'yellow' | 'orange' | 'gray';
}

class SessionTradeProbabilityAnalyzer {
  private readonly INDICATOR_COUNT = 8;
  private readonly MIN_CANDLES = 50;

  /**
   * Analyze a symbol and calculate trade probability
   * SSOT: All probability calculations happen here
   */
  analyzeProbability(input: ProbabilityInput): ProbabilityResult {
    if (input.candles.length < this.MIN_CANDLES) {
      return this.getInsufficientDataResult(input.symbol);
    }

    const indicators = this.evaluateIndicators(input);
    const alignedCount = Object.values(indicators).filter(v => v).length;
    const confidence = Math.round((alignedCount / this.INDICATOR_COUNT) * 100);
    const direction = input.direction as 'buy' | 'sell';
    const colorCode = this.getColorCode(confidence);

    const reasoning = this.buildReasoning(indicators, direction, alignedCount);

    logger.info('[Probability Analyzer] Analysis complete', {
      symbol: input.symbol,
      confidence,
      alignedCount,
      direction,
      colorCode
    });

    return {
      symbol: input.symbol,
      confidence,
      direction,
      alignedCount,
      totalIndicators: this.INDICATOR_COUNT,
      indicators,
      reasoning,
      colorCode
    };
  }

  /**
   * Evaluate all technical indicators
   * Returns boolean for each indicator: aligned or not
   */
  private evaluateIndicators(input: ProbabilityInput): IndicatorAlignment {
    const recentCandles = input.candles.slice(-50); // Last 50 for recent context
    const allCandles = input.candles;

    return {
      vwap: this.checkVWAPAlignment(input.currentPrice, recentCandles, input.direction),
      ema20: this.checkEMA20Alignment(input.currentPrice, recentCandles, input.direction),
      ema50: this.checkEMA50Alignment(input.currentPrice, allCandles, input.direction),
      rsi: this.checkRSIAlignment(recentCandles, input.direction),
      volumePressure: this.checkVolumePressure(recentCandles, input.direction),
      candlePattern: this.checkCandlePattern(recentCandles, input.direction),
      structure: this.checkStructure(recentCandles, input.direction),
      momentum: this.checkMomentum(recentCandles, input.direction)
    };
  }

  /**
   * VWAP Alignment: Is price near or above/below VWAP?
   */
  private checkVWAPAlignment(price: number, candles: Candle[], direction: string): boolean {
    if (candles.length === 0) return false;

    const vwap = this.calculateVWAP(candles);
    const tolerance = Math.abs(price - vwap) / price;

    if (direction === 'buy') {
      return price >= vwap * 0.995; // Within 0.5% above VWAP
    } else {
      return price <= vwap * 1.005; // Within 0.5% below VWAP
    }
  }

  /**
   * EMA20 Alignment: Price relationship with 20-period EMA
   */
  private checkEMA20Alignment(price: number, candles: Candle[], direction: string): boolean {
    if (candles.length < 20) return false;

    const ema20 = this.calculateEMA(candles, 20);

    if (direction === 'buy') {
      return price >= ema20 * 0.99; // Price at or above EMA20
    } else {
      return price <= ema20 * 1.01; // Price at or below EMA20
    }
  }

  /**
   * EMA50 Alignment: Long-term trend confirmation
   */
  private checkEMA50Alignment(price: number, candles: Candle[], direction: string): boolean {
    if (candles.length < 50) return false;

    const ema50 = this.calculateEMA(candles, 50);
    const tolerance = Math.abs(price - ema50) / price;

    if (direction === 'buy') {
      return price > ema50 && tolerance < 0.02; // Above EMA50 for uptrend
    } else {
      return price < ema50 && tolerance < 0.02; // Below EMA50 for downtrend
    }
  }

  /**
   * RSI Alignment: Momentum confirmation (30-70 range)
   */
  private checkRSIAlignment(candles: Candle[], direction: string): boolean {
    if (candles.length < 14) return false;

    const rsi = this.calculateRSI(candles, 14);

    if (direction === 'buy') {
      return rsi > 40 && rsi < 70; // Bullish but not overbought
    } else {
      return rsi > 30 && rsi < 60; // Bearish but not oversold
    }
  }

  /**
   * Volume Pressure: Recent volume alignment with direction
   */
  private checkVolumePressure(candles: Candle[], direction: string): boolean {
    if (candles.length < 5) return false;

    const recentCandles = candles.slice(-5);
    const avgVolume = recentCandles.reduce((sum, c) => sum + (c.volume || 0), 0) / 5;

    let bullishCandles = 0;
    for (const candle of recentCandles) {
      const close = candle.close;
      const open = candle.open;
      const isBullish = close > open;
      const isHighVolume = (candle.volume || 0) > avgVolume * 0.8;

      if (isBullish && isHighVolume) bullishCandles++;
    }

    if (direction === 'buy') {
      return bullishCandles >= 2; // At least 2 bullish candles with volume
    } else {
      return recentCandles.length - bullishCandles >= 2; // At least 2 bearish candles
    }
  }

  /**
   * Candle Pattern: Recent candle structure
   */
  private checkCandlePattern(candles: Candle[], direction: string): boolean {
    if (candles.length < 3) return false;

    const recentCandle = candles[candles.length - 1];
    const previousCandle = candles[candles.length - 2];

    const recentIsBullish = recentCandle.close > recentCandle.open;
    const recentIsGrowing = recentCandle.close > previousCandle.close;

    if (direction === 'buy') {
      return recentIsBullish && recentIsGrowing;
    } else {
      return !recentIsBullish && !recentIsGrowing;
    }
  }

  /**
   * Structure: Higher highs/lows pattern
   */
  private checkStructure(candles: Candle[], direction: string): boolean {
    if (candles.length < 5) return false;

    const recent = candles.slice(-5);
    const highs = recent.map(c => c.high);
    const lows = recent.map(c => c.low);

    const isHigherHighs = highs[4] > highs[2] && highs[2] > highs[0];
    const isHigherLows = lows[4] > lows[2] && lows[2] > lows[0];

    if (direction === 'buy') {
      return isHigherHighs || isHigherLows; // Uptrend structure
    } else {
      const isLowerHighs = highs[4] < highs[2] && highs[2] < highs[0];
      const isLowerLows = lows[4] < lows[2] && lows[2] < lows[0];
      return isLowerHighs || isLowerLows; // Downtrend structure
    }
  }

  /**
   * Momentum: Rate of price change
   */
  private checkMomentum(candles: Candle[], direction: string): boolean {
    if (candles.length < 10) return false;

    const recent = candles.slice(-10);
    const change = (recent[9].close - recent[0].close) / recent[0].close;

    if (direction === 'buy') {
      return change > 0.001; // Positive momentum
    } else {
      return change < -0.001; // Negative momentum
    }
  }

  /**
   * Helper: Calculate VWAP
   */
  private calculateVWAP(candles: Candle[]): number {
    let cumPQ = 0;
    let cumQ = 0;

    for (const candle of candles) {
      const tp = (candle.high + candle.low + candle.close) / 3;
      const volume = candle.volume || 1;
      cumPQ += tp * volume;
      cumQ += volume;
    }

    return cumQ > 0 ? cumPQ / cumQ : candles[candles.length - 1].close;
  }

  /**
   * Helper: Calculate EMA
   */
  private calculateEMA(candles: Candle[], period: number): number {
    if (candles.length < period) return candles[candles.length - 1].close;

    const multiplier = 2 / (period + 1);
    let ema = 0;

    // Calculate initial SMA
    for (let i = 0; i < period; i++) {
      ema += candles[i].close;
    }
    ema /= period;

    // Calculate EMA
    for (let i = period; i < candles.length; i++) {
      ema = candles[i].close * multiplier + ema * (1 - multiplier);
    }

    return ema;
  }

  /**
   * Helper: Calculate RSI
   */
  private calculateRSI(candles: Candle[], period: number = 14): number {
    if (candles.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i < candles.length; i++) {
      const change = candles[i].close - candles[i - 1].close;
      if (change > 0) gains += change;
      else losses += Math.abs(change);
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    const rsi = 100 - 100 / (1 + rs);

    return rsi;
  }

  /**
   * Determine color code based on confidence
   */
  private getColorCode(confidence: number): 'green' | 'yellow' | 'orange' | 'gray' {
    if (confidence >= 80) return 'green';
    if (confidence >= 70) return 'yellow';
    if (confidence >= 60) return 'orange';
    return 'gray';
  }

  /**
   * Build reasoning strings explaining the confidence
   */
  private buildReasoning(indicators: IndicatorAlignment, direction: string, alignedCount: number): string[] {
    const reasons: string[] = [];
    const alignment = Object.entries(indicators)
      .filter(([_, aligned]) => aligned)
      .map(([key]) => key);

    if (alignedCount >= 7) {
      reasons.push('Strong multi-indicator confluence');
    } else if (alignedCount >= 5) {
      reasons.push('Good indicator alignment');
    } else if (alignedCount >= 3) {
      reasons.push('Moderate indicator agreement');
    } else {
      reasons.push('Weak signal, mixed indicators');
    }

    if (indicators.structure) reasons.push('Structure confirms trend direction');
    if (indicators.vwap && indicators.ema20) reasons.push('Price, VWAP, and EMA20 aligned');
    if (indicators.volumePressure) reasons.push('Volume confirms movement');
    if (!indicators.rsi) reasons.push('RSI caution');

    return reasons.slice(0, 3); // Top 3 reasons
  }

  /**
   * Handle insufficient data
   */
  private getInsufficientDataResult(symbol: string): ProbabilityResult {
    return {
      symbol,
      confidence: 0,
      direction: 'neutral',
      alignedCount: 0,
      totalIndicators: this.INDICATOR_COUNT,
      indicators: {
        vwap: false,
        ema20: false,
        ema50: false,
        rsi: false,
        volumePressure: false,
        candlePattern: false,
        structure: false,
        momentum: false
      },
      reasoning: ['Insufficient data for analysis'],
      colorCode: 'gray'
    };
  }

  /**
   * Store probability result for audit trail (optional)
   */
  async storeProbabilityScore(
    userId: string,
    sessionName: string,
    result: ProbabilityResult
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('trade_probability_scores')
        .insert({
          user_id: userId,
          session_name: sessionName,
          symbol: result.symbol,
          trade_direction: result.direction,
          confidence_score: result.confidence,
          indicator_alignment: result.indicators
        });

      if (error) {
        logger.warn('[Probability Analyzer] Failed to store score:', error);
      }
    } catch (err) {
      logger.warn('[Probability Analyzer] Store error:', err);
    }
  }
}

export const sessionTradeProbabilityAnalyzer = new SessionTradeProbabilityAnalyzer();
