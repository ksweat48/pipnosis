/**
 * Adversarial Detector - Stop Hunt & Manipulation Detection
 *
 * Detects hostile market behavior using ONLY local computations (no LLM calls).
 * Identifies stop runs, fake breakouts, whipsaws, and news spikes.
 *
 * This module acts as a zero-cost intelligence gate that blocks trades
 * before expensive Alpha/Omega calls during manipulated market conditions.
 */

import type { RegimeSnapshot } from './regime-oracle';

export interface AdversarialSignal {
  is_adversarial: boolean;
  level: 'none' | 'mild' | 'moderate' | 'severe';
  suspicion_score: number; // 0-100
  patterns: string[]; // ["stop_run_high", "whipsaw_cluster"]
  recommended_action: 'normal' | 'reduce_size' | 'delay' | 'avoid';
  notes: string; // short, 80 chars max
}

export interface MarketState {
  price: number;
  ema20: number;
  ema50: number;
  ema200?: number;
  atr: number;
  rsi: number;
  vwap?: number;
  swingHigh?: number;
  swingLow?: number;
  spread?: number;
}

export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  time?: number;
  open_time?: string | Date;
}

interface CandleAnalysis {
  wick_high: number;
  wick_low: number;
  body: number;
  direction: 'up' | 'down';
  range: number;
}

class AdversarialDetector {
  /**
   * Evaluate market for adversarial patterns
   * Returns adversarial signal with suspicion score and recommended action
   */
  evaluate(
    marketState: MarketState,
    recentCandles: Candle[],
    regime?: RegimeSnapshot
  ): AdversarialSignal {
    if (!recentCandles || recentCandles.length < 10) {
      return this.createCleanSignal();
    }

    const patterns: string[] = [];
    let suspicion_score = 0;

    // Analyze recent candles for patterns
    const candleAnalyses = this.analyzeCandleSet(recentCandles);
    const avgCandleRange = this.calculateAverageCandleRange(recentCandles);

    // A) STOP RUN DETECTION
    const stopRunPatterns = this.detectStopRuns(
      recentCandles,
      candleAnalyses,
      marketState
    );
    patterns.push(...stopRunPatterns);
    suspicion_score += stopRunPatterns.length * 20;

    // B) FAKE BREAKOUT DETECTION
    const fakeBreakoutPatterns = this.detectFakeBreakouts(
      recentCandles,
      marketState
    );
    patterns.push(...fakeBreakoutPatterns);
    suspicion_score += fakeBreakoutPatterns.length * 20;

    // C) NEWS SPIKE DETECTION
    const spikePatterns = this.detectNewsSpikes(
      recentCandles,
      avgCandleRange
    );
    patterns.push(...spikePatterns);
    if (spikePatterns.includes('extreme_spike')) {
      suspicion_score += 35;
    } else if (spikePatterns.includes('news_spike')) {
      suspicion_score += 25;
    }

    // D) WHIPSAW CLUSTER DETECTION
    const whipsawDetected = this.detectWhipsawCluster(candleAnalyses);
    if (whipsawDetected) {
      patterns.push('whipsaw_cluster');
      suspicion_score += 20;
    }

    // E) SPREAD SPIKE DETECTION (if available)
    if (marketState.spread !== undefined) {
      const spreadAvg = marketState.atr * 0.1; // Estimate
      if (marketState.spread > spreadAvg * 2) {
        patterns.push('spread_spike');
        suspicion_score += 15;
      }
    }

    // F) REGIME-AWARE ENHANCEMENTS
    if (regime) {
      const regimeBonus = this.calculateRegimeBonus(patterns, regime);
      suspicion_score += regimeBonus;
    }

    // Clamp score to 0-100
    suspicion_score = Math.min(100, Math.max(0, suspicion_score));

    // Classify level and determine action
    const level = this.classifyLevel(suspicion_score);
    const recommended_action = this.determineAction(level);
    const is_adversarial = level !== 'none';
    const notes = this.generateNotes(patterns, level);

    console.log(`[Adversarial] Score: ${suspicion_score}, Level: ${level}`);
    if (patterns.length > 0) {
      console.log(`[Adversarial] Patterns: ${patterns.join(', ')}`);
    }

    return {
      is_adversarial,
      level,
      suspicion_score,
      patterns,
      recommended_action,
      notes
    };
  }

  /**
   * Analyze a set of candles for basic metrics
   */
  private analyzeCandleSet(candles: Candle[]): CandleAnalysis[] {
    return candles.map(c => this.analyzeCandle(c));
  }

  /**
   * Analyze single candle
   */
  private analyzeCandle(candle: Candle): CandleAnalysis {
    const body = Math.abs(candle.close - candle.open);
    const maxOC = Math.max(candle.open, candle.close);
    const minOC = Math.min(candle.open, candle.close);
    const wick_high = candle.high - maxOC;
    const wick_low = minOC - candle.low;
    const direction = candle.close >= candle.open ? 'up' : 'down';
    const range = candle.high - candle.low;

    return { wick_high, wick_low, body, direction, range };
  }

  /**
   * Detect stop runs (long wicks rejecting back into range)
   */
  private detectStopRuns(
    candles: Candle[],
    analyses: CandleAnalysis[],
    marketState: MarketState
  ): string[] {
    const patterns: string[] = [];
    const recentCount = Math.min(20, candles.length);
    const recentCandles = candles.slice(-recentCount);
    const recentAnalyses = analyses.slice(-recentCount);

    for (let i = 1; i < recentCandles.length; i++) {
      const candle = recentCandles[i];
      const analysis = recentAnalyses[i];
      const prevCandle = recentCandles[i - 1];

      // Long upper wick (potential stop run high)
      const longUpperWick =
        analysis.wick_high > analysis.body * 2 &&
        analysis.wick_high > marketState.atr * 0.5;

      if (longUpperWick) {
        // Check if it rejected near resistance (swing high or recent high)
        const nearResistance = marketState.swingHigh
          ? Math.abs(candle.high - marketState.swingHigh) < marketState.atr * 0.3
          : false;

        // Check if closed back inside previous range
        const closedInsideRange =
          candle.close < Math.max(prevCandle.open, prevCandle.close);

        if (nearResistance || closedInsideRange) {
          patterns.push('stop_run_high');
        }
      }

      // Long lower wick (potential stop run low)
      const longLowerWick =
        analysis.wick_low > analysis.body * 2 &&
        analysis.wick_low > marketState.atr * 0.5;

      if (longLowerWick) {
        // Check if it rejected near support (swing low or recent low)
        const nearSupport = marketState.swingLow
          ? Math.abs(candle.low - marketState.swingLow) < marketState.atr * 0.3
          : false;

        // Check if closed back inside previous range
        const closedInsideRange =
          candle.close > Math.min(prevCandle.open, prevCandle.close);

        if (nearSupport || closedInsideRange) {
          patterns.push('stop_run_low');
        }
      }
    }

    // Remove duplicates
    return Array.from(new Set(patterns));
  }

  /**
   * Detect fake breakouts
   */
  private detectFakeBreakouts(
    candles: Candle[],
    marketState: MarketState
  ): string[] {
    const patterns: string[] = [];

    if (!marketState.swingHigh && !marketState.swingLow) {
      return patterns;
    }

    const recentCount = Math.min(10, candles.length);
    const recentCandles = candles.slice(-recentCount);

    for (let i = 1; i < recentCandles.length; i++) {
      const candle = recentCandles[i];
      const prevCandle = recentCandles[i - 1];

      // Fake breakout UP
      if (marketState.swingHigh) {
        const breakoutDistance = candle.high - marketState.swingHigh;
        const brokeAbove = breakoutDistance > marketState.atr * 0.2;
        const closedBelow = candle.close < marketState.swingHigh;

        if (brokeAbove && closedBelow) {
          patterns.push('fake_breakout_up');
        }
      }

      // Fake breakout DOWN
      if (marketState.swingLow) {
        const breakoutDistance = marketState.swingLow - candle.low;
        const brokeBelow = breakoutDistance > marketState.atr * 0.2;
        const closedAbove = candle.close > marketState.swingLow;

        if (brokeBelow && closedAbove) {
          patterns.push('fake_breakout_down');
        }
      }
    }

    // Remove duplicates
    return Array.from(new Set(patterns));
  }

  /**
   * Detect news spikes / extreme volatility candles
   */
  private detectNewsSpikes(
    candles: Candle[],
    avgCandleRange: number
  ): string[] {
    const patterns: string[] = [];

    if (candles.length < 2) {
      return patterns;
    }

    const lastCandle = candles[candles.length - 1];
    const lastRange = lastCandle.high - lastCandle.low;

    // News spike: 2.5x average range
    if (lastRange > avgCandleRange * 2.5) {
      patterns.push('news_spike');
    }

    // Extreme spike: 3.5x average range
    if (lastRange > avgCandleRange * 3.5) {
      patterns.push('extreme_spike');
    }

    return patterns;
  }

  /**
   * Detect whipsaw cluster (excessive direction changes)
   */
  private detectWhipsawCluster(analyses: CandleAnalysis[]): boolean {
    const recentCount = Math.min(10, analyses.length);
    const recentAnalyses = analyses.slice(-recentCount);

    let flips = 0;
    for (let i = 1; i < recentAnalyses.length; i++) {
      if (recentAnalyses[i].direction !== recentAnalyses[i - 1].direction) {
        flips++;
      }
    }

    // 7+ flips in 10 candles = whipsaw cluster
    return flips >= 7;
  }

  /**
   * Calculate average candle range
   */
  private calculateAverageCandleRange(candles: Candle[]): number {
    const count = Math.min(50, candles.length);
    const recentCandles = candles.slice(-count);

    const sum = recentCandles.reduce((acc, c) => acc + (c.high - c.low), 0);
    return sum / recentCandles.length;
  }

  /**
   * Calculate regime-based scoring bonus
   */
  private calculateRegimeBonus(
    patterns: string[],
    regime: RegimeSnapshot
  ): number {
    let bonus = 0;

    // High volatility bonus
    if (regime.volatility_score > 80) {
      bonus += 10;
    }

    // Session open + manipulation patterns
    const hasManipulation =
      patterns.some(p => p.includes('stop_run')) ||
      patterns.some(p => p.includes('fake_breakout')) ||
      patterns.some(p => p.includes('spike'));

    if (hasManipulation) {
      if (regime.session === 'ny_open' || regime.session_open) {
        bonus += 15;
      } else if (regime.session === 'london_open') {
        bonus += 10;
      }
    }

    // Range structure + stop runs
    if (regime.structure === 'range' && patterns.some(p => p.includes('stop_run'))) {
      bonus += 10;
    }

    return bonus;
  }

  /**
   * Classify suspicion level
   */
  private classifyLevel(score: number): 'none' | 'mild' | 'moderate' | 'severe' {
    if (score >= 70) return 'severe';
    if (score >= 40) return 'moderate';
    if (score >= 20) return 'mild';
    return 'none';
  }

  /**
   * Determine recommended action based on level
   */
  private determineAction(
    level: 'none' | 'mild' | 'moderate' | 'severe'
  ): 'normal' | 'reduce_size' | 'delay' | 'avoid' {
    switch (level) {
      case 'severe':
        return 'avoid';
      case 'moderate':
        return 'delay';
      case 'mild':
        return 'reduce_size';
      default:
        return 'normal';
    }
  }

  /**
   * Generate short diagnostic notes
   */
  private generateNotes(
    patterns: string[],
    level: 'none' | 'mild' | 'moderate' | 'severe'
  ): string {
    if (patterns.length === 0) {
      return 'Clean market conditions';
    }

    // Build concise summary
    const stopRuns = patterns.filter(p => p.includes('stop_run')).length;
    const fakeBreakouts = patterns.filter(p => p.includes('fake_breakout')).length;
    const hasWhipsaw = patterns.includes('whipsaw_cluster');
    const hasSpike = patterns.some(p => p.includes('spike'));
    const hasSpread = patterns.includes('spread_spike');

    const parts: string[] = [];

    if (stopRuns > 0) {
      parts.push(`${stopRuns} stop run${stopRuns > 1 ? 's' : ''}`);
    }
    if (fakeBreakouts > 0) {
      parts.push(`${fakeBreakouts} fakeout${fakeBreakouts > 1 ? 's' : ''}`);
    }
    if (hasWhipsaw) {
      parts.push('whipsaw');
    }
    if (hasSpike) {
      parts.push(patterns.includes('extreme_spike') ? 'extreme spike' : 'spike');
    }
    if (hasSpread) {
      parts.push('wide spread');
    }

    let notes = parts.join(', ');

    // Add level prefix for severe/moderate
    if (level === 'severe') {
      notes = 'HOSTILE: ' + notes;
    } else if (level === 'moderate') {
      notes = 'CAUTION: ' + notes;
    }

    // Truncate to 80 chars
    if (notes.length > 80) {
      notes = notes.substring(0, 77) + '...';
    }

    return notes;
  }

  /**
   * Create clean signal (no adversarial patterns detected)
   */
  private createCleanSignal(): AdversarialSignal {
    return {
      is_adversarial: false,
      level: 'none',
      suspicion_score: 0,
      patterns: [],
      recommended_action: 'normal',
      notes: 'Clean market conditions'
    };
  }
}

export const adversarialDetector = new AdversarialDetector();
